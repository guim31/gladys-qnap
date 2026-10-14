// -----------------------------------------------------------------------------
// The answers of QTS (src/qnap/client.js) and of the NUT server (src/qnap/nut.js),
// turned into one plain snapshot the rest of the code reads: no XML tree, no
// string numbers, no field that may or may not exist.
//
// Field names, as the QTS answers in test/fixtures/qnap (real answers of nine
// models, QTS 4.2 to 4.5, from python-qnapstats, MIT) carry them:
//
//   sysinfo   model.displayModelName, firmware.{version, number, build},
//             func.ownContent.root.{server_name, serial_number, cpu_usage ("1.2 %"),
//             total_memory, free_memory (MB), cpu_tempc, sys_tempc,
//             uptime_day/hour/min/sec, sysfan_count, sysfanN (rpm), sysfanN_stat
//             (-1: alert), eth_mac1}
//   volumes   volumeList.volume[].{volumeValue, volumeLabel, volumeStat (raid5…),
//             volumeStatus, Progress}, volumeUseList.volumeUse[].{volumeValue,
//             total_size, free_size (bytes)}
//   disks     Disk_Info.entry[].{HDNo, Disk_Alias, Model, Serial, Health,
//             Temperature.oC, hd_is_ssd, Capacity}; an empty slot has no Model
//   network   bandwidth_info.item[].{id, name, rx, tx} (QSM40bandwidth) or
//             bandwidth_info.{eth_index_list, ethN.{dname, rx, tx}} (QTS 4.5.4+):
//             bytes over `bandwidth_interval` seconds (5)
//   firmware  func.ownContent.newVersion ("4.3.4.0695 Build 20180830", empty
//             when up to date)
//
// Volume state. Only `volumeStatus` 0 is confirmed by real answers (a ready
// volume); the codes of a degraded or rebuilding volume are not published
// anywhere. So: 0 is ready, 0 with a `Progress` between 0 and 99 is a RAID
// operation in progress (rebuild, resync, migration), and any other code is
// "abnormal" — announced, because missing a degraded RAID is worse than a
// false alarm, and logged with its code so users can report it.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { at, list, text } from './xml.js';

/** A number, from a number or a numeric string ("1.2 %" too); null otherwise. */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^-?\d+(?:[.,]\d+)?/);
    if (match) {
      const parsed = Number(match[0].replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

const percent = (value) => {
  const n = num(value);
  return n === null ? null : Math.min(100, Math.max(0, n));
};

// A sensor reading 0 °C (or the 32763 of a missing module sensor) inside a
// NAS is a sensor that did not answer.
const celsius = (value) => {
  const n = num(value);
  return n === null || n <= 0 || n > 200 ? null : n;
};

/** A platform id part from a name QTS gives: as is when safe, hashed otherwise. */
export function itemKey(name) {
  const value = String(name ?? '');
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(value) && !/^h[0-9a-f]{12}$/.test(value)) {
    return value;
  }
  return `h${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

// --- States ---------------------------------------------------------------------

// Volume states, by increasing severity; `alert` marks the ones a scene hears.
export const VOLUME_STATES = Object.freeze({
  ready: { severity: 0, alert: false },
  unknown: { severity: 0, alert: false },
  rebuilding: { severity: 1, alert: true },
  abnormal: { severity: 2, alert: true },
});

// Disk states (the SMART summary QTS shows), by increasing severity.
export const DISK_STATES = Object.freeze({
  good: { severity: 0, alert: false },
  unknown: { severity: 0, alert: false },
  warning: { severity: 1, alert: true },
  error: { severity: 2, alert: true },
});

/** The volume state of a `volumeStatus` code and a `Progress` percentage. */
export function volumeState(status, progress) {
  const code = num(status);
  if (code === null) {
    return 'unknown';
  }
  if (code !== 0) {
    return 'abnormal';
  }
  const done = num(progress);
  return done !== null && done >= 0 && done < 100 ? 'rebuilding' : 'ready';
}

/** The disk state of the `Health` word of qsmart.cgi. */
export function diskState(health) {
  const word = String(health ?? '')
    .trim()
    .toLowerCase();
  if (['ok', 'good', 'normal'].includes(word)) {
    return 'good';
  }
  if (word === 'warning') {
    return 'warning';
  }
  if (['abnormal', 'error', 'bad', 'failed', 'failure', 'critical'].includes(word)) {
    return 'error';
  }
  return 'unknown';
}

// --- Firmware -----------------------------------------------------------------------

/** "4.5.2.1594" and the build "20210302" of the running firmware. */
function currentFirmware(doc) {
  const version = text(doc, 'firmware', 'version');
  if (!version) {
    return null;
  }
  const number = text(doc, 'firmware', 'number');
  const build = text(doc, 'firmware', 'build');
  return {
    version: number ? `${version}.${number}` : version,
    build: build && /^\d{8}$/.test(build) ? build : null,
  };
}

const parts = (version) => (version.match(/\d+/g) ?? []).map(Number);

function newer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x > y;
    }
  }
  return false;
}

/**
 * The firmware offered by the NAS, when newer than the running one.
 * @returns {{ version: string, label: string }|null} null when up to date
 */
export function availableFirmware(firmwareDoc, current) {
  const offered = text(firmwareDoc, 'func', 'ownContent', 'newVersion');
  if (!offered || !current) {
    return null;
  }
  const version = offered.split(/\s+/)[0];
  const build = offered.match(/build\s+(\d{8})/i)?.[1] ?? null;
  // The build date orders two firmwares best; the version when a date is missing.
  const isNewer =
    build && current.build ? build > current.build : newer(parts(version), parts(current.version));
  return isNewer ? { version, label: offered.slice(0, 80) } : null;
}

// --- Parts of the snapshot ---------------------------------------------------------

/** The serial number, else the first MAC address: what identifies the NAS. */
function platformId(root) {
  const serial = text(root, 'serial_number');
  if (serial && /^[A-Za-z0-9]{6,32}$/.test(serial) && !/^Q-*$/.test(serial)) {
    return serial.toUpperCase();
  }
  const mac = text(root, 'eth_mac1');
  if (mac && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
    return `mac${mac.replace(/:/g, '').toLowerCase()}`;
  }
  return null;
}

function fans(root) {
  const count = num(text(root, 'sysfan_count')) ?? 0;
  const found = [];
  for (let index = 1; index <= Math.min(count, 16); index += 1) {
    const speed = num(text(root, `sysfan${index}`));
    if (speed === null || speed < 0) {
      continue;
    }
    found.push({
      key: String(index),
      speed,
      alert: num(text(root, `sysfan${index}_stat`)) === -1,
    });
  }
  return found;
}

function uptime(root) {
  const values = ['uptime_day', 'uptime_hour', 'uptime_min', 'uptime_sec'].map((key) =>
    num(text(root, key)),
  );
  if (values.every((value) => value === null)) {
    return null;
  }
  const [days, hours, minutes, seconds] = values.map((value) => value ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function memoryPercent(root) {
  const total = num(text(root, 'total_memory'));
  const free = num(text(root, 'free_memory'));
  if (!total || total <= 0 || free === null) {
    return null;
  }
  return percent(((total - free) / total) * 100);
}

/** The network interfaces and their rates in bytes per second. */
export function parseBandwidth(doc) {
  if (!doc) {
    return null;
  }
  const info = at(doc, 'bandwidth_info');
  const interval = num(text(doc, 'bandwidth_interval')) || 5;
  const items = list(info.item).map((item) => ({ id: text(item, 'id'), item }));
  if (items.length === 0) {
    const ids = [
      ...(text(info, 'eth_index_list') ?? '').split(',').map((n) => n.trim() && `eth${n.trim()}`),
      ...(text(info, 'wlan_index_list') ?? '').split(',').map((n) => n.trim() && `wlan${n.trim()}`),
    ].filter(Boolean);
    for (const id of ids) {
      items.push({ id, item: at(info, id) });
    }
  }
  const found = [];
  for (const { id, item } of items) {
    const rx = num(text(item, 'rx'));
    const tx = num(text(item, 'tx'));
    if (!id || rx === null || tx === null) {
      continue;
    }
    found.push({
      key: itemKey(id),
      label: text(item, 'dname') ?? text(item, 'name') ?? id,
      rx: Math.max(0, rx / interval),
      tx: Math.max(0, tx / interval),
    });
  }
  return found;
}

export function parseVolumes(doc) {
  if (!doc) {
    return null;
  }
  const usage = new Map(
    list(at(doc, 'volumeUseList').volumeUse).map((use) => [text(use, 'volumeValue'), use]),
  );
  const found = [];
  for (const volume of list(at(doc, 'volumeList').volume)) {
    const id = text(volume, 'volumeValue');
    if (!id) {
      continue;
    }
    const use = usage.get(id) ?? {};
    const total = num(text(use, 'total_size'));
    const free = num(text(use, 'free_size'));
    const known = total !== null && total > 0 && free !== null;
    found.push({
      key: itemKey(id),
      label: text(volume, 'volumeLabel') ?? `Volume ${id}`,
      level: text(volume, 'volumeStat'),
      code: text(volume, 'volumeStatus'),
      state: volumeState(text(volume, 'volumeStatus'), text(volume, 'Progress')),
      total: known ? total : null,
      free: known ? Math.min(free, total) : null,
      percent: known ? percent(((total - Math.min(free, total)) / total) * 100) : null,
    });
  }
  return found;
}

export function parseDisks(doc) {
  if (!doc) {
    return null;
  }
  // An empty bay: no model (and Disk_Status -5).
  const entries = list(at(doc, 'Disk_Info').entry).filter(
    (entry) => text(entry, 'Model') && text(entry, 'HDNo'),
  );
  // A serial number identifies a disk wherever it moves, unless the firmware
  // masks it ("WD-XXX" on every disk of a real TS-451): then the bay does.
  const serials = entries.map((entry) => text(entry, 'Serial'));
  const unique = (serial) => serial && serials.filter((s) => s === serial).length === 1;
  const found = [];
  for (const entry of entries) {
    const model = text(entry, 'Model');
    const slot = text(entry, 'HDNo');
    const serial = text(entry, 'Serial');
    // "0:3" is bay 3 of the NAS itself (enclosure 0).
    const bay = slot.replace(/^0:/, '');
    found.push({
      key: unique(serial) ? itemKey(serial) : itemKey(`slot-${slot.replace(':', '-')}`),
      label: text(entry, 'Disk_Alias') ?? `Disk ${bay}`,
      model: model.replace(/\s+/g, ' '),
      temperature: celsius(text(entry, 'Temperature', 'oC')),
      state: diskState(text(entry, 'Health')),
      ssd: text(entry, 'hd_is_ssd') === '1',
      capacity: text(entry, 'Capacity'),
    });
  }
  return found;
}

/** The UPS of the NUT variables (src/qnap/nut.js). */
export function parseUps(variables) {
  if (!variables) {
    return null;
  }
  const status = String(variables['ups.status'] ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const runtime = num(variables['battery.runtime']);
  const name = [
    variables['ups.mfr'] ?? variables['device.mfr'],
    variables['ups.model'] ?? variables['device.model'],
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return {
    model: name || null,
    battery: percent(variables['battery.charge']),
    runtimeMinutes: runtime === null || runtime < 0 ? null : runtime / 60,
    load: percent(variables['ups.load']),
    onBattery: status.length ? status.includes('OB') : null,
    lowBattery: status.length ? status.includes('LB') : null,
  };
}

/**
 * One snapshot of the NAS.
 * @param {object} raw { sysinfo, volumes?, disks?, bandwidth?, firmware?, errors } (client.read)
 */
export function parseSnapshot(raw) {
  const doc = raw.sysinfo;
  const root = at(doc, 'func', 'ownContent', 'root');
  const firmware = currentFirmware(doc);
  const build = text(doc, 'firmware', 'build');
  const cpu = percent(text(root, 'cpu_usage'));
  return {
    platformId: platformId(root),
    name: text(root, 'server_name') ?? text(doc, 'hostname'),
    model: text(doc, 'model', 'displayModelName') ?? text(doc, 'model', 'modelName'),
    hero: text(doc, 'model', 'is_zfs') === '1',
    version: firmware
      ? `${firmware.version}${build && /^\d{8}$/.test(build) ? ` build ${build}` : ''}`
      : null,
    firmware,
    cpu,
    memory: memoryPercent(root),
    cpuTemperature: celsius(text(root, 'cpu_tempc')),
    systemTemperature: celsius(text(root, 'sys_tempc')),
    uptime: uptime(root),
    fans: fans(root),
    interfaces: raw.bandwidth === undefined ? null : parseBandwidth(raw.bandwidth),
    volumes: raw.volumes === undefined ? null : parseVolumes(raw.volumes),
    disks: raw.disks === undefined ? null : parseDisks(raw.disks),
    update: raw.firmware ? availableFirmware(raw.firmware, firmware) : null,
    updateKnown: Boolean(raw.firmware),
    errors: Object.fromEntries(
      Object.entries(raw.errors ?? {}).map(([part, err]) => [part, err.message]),
    ),
  };
}
