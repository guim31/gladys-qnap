#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probes a real QNAP NAS with the client of the integration, READ ONLY, and
// prints what the tests cannot know: the shape of the answers of this
// firmware, the volume state codes, the SMART words, the rights of the
// account, the UPS over NUT. Never the password, the session id, an address,
// a MAC address or a serial number: only counts, codes and field names.
//
//   QNAP_URL=http://192.0.2.50:8080 QNAP_USER=gladys QNAP_PASSWORD=… \
//     [QNAP_INSECURE=1] node scripts/probe.mjs
//
// It never restarts nor shuts down anything: the power request is not called.
// One login, one session: the session is closed by QTS after its idle timeout.
// -----------------------------------------------------------------------------

import { hostnameOf, parseAddress } from '../src/config.js';
import { QnapClient, encodePassword } from '../src/qnap/client.js';
import { httpRequest } from '../src/qnap/http.js';
import { parseSnapshot, parseUps } from '../src/qnap/model.js';
import { readUps } from '../src/qnap/nut.js';
import { at, list, parseQDoc, text } from '../src/qnap/xml.js';

const url = parseAddress(process.env.QNAP_URL ?? '');
const username = process.env.QNAP_USER ?? '';
const password = process.env.QNAP_PASSWORD ?? '';
const insecure = process.env.QNAP_INSECURE === '1';
if (!url || !username || !password) {
  console.error(
    'Set QNAP_URL, QNAP_USER and QNAP_PASSWORD (QNAP_INSECURE=1 for a self-signed certificate).',
  );
  process.exit(2);
}

const secrets = [password, encodePassword(password)];
/** Prints a line, refusing any that carries a secret (belt and braces). */
function say(...parts) {
  const line = parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ');
  if (secrets.some((secret) => secret && line.includes(secret)) || (sid && line.includes(sid))) {
    console.log('(line withheld: it carried a secret)');
    return;
  }
  console.log(line);
}
let sid = null;

// 1. The login answer itself: its field names, and the flags that matter.
try {
  const response = await httpRequest(new URL('/cgi-bin/authLogin.cgi', url).toString(), {
    method: 'POST',
    insecure,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: username, pwd: encodePassword(password) }).toString(),
  });
  const doc = parseQDoc(response.body);
  sid = text(doc, 'authSid');
  say('login: HTTP', response.status, 'content-type', response.headers['content-type'] ?? '?');
  say('login fields:', Object.keys(doc).sort().join(', '));
  for (const key of [
    'authPassed',
    'isAdmin',
    'need_2sv',
    'force_2sv',
    'errorValue',
    'hero_model',
    'qts_mode_type',
    'pw_status',
  ]) {
    if (doc[key] !== undefined) {
      say(`login ${key}:`, text(doc, key) ?? '(empty)');
    }
  }
  say('login authSid present:', Boolean(sid));
} catch (err) {
  say('login failed:', err.code ?? err.name);
  process.exit(1);
}

// 2. Every read the integration does, through its own client (it logs in again).
const client = new QnapClient({ url, username, password, insecure });
let raw;
try {
  raw = await client.read({ disks: true, firmware: true });
  sid = client.sid;
} catch (err) {
  say('read failed:', err.kind, err.message);
  process.exit(1);
}
say('account:', client.account);
for (const [part, err] of Object.entries(raw.errors)) {
  say(`part ${part} refused:`, err.kind, err.message);
}

const snapshot = parseSnapshot(raw);
say('model:', snapshot.model, '| firmware:', snapshot.version, '| QuTS hero:', snapshot.hero);
say(
  'platform id kind:',
  snapshot.platformId
    ? snapshot.platformId.startsWith('mac')
      ? 'MAC address'
      : 'serial number'
    : 'none',
);
say('cpu %:', snapshot.cpu, '| memory %:', snapshot.memory?.toFixed(1));
say(
  'cpu °C:',
  snapshot.cpuTemperature,
  '| system °C:',
  snapshot.systemTemperature,
  '| uptime s:',
  snapshot.uptime,
);
say(
  'fans:',
  snapshot.fans.map((fan) => `${fan.key}=${fan.speed}${fan.alert ? '!' : ''}`).join(' ') || 'none',
);
say(
  'interfaces:',
  (snapshot.interfaces ?? []).map((nic) => `${nic.key}(${nic.label})`).join(' ') || 'none',
);
const root = at(raw.sysinfo, 'func', 'ownContent', 'root');
say(
  'sysinfo fields with "fan" or "temp":',
  Object.keys(root)
    .filter((k) => /fan|temp/i.test(k))
    .join(', '),
);

// The volume codes: what the integration cannot know without real NAS.
for (const volume of list(at(raw.volumes, 'volumeList').volume)) {
  say(
    'volume',
    text(volume, 'volumeValue'),
    '| volumeStatus:',
    text(volume, 'volumeStatus'),
    '| Progress:',
    text(volume, 'Progress'),
    '| volumeStat:',
    text(volume, 'volumeStat'),
    '| volumeMngStatus:',
    text(volume, 'volumeMngStatus'),
    '| other fields:',
    Object.keys(volume)
      .filter((k) => /stat|progress|health|degrad|rebuild/i.test(k))
      .join(', '),
  );
}
say(
  'volumes parsed:',
  (snapshot.volumes ?? [])
    .map((v) => `${v.key}:${v.state}:${v.percent?.toFixed(1) ?? '?'}%`)
    .join(' '),
);

const words = {};
for (const entry of list(at(raw.disks, 'Disk_Info').entry)) {
  const key = `Health=${text(entry, 'Health') ?? '(empty)'} Disk_Status=${text(entry, 'Disk_Status') ?? '?'}`;
  words[key] = (words[key] ?? 0) + 1;
}
say('disk words:', words);
say(
  'disks parsed:',
  (snapshot.disks ?? []).map((d) => `${d.label}:${d.state}:${d.temperature ?? '?'}°C`).join(' '),
);
say(
  'disk keys by serial:',
  (snapshot.disks ?? []).filter((d) => !d.key.startsWith('slot-')).length,
  'of',
  snapshot.disks?.length ?? 0,
);
say(
  'firmware offered:',
  raw.firmware
    ? (text(raw.firmware, 'func', 'ownContent', 'newVersion') ?? '(none)')
    : '(not readable)',
);
say('update parsed:', snapshot.update, '| known:', snapshot.updateKnown);

// 3. The UPS over NUT, port 3493.
try {
  const ups = parseUps(await readUps({ host: hostnameOf(url) }));
  say('ups:', ups);
} catch (err) {
  say('ups:', err.kind, err.message);
}
