// -----------------------------------------------------------------------------
// The snapshot (src/qnap/model.js) of the real answers of nine QNAP models,
// QTS 4.2 to 4.5 (test/fixtures/qnap, from python-qnapstats): the values its
// own tests expect, the models without CPU temperature, the bays left empty,
// the masked serial numbers, the two network answers, the firmware offered;
// then the state mappings and the UPS.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  availableFirmware,
  diskState,
  parseBandwidth,
  parseDisks,
  parseSnapshot,
  parseUps,
  parseVolumes,
  volumeState,
} from '../src/qnap/model.js';
import { parseQDoc } from '../src/qnap/xml.js';
import { UPS_ON_MAINS } from './helpers/fakeQnap.js';

const fixture = (path) => {
  const url = new URL(`./fixtures/qnap/${path}`, import.meta.url);
  return existsSync(url) ? parseQDoc(readFileSync(url, 'utf8')) : undefined;
};

test('TS-EC1280U, QTS 4.5.2: system, fans, temperatures, network', () => {
  const snapshot = parseSnapshot({
    sysinfo: fixture('TS-EC1280U-4.5.2/systemstats.xml'),
    bandwidth: fixture('TS-EC1280U-4.5.2/bandwidth.xml'),
  });
  assert.equal(snapshot.platformId, 'Q000TEST0002');
  assert.equal(snapshot.name, 'NAS-TEST-9');
  assert.equal(snapshot.model, 'TS-EC1280U');
  assert.equal(snapshot.hero, false);
  assert.equal(snapshot.version, '4.5.2.1594 build 20210302');
  assert.equal(snapshot.cpu, 1.2);
  // 3892 MB in all, 1517 MB free.
  assert.equal(Math.round(snapshot.memory * 10) / 10, 61);
  assert.equal(snapshot.cpuTemperature, 44);
  assert.equal(snapshot.systemTemperature, 40);
  assert.equal(snapshot.uptime, 2 * 86400 + 3600 + 26 * 60 + 49);
  assert.deepEqual(
    snapshot.fans.map((fan) => [fan.key, fan.speed, fan.alert]),
    [
      ['1', 6108, false],
      ['2', 6108, false],
      ['3', 6192, false],
      ['4', 6081, false],
    ],
  );
  // qnapstats divides the bytes by the 5-second interval: same figures.
  const lan4 = snapshot.interfaces.find((nic) => nic.key === 'eth3');
  assert.equal(lan4.label, 'LAN 4');
  assert.equal(Math.round(lan4.rx), 5041);
  assert.equal(Math.round(lan4.tx), 13702);
  assert.ok(snapshot.interfaces.some((nic) => nic.key === 'bond0'));
  assert.equal(snapshot.volumes, null, 'not read');
  assert.equal(snapshot.update, null);
  assert.equal(snapshot.updateKnown, false);
});

test('a failed fan: its status -1 or its failure flag', () => {
  const doc = fixture('TS-EC1280U-4.5.2/systemstats.xml');
  doc.func.ownContent.root.sysfan_fail2 = '1';
  doc.func.ownContent.root.sysfan3_stat = '-1';
  assert.deepEqual(
    parseSnapshot({ sysinfo: doc }).fans.map((fan) => fan.alert),
    [false, true, true, false],
  );
});

test('TS-410, QTS 4.2.3: no CPU temperature, no fan, older layout', () => {
  const snapshot = parseSnapshot({ sysinfo: fixture('TS-410-4.2.3/systemstats.xml') });
  assert.equal(snapshot.cpuTemperature, null);
  assert.equal(snapshot.systemTemperature, 40);
  assert.deepEqual(snapshot.fans, []);
  assert.equal(snapshot.cpu, 48.5);
  assert.equal(snapshot.version, '4.2.3 build 20170121');
});

test('TS-451: no serial number, the first MAC address identifies the NAS', () => {
  const snapshot = parseSnapshot({ sysinfo: fixture('TS-451-4.2.2/systemstats.xml') });
  assert.match(snapshot.platformId, /^mac02005e0000[0-9a-f]{2}$/);
});

test('the volumes of a TS-451 and a TS-639 (labels or numbers, sizes in bytes)', () => {
  const [ts451] = parseVolumes(fixture('TS-451-4.2.2/volumes.xml'));
  assert.deepEqual(
    { ...ts451, percent: Math.round(ts451.percent * 10) / 10 },
    {
      key: '1',
      label: 'DataVol1',
      level: 'raid5',
      code: '0',
      state: 'ready',
      total: 5934928510976,
      free: 865955594240,
      percent: 85.4,
    },
  );
  // A TS-639 (QTS 4.2.3, storage v1): no labels, volumes 3 and 4 only.
  assert.deepEqual(
    parseVolumes(fixture('TS-639-4.2.3/volumes.xml')).map((v) => [v.key, v.label, v.state]),
    [
      ['3', 'Volume 3', 'ready'],
      ['4', 'Volume 4', 'ready'],
    ],
  );
  // A TS-1677XU-RP whose volumes report no usage: kept, without sizes.
  const unsized = parseVolumes(fixture('TS-1677XU-RP-4.5.2/volumes.xml'));
  assert.deepEqual(
    unsized.map((v) => [v.label, v.total, v.percent]),
    [
      ['V_DataVolUsers', null, null],
      ['V_DataVol_Xray', null, null],
    ],
  );
  // A TS-EC1280U without any volume.
  assert.deepEqual(parseVolumes(fixture('TS-EC1280U-4.5.2/volumes.xml')), []);
});

test('the disks: SMART summary, temperature, empty bays, masked serial numbers', () => {
  // TS-659: bays 4 and 5 empty (no model, Disk_Status -5), an SSD without temperature.
  const ts659 = parseDisks(fixture('TS-659-4.2.6/smartdiskhealth.xml'));
  assert.deepEqual(
    ts659.map((disk) => [disk.label, disk.state, disk.temperature]),
    [
      ['Disk 1', 'good', 38],
      ['Disk 2', 'good', 38],
      ['Disk 3', 'good', null],
      ['Disk 6', 'good', 37],
    ],
  );
  assert.ok(ts659.every((disk) => /^TESTDISK\d{4}$/.test(disk.key)));
  // TS-451: the four disks share one masked serial: the bay identifies them.
  assert.deepEqual(
    parseDisks(fixture('TS-451-4.2.2/smartdiskhealth.xml')).map((disk) => disk.key),
    ['slot-0-1', 'slot-0-2', 'slot-0-3', 'slot-0-4'],
  );
  // TS-1677XU-RP: 16 SSD and HDD, the 32763 of a missing module sensor ignored.
  const ts1677 = parseDisks(fixture('TS-1677XU-RP-4.5.2/smartdiskhealth.xml'));
  assert.equal(ts1677.length, 16);
  assert.equal(new Set(ts1677.map((disk) => disk.key)).size, 16);
  assert.equal(ts1677[0].ssd, true);
  assert.equal(ts1677[0].temperature, 32);
  assert.equal(ts1677[0].model, '5200_MTFDDAK960TDD');
  // TS-110 (ARM, QTS 4.2.4).
  assert.deepEqual(
    parseDisks(fixture('TS-110-4.2.4/smartdiskhealth.xml')).map((d) => [d.model, d.state]),
    [['WDC WD30EFRX-68EUZN0', 'good']],
  );
});

test('the two network answers: items (QSM40bandwidth) and ethN (QTS 4.5.4)', () => {
  assert.deepEqual(
    parseBandwidth(fixture('TS-1677XU-RP-4.5.2/bandwidth.xml')).map((nic) => [
      nic.key,
      nic.label,
      Math.round(nic.rx),
      Math.round(nic.tx),
    ]),
    [
      ['eth0', 'LAN 1', 6092, 96],
      ['eth1', 'LAN 2', 6092, 87],
      ['eth2', 'LAN 3', 7132, 6111],
      ['eth3', 'LAN 4', 63, 0],
    ],
  );
  assert.deepEqual(
    parseBandwidth(fixture('TS-X53-4.5.4/bandwidth2.xml')).map((nic) => [
      nic.key,
      nic.label,
      Math.round(nic.rx),
      Math.round(nic.tx),
    ]),
    [
      ['eth0', 'Adapter 1', 3157, 656],
      ['eth1', 'Adapter 2', 0, 0],
    ],
  );
  // The 4.5.4 answer to the old query: nothing.
  assert.deepEqual(parseBandwidth(fixture('TS-X53-4.5.4/bandwidth.xml')), []);
});

test('the firmware offered: newer by build date, else by version', () => {
  const doc = fixture('TS-420-4.3.3/firmwareupdate.xml');
  const running = parseSnapshot({ sysinfo: doc, firmware: doc });
  assert.equal(running.version, '4.3.4.0675 build 20180810');
  assert.deepEqual(running.update, {
    version: '4.3.4.0695',
    label: '4.3.4.0695 Build 20180830',
  });
  assert.equal(running.updateKnown, true);

  const offer = (newVersion) => ({ func: { ownContent: { newVersion } } });
  const current = { version: '5.2.1.3000', build: '20261001' };
  assert.equal(availableFirmware(offer(''), current), null);
  assert.equal(availableFirmware(offer('5.2.1.3000 Build 20261001'), current), null);
  assert.equal(availableFirmware(offer('5.1.0.2000 Build 20250101'), current), null);
  assert.equal(
    availableFirmware(offer('5.2.2.3100 Build 20261201'), current).version,
    '5.2.2.3100',
  );
  // No build date on one side: the version decides.
  assert.equal(availableFirmware(offer('5.2.2.3100'), current).version, '5.2.2.3100');
  assert.equal(
    availableFirmware(offer('5.2.1.3000'), { version: '5.2.1.3000', build: null }),
    null,
  );
});

test('volume states: 0 ready, a RAID operation in progress, any other code abnormal', () => {
  assert.equal(volumeState('0', '100'), 'ready');
  assert.equal(volumeState('0', '-1'), 'ready');
  assert.equal(volumeState('0', null), 'ready');
  assert.equal(volumeState('0', '37'), 'rebuilding');
  assert.equal(volumeState('-2', '100'), 'abnormal');
  assert.equal(volumeState('5', null), 'abnormal');
  assert.equal(volumeState(null, null), 'unknown');
});

test('disk states: the words of the SMART summary', () => {
  assert.equal(diskState('OK'), 'good');
  assert.equal(diskState('Good'), 'good');
  assert.equal(diskState('Normal'), 'good');
  assert.equal(diskState('Warning'), 'warning');
  assert.equal(diskState('Abnormal'), 'error');
  assert.equal(diskState('Error'), 'error');
  assert.equal(diskState(''), 'unknown');
  assert.equal(diskState('--'), 'unknown');
});

test('the UPS of the NUT variables', () => {
  assert.deepEqual(parseUps(UPS_ON_MAINS), {
    model: 'American Power Conversion Back-UPS ES 700G',
    battery: 100,
    runtimeMinutes: 30.5,
    load: 18,
    onBattery: false,
    lowBattery: false,
  });
  assert.deepEqual(parseUps({ 'ups.status': 'OB DISCHRG LB', 'battery.charge': '9' }), {
    model: null,
    battery: 9,
    runtimeMinutes: null,
    load: null,
    onBattery: true,
    lowBattery: true,
  });
  assert.equal(parseUps({ 'battery.charge': '50' }).onBattery, null);
});
