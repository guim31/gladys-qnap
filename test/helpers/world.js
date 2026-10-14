// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake NAS on a fake network,
// a temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless asked (`timers: true`, under
// mocked timers): the tests read the NAS with `tick(world)`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { deviceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { FakeQnap, NAS_SERIAL, PASSWORD, USERNAME, createNetwork } from './fakeQnap.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const ORIGIN = 'http://192.0.2.50:8080';
export const NAS_ID = NAS_SERIAL;

export const CONFIG = {
  address: '192.0.2.50',
  username: USERNAME,
  password: PASSWORD,
  accept_self_signed: false,
  poll_interval: '60',
  ups: true,
  allow_power_actions: false,
  language: 'en',
};

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {FakeQnap} [options.nas] the NAS at ORIGIN
 * @param {Record<string, FakeQnap>} [options.network] NAS by origin (overrides `nas`)
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the hub's own timers (mock them first)
 */
export async function createWorld({
  clock = createClock(),
  nas = new FakeQnap(),
  network,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-qnap-')),
  timings = {},
  timers = false,
} = {}) {
  const net = createNetwork(network ?? { [ORIGIN]: nas });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: net.request,
    nutExchange: net.nutExchange,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, nas, network: net, app, hub: app.hub, clock, dataDir };
}

/** External id of a device: the NAS (`key` omitted), a volume, a disk, the UPS. */
export const deviceId = (gladys, type, key = null) => deviceIds(gladys, type, NAS_ID, key).device;

export const featureId = (gladys, type, key, feature) =>
  deviceIds(gladys, type, NAS_ID, key).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** One read of the NAS, as the timer does. */
export async function tick(world) {
  await world.hub.afterChanges(await world.hub.poll());
}
