// -----------------------------------------------------------------------------
// The Gladys devices of a QNAP NAS, proposed in the Discovery tab: the user
// adds the ones to follow, nothing is created on their behalf.
//
//   - the NAS itself: online, CPU, memory, CPU and system temperatures, each
//     fan (rpm), download and upload rates of each network interface, uptime,
//     firmware version, firmware update available;
//   - one device per volume: space used, capacity, free space, state, alert;
//   - one device per disk: temperature, SMART state, alert (its model is the
//     model of the device);
//   - the UPS, when the NAS shares one (src/qnap/nut.js): battery, runtime,
//     load, on battery, low battery.
//
// Identity: the serial number of the NAS (its first MAC address when the
// firmware hides the serial), then the volume number QTS gives, the serial
// number of the disk, `ups` for the UPS. Never a label: the user renames
// volumes, QTS translates disk names.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). The core has no generic "percent" category:
// usage percentages are `level-sensor/liquid-level-percent` (a fill level,
// the couple guim31/gladys-ugreen-nas and gladys-glances use), which also
// gives the gauge a 0-100 range. The core has no rpm unit: a fan is a
// `speed-sensor/integer` without unit, its name says "rpm". The states are
// `text/text` words in the configured language, next to an `input/binary`
// alert (1 = needs attention) that scenes and history can use.
//
// Published with should_poll: false: the integration reads the NAS on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { DISK_STATES, VOLUME_STATES } from './qnap/model.js';
import { DISK_STATE_TEXT, VOLUME_STATE_TEXT, pick } from './texts.js';

export const DEVICE_TYPES = Object.freeze({
  NAS: 'nas',
  VOLUME: 'volume',
  DISK: 'disk',
  UPS: 'ups',
});

// Suffixes of the feature external ids: permanent once published. Fans and
// network interfaces add their own key: `fan_1`, `download_eth0`.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  CPU: 'cpu',
  MEMORY: 'memory',
  CPU_TEMPERATURE: 'cpu_temperature',
  SYSTEM_TEMPERATURE: 'system_temperature',
  FAN: 'fan',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  UPTIME: 'uptime',
  VERSION: 'version',
  UPDATE: 'update_available',
  USED_PERCENT: 'used_percent',
  CAPACITY: 'capacity',
  FREE: 'free',
  STATE: 'state',
  ALERT: 'alert',
  TEMPERATURE: 'temperature',
  BATTERY: 'battery',
  RUNTIME: 'runtime',
  LOAD: 'load',
  ON_BATTERY: 'on_battery',
  LOW_BATTERY: 'low_battery',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
// FAN, DOWNLOAD and UPLOAD are followed by the fan number or interface name.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.CPU_TEMPERATURE]: 'CPU temperature',
    [K.SYSTEM_TEMPERATURE]: 'System temperature',
    [K.FAN]: 'Fan',
    rpm: 'rpm',
    [K.DOWNLOAD]: 'Download',
    [K.UPLOAD]: 'Upload',
    [K.UPTIME]: 'Uptime',
    [K.VERSION]: 'Firmware version',
    [K.UPDATE]: 'Update available',
    [K.USED_PERCENT]: 'Space used',
    [K.CAPACITY]: 'Capacity',
    [K.FREE]: 'Free space',
    [K.STATE]: 'State',
    [K.ALERT]: 'Alert',
    [K.TEMPERATURE]: 'Temperature',
    [K.BATTERY]: 'Battery',
    [K.RUNTIME]: 'Runtime',
    [K.LOAD]: 'Load',
    [K.ON_BATTERY]: 'On battery',
    [K.LOW_BATTERY]: 'Low battery',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.CPU_TEMPERATURE]: 'Température du processeur',
    [K.SYSTEM_TEMPERATURE]: 'Température du système',
    [K.FAN]: 'Ventilateur',
    rpm: 'tr/min',
    [K.DOWNLOAD]: 'Réception',
    [K.UPLOAD]: 'Émission',
    [K.UPTIME]: 'Durée de fonctionnement',
    [K.VERSION]: 'Version du firmware',
    [K.UPDATE]: 'Mise à jour disponible',
    [K.USED_PERCENT]: 'Espace utilisé',
    [K.CAPACITY]: 'Capacité',
    [K.FREE]: 'Espace libre',
    [K.STATE]: 'État',
    [K.ALERT]: 'Alerte',
    [K.TEMPERATURE]: 'Température',
    [K.BATTERY]: 'Batterie',
    [K.RUNTIME]: 'Autonomie',
    [K.LOAD]: 'Charge',
    [K.ON_BATTERY]: 'Sur batterie',
    [K.LOW_BATTERY]: 'Batterie faible',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.CPU_TEMPERATURE]: 'Prozessortemperatur',
    [K.SYSTEM_TEMPERATURE]: 'Systemtemperatur',
    [K.FAN]: 'Lüfter',
    rpm: 'U/min',
    [K.DOWNLOAD]: 'Empfang',
    [K.UPLOAD]: 'Senden',
    [K.UPTIME]: 'Laufzeit',
    [K.VERSION]: 'Firmware-Version',
    [K.UPDATE]: 'Update verfügbar',
    [K.USED_PERCENT]: 'Belegter Speicher',
    [K.CAPACITY]: 'Kapazität',
    [K.FREE]: 'Freier Speicher',
    [K.STATE]: 'Zustand',
    [K.ALERT]: 'Warnung',
    [K.TEMPERATURE]: 'Temperatur',
    [K.BATTERY]: 'Batterie',
    [K.RUNTIME]: 'Restlaufzeit',
    [K.LOAD]: 'Last',
    [K.ON_BATTERY]: 'Batteriebetrieb',
    [K.LOW_BATTERY]: 'Batterie schwach',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.CPU_TEMPERATURE]: 'Temperatura del procesador',
    [K.SYSTEM_TEMPERATURE]: 'Temperatura del sistema',
    [K.FAN]: 'Ventilador',
    rpm: 'rpm',
    [K.DOWNLOAD]: 'Recepción',
    [K.UPLOAD]: 'Envío',
    [K.UPTIME]: 'Tiempo en marcha',
    [K.VERSION]: 'Versión del firmware',
    [K.UPDATE]: 'Actualización disponible',
    [K.USED_PERCENT]: 'Espacio usado',
    [K.CAPACITY]: 'Capacidad',
    [K.FREE]: 'Espacio libre',
    [K.STATE]: 'Estado',
    [K.ALERT]: 'Alerta',
    [K.TEMPERATURE]: 'Temperatura',
    [K.BATTERY]: 'Batería',
    [K.RUNTIME]: 'Autonomía',
    [K.LOAD]: 'Carga',
    [K.ON_BATTERY]: 'Con batería',
    [K.LOW_BATTERY]: 'Batería baja',
  },
};

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure.
export const BOUNDS = Object.freeze({
  TEMPERATURE: [-50, 150],
  FAN_MAX_RPM: 20000,
  RATE_MAX_MBPS: 100000,
  UPTIME_MAX_DAYS: 36500,
  SIZE_MAX_GB: 10000000,
  RUNTIME_MAX_MINUTES: 10000,
});

/** External ids of a device: the NAS (`key` null), or one of its volumes, disks, UPS. */
export function deviceIds(gladys, type, nasId, key = null) {
  return gladys.externalIds(type, key === null ? nasId : `${nasId}-${key}`);
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const percent = (digits = 1) => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits,
});
const binary = () => ({
  definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  digits: 0,
});
const temperature = () => ({
  definition: {
    category: CATEGORY.DEVICE_TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: BOUNDS.TEMPERATURE[0],
    max: BOUNDS.TEMPERATURE[1],
  },
  digits: 0,
});
const rate = () => ({
  definition: {
    category: CATEGORY.DATARATE,
    type: TYPE.DATARATE.RATE,
    unit: UNIT.MEGABITS_PER_SECOND,
    min: 0,
    max: BOUNDS.RATE_MAX_MBPS,
  },
  digits: 2,
});
const size = () => ({
  definition: {
    category: CATEGORY.DATA,
    type: TYPE.DATA.SIZE,
    unit: UNIT.GIGABYTE,
    min: 0,
    max: BOUNDS.SIZE_MAX_GB,
  },
  digits: 1,
});
// A text state: min/max are NOT NULL in the core, even for a text.
const textual = () => ({
  definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  text: true,
});

const toMbps = (bytesPerSecond) =>
  bytesPerSecond === null || bytesPerSecond === undefined ? null : (bytesPerSecond * 8) / 1e6;
const toGigabytes = (bytes) => (bytes === null || bytes === undefined ? null : bytes / 1e9);
const binaryOf = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

/**
 * The features of a device for an item: what it stands for (the snapshot for
 * the NAS, a volume, a disk, the UPS). `item` null means it is gone: only the
 * features that do not need it remain (the NAS online flag). Each feature:
 * { key, name(names), definition, digits | text, value(item, ctx) }; `ctx`
 * carries { online, language }.
 */
function blueprint(type, item) {
  switch (type) {
    case DEVICE_TYPES.NAS: {
      const s = item;
      const features = [
        { key: K.ONLINE, ...binary(), value: (_, ctx) => (ctx.online ? 1 : 0) },
        { key: K.CPU, ...percent(), value: (x) => x?.cpu },
        { key: K.MEMORY, ...percent(), value: (x) => x?.memory },
      ];
      if (s?.cpuTemperature !== null) {
        features.push({
          key: K.CPU_TEMPERATURE,
          ...temperature(),
          value: (x) => x?.cpuTemperature,
        });
      }
      if (s?.systemTemperature !== null) {
        features.push({
          key: K.SYSTEM_TEMPERATURE,
          ...temperature(),
          value: (x) => x?.systemTemperature,
        });
      }
      for (const fan of s?.fans ?? []) {
        features.push({
          key: `${K.FAN}_${fan.key}`,
          name: (names) => `${names[K.FAN]} ${fan.key} (${names.rpm})`,
          definition: {
            category: CATEGORY.SPEED_SENSOR,
            type: TYPE.SPEED_SENSOR.INTEGER,
            min: 0,
            max: BOUNDS.FAN_MAX_RPM,
          },
          digits: 0,
          value: (x) => x?.fans?.find((f) => f.key === fan.key)?.speed,
        });
      }
      for (const nic of s?.interfaces ?? []) {
        const of = (x) => x?.interfaces?.find((i) => i.key === nic.key);
        features.push(
          {
            key: `${K.DOWNLOAD}_${nic.key}`,
            name: (names) => `${names[K.DOWNLOAD]} ${nic.label}`.slice(0, 40),
            ...rate(),
            value: (x) => toMbps(of(x)?.rx),
          },
          {
            key: `${K.UPLOAD}_${nic.key}`,
            name: (names) => `${names[K.UPLOAD]} ${nic.label}`.slice(0, 40),
            ...rate(),
            value: (x) => toMbps(of(x)?.tx),
          },
        );
      }
      features.push(
        {
          key: K.UPTIME,
          definition: {
            category: CATEGORY.DURATION,
            type: TYPE.DURATION.DECIMAL,
            unit: UNIT.DAYS,
            min: 0,
            max: BOUNDS.UPTIME_MAX_DAYS,
          },
          digits: 2,
          value: (x) => (x?.uptime === null || x?.uptime === undefined ? null : x.uptime / 86400),
        },
        { key: K.VERSION, ...textual(), value: (x) => x?.version },
        {
          key: K.UPDATE,
          ...binary(),
          // Unknown until the first firmware check (every 6 hours).
          value: (x) => (x?.updateKnown ? (x.update ? 1 : 0) : null),
        },
      );
      return features;
    }
    case DEVICE_TYPES.VOLUME: {
      const sized = item === null || item.total !== null;
      return [
        ...(sized
          ? [
              { key: K.USED_PERCENT, ...percent(), value: (v) => v?.percent },
              { key: K.CAPACITY, ...size(), value: (v) => toGigabytes(v?.total) },
              { key: K.FREE, ...size(), value: (v) => toGigabytes(v?.free) },
            ]
          : []),
        {
          key: K.STATE,
          ...textual(),
          value: (v, ctx) => (v ? pick(VOLUME_STATE_TEXT[v.state], ctx.language) : null),
        },
        {
          key: K.ALERT,
          ...binary(),
          value: (v) => (v ? binaryOf(VOLUME_STATES[v.state].alert) : null),
        },
      ];
    }
    case DEVICE_TYPES.DISK:
      return [
        // Kept once seen: a disk asleep may report no temperature for a while.
        { key: K.TEMPERATURE, ...temperature(), value: (d) => d?.temperature },
        {
          key: K.STATE,
          ...textual(),
          value: (d, ctx) => (d ? pick(DISK_STATE_TEXT[d.state], ctx.language) : null),
        },
        {
          key: K.ALERT,
          ...binary(),
          value: (d) => (d ? binaryOf(DISK_STATES[d.state].alert) : null),
        },
      ];
    case DEVICE_TYPES.UPS:
      return [
        {
          key: K.BATTERY,
          definition: {
            category: CATEGORY.BATTERY,
            type: TYPE.BATTERY.INTEGER,
            unit: UNIT.PERCENT,
            min: 0,
            max: 100,
          },
          digits: 0,
          value: (u) => u?.battery,
        },
        {
          key: K.RUNTIME,
          definition: {
            category: CATEGORY.DURATION,
            type: TYPE.DURATION.INTEGER,
            unit: UNIT.MINUTES,
            min: 0,
            max: BOUNDS.RUNTIME_MAX_MINUTES,
          },
          digits: 0,
          value: (u) => u?.runtimeMinutes,
        },
        { key: K.LOAD, ...percent(0), value: (u) => u?.load },
        { key: K.ON_BATTERY, ...binary(), value: (u) => binaryOf(u?.onBattery) },
        {
          key: K.LOW_BATTERY,
          definition: {
            category: CATEGORY.BATTERY_LOW,
            type: TYPE.BATTERY_LOW.BINARY,
            min: 0,
            max: 1,
          },
          digits: 0,
          value: (u) => binaryOf(u?.lowBattery),
        },
      ];
    default:
      throw new Error(`Unknown device type ${type}`);
  }
}

const nameOf = (feature, names) => (feature.name ? feature.name(names) : names[feature.key]);

/** The feature keys a device of this type has for this item. */
export const featureKeys = (type, item) => blueprint(type, item).map((f) => f.key);

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.type one of DEVICE_TYPES
 * @param {string} options.nasId platform id of the NAS
 * @param {string|null} options.key item key (null for the NAS)
 * @param {string} options.name device name
 * @param {string} options.model device model
 * @param {object} options.item what the device stands for
 * @param {string} [options.language] feature names language
 */
export function buildDevice(
  gladys,
  { type, nasId, key = null, name, model, item, language = 'en' },
) {
  const ids = deviceIds(gladys, type, nasId, key);
  const names = NAMES[language] ?? NAMES.en;
  const features = blueprint(type, item).map((feature) => ({
    name: nameOf(feature, names),
    external_id: ids.feature(feature.key),
    ...feature.definition,
    read_only: true,
    has_feedback: false,
    keep_history: !feature.text,
  }));
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: (model ?? 'QNAP').slice(0, 255),
    should_poll: false,
    features,
  };
}

/**
 * The states of every feature of a device, in the `publishStates` format;
 * the features without a value are left out.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function deviceStates(gladys, { type, nasId, key = null, item, context }) {
  const ids = deviceIds(gladys, type, nasId, key);
  const states = [];
  for (const feature of blueprint(type, item)) {
    const raw = feature.value(item, context);
    const id = ids.feature(feature.key);
    if (feature.text) {
      // An empty text is ignored by the core: nothing to publish.
      if (typeof raw === 'string' && raw.trim()) {
        states.push({ device_feature_external_id: id, text: raw.slice(0, 255) });
      }
      continue;
    }
    const value = round(raw, feature.digits);
    if (value !== null) {
      states.push({ device_feature_external_id: id, state: value });
    }
  }
  return states;
}
