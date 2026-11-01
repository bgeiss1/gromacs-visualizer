// Checks the page's editconf against output recorded from real GROMACS 2023.3
// (tests/fixtures/editconf.json, made by tools/make-fixtures.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGro, groBoxLine } from '../js/gro.js';
import { parseCommand, buildCommand } from '../js/command.js';
import { editconf, prepareSystem } from '../js/editconf.js';
import { cellShape, volume, latticeShifts, closestImage, norm, sub } from '../js/geometry.js';

const here = new URL('..', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');
const systems = {
  lysozyme: prepareSystem(parseGro(read('data/lysozyme/lysozyme.gro'))),
  magainin2: prepareSystem(parseGro(read('data/magainin2/magainin2.gro')))
};
const fixtures = JSON.parse(read('tests/fixtures/editconf.json'));

// GROMACS computes in single precision, so the last printed digit can differ by one.
const NUM = /-?\d+\.\d+/g;
function sameOutput(actual, expected) {
  assert.equal(actual.length, expected.length, `line count\n${actual.join('\n')}`);
  actual.forEach((line, i) => {
    assert.equal(line.replace(NUM, '#').replace(/\s+/g, ' '), expected[i].replace(NUM, '#').replace(/\s+/g, ' '), line);
    const a = line.match(NUM) || [], e = expected[i].match(NUM) || [];
    a.forEach((x, k) => {
      const tol = 1.5 * 10 ** -((e[k].split('.')[1] || '').length);
      assert.ok(Math.abs(parseFloat(x) - parseFloat(e[k])) <= tol, `${line}\n vs ${expected[i]}`);
    });
  });
}

for (const fx of fixtures) {
  test(`${fx.system}: gmx editconf ${fx.args}`, () => {
    const p = parseCommand(`gmx editconf -f ${fx.system}.gro -o out.gro ${fx.args}`);
    assert.ok(p.opts, JSON.stringify(p));
    const sys = systems[fx.system];
    const r = editconf(sys, p.opts);
    sameOutput([groBoxLine(r.vectors)], [fx.boxLine]);
    sameOutput([...r.stdout, ...r.warnings], fx.stdout);
    const first = sys.atoms[0].x.map((x, k) => x + r.shift[k]);
    first.forEach((x, k) => assert.ok(Math.abs(x - fx.firstAtom[k]) < 0.0015, `atom 1 ${first} vs ${fx.firstAtom}`));
  });
}

const err = cmd => parseCommand(cmd).error;
test('errors read like GROMACS', () => {
  assert.deepEqual(err('gmx editconf -d 1 -bt octohedral').lines, ['In command-line option -bt', 'Invalid value: octohedral']);
  assert.equal(parseCommand('gmx editconf -bt octohedral').fix.to, '-bt octahedron');
  assert.deepEqual(err('gmx editconf -d abc').lines, ['In command-line option -d', "Invalid value: 'abc'; expected a number"]);
  assert.deepEqual(err('gmx editconf -d').lines, ['In command-line option -d', 'Too few (valid) values']);
  assert.deepEqual(err('gmx editconf -box 5 6').lines, ['In command-line option -box', 'Expected 1 or 3 values, got 2']);
  assert.deepEqual(err('gmx editconf -c -d 1 -noc').lines, ['In command-line option -noc', 'Option specified multiple times']);
  assert.deepEqual(err('gmx editconf -foo').lines, ['Unknown command-line option -foo']);
  assert.equal(parseCommand('gmx editconf -d 1 -bt dod').opts.bt, 'dodecahedron');
  assert.equal(parseCommand('gmx editconf -d 1 -bt c').opts.bt, 'cubic');
  assert.ok(parseCommand('editconf -d 1').shell);
  assert.equal(parseCommand('gmx solvate -cp a.gro').other, 'solvate');
});

test('buildCommand round-trips', () => {
  for (const c of ['gmx editconf -f a.gro -o b.gro -c -d 1.2 -bt cubic', 'gmx editconf -f a.gro -bt octahedron -d 2 -o b.gro', 'gmx editconf -f a.gro -o b.gro -box 6 7 8', 'gmx editconf -f a.gro -o b.gro -noc -box 7 -princ']) {
    assert.equal(buildCommand('editconf', parseCommand(c).opts), c);
  }
  const p = parseCommand('gmx editconf -f a.gro -bt octahedron -o b.gro').opts;
  p.d = 1.5; p.set.add('d');
  assert.equal(buildCommand('editconf', p), 'gmx editconf -f a.gro -bt octahedron -o b.gro -d 1.5');
});

test('compact cells have the right volume and image distance', () => {
  for (const bt of ['cubic', 'dodecahedron', 'octahedron']) {
    const p = parseCommand(`gmx editconf -d 1 -bt ${bt}`).opts;
    const r = editconf(systems.lysozyme, p);
    const cell = cellShape(bt, r.vectors);
    const L = systems.lysozyme.diameter + 2;
    for (const s of cell.shifts) assert.ok(norm(s) >= L - 1e-6, `${bt} shift ${norm(s)} < ${L}`);
    assert.ok(Math.abs(Math.min(...cell.shifts.map(norm)) - L) < 1e-6);
    // every vertex of the compact cell is on or inside the Voronoi bound
    for (const v of cell.verts) for (const s of cell.shifts) assert.ok(2 * (v[0] * s[0] + v[1] * s[1] + v[2] * s[2]) <= norm(s) ** 2 + 1e-6);
    if (cell.rotation) {
      const R = cell.rotation; // a rotation times a uniform scale
      const s2 = R[0][0] ** 2 + R[1][0] ** 2 + R[2][0] ** 2;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const d = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
        assert.ok(Math.abs(d / s2 - (i === j ? 1 : 0)) < 1e-9);
      }
    }
    assert.ok(volume(r.vectors) > 0);
  }
});

test('closest image is 2d for a triclinic box along the short axis', () => {
  const sys = systems.magainin2;
  const r = editconf(sys, parseCommand('gmx editconf -d 1.0').opts);
  const gap = closestImage(sys.atoms.map(a => a.x), latticeShifts(r.vectors), sys.diameter);
  assert.ok(gap >= 2.0 - 1e-6 && gap < 3, String(gap));
  const r2 = editconf(sys, parseCommand('gmx editconf -d 1.0 -bt cubic').opts);
  assert.ok(closestImage(sys.atoms.map(a => a.x), latticeShifts(r2.vectors), sys.diameter) >= 2.0 - 1e-6);
  assert.ok(sub([1, 1, 1], [1, 1, 1]).every(x => x === 0));
});
