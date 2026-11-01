// Every text key the pages use exists in data/text.json, and the text follows Brian's style rules
// (no em or en dashes, no semicolons in prose).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const TEXT = JSON.parse(readFileSync(new URL('data/text.json', root), 'utf8'));
const read = f => readFileSync(new URL(f, root), 'utf8');

test('every data-t and literal T() key exists', () => {
  const used = new Set();
  for (const f of readdirSync(root).filter(f => f.endsWith('.html'))) for (const m of read(f).matchAll(/data-t="([^"]+)"/g)) used.add(m[1]);
  for (const f of ['js/site.js', 'js/files.js', ...readdirSync(new URL('js/pages/', root)).map(f => 'js/pages/' + f)]) {
    for (const m of read(f).matchAll(/\bT(?:plain)?\('([\w.]+)'(?=[,)])/g)) used.add(m[1]);
  }
  const missing = [...used].filter(k => !(k in TEXT));
  assert.deepEqual(missing, []);
});

test('text has no em dashes, en dashes or prose semicolons', () => {
  const bad = Object.entries(TEXT).filter(([, v]) => /[—–]/.test(v) || /;/.test(v.replace(/&\w+;|&#\d+;/g, '')));
  assert.deepEqual(bad.map(([k]) => k), []);
});
