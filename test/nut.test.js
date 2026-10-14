// -----------------------------------------------------------------------------
// The UPS over NUT (src/qnap/nut.js): the answer of `LIST VAR`, and the three
// ways it fails — no NUT server (the usual NAS without UPS), a server that
// refuses this address, an unknown UPS name.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { NUT_ERRORS, nutExchange, parseVariables, readUps } from '../src/qnap/nut.js';
import { FakeQnap, UPS_ON_MAINS } from './helpers/fakeQnap.js';

test('LIST VAR qnapups: every variable, quotes and escapes handled', async () => {
  const nas = new FakeQnap({ ups: { ...UPS_ON_MAINS, 'ups.id': 'say \\"hi\\"' } });
  let asked;
  const variables = await readUps({
    host: '192.0.2.50',
    exchange: (options) => {
      asked = options;
      return nas.nut(options);
    },
  });
  assert.deepEqual(asked.lines, ['LIST VAR qnapups', 'LOGOUT']);
  assert.equal(asked.port, 3493);
  assert.equal(variables['battery.charge'], '100');
  assert.equal(variables['ups.status'], 'OL');
  assert.equal(variables['ups.id'], 'say "hi"');
  assert.deepEqual(parseVariables('BEGIN LIST VAR x\nnoise\nEND LIST VAR x\n'), {});
});

test('no server, refused address, unknown UPS, empty answer', async () => {
  const kind = (expected) => (err) => {
    assert.equal(err.kind, expected);
    return true;
  };
  const nas = new FakeQnap();
  const exchange = (options) => nas.nut(options);
  await assert.rejects(readUps({ host: 'h', exchange }), kind(NUT_ERRORS.ABSENT));
  nas.setUps(UPS_ON_MAINS);
  nas.upsAllowed = false;
  await assert.rejects(readUps({ host: 'h', exchange }), kind(NUT_ERRORS.DENIED));
  nas.upsAllowed = true;
  await assert.rejects(readUps({ host: 'h', name: 'other', exchange }), kind(NUT_ERRORS.ABSENT));
  await assert.rejects(
    readUps({ host: 'h', exchange: async () => 'ERR DATA-STALE\n' }),
    kind(NUT_ERRORS.FAILED),
  );
  await assert.rejects(
    readUps({ host: 'h', exchange: async () => 'OK Goodbye\n' }),
    kind(NUT_ERRORS.FAILED),
  );
});

test('the TCP exchange against a local NUT server', async (t) => {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
      if (data.startsWith('LIST VAR qnapups')) {
        socket.write('BEGIN LIST VAR qnapups\nVAR qnapups battery.charge "87"\n');
        socket.write('END LIST VAR qnapups\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const variables = await readUps({ host: '127.0.0.1', port: server.address().port });
  assert.deepEqual(variables, { 'battery.charge': '87' });

  // A server that never answers: the timeout ends it.
  const silent = net.createServer(() => {});
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  t.after(() => silent.close());
  await assert.rejects(
    nutExchange({
      host: '127.0.0.1',
      port: silent.address().port,
      lines: ['LIST VAR qnapups'],
      until: /^END/m,
      timeoutMs: 100,
    }),
    /Timed out/,
  );
});
