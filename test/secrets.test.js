// -----------------------------------------------------------------------------
// The credentials never leave where they belong: the password stays in the
// Gladys configuration and in the login request, the session id in memory,
// in the requests to the NAS and in /data/qnap-session.json (owner only).
// Not in the logs (at the most verbose level), not in the other file under
// /data, not in anything sent to Gladys — whatever happens: login, expired
// session, refused password, NAS gone, connection test, scene action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENE_ACTIONS } from '../src/app.js';
import { WIDGET_KEY } from '../src/hub.js';
import { encodePassword } from '../src/qnap/client.js';
import { SESSION_FILE, STATE_FILE } from '../src/store.js';
import { FakeQnap, PASSWORD, UPS_ON_MAINS } from './helpers/fakeQnap.js';
import { captureLogs } from './helpers/logs.js';
import { CONFIG, createDevices, createWorld, tick } from './helpers/world.js';

test('neither the password nor a session id is logged, sent to Gladys or in the state file', async () => {
  let world;
  const logs = (
    await captureLogs(async () => {
      world = await createWorld({
        nas: new FakeQnap({ ups: { ...UPS_ON_MAINS } }),
        config: { ...CONFIG, allow_power_actions: true },
      });
      await createDevices(world);
      world.nas.expireSessions();
      await tick(world);
      world.nas.setVolume({ status: -2 });
      await tick(world);
      await world.fake.action('test_connection');
      await world.fake.widgetGet(WIDGET_KEY, { language: 'fr' });
      await world.fake.sceneAction(SCENE_ACTIONS.RESTART, {});
      world.nas.failure = 'down';
      await tick(world);
      await tick(world);
      world.nas.failure = null;
      await world.fake.configUpdated({ ...CONFIG, password: `${PASSWORD}-typo` });
      await world.fake.action('test_connection');
      await world.app.stop();
    })
  ).join('\n');

  const sids = new Set(world.nas.requests.map((r) => r.query.sid).filter(Boolean));
  assert.ok(sids.size >= 2, 'several sessions were opened');
  assert.ok(logs.length > 0, 'something was logged');

  const secrets = [PASSWORD, encodePassword(PASSWORD), encodePassword(`${PASSWORD}-typo`), ...sids];
  const sentToGladys = JSON.stringify(world.fake.requests);
  const state = await readFile(join(world.dataDir, STATE_FILE), 'utf8');
  assert.ok(state.includes('Q000TEST0002'), 'the state file was written');
  for (const secret of secrets) {
    assert.ok(!logs.includes(secret), 'a secret is in the logs');
    assert.ok(!sentToGladys.includes(secret), 'a secret was sent to Gladys');
    assert.ok(!state.includes(secret), 'a secret is in the state file');
  }
  // The session file: no password, owner-only, cleared by the refused login.
  const files = await readdir(world.dataDir);
  assert.deepEqual(files.sort(), [SESSION_FILE, STATE_FILE].sort());
  const session = await readFile(join(world.dataDir, SESSION_FILE), 'utf8');
  for (const secret of [PASSWORD, encodePassword(PASSWORD), CONFIG.username]) {
    assert.ok(!session.includes(secret));
  }
  assert.deepEqual(JSON.parse(session), {}, 'a refused login forgets the session');
  assert.equal((await stat(join(world.dataDir, SESSION_FILE))).mode & 0o777, 0o600);
});

test('the session file holds the session id of the address and user name only', async () => {
  const world = await createWorld();
  await world.app.stop();
  const session = JSON.parse(await readFile(join(world.dataDir, SESSION_FILE), 'utf8'));
  assert.deepEqual(Object.keys(session).sort(), ['owner', 'sid']);
  assert.ok(world.nas.sids.has(session.sid));
  assert.match(session.owner, /^[0-9a-f]{32}$/);
});

test('a new password is checked for real: the kept session is not reused', async () => {
  const world = await createWorld();
  await world.fake.configUpdated({ ...CONFIG, password: `${PASSWORD}-typo` });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  await world.app.stop();
});
