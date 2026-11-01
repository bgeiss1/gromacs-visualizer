// The command parser on the other tools' options, and the workflow table they share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, buildCommand } from '../js/command.js';
import { WORKFLOW, fill, filesBefore, stepsFor } from '../js/site.js';

test('every command in the workflow parses on its own page', () => {
  for (const w of WORKFLOW) {
    const p = parseCommand(fill(w.cmd, 'magainin2'), w.tool);
    assert.ok(p.opts, `${w.key}: ${JSON.stringify(p.error || p)}`);
    assert.equal(buildCommand(w.tool, p.opts), fill(w.cmd, 'magainin2'), w.key);
  }
});

test('grompp -maxwarn takes an integer', () => {
  const p = parseCommand('gmx grompp -f a.mdp -maxwarn 1.5', 'grompp');
  assert.match(p.error.lines.join(' '), /expected an integer/);
});

test('trjconv -fit and -pbc accept a unique prefix', () => {
  const p = parseCommand('gmx trjconv -f x.xtc -fit rot+ -pbc noj', 'trjconv');
  assert.equal(p.opts.fit, 'rot+trans');
  assert.equal(p.opts.pbc, 'nojump');
});

test('mdrun -nb only takes cpu, gpu or auto', () => {
  const p = parseCommand('gmx mdrun -deffnm x -nb cuda', 'mdrun');
  assert.ok(p.error);
});

test('a command for another tool points to its page', () => {
  assert.equal(parseCommand('gmx genion -s x.tpr', 'solvate').other, 'genion');
});

test('files appear in the folder only after the step that makes them', () => {
  const before = filesBefore('grompp_ion', 'lysozyme');
  assert.ok(before.has('lysozyme_b4ion.gro'));
  assert.ok(!before.has('lysozyme_ion.tpr'));
  assert.ok(!before.has('lysozyme_em_sol.gro'));
});

test('the duplicate grompp is left out of the step buttons', () => {
  assert.deepEqual(stepsFor('grompp').map(w => w.key), ['grompp_em_vac', 'grompp_ion', 'grompp_em_sol', 'grompp_pr', 'grompp_md', 'grompp_longmd']);
});
