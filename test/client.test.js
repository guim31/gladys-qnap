// -----------------------------------------------------------------------------
// The QTS client (src/qnap/client.js) against the fake NAS: the login (form,
// then query for the firmwares that want it), the session kept and renewed,
// the 2-step verification, the refused password, the account without the
// right, the certificate, what is not a QNAP, the QTS 4.5.4 network answer,
// the power requests.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, POWER_ACTIONS, QnapClient, encodePassword } from '../src/qnap/client.js';
import { FakeQnap, PASSWORD, USERNAME, createNetwork } from './helpers/fakeQnap.js';

const ORIGIN = 'http://192.0.2.50:8080';

function client(nas, options = {}) {
  const net = createNetwork({ [ORIGIN]: nas });
  const sessions = [];
  const qnap = new QnapClient({
    url: ORIGIN,
    username: USERNAME,
    password: PASSWORD,
    request: net.request,
    onSession: (sid) => sessions.push(sid),
    ...options,
  });
  return { qnap, sessions };
}

const rejects = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    return true;
  });

test('the login posts the base64 password, then every request carries the session', async () => {
  const nas = new FakeQnap();
  const { qnap, sessions } = client(nas);
  const raw = await qnap.read({ disks: true, firmware: true });
  assert.ok(raw.sysinfo && raw.volumes && raw.bandwidth && raw.disks && raw.firmware);
  assert.deepEqual(raw.errors, {});
  assert.equal(nas.logins, 1);
  const [login, ...reads] = nas.requests;
  assert.equal(login.method, 'POST');
  assert.deepEqual(login.form, { user: USERNAME, pwd: encodePassword(PASSWORD) });
  assert.deepEqual(login.query, {}, 'the password is not in the URL');
  assert.ok(reads.every((request) => request.query.sid === sessions[0]));
  assert.deepEqual(qnap.account, { admin: true, hero: false });
  assert.equal(encodePassword('é€'), Buffer.from('é€', 'utf8').toString('base64'));
});

test('a session kept from a previous run is used without logging in', async () => {
  const nas = new FakeQnap();
  nas.sids.add('kept-session');
  const { qnap, sessions } = client(nas, { sid: 'kept-session' });
  await qnap.sysinfo();
  assert.equal(nas.logins, 0);
  assert.deepEqual(sessions, []);
});

test('an expired session: one login again, the request repeated', async () => {
  const nas = new FakeQnap();
  const { qnap, sessions } = client(nas, { sid: 'expired' });
  await qnap.sysinfo();
  assert.equal(nas.logins, 1);
  assert.equal(sessions.length, 1);
  nas.expireSessions();
  await qnap.sysinfo();
  assert.equal(nas.logins, 2);
  assert.equal(sessions.length, 2);
});

test('QTS 4.5.1: the POST answers without session id, the same query as a GET does', async () => {
  const nas = new FakeQnap({ loginByGet: true });
  const { qnap } = client(nas);
  await qnap.sysinfo();
  assert.deepEqual(
    nas.requests.slice(0, 2).map((r) => [r.method, r.path]),
    [
      ['POST', '/cgi-bin/authLogin.cgi'],
      ['GET', '/cgi-bin/authLogin.cgi'],
    ],
  );
});

test('a refused password, a 2-step verification account', async () => {
  const wrong = client(new FakeQnap(), { password: 'nope' });
  await rejects(wrong.qnap.sysinfo(), ERROR_KINDS.AUTH);
  const otp = client(new FakeQnap({ otp: true }));
  await rejects(otp.qnap.sysinfo(), ERROR_KINDS.OTP);
});

test('an account without System Monitoring: permission, after one login again', async () => {
  const nas = new FakeQnap({ monitoring: false });
  const { qnap } = client(nas);
  await rejects(qnap.sysinfo(), ERROR_KINDS.PERMISSION);
  assert.equal(nas.logins, 2);
});

test('a part refused alone does not fail the read: the firmware of a non-administrator', async () => {
  const nas = new FakeQnap({ admin: false });
  const { qnap } = client(nas);
  const raw = await qnap.read({ firmware: true });
  assert.equal(raw.firmware, null);
  assert.equal(raw.errors.firmware.kind, ERROR_KINDS.PERMISSION);
  assert.ok(raw.volumes);
  assert.deepEqual(qnap.account, { admin: false, hero: false });
});

test('network, certificate, not a QNAP, 404', async () => {
  const nas = new FakeQnap();
  const { qnap } = client(nas);
  nas.failure = 'down';
  await rejects(qnap.sysinfo(), ERROR_KINDS.UNREACHABLE);
  nas.failure = 'tls';
  await rejects(qnap.sysinfo(), ERROR_KINDS.CERTIFICATE);
  nas.failure = 'html';
  await rejects(qnap.sysinfo(), ERROR_KINDS.NOT_QNAP);
  nas.failure = null;
  await rejects(qnap.get('/cgi-bin/nothing.cgi', {}), ERROR_KINDS.NOT_QNAP);
  const elsewhere = new QnapClient({
    url: 'http://192.0.2.99:8080',
    username: USERNAME,
    password: PASSWORD,
    request: createNetwork({}).request,
  });
  await rejects(elsewhere.sysinfo(), ERROR_KINDS.UNREACHABLE);
});

test('the error messages never carry the password nor the session id', async () => {
  const nas = new FakeQnap();
  const { qnap, sessions } = client(nas);
  await qnap.sysinfo();
  for (const failure of ['down', 'tls', 'html']) {
    nas.failure = failure;
    const err = await qnap.sysinfo().catch((e) => e);
    for (const secret of [PASSWORD, encodePassword(PASSWORD), sessions[0]]) {
      assert.ok(!err.message.includes(secret));
    }
  }
  assert.ok(!JSON.stringify(qnap).includes(PASSWORD));
  assert.ok(!JSON.stringify(qnap).includes(sessions[0]));
});

test('QTS 4.5.4: the old network query answers nothing, the new one is asked', async () => {
  const nas = new FakeQnap({ bandwidth454: true });
  const { qnap } = client(nas);
  const doc = await qnap.bandwidth();
  assert.ok(doc.bandwidth_info);
  assert.deepEqual(
    nas.requests.filter((r) => r.query.chart_func).map((r) => r.query.chart_func),
    ['QSM40bandwidth', 'bandwidth'],
  );
});

test('restart and shutdown: the two requests QTS knows, nothing else', async () => {
  const nas = new FakeQnap();
  const { qnap } = client(nas);
  await qnap.power(POWER_ACTIONS.RESTART);
  await qnap.power(POWER_ACTIONS.SHUTDOWN);
  assert.deepEqual(nas.powerCalls, ['restart', 'shutdown']);
  await assert.rejects(qnap.power('format'), /Unknown power action/);
  const user = client(new FakeQnap({ admin: false }));
  await rejects(user.qnap.power(POWER_ACTIONS.RESTART), ERROR_KINDS.PERMISSION);
});
