// -----------------------------------------------------------------------------
// The hub end to end, on the SDK's fake Gladys and the fake NAS: discovery,
// states (only the changes, everything again when a device is added), scene
// events on transitions only and their memory across a restart, the reading
// cadence of the disks and of the firmware, the UPS, the NAS offline, a refused
// password never retried on the timer, the session kept under /data, the
// connection status and the transport badges.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TYPES, FEATURE_KEYS } from '../src/devices.js';
import { HUB_TIMINGS, TRIGGERS } from '../src/hub.js';
import { DISK_KEYS, FakeQnap, UPS_ON_MAINS } from './helpers/fakeQnap.js';
import { CONFIG, createDevices, createWorld, deviceId, featureId, tick } from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const MINUTE = 60_000;

test('discovery proposes the NAS, its volume and its disks, nothing created', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => [device.name, device.model]),
    [
      ['NAS-TEST-9', 'QNAP TS-EC1280U'],
      ['NAS-TEST-9 DataVol1', 'Volume raid5'],
      ['NAS-TEST-9 Disk 1', 'WD30EFRX-68EUZN0'],
      ['NAS-TEST-9 Disk 2', 'WD30EFRX-68EUZN0'],
      ['NAS-TEST-9 Disk 3', 'WD30EFRX-68EUZN0'],
      ['NAS-TEST-9 Disk 4', 'WD30EFRX-68EUZN0'],
    ],
  );
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  const nas = world.fake.discoveredDevices[0];
  assert.deepEqual(
    nas.features.map((feature) => feature.name),
    [
      'Online',
      'CPU',
      'Memory',
      'CPU temperature',
      'System temperature',
      'Fan 1 (rpm)',
      'Fan 2 (rpm)',
      'Fan 3 (rpm)',
      'Fan 4 (rpm)',
      'Download LAN 1',
      'Upload LAN 1',
      'Download LAN 2',
      'Upload LAN 2',
      'Download LAN 3',
      'Upload LAN 3',
      'Download LAN 4',
      'Upload LAN 4',
      'Download LAN 5',
      'Upload LAN 5',
      'Download LAN 6',
      'Upload LAN 6',
      'Download LAN 5+6',
      'Upload LAN 5+6',
      'Uptime',
      'Firmware version',
      'Update available',
    ],
  );
  assert.equal(world.fake.states.length, 0, 'nothing published before a device is added');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a device added gets all its states at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const nas = world.fake.discoveredDevices[0];
  await world.fake.deviceCreated(nas);
  const first = world.fake.states.length;
  const id = (key) => featureId(world.gladys, DEVICE_TYPES.NAS, null, key);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.CPU)), 1.2);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.ONLINE)), 1);
  assert.equal(world.fake.lastState(id('fan_3')), 6192);
  assert.equal(world.fake.lastState(id('download_eth3')), 0.04);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.VERSION)), '4.5.2.1594 build 20210302');
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.UPDATE)), 0);
  assert.equal(first, nas.features.length, 'every feature has a value');

  await tick(world);
  assert.equal(world.fake.states.length, first, 'nothing changed: nothing sent');
  world.nas.setCpu(55.55);
  await tick(world);
  assert.deepEqual(world.fake.states.slice(first), [
    { device_feature_external_id: id(FEATURE_KEYS.CPU), state: 55.6 },
  ]);
  assert.ok(world.fake.states.every((state) => state.device_feature_external_id.includes(':nas:')));
});

test('volume and disk states in the configured language, scene events on transitions', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await createDevices(world);
  const volume = (key) => featureId(world.gladys, DEVICE_TYPES.VOLUME, '1', key);
  const disk = (key) => featureId(world.gladys, DEVICE_TYPES.DISK, DISK_KEYS[1], key);
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.STATE)), 'Prêt');
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.ALERT)), 0);
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.USED_PERCENT)), 85.4);
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.FREE)), 866);
  assert.equal(world.fake.lastState(disk(FEATURE_KEYS.STATE)), 'Bon');
  assert.equal(world.fake.lastState(disk(FEATURE_KEYS.TEMPERATURE)), 32);

  world.nas.setVolume({ status: 0, progress: 42 });
  world.nas.setDisk('0:2', { health: 'Warning', temperature: 51 });
  world.clock.advance(HUB_TIMINGS.diskIntervalMs);
  await tick(world);
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.STATE)), 'Reconstruction');
  assert.equal(world.fake.lastState(volume(FEATURE_KEYS.ALERT)), 1);
  assert.equal(world.fake.lastState(disk(FEATURE_KEYS.STATE)), 'Avertissement');
  assert.equal(world.fake.lastState(disk(FEATURE_KEYS.ALERT)), 1);
  assert.deepEqual(events(world, TRIGGERS.VOLUME), [
    {
      key: TRIGGERS.VOLUME,
      data: {
        volume: deviceId(world.gladys, DEVICE_TYPES.VOLUME, '1'),
        nas_name: 'NAS-TEST-9',
        volume_name: 'DataVol1',
        state: 'Reconstruction',
      },
    },
  ]);
  assert.deepEqual(events(world, TRIGGERS.DISK), [
    {
      key: TRIGGERS.DISK,
      data: {
        disk: deviceId(world.gladys, DEVICE_TYPES.DISK, DISK_KEYS[1]),
        nas_name: 'NAS-TEST-9',
        disk_name: 'Disk 2',
        model: 'WD30EFRX-68EUZN0',
        state: 'Avertissement',
        temperature: 51,
      },
    },
  ]);

  // The same states again: no new event. Worse: again. Better: nothing.
  world.clock.advance(HUB_TIMINGS.diskIntervalMs);
  await tick(world);
  assert.equal(world.fake.sceneEvents.length, 2);
  world.nas.setVolume({ status: -2 });
  world.nas.setDisk('0:2', { health: 'Abnormal' });
  world.clock.advance(HUB_TIMINGS.diskIntervalMs);
  await tick(world);
  assert.deepEqual(
    world.fake.sceneEvents.slice(2).map((event) => [event.key, event.data.state]),
    [
      [TRIGGERS.VOLUME, 'Dégradé ou anormal'],
      [TRIGGERS.DISK, 'Erreur'],
    ],
  );
  world.nas.setDisk('0:2', { health: 'Warning' });
  world.clock.advance(HUB_TIMINGS.diskIntervalMs);
  await tick(world);
  assert.equal(world.fake.sceneEvents.length, 4, 'getting better is not announced');
});

test('the first read only records the states: no event for what was already wrong', async (t) => {
  const nas = new FakeQnap();
  nas.setVolume({ status: -2 });
  nas.setDisk('0:1', { health: 'Abnormal' });
  nas.setFirmwareOffer('5.2.1.3000 Build 20261001');
  const world = await createWorld({ nas });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('scene events are remembered across a restart', async () => {
  const nas = new FakeQnap();
  const world = await createWorld({ nas });
  nas.setVolume({ status: -2 });
  await tick(world);
  assert.equal(events(world, TRIGGERS.VOLUME).length, 1);
  await world.app.stop();

  const again = await createWorld({ nas, dataDir: world.dataDir });
  await tick(again);
  assert.equal(again.fake.sceneEvents.length, 0, 'already announced before the restart');
  nas.setVolume({ status: 0 });
  await tick(again);
  nas.setVolume({ status: -2 });
  await tick(again);
  assert.equal(events(again, TRIGGERS.VOLUME).length, 1, 're-armed once back to ready');
  await again.app.stop();
});

test('firmware: checked every 6 hours, announced once per version', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const checks = () => world.nas.requests.filter((r) => r.query.subfunc === 'firm_update').length;
  const update = featureId(world.gladys, DEVICE_TYPES.NAS, null, FEATURE_KEYS.UPDATE);
  assert.equal(checks(), 1);
  assert.equal(world.fake.lastState(update), 0);

  world.nas.setFirmwareOffer('5.2.1.3000 Build 20261001');
  world.clock.advance(HUB_TIMINGS.firmwareIntervalMs - MINUTE);
  await tick(world);
  assert.equal(checks(), 1, 'not before 6 hours');
  world.clock.advance(MINUTE);
  await tick(world);
  assert.equal(checks(), 2);
  assert.equal(world.fake.lastState(update), 1);
  assert.deepEqual(events(world, TRIGGERS.UPDATE), [
    {
      key: TRIGGERS.UPDATE,
      data: {
        nas_name: 'NAS-TEST-9',
        current_version: '4.5.2.1594 build 20210302',
        new_version: '5.2.1.3000 Build 20261001',
      },
    },
  ]);
  world.clock.advance(HUB_TIMINGS.firmwareIntervalMs);
  await tick(world);
  assert.equal(events(world, TRIGGERS.UPDATE).length, 1, 'once per version');
  world.nas.setFirmwareOffer('5.2.2.3100 Build 20261201');
  world.clock.advance(HUB_TIMINGS.firmwareIntervalMs);
  await tick(world);
  assert.equal(events(world, TRIGGERS.UPDATE).length, 2, 'a newer version again');
});

test('the disks are read every 5 minutes at most often', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const reads = () => world.nas.requests.filter((r) => r.query.func === 'all_hd_data').length;
  assert.equal(reads(), 1);
  for (let minute = 1; minute < 5; minute += 1) {
    world.clock.advance(MINUTE);
    await tick(world);
  }
  assert.equal(reads(), 1);
  world.clock.advance(MINUTE);
  await tick(world);
  assert.equal(reads(), 2);
  assert.equal(world.hub.snapshot.disks.length, 4, 'kept between two reads');
});

test('the UPS the NAS shares: a device, its states, asked again when gone', async (t) => {
  const nas = new FakeQnap({ ups: { ...UPS_ON_MAINS } });
  const world = await createWorld({ nas });
  t.after(() => world.app.stop());
  const ups = world.fake.discoveredDevices.find((d) => d.external_id.includes(':ups:'));
  assert.equal(ups.name, 'NAS-TEST-9 UPS');
  assert.equal(ups.model, 'American Power Conversion Back-UPS ES 700G');
  await world.fake.deviceCreated(ups);
  const id = (key) => featureId(world.gladys, DEVICE_TYPES.UPS, 'ups', key);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.BATTERY)), 100);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.RUNTIME)), 31);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.ON_BATTERY)), 0);

  nas.setUps({ ...UPS_ON_MAINS, 'ups.status': 'OB DISCHRG', 'battery.charge': '64' });
  await tick(world);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.ON_BATTERY)), 1);
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.BATTERY)), 64);

  // The NAS stops sharing it: unreachable badge, asked again every 10 minutes.
  nas.setUps(null);
  await tick(world);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  const asked = nas.nutRequests;
  await tick(world);
  assert.equal(nas.nutRequests, asked);
  nas.setUps({ ...UPS_ON_MAINS });
  world.clock.advance(HUB_TIMINGS.upsRetryMs);
  await tick(world);
  assert.equal(nas.nutRequests, asked + 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.lastState(id(FEATURE_KEYS.ON_BATTERY)), 0);
});

test('a NAS without UPS: no device, the NUT port asked every 10 minutes only', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.ok(!world.fake.discoveredDevices.some((d) => d.external_id.includes(':ups:')));
  assert.equal(world.nas.nutRequests, 1);
  await tick(world);
  assert.equal(world.nas.nutRequests, 1);
  const off = await createWorld({ config: { ...CONFIG, ups: false } });
  t.after(() => off.app.stop());
  assert.equal(off.nas.nutRequests, 0, 'never asked when the option is off');
});

test('the NAS offline: online 0 after two failed reads, back to 1 when it answers', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const online = featureId(world.gladys, DEVICE_TYPES.NAS, null, FEATURE_KEYS.ONLINE);
  world.nas.failure = 'down';
  await tick(world);
  assert.equal(world.fake.lastState(online), 1, 'one failure is a blip');
  await tick(world);
  assert.equal(world.fake.lastState(online), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(world.fake.transports.some((entry) => entry.transport === 'unreachable'));
  world.nas.failure = null;
  await tick(world);
  assert.equal(world.fake.lastState(online), 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a refused password is never retried on the timer, only on a manual request', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.nas.failedLogins, 1);
  assert.match(world.fake.connectionStatus.message.fr, /mot de passe refusé/);
  for (let i = 0; i < 5; i += 1) {
    await tick(world);
  }
  assert.equal(world.nas.failedLogins, 1);
  await world.fake.action('test_connection');
  assert.equal(world.nas.failedLogins, 2);
  await world.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('2-step verification and a missing right are reported in words', async (t) => {
  const otp = await createWorld({ nas: new FakeQnap({ otp: true }) });
  t.after(() => otp.app.stop());
  assert.match(otp.fake.connectionStatus.message.en, /2-step verification/);
  const monitoring = await createWorld({ nas: new FakeQnap({ monitoring: false }) });
  t.after(() => monitoring.app.stop());
  assert.match(monitoring.fake.connectionStatus.message.en, /System Monitoring/);
  const logins = monitoring.nas.logins;
  await tick(monitoring);
  assert.equal(monitoring.nas.logins, logins, 'not retried on the timer');
});

test('the session id is kept under /data and reused after a restart', async () => {
  const nas = new FakeQnap();
  const world = await createWorld({ nas });
  await world.app.stop();
  assert.equal(nas.logins, 1);
  const again = await createWorld({ nas, dataDir: world.dataDir });
  assert.equal(nas.logins, 1, 'no new login');
  await again.app.stop();
  // Another user name: the kept session is not used.
  const other = await createWorld({
    nas,
    dataDir: world.dataDir,
    config: { ...CONFIG, username: 'someone' },
  });
  assert.equal(other.fake.connectionStatus.connected, false);
  await other.app.stop();
});

test('not configured, or an address that is not one', async (t) => {
  const empty = await createWorld({ config: { ...CONFIG, password: '' } });
  t.after(() => empty.app.stop());
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  const bad = await createWorld({ config: { ...CONFIG, address: 'ftp://nas' } });
  t.after(() => bad.app.stop());
  assert.match(bad.fake.connectionStatus.message.en, /Address not understood/);
});

test('onPoll, should Gladys ever call it: a recent read is enough', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const reads = () => world.nas.requests.filter((r) => r.query.subfunc === 'sysinfo').length;
  const before = reads();
  const [nas] = world.fake.discoveredDevices;
  await world.fake.poll(nas);
  assert.equal(reads(), before, 'read less than half an interval ago');
  world.clock.advance(MINUTE / 2);
  await world.fake.poll(nas);
  assert.equal(reads(), before + 1);
});

test('the Search button reads the NAS and publishes the list again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const published = world.fake.requests.filter((r) => r.path === '/discovered_device').length;
  await world.fake.scanRequest();
  assert.equal(
    world.fake.requests.filter((r) => r.path === '/discovered_device').length,
    published + 1,
  );
});

test('the connection test reports the NAS, its storage, its UPS and the account', async (t) => {
  const user = await createWorld({ nas: new FakeQnap({ admin: false, ups: { ...UPS_ON_MAINS } }) });
  t.after(() => user.app.stop());
  const ack = await user.fake.action('test_connection');
  assert.equal(
    ack.data.message.en,
    'NAS-TEST-9: connected, TS-EC1280U, QTS 4.5.2.1594 build 20210302, 1 volume(s), ' +
      '4 disk(s), UPS read, not an administrator: restart and shutdown refused',
  );
  const denied = new FakeQnap({ ups: { ...UPS_ON_MAINS } });
  denied.upsAllowed = false;
  const world = await createWorld({ nas: denied });
  t.after(() => world.app.stop());
  const report = await world.fake.action('test_connection');
  assert.match(report.data.message.fr, /onduleur refusé \(adresses IP autorisées \?\)/);
  world.nas.failure = 'down';
  const down = await world.fake.action('test_connection');
  assert.match(down.data.message.de, /antwortet nicht/);
});
