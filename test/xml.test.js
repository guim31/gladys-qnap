// -----------------------------------------------------------------------------
// The small XML reader (src/qnap/xml.js): the shapes QTS answers with, and a
// clean refusal of what is not one of its answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { XmlError, at, list, parseQDoc, parseXml, text } from '../src/qnap/xml.js';

test('elements, CDATA, repeated names, empty and self-closing elements', () => {
  const doc = parseQDoc(`<?xml version="1.0" encoding="UTF-8" ?>
<QDocRoot version="1.0">
  <!-- a comment -->
  <a><![CDATA[ 1 ]]></a>
  <b><c>x</c><c>y</c><d/><e></e></b>
  <f>Tom &amp; Jerry &lt;3 &#65;&#x42;</f>
  <g>
      <![CDATA[pretty]]>
  </g>
</QDocRoot>`);
  assert.deepEqual(doc, {
    a: '1',
    b: { c: ['x', 'y'], d: '', e: '' },
    f: 'Tom & Jerry <3 AB',
    g: 'pretty',
  });
  assert.deepEqual(list(doc.b.c), ['x', 'y']);
  assert.deepEqual(list(doc.a), ['1']);
  assert.deepEqual(list(doc.missing), []);
  assert.deepEqual(list(doc.b.e), []);
  assert.equal(text(doc, 'b', 'c'), 'x');
  assert.equal(text(doc, 'b', 'd'), null);
  assert.equal(text(doc, 'nothing', 'here'), null);
  assert.deepEqual(at(doc, 'b', 'c'), {});
});

test('a CDATA section may hold what looks like markup', () => {
  assert.deepEqual(parseQDoc('<QDocRoot><a><![CDATA[<b>not a tag</b>]]></a></QDocRoot>'), {
    a: '<b>not a tag</b>',
  });
});

test('what is not a QTS answer is refused with an XmlError', () => {
  for (const source of [
    '',
    '<html><body>Router</body></html>',
    '<QDocRoot><a></QDocRoot>',
    '<QDocRoot><a><![CDATA[x</a></QDocRoot>',
    '<QDocRoot></QDocRoot><QDocRoot></QDocRoot>',
    '{"json": true}',
    `<QDocRoot>${'<a>'.repeat(100)}${'</a>'.repeat(100)}</QDocRoot>`,
  ]) {
    assert.throws(() => parseQDoc(source), XmlError, source.slice(0, 40));
  }
  assert.throws(() => parseXml(42), XmlError);
});

test('every real answer of the fixtures parses', () => {
  const base = new URL('./fixtures/qnap/', import.meta.url);
  let count = 0;
  const models = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const { name: model } of models) {
    for (const file of readdirSync(new URL(`${model}/`, base)).filter((f) => f.endsWith('.xml'))) {
      const doc = parseQDoc(readFileSync(new URL(`${model}/${file}`, base), 'utf8'));
      assert.equal(text(doc, 'authPassed'), '1', `${model}/${file}`);
      count += 1;
    }
  }
  assert.ok(count >= 25, `${count} answers`);
});
