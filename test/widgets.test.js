// -----------------------------------------------------------------------------
// The `nas` widget: valid for the core in every state and language (the SDK
// validator: vocabulary, budget, lengths), the problems first, and the Refresh
// button that reads the NAS again.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HUB_TIMINGS, WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import { FakeQnap, UPS_ON_MAINS } from './helpers/fakeQnap.js';
import { CONFIG, createWorld, tick } from './helpers/world.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function content(world, language = 'en') {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const status = (widget) => widget.components.find((c) => c.type === 'status');

test('a NAS that answers: valid, three tiles, the volume, the UPS, a Refresh button', async (t) => {
  const world = await createWorld({ nas: new FakeQnap({ ups: { ...UPS_ON_MAINS } }) });
  t.after(() => world.app.stop());
  for (const language of LANGUAGES) {
    const widget = await content(world, language);
    assert.deepEqual(validateWidgetContent(widget), [], language);
    assert.deepEqual(
      widget.components.map((c) => c.type),
      ['text', 'gauge', 'gauge', 'value', 'status', 'button'],
    );
  }
  const widget = await content(world, 'fr');
  assert.equal(widget.components[0].text, 'NAS-TEST-9');
  assert.equal(widget.components[3].value, 44);
  assert.deepEqual(
    status(widget).items.map((item) => [item.label, item.value]),
    [
      ['DataVol1', '85 % · 866 Go libres'],
      ['Onduleur', 'Sur secteur · 100 %'],
      ['En marche depuis', '2 j 1 h'],
    ],
  );
});

test('the problems come first: volume, disk, fan, UPS on battery, firmware', async (t) => {
  const world = await createWorld({ nas: new FakeQnap({ ups: { ...UPS_ON_MAINS } }) });
  t.after(() => world.app.stop());
  world.nas.setVolume({ status: -2 });
  world.nas.setDisk('0:3', { health: 'Abnormal' });
  world.nas.setFan(2, 0, true);
  world.nas.setUps({ ...UPS_ON_MAINS, 'ups.status': 'OB', 'battery.charge': '80' });
  world.nas.setFirmwareOffer('5.2.1.3000 Build 20261001');
  world.clock.advance(HUB_TIMINGS.firmwareIntervalMs);
  await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH);
  const widget = await content(world);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.deepEqual(
    status(widget).items.map((item) => [item.label, item.value, item.color]),
    [
      ['DataVol1', 'Degraded or abnormal', 'danger'],
      ['Disk 3', 'Error', 'danger'],
      ['Fan 2', 'Alert', 'danger'],
      ['UPS', 'On battery · 80 % · 31 min', 'warning'],
      ['Firmware', '5.2.1.3000', 'info'],
      ['Uptime', '2 d 1 h', 'neutral'],
    ],
  );
});

test('many disks in trouble stay within the budget of rows', async (t) => {
  const nas = new FakeQnap({ fixtures: { disks: 'TS-1677XU-RP-4.5.2/smartdiskhealth.xml' } });
  nas.docs.disks = nas.docs.disks.replaceAll(
    '<Health><![CDATA[OK]]>',
    '<Health><![CDATA[Warning]]>',
  );
  const world = await createWorld({ nas });
  t.after(() => world.app.stop());
  const widget = await content(world);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(status(widget).items.length, MAX_ROWS);
  assert.equal(status(widget).items.at(-1).label, 'Others');
});

test('a NAS that does not answer says so, and Refresh reads it again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.nas.failure = 'down';
  await tick(world);
  for (const language of LANGUAGES) {
    const widget = await content(world, language);
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.deepEqual(
      widget.components.map((c) => c.type),
      ['text', 'text', 'button'],
    );
  }
  world.nas.failure = null;
  const ack = await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH);
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, 'NAS read again.');
  assert.equal((await content(world)).components[1].type, 'gauge');
});

test('not configured: one sentence', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: '' } });
  t.after(() => world.app.stop());
  const widget = await content(world, 'de');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.match(widget.components[0].text, /Gib die Adresse/);
});

test('an unknown widget action is refused', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetAction(WIDGET_KEY, 'reboot');
  assert.equal(ack.success, false);
});
