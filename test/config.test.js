// -----------------------------------------------------------------------------
// Configuration normalization (src/config.js): addresses as users type them,
// booleans as the form sends them, defaults for everything else.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  hostOf,
  hostnameOf,
  normalizeConfig,
  parseAddress,
} from '../src/config.js';

test('addresses: bare host on 8080, 443 means HTTPS, URLs kept, paths dropped', () => {
  assert.equal(parseAddress('192.0.2.50'), 'http://192.0.2.50:8080');
  assert.equal(parseAddress(' nas.local '), 'http://nas.local:8080');
  assert.equal(parseAddress('192.0.2.50:8081'), 'http://192.0.2.50:8081');
  assert.equal(parseAddress('192.0.2.50:443'), 'https://192.0.2.50');
  assert.equal(parseAddress('https://192.0.2.50'), 'https://192.0.2.50');
  assert.equal(parseAddress('https://192.0.2.50:5001/cgi-bin/'), 'https://192.0.2.50:5001');
  assert.equal(parseAddress('http://192.0.2.50:8080/'), 'http://192.0.2.50:8080');
  assert.equal(parseAddress('[2001:db8::5]'), 'http://[2001:db8::5]:8080');
  for (const bad of ['', '   ', 'ftp://nas', 'http://admin:pw@192.0.2.50', 'http://', null, 42]) {
    assert.equal(parseAddress(bad), null, String(bad));
  }
  assert.equal(hostOf('http://192.0.2.50:8080'), '192.0.2.50');
  assert.equal(hostOf('https://192.0.2.50'), '192.0.2.50');
  assert.equal(hostnameOf('http://[2001:db8::5]:8080'), '2001:db8::5');
});

test('defaults, booleans, password kept as typed', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    addressInvalid: false,
    username: '',
    password: '',
    insecure: false,
    pollIntervalMs: 60_000,
    ups: true,
    powerActions: false,
    language: 'fr',
  });
  const config = normalizeConfig({
    address: '192.0.2.50',
    username: ' gladys ',
    password: ' p@ss word \n',
    accept_self_signed: 'true',
    poll_interval: 300,
    ups: false,
    allow_power_actions: true,
    language: 'de',
  });
  assert.equal(config.username, 'gladys');
  assert.equal(config.password, ' p@ss word ');
  assert.equal(config.insecure, true);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.ups, false);
  assert.equal(config.powerActions, true);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ poll_interval: '7', language: 'it' }).pollIntervalMs, 60_000);
  assert.equal(normalizeConfig({ language: 'it' }).language, DEFAULT_CONFIG.language);
  assert.equal(normalizeConfig({ address: 'ftp://x' }).addressInvalid, true);
  assert.equal(normalizeConfig(null).url, null);
});
