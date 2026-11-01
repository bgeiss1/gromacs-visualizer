// The file viewer labels: every piece of the real files gets a label that exists in data/text.json,
// the pieces put back together give the original line, and the .top is rebuilt right for each step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { lineInfo, segments, plan, topAt, fileKind } from '../js/annotate.js';

const root = new URL('../', import.meta.url);
const TEXT = JSON.parse(readFileSync(new URL('data/text.json', root), 'utf8'));
const has = k => k in TEXT;
const read = f => readFileSync(new URL(f, root), 'utf8');

const files = ['data/lysozyme/lysozyme.top', 'data/lysozyme/lysozyme.gro', 'data/lysozyme/lysozyme_em_sol.gro', 'data/magainin2/magainin2.top',
  ...readdirSync(new URL('workflow/Functions/', root)).map(f => 'workflow/Functions/' + f),
  ...['lysozyme', 'magainin2'].flatMap(M => existsSync(new URL(`data/${M}/files/`, root)) ? readdirSync(new URL(`data/${M}/files/`, root)).map(f => `data/${M}/files/${f}`) : [])];

for (const f of files) {
  test(`labels for ${f}`, () => {
    const { ext, text } = fileKind(f);
    if (!text) return;
    const lines = read(f).replace(/\n$/, '').split('\n'), info = lineInfo(ext, lines);
    const missing = new Set();
    lines.forEach((l, i) => {
      const segs = segments(ext, l, info[i], has);
      assert.equal(segs.map(s => s.t).join(''), l, `line ${i + 1} comes back the same`);
      for (const s of segs) if (s.k && !has(s.k)) missing.add(s.k);
    });
    assert.deepEqual([...missing], []);
    const r = plan(ext, info);
    assert.ok(r.length && r.every(([a, b]) => a < b && b <= lines.length));
  });
}

test('the .top after pdb2gmx, solvate and genion', () => {
  const top = read('data/lysozyme/lysozyme.top');
  const mols = t => t.slice(t.search(/\[ molecules \]/)).split('\n').filter(l => l.trim() && !/^[;[]/.test(l.trim())).map(l => l.trim().split(/\s+/));
  assert.deepEqual(mols(topAt(top, { Protein: 1 })), [['Protein', '1']]);
  assert.deepEqual(mols(topAt(top, { Protein: 1, SOL: 18867 })), [['Protein', '1'], ['SOL', '18867']]);
  assert.deepEqual(mols(topAt(top, { Protein: 1, SOL: 18787, NA: 36, CL: 44 })), [['Protein', '1'], ['SOL', '18787'], ['NA', '36'], ['CL', '44']]);
  assert.deepEqual(mols(topAt(read('data/magainin2/magainin2.top'), { Protein: 1 })), [['Protein_chain_A', '1']]);
});

test('the solvated .gro shows where protein turns into water and water into ions', () => {
  const lines = read('data/lysozyme/lysozyme_em_sol.gro').replace(/\n$/, '').split('\n'), info = lineInfo('gro', lines);
  const shown = plan('gro', info).flatMap(([a, b]) => lines.slice(a, b));
  for (const res of ['SOL', 'NA', 'CL']) assert.ok(shown.some(l => l.slice(5, 10).trim() === res), res);
  assert.ok(shown.length < 100);
});
