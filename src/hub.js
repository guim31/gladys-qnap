// -----------------------------------------------------------------------------
// The NAS hub: reads the NAS on a timer of the container (the interval chosen
// in the configuration, one minute at most often), publishes the states of the
// devices the user added when they change, fires the scene events on
// transitions (src/alerts.js), runs the restart and shutdown the user allowed,
// and serves the views of the widget and of the "Test the connection" action.
//
// Gladys never polls these devices (should_poll: false, Gladys#3198): the
// configurable interval goes up to 5 minutes, beyond the fixed list of the
// core scheduler, and the scene events must fire for every volume and disk,
// added to Gladys or not.
//
// What one read costs the NAS (src/qnap/client.js): the system information,
// the volumes and the network rates at every read; the disks (SMART summary)
// every 5 minutes at most often; the firmware check every 6 hours; the UPS
// over NUT at every read when the NAS shares one, every 10 minutes otherwise.
//
// The 300 states per minute of Gladys: a few dozen features read once a minute
// at most, and only what changed is sent (publishChangedStates of the SDK);
// every value is sent again after 6 hours unchanged, before the core marks it
// outdated.
//
// Logs stay quiet: a normal read writes at the debug level only, and a failure
// that repeats on every read (Gladys refusing the states, a NAS that stays
// silent) writes one line when it starts and one when it ends.
//
// A refused password is never retried on the timer: QTS blocks an address
// after a few failed logins (IP access protection). Saving the configuration,
// "Test the connection" or the Refresh button of the widget try again.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import { hostOf, hostnameOf, isComplete } from './config.js';
import { DEVICE_TYPES, buildDevice, deviceIds, deviceStates } from './devices.js';
import { ERROR_KINDS, QnapClient } from './qnap/client.js';
import { parseSnapshot, parseUps } from './qnap/model.js';
import { NUT_ERRORS, NutError, readUps } from './qnap/nut.js';
import {
  CONNECTION_TEXT,
  DISK_STATE_TEXT,
  ERROR_TEXT,
  POWER_TEXT,
  REPORT_TEXT,
  VOLUME_STATE_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'qnap-hub' });

export const WIDGET_KEY = 'nas';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  VOLUME: 'volume_degraded',
  DISK: 'disk_alert',
  UPDATE: 'firmware_update',
});

export const HUB_TIMINGS = {
  // A NAS that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the NAS counts as offline.
  downAfterFailures: 2,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // The disks (SMART summary) are read this often at most.
  diskIntervalMs: 5 * 60_000,
  // The firmware check, this often.
  firmwareIntervalMs: 6 * 3600_000,
  // A NAS that shares no UPS is asked again this often.
  upsRetryMs: 10 * 60_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
// The errors that wait for the user instead of being retried on the timer: a
// wrong password (QTS blocks the address after a few), a 2-step verification
// account, an account without the right (each try is a login on the NAS).
const BLOCKING = new Set([ERROR_KINDS.AUTH, ERROR_KINDS.OTP, ERROR_KINDS.PERMISSION]);

const signature = (config) =>
  JSON.stringify([config.url, config.username, config.password, config.insecure]);

export class NasHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/qnap/http.js)
   * @param {Function} [options.nutExchange] NUT seam (src/qnap/nut.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, nutExchange, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.nutExchange = nutExchange;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    /** Whether the session kept under /data was offered to a client already. */
    this.sessionTried = false;
    this.watcher = new Watcher();
    this.resetRead();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
    /** The failures already logged, until they end (see failed/recovered). */
    this.failing = new Set();
  }

  resetRead() {
    /** @type {object|null} the last snapshot read (src/qnap/model.js) */
    this.snapshot = null;
    this.readAt = 0;
    this.disksAt = 0;
    this.firmwareAt = 0;
    this.error = null;
    this.failures = 0;
    this.down = false;
    /** The UPS: last values read, and how the last try went. */
    this.ups = { data: null, status: null, checkedAt: 0 };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load());
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config, { force: true });
  }

  async reconfigure(config, { force = false } = {}) {
    const previous = this.config;
    this.config = config;
    const wanted = isComplete(config) ? signature(config) : null;
    if (wanted !== this.signature) {
      this.signature = wanted;
      this.client = null;
      // Another address may be another NAS: nothing of the old one is kept.
      clearTimeout(this.retryTimer);
      this.resetRead();
      if (wanted) {
        const { url, username } = config;
        // The session kept under /data only serves the first start of the
        // container: after a change of the configuration (a new password, a
        // new certificate choice), the new settings must log in for real.
        let sid = null;
        if (this.sessionTried) {
          // The session of the previous settings is forgotten, on disk too.
          this.store.saveSession(url, username, null);
        } else {
          sid = await this.store.loadSession(url, username);
          this.sessionTried = true;
        }
        this.client = new QnapClient({
          url,
          username,
          password: config.password,
          insecure: config.insecure,
          request: this.request,
          sid,
          onSession: (value) => this.store.saveSession(url, username, value),
        });
      }
    }
    if (previous?.language !== config.language || previous?.ups !== config.ups) {
      this.discovered = null;
    }
    if (!config.ups) {
      this.ups = { data: null, status: null, checkedAt: 0 };
    }
    if (this.client) {
      // Saving the configuration is a manual request: a refused login is tried again.
      await this.poll({ manual: true });
    }
    await this.afterChanges(true, { publish: true, force });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.afterChanges(await this.poll());
        this.recovered('poll');
      } catch (err) {
        this.failed('poll', 'Read cycle failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  // --- Names and identities ----------------------------------------------------

  /** The platform id of the NAS: its serial number, else something stable enough. */
  get nasId() {
    if (this.snapshot?.platformId) {
      return this.snapshot.platformId;
    }
    if (this.watcher.saved.nas) {
      return this.watcher.saved.nas;
    }
    return this.config?.url
      ? `h${createHash('sha1').update(this.config.url).digest('hex').slice(0, 12)}`
      : null;
  }

  /** The NAS name: the one set in QTS, its model, or its address. */
  get nasName() {
    return (
      this.snapshot?.name ??
      this.snapshot?.model ??
      (this.config?.url ? hostOf(this.config.url) : 'QNAP')
    );
  }

  nasDeviceId() {
    return deviceIds(this.gladys, DEVICE_TYPES.NAS, this.nasId).device;
  }

  /** Every device the snapshot proposes: the NAS, its volumes, its disks, its UPS. */
  items() {
    const { snapshot } = this;
    if (!snapshot) {
      return [];
    }
    const nas = this.nasName;
    const items = [
      {
        type: DEVICE_TYPES.NAS,
        key: null,
        name: nas,
        model: snapshot.model ? `QNAP ${snapshot.model}` : 'QNAP',
        item: snapshot,
      },
      ...(snapshot.volumes ?? []).map((volume) => ({
        type: DEVICE_TYPES.VOLUME,
        key: volume.key,
        name: `${nas} ${volume.label}`,
        model: volume.level ? `Volume ${volume.level}` : 'Volume',
        item: volume,
      })),
      ...(snapshot.disks ?? []).map((disk) => ({
        type: DEVICE_TYPES.DISK,
        key: disk.key,
        name: `${nas} ${disk.label}`,
        model: disk.model,
        item: disk,
      })),
    ];
    if (this.ups.data) {
      items.push({
        type: DEVICE_TYPES.UPS,
        key: DEVICE_TYPES.UPS,
        name: `${nas} UPS`,
        model: this.ups.data.model ?? 'UPS',
        // Its values only while the NAS shares it.
        item: this.ups.status === 'ok' ? this.ups.data : null,
      });
    }
    return items;
  }

  /** The created devices of this NAS, with what they stand for in the last read (null: gone). */
  createdDevices() {
    const nasId = this.nasId;
    if (!nasId) {
      return [];
    }
    const byId = new Map(
      this.items().map((entry) => [
        deviceIds(this.gladys, entry.type, nasId, entry.key).device,
        entry,
      ]),
    );
    const nasDevice = this.nasDeviceId();
    const created = [];
    for (const device of this.gladys.devices ?? []) {
      const entry = byId.get(device.external_id);
      if (entry) {
        created.push({ device, ...entry });
      } else if (device.external_id === nasDevice) {
        // The NAS before its first answer, or offline.
        created.push({ device, type: DEVICE_TYPES.NAS, key: null, item: null });
      }
    }
    return created;
  }

  isOurs(externalId) {
    return this.createdDevices().some(({ device }) => device.external_id === externalId);
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const nasId = this.nasId;
    return this.items().map((entry) =>
      buildDevice(this.gladys, {
        ...entry,
        // The structure of the UPS does not depend on its values.
        item: entry.type === DEVICE_TYPES.UPS ? this.ups.data : entry.item,
        nasId,
        language: this.config.language,
      }),
    );
  }

  /** Publish the Discovery list when it changed (a disk added, a volume created…). */
  async publishDevices({ force = false } = {}) {
    if (!this.snapshot && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    if (devices.length === 0 && this.discovered === null && !force) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.recovered('discovery');
    } catch (err) {
      this.failed('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the NAS, publish the list again. */
  async rediscover() {
    await this.poll({ manual: true });
    await this.afterChanges(true, { publish: true });
  }

  /** The user added (or updated) a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.isOurs(device.external_id)) {
      return;
    }
    // A device deleted then added again is a new row in Gladys: no badge yet.
    this.transports.delete(device.external_id);
    await this.publishStates({ force: true, only: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  onDeviceDeleted(device) {
    if (typeof device?.external_id === 'string') {
      this.transports.delete(device.external_id);
    }
  }

  // --- Reading the NAS -----------------------------------------------------------

  /**
   * Read the NAS and apply what changed. Concurrent calls share the read. A
   * refused login is only tried again on a manual request.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll({ manual = false } = {}) {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!manual && this.error && BLOCKING.has(this.error.kind)) {
      return Promise.resolve(false);
    }
    const client = this.client;
    this.polling ??= this.read(client).finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /**
   * onPoll, should Gladys ever poll: the hub already reads on its own timer,
   * so a read less than half an interval old is enough.
   */
  async pollIfStale() {
    if (this.readAt && this.now() - this.readAt < this.config.pollIntervalMs / 2) {
      return false;
    }
    return this.poll();
  }

  async read(client) {
    const now = this.now();
    const disks = !this.snapshot?.disks || now - this.disksAt >= this.timings.diskIntervalMs;
    const firmware = now - this.firmwareAt >= this.timings.firmwareIntervalMs;
    try {
      const raw = await client.read({ disks, firmware });
      if (client !== this.client) {
        return false;
      }
      if (disks) {
        this.disksAt = now;
      }
      if (firmware) {
        this.firmwareAt = now;
      }
      await this.readUps();
      return await this.applySuccess(raw, { disks, firmware });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return client === this.client ? this.applyFailure(err) : false;
    }
  }

  /** The UPS the NAS shares over NUT, when the configuration asks for it. */
  async readUps() {
    if (!this.config.ups) {
      return;
    }
    const { status, checkedAt } = this.ups;
    if (status !== 'ok' && checkedAt && this.now() - checkedAt < this.timings.upsRetryMs) {
      return;
    }
    this.ups.checkedAt = this.now();
    try {
      const variables = await readUps({
        host: hostnameOf(this.config.url),
        ...(this.nutExchange ? { exchange: this.nutExchange } : {}),
      });
      if (this.ups.status !== 'ok') {
        logger.info(`UPS found on the NAS${this.ups.data ? ' again' : ''}`);
      }
      this.ups.data = parseUps(variables);
      this.ups.status = 'ok';
      this.recovered('ups');
    } catch (err) {
      if (!(err instanceof NutError)) {
        throw err;
      }
      const was = this.ups.status;
      this.ups.status = err.kind;
      if (err.kind === NUT_ERRORS.ABSENT && was !== 'ok') {
        // The usual case: the NAS shares no UPS.
        logger.debug(`No UPS: ${err.message}`);
      } else {
        this.failed('ups', `UPS: ${err.message}`);
      }
    }
  }

  /** Keep what a part that failed this time said before, so the devices do not flicker. */
  merge(snapshot, { disks, firmware }) {
    const previous = this.snapshot;
    if (!disks) {
      snapshot.disks = previous?.disks ?? null;
    }
    if (!firmware) {
      snapshot.update = previous?.update ?? null;
      snapshot.updateKnown = previous?.updateKnown ?? false;
    }
    for (const part of ['volumes', 'disks']) {
      if (snapshot[part] === null && previous?.[part]) {
        snapshot[part] = previous[part];
      }
    }
    if (snapshot.interfaces === null && previous?.interfaces) {
      // The interfaces stay, without rates.
      snapshot.interfaces = previous.interfaces.map((nic) => ({ ...nic, rx: null, tx: null }));
    }
    return snapshot;
  }

  async applySuccess(raw, parts) {
    const snapshot = this.merge(parseSnapshot(raw), parts);
    logger.debug(
      `Read: ${snapshot.volumes?.length ?? 0} volume(s), ${snapshot.disks?.length ?? 0} disk(s)`,
    );
    const widgetChanged = this.error !== null || this.readAt === 0 || this.down;
    if (this.error || this.down) {
      logger.info(`${this.config.url ? hostOf(this.config.url) : 'NAS'} answers again`);
    }
    for (const [part, message] of Object.entries(snapshot.errors)) {
      this.failed(`part ${part}`, `Cannot read the ${part}: ${message}`);
    }
    for (const part of ['volumes', 'disks', 'bandwidth', 'firmware']) {
      if (raw[part] && !snapshot.errors[part]) {
        this.recovered(`part ${part}`);
      }
    }
    if (!this.snapshot) {
      logger.info(
        `Connected to ${snapshot.model ?? 'a QNAP NAS'} (${snapshot.hero ? 'QuTS hero' : 'QTS'} ` +
          `${snapshot.version ?? '?'}), ${snapshot.volumes?.length ?? 0} volume(s), ` +
          `${snapshot.disks?.length ?? 0} disk(s)`,
      );
    }
    this.snapshot = snapshot;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = this.now();
    clearTimeout(this.retryTimer);

    this.watcher.bind(this.nasId);
    let changed = widgetChanged;
    const language = this.config.language;
    const nasName = this.nasName;
    const nasId = this.nasId;
    for (const volume of this.watcher.volumes(snapshot.volumes)) {
      changed = true;
      logger.warn(`${nasName} ${volume.label}: ${volume.state} (volumeStatus ${volume.code})`);
      await this.fireEvent(TRIGGERS.VOLUME, {
        volume: deviceIds(this.gladys, DEVICE_TYPES.VOLUME, nasId, volume.key).device,
        nas_name: nasName,
        volume_name: volume.label,
        state: pick(VOLUME_STATE_TEXT[volume.state], language),
      });
    }
    for (const disk of this.watcher.disks(snapshot.disks)) {
      changed = true;
      logger.warn(`${nasName} ${disk.label}: SMART ${disk.state}`);
      await this.fireEvent(TRIGGERS.DISK, {
        disk: deviceIds(this.gladys, DEVICE_TYPES.DISK, nasId, disk.key).device,
        nas_name: nasName,
        disk_name: disk.label,
        model: disk.model,
        state: pick(DISK_STATE_TEXT[disk.state], language),
        temperature: disk.temperature,
      });
    }
    if (parts.firmware && snapshot.updateKnown && this.watcher.firmware(snapshot.update)) {
      changed = true;
      logger.info(`${nasName}: firmware ${snapshot.update.version} available`);
      await this.fireEvent(TRIGGERS.UPDATE, {
        nas_name: nasName,
        current_version: snapshot.version ?? '',
        new_version: snapshot.update.label,
      });
    }
    this.store.save(this.watcher.saved);
    await this.publishStates();
    return changed;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`NAS: ${err.message}`);
    }
    // Only silence counts as offline: a refused password is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      await this.publishStates();
      return true;
    }
    if (this.down) {
      await this.publishStates();
    }
    return wasError !== err.kind;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.poll()
        .then((changed) => this.afterChanges(changed))
        .then(() => this.recovered('poll'))
        .catch((err) => this.failed('poll', 'Read cycle failed', err));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.recovered('scene event');
    } catch (err) {
      this.failed('scene event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /**
   * A failure that may repeat on every read: logged when it starts, then at
   * the debug level only, until recovered() logs its end.
   */
  failed(key, message, err) {
    // An exception (err given) is a bug: error, with its stack.
    const first = err ? logger.error : logger.warn;
    const log = this.failing.has(key) ? logger.debug : first;
    this.failing.add(key);
    log(...(err ? [message, err] : [message]));
  }

  recovered(key) {
    if (this.failing.delete(key)) {
      logger.info(`${key}: back to normal`);
    }
  }

  // --- Power (scene actions) -------------------------------------------------------

  /**
   * Restart or shut down the NAS, for a scene: only when the user allowed it
   * in the configuration. Throws (the scene logs it) otherwise.
   * @param {'restart'|'shutdown'} action
   */
  async power(action) {
    const language = this.config?.language;
    if (!this.config?.powerActions) {
      throw new Error(pick(POWER_TEXT.disabled, language));
    }
    if (!this.client || !this.snapshot || this.error) {
      throw new Error(pick(POWER_TEXT.notConnected, language));
    }
    logger.info(`${this.nasName}: ${action} sent by a scene`);
    try {
      await this.client.power(action);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.nasName}: ${action} refused: ${err.message}`);
      throw new Error(labelled(this.nasName, pick(ERROR_TEXT[err.kind], language), language), {
        cause: err,
      });
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The states of the devices the user added.
   * @param {object} [options]
   * @param {boolean} [options.force] send even unchanged values (a device just added)
   * @param {string} [options.only] the external id of the one device to send
   */
  async publishStates({ force = false, only = null } = {}) {
    const nasId = this.nasId;
    const context = {
      online: this.error === null && this.snapshot !== null,
      language: this.config.language,
    };
    const states = [];
    for (const { device, type, key, item } of this.createdDevices()) {
      if (only && device.external_id !== only) {
        continue;
      }
      if (this.error || !this.snapshot) {
        // Nothing read: only say the NAS is offline once it is.
        if (type === DEVICE_TYPES.NAS && this.down) {
          states.push(
            ...deviceStates(this.gladys, { type, nasId, key, item: null, context }).filter(
              (state) => state.device_feature_external_id.endsWith(':online'),
            ),
          );
        }
        continue;
      }
      if (item === null) {
        continue;
      }
      states.push(...deviceStates(this.gladys, { type, nasId, key, item, context }));
    }
    if (states.length === 0) {
      return;
    }
    try {
      if (force) {
        // Sent again even unchanged, and remembered for the next comparisons.
        this.gladys.forgetPublishedStates(only ?? undefined);
      }
      // Batches of 100 at most: done by the SDK.
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('states');
    } catch (err) {
      this.failed('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false, force = false } = {}) {
    await this.publishDevices({ force: publish });
    if (force) {
      await this.publishStates({ force: true });
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const entries = [];
    for (const { device, type, item } of this.createdDevices()) {
      // A UPS the NAS no longer shares is unreachable, the NAS itself fine.
      const reachable = this.error === null && (type !== DEVICE_TYPES.UPS || item !== null);
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    let refused = false;
    for (let index = 0; index < entries.length; index += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(index, index + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        refused = true;
        this.failed('transports', `Transports refused: ${err.message}`);
      }
    }
    if (entries.length > 0 && !refused) {
      this.recovered('transports');
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config || !this.client) {
      return {
        connected: false,
        message: this.config?.addressInvalid
          ? CONNECTION_TEXT.invalidAddress
          : CONNECTION_TEXT.notConfigured,
      };
    }
    if (!this.error) {
      return { connected: this.snapshot !== null };
    }
    const message = {};
    for (const language of Object.keys(ERROR_TEXT[this.error.kind])) {
      message[language] = labelled(
        this.nasName,
        pick(ERROR_TEXT[this.error.kind], language),
        language,
      ).slice(0, 200);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.recovered('connection status');
    } catch (err) {
      this.failed('connection status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, test action) --------------------------------------------------

  /** What the widget shows of the NAS. */
  view() {
    return {
      configured: Boolean(this.client),
      name: this.nasName,
      online: this.error === null && this.snapshot !== null,
      error: this.error,
      snapshot: this.snapshot,
      ups: this.ups.status === 'ok' ? this.ups.data : null,
    };
  }

  /** "Test the connection": read the NAS now, one line. */
  async testConnection() {
    if (this.client) {
      // A manual request: the UPS is asked again too.
      this.ups.checkedAt = 0;
      await this.afterChanges(await this.poll({ manual: true }), { publish: true });
    }
    const message = {};
    for (const [language, words] of Object.entries(REPORT_TEXT)) {
      if (!this.client) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      if (this.error) {
        message[language] = labelled(
          this.nasName,
          pick(ERROR_TEXT[this.error.kind], language),
          language,
        );
        continue;
      }
      const { snapshot } = this;
      const parts = [
        words.ok,
        [
          snapshot.model,
          snapshot.version ? `${snapshot.hero ? 'QuTS hero' : 'QTS'} ${snapshot.version}` : null,
        ]
          .filter(Boolean)
          .join(', '),
        words.volumes(snapshot.volumes?.length ?? 0),
        words.disks(snapshot.disks?.length ?? 0),
      ];
      if (this.ups.status === 'ok') {
        parts.push(words.ups);
      } else if (this.ups.status === NUT_ERRORS.DENIED) {
        parts.push(words.upsDenied);
      }
      if (this.client.account && !this.client.account.admin) {
        parts.push(words.notAdmin);
      }
      message[language] = labelled(this.nasName, parts.filter(Boolean).join(', '), language).slice(
        0,
        200,
      );
    }
    return message;
  }
}
