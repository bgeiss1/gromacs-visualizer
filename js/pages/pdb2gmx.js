// pdb2gmx: PDB in, hydrogens + topology out. pdb2gmx asks which force field to use (and which
// water model, without -water); the student answers in the terminal. The output for each force
// field comes from a real run (data/<system>/pdb2gmx/ff<N>.gro and .log), captured at a terminal
// so the question and the answer appear where a student sees them.
import { parseGro, isHydrogen } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { stats } from '../geometry.js';
import { Scene } from '../viewer.js';
import { $, esc, setup, T, loadSystems, text, shell, terminal, errorLines, notes, showParseProblem, commandLine, tries, systemPicker, basename, trimLog, splitTyped, gmxVersion, hasRun } from '../site.js';
import { showFiles } from '../files.js';

await setup('pdb2gmx');
const START = 'gmx pdb2gmx -ignh -f lysozyme.pdb -o lysozyme.gro -p lysozyme.top -water tip3p';

// Exercise cards (hidden while SHOW_TRIES is false in site.js).
const TRIES = [
  {
    title: 'Which force field?',
    cmd: START,
    ask: 'OPLS-AA/L is a good force field. Which number do you type to get it in GROMACS 2026.4, and what does answering <code>1</code> give you?',
    answer: 'Number 1 is AMBER03. OPLS-AA/L is number <code>17</code> in GROMACS 2026.4 (it was 15 in older versions), or skip the question with <code>-ff oplsaa</code>.'
  },
  {
    title: 'Where did the hydrogens go?',
    cmd: START,
    ask: 'Pick GROMOS 54a7 (14). Count the atoms and look at the protein with hydrogens highlighted. What changed compared with AMBER03?',
    answer: '1323 atoms instead of 1960. GROMOS is a united-atom force field, so only polar hydrogens are added.'
  },
  {
    title: 'Name the force field',
    cmd: 'gmx pdb2gmx -ignh -f magainin2.pdb -o magainin2.gro -p magainin2.top -water tip3p -ff amber99sb-ildn',
    ask: 'No question this time. Why, and what is the peptide\'s charge?',
    answer: '<code>-ff amber99sb-ildn</code> answers the question on the command line. Magainin 2 comes out at +3.'
  }
];

let systems, ffs, scene, good = null, view = 'after', line, version = '2026.4';
const cache = {};
const load = async path => cache[path] ??= text(path);

async function boot() {
  [systems, ffs] = await Promise.all([loadSystems(), (await fetch('data/forcefields.json')).json()]);
  for (const s of systems) {
    const pdb = await load(`data/${s.id}/${s.id}.pdb`);
    s.pdbAtoms = pdb.split('\n').filter(l => l.startsWith('ATOM')).map(l => ({ resnr: +l.slice(22, 26), resname: l.slice(17, 20).trim(), name: l.slice(12, 16).trim(), x: [+l.slice(30, 38) / 10, +l.slice(38, 46) / 10, +l.slice(46, 54) / 10] }));
  }
  $('ff-select').innerHTML = ffs.map(f => `<option value="${f.n}">${f.n}: ${esc(f.label)}</option>`).join('');
  scene = new Scene($('viewer'));
  line = commandLine({ run, start: START });
  tries($('tries'), TRIES, t => { line.set(t.cmd); run(); });
  $('ff-select').addEventListener('change', () => setFF(+$('ff-select').value));
  $('ff-byname').addEventListener('change', () => setFF(+$('ff-select').value));
  $('water-select').addEventListener('change', () => edit(o => { o.water = $('water-select').value; o.set.add('water'); }, ffAnswer()));
  $('ignh-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.ignh = true; o.set.add('ignh'); } else o.set.delete('ignh'); }, ffAnswer()));
  $('show-before').addEventListener('click', () => { view = 'before'; draw(true); });
  $('show-after').addEventListener('click', () => { view = 'after'; draw(true); });
  $('show-h').addEventListener('change', () => draw(false));
  $('view-reset').addEventListener('click', () => draw(true));
  run();
}

// Changing a control re-runs the command. The answer given last time is typed again for you.
const ffAnswer = () => (good && !(good.opts.set.has('ff') && good.opts.ff !== 'select') ? [String(good.ff.n)] : []);
function edit(change, auto = []) {
  const base = good?.opts || parseCommand($('cmd').value, 'pdb2gmx').opts;
  if (!base) return;
  const o = { ...base, set: new Set(base.set), ignored: [...base.ignored], order: [...base.order] };
  change(o);
  line.set(buildCommand('pdb2gmx', o));
  run({ auto });
}
// The force-field control either types the number at the question or names it with -ff.
function setFF(n) {
  if ($('ff-byname').checked) edit(o => { o.ff = ffs[n - 1].dir; o.set.add('ff'); });
  else edit(o => { o.set.delete('ff'); }, [String(n)]);
}

// Each force field was run in its own folder; drop the backup note a second run would print.
const shown = lines => lines.map(l => l.replace(/\/\S*\/([\w.-]+\.pdb)/g, '$1')).filter((l, i, a) => !/^Back Off! I just backed up posre/.test(l) && !(l === '' && /^Back Off! I just backed up posre/.test(a[i - 1] || '')));
const color = l => /^(WARNING|NOTE)/.test(l) ? `<span class="t-warn">${esc(l)}</span>` : esc(l);

async function run({ focus = false, auto = [] } = {}) {
  const command = $('cmd').value;
  const p = parseCommand(command, 'pdb2gmx');
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'pdb2gmx', ui)) { $('stale').hidden = !good; return; }
  const o = p.opts;
  const sys = systems.find(s => basename(o.f) === `${s.id}.pdb`);
  if (!sys) {
    terminal(ui.term, command, errorLines('pdb2gmx', { title: 'Invalid command-line options', lines: ['In command-line option -f', `File '${o.f}' does not exist or is not accessible.`, 'The file could not be opened.', '  Reason: No such file or directory'] }, version));
    notes(ui.coach, [{ h: T('pdb2gmx.noFile', { files: systems.map(s => `<code>${s.id}.pdb</code>`).join(' and ') }), k: 'err' }]);
    $('stale').hidden = !good;
    return;
  }
  version = await gmxVersion(sys.id);
  showFiles(sys.id, 'pdb2gmx');
  const named = o.set.has('ff') && o.ff !== 'select';
  let ff = named ? ffs.find(f => f.dir === o.ff) : null;
  if (named && !ff) {
    terminal(ui.term, command, ['-------------------------------------------------------', `Program:     gmx pdb2gmx, version ${version}`, '', 'Inconsistency in user input:', `Could not find force field '${o.ff}' in current directory, install tree or`, 'GMXLIB path.', '-------------------------------------------------------'].map(l => `<span class="t-err">${esc(l)}</span>`));
    notes(ui.coach, [{ h: T('pdb2gmx.badFF', { names: ffs.map(f => `<code>${f.dir}</code>`).join(', ') }), k: 'err' }]);
    $('stale').hidden = !good;
    return;
  }

  // Everything up to the force-field question is the same whichever force field is picked.
  const first = splitTyped(trimLog(await load(`data/${sys.id}/pdb2gmx/ff1.log`)));
  const term = shell(ui.term, command, { auto, focus });
  const before = first.parts[0];
  const list = before.findIndex(l => /^Select the Force Field/.test(l));
  let usedNumber = null;
  if (named) term.print(shown(before.slice(0, list)).map(color));
  else {
    term.print(shown(before).map(color));
    if (!auto.length) { waitingView(sys); sync({ sys, opts: o, ff: null, water: o.set.has('water') ? o.water : 'select' }); }
    const a = await term.ask({
      check: v => (ffs.some(f => String(f.n) === v) ? null : { lines: [] }),
      onWait: state => notes(ui.coach, [{ k: 'wait', h: state === 'again' ? T('pdb2gmx.waitAgain', { n: ffs.length }) : state === 'stopped' ? T('common.stopped') : T('pdb2gmx.waitFF') }])
    });
    ff = ffs.find(f => String(f.n) === a);
    usedNumber = ff.n;
  }

  // The rest of that force field's run. Without -water, pdb2gmx asks about water next.
  const rest = splitTyped(trimLog(await load(`data/${sys.id}/pdb2gmx/ff${ff.n}.log`))).parts.at(-1);
  let water = o.set.has('water') ? o.water : 'select';
  let after = shown(rest);
  if (water === 'select') {
    const choices = [...ff.waters, { id: 'none', name: 'None', desc: '' }];
    const at = after.findIndex(l => /^going to rename|^Opening force field file/.test(l));
    const head = after.slice(0, at);
    while (head.length && !head.at(-1)) head.pop();
    const dir = (after.find(l => /^Opening force field file /.test(l)) || '').match(/file (\S*\/)[\w.-]+\.ff\//)?.[1] || '';
    term.print([...head, `Opening force field file ${dir}${ff.dir}.ff/watermodels.dat`, '', 'Select the Water Model:', '', ...choices.flatMap((w, i) => [`${String(i + 1).padStart(2)}: ${w.name.padEnd(9)} ${w.desc}`.trimEnd(), ''])].slice(0, -1).map(color));
    const a = await term.ask({
      check: v => (/^\d+$/.test(v) && choices[+v - 1] ? null : { lines: [] }),
      onWait: state => notes(ui.coach, [{ k: 'wait', h: state === 'again' ? T('pdb2gmx.waitAgainWater', { n: choices.length }) : state === 'stopped' ? T('common.stopped') : T('pdb2gmx.waitWater') }])
    });
    water = choices[+a - 1].id;
    after = ['', ...after.slice(at)];
  }
  term.print(after.map(l => l.replace(/\btip3p\b/g, water === 'none' ? 'no' : water)).map(color));

  const raw = await load(`data/${sys.id}/pdb2gmx/ff${ff.n}.log`);
  const gro = parseGro(await load(`data/${sys.id}/pdb2gmx/ff${ff.n}.gro`));
  good = { sys, opts: o, ff, water, gro, log: raw };
  $('stale').hidden = true;
  const coach = [];
  if (usedNumber === 1) coach.push({ h: T('pdb2gmx.answered1') });
  else if (usedNumber) coach.push({ h: T('pdb2gmx.answeredOther', { n: usedNumber, ff: esc(ff.label.split(' (')[0]) }) });
  if (named) coach.push({ h: T('pdb2gmx.namedFF', { ff: esc(ff.dir) }) });
  if (!o.set.has('ignh') || !o.ignh) coach.push({ h: T('pdb2gmx.noIgnh') });
  if (water !== 'none' && !ff.waters.some(w => w.id === water)) coach.push({ h: T('pdb2gmx.waterNotListed', { water: esc(water), ff: esc(ff.label.split(' ')[0]) }), k: 'warn' });
  for (const flag of ['ter', 'his', 'ss']) if (o.set.has(flag) && o[flag]) coach.push({ h: T('pdb2gmx.extraQuestions', { flag }) });
  notes(ui.coach, coach);
  sync();
  readouts();
  draw(true);
}

// While pdb2gmx waits for an answer there is no .gro yet, so the view shows the PDB.
function waitingView(sys) {
  $('readout').innerHTML = `<dt>${T(hasRun() ? 'pdb2gmx.rows.waiting' : 'common.notRunRow')}</dt><dd>${T(hasRun() ? 'pdb2gmx.rows.waitingNote' : 'common.notRunNote')}</dd>`;
  $('top-excerpt').textContent = '';
  $('top-name').textContent = '';
  const st = stats(sys.pdbAtoms.map(a => a.x));
  scene.clear();
  scene.setOrigin(st.center);
  scene.addAtoms(sys.pdbAtoms, { cartoon: { color: '#4f7a94', opacity: 0.75 }, stick: { radius: 0.14, colorscheme: 'Jmol' } });
  scene.frame(Math.max(...st.size) * 1.15);
  $('show-before').setAttribute('aria-pressed', 'true');
  $('show-after').setAttribute('aria-pressed', 'false');
}

// Sets the controls from the command. ff is null while pdb2gmx is still waiting for the answer.
function sync({ sys, opts: o, ff, water } = good) {
  systemPicker($('sys-seg'), systems, sys.id, s => edit(x => { x.f = `${s.id}.pdb`; x.o = `${s.id}.gro`; x.p = `${s.id}.top`; ['f', 'o', 'p'].forEach(k => x.set.add(k)); }, ffAnswer()));
  $('sys-note').innerHTML = T(`system.${sys.id}.shape`) + ' ' + T(`system.${sys.id}.source`);
  $('ff-byname').checked = o.set.has('ff') && o.ff !== 'select';
  $('ignh-on').checked = o.set.has('ignh') && o.ignh;
  $('ignh-val').textContent = $('ignh-on').checked ? 'on' : 'off';
  if (!ff) {
    $('ff-val').innerHTML = hasRun() ? T('pdb2gmx.ffWaiting') : '';
    $('water-select').innerHTML = `<option>${water === 'select' ? T('pdb2gmx.waterAsked') : esc(water)}</option>`;
    $('water-val').textContent = water === 'select' ? '' : water;
    return;
  }
  $('ff-select').value = ff.n;
  $('ff-val').innerHTML = $('ff-byname').checked ? `-ff ${ff.dir}` : T('pdb2gmx.typed', { v: ff.n });
  $('water-select').innerHTML = [...ff.waters.map(w => `<option value="${w.id}">${w.id}: ${esc(w.desc)}</option>`), `<option value="none">none</option>`].join('');
  if (!ff.waters.some(w => w.id === water) && water !== 'none') $('water-select').insertAdjacentHTML('afterbegin', `<option value="${esc(water)}">${esc(water)} ${T('pdb2gmx.notInList')}</option>`);
  $('water-select').value = water;
  $('water-val').innerHTML = o.set.has('water') ? esc(water) : T('pdb2gmx.typed', { v: water });
}

function readouts() {
  const { sys, gro, ff, water, opts: o, log } = good;
  const h = gro.atoms.filter(isHydrogen).length;
  const charge = (log.match(/Total charge ([-\d.]+) e/g) || []).pop()?.match(/[-\d.]+/)[0];
  const ss = (log.match(/^Linking CYS/gm) || []).length;
  const res = new Set(gro.atoms.map(a => a.resnr)).size;
  const rows = [
    ['forceField', `${esc(ff.label.split(' (')[0])}`],
    ['atomsPDB', sys.pdbAtoms.length.toLocaleString()],
    ['atomsAfter', gro.atoms.length.toLocaleString()],
    ['hydrogens', `${h.toLocaleString()}${ff.dir.startsWith('gromos') ? `<span class="sub">${T('pdb2gmx.rows.unitedAtom')}</span>` : ''}`],
    ['residues', res],
    ['charge', `${charge > 0 ? '+' : ''}${(+charge).toFixed(0)} e<span class="sub">${T('pdb2gmx.rows.chargeNote')}</span>`],
    ['disulfides', ss || T('pdb2gmx.rows.none')],
    ['files', [o.o, o.p, o.i].map(f => `<span class="mono">${esc(basename(f))}</span>`).join(', ')]
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${T('pdb2gmx.rows.' + k)}</dt><dd>${v}</dd>`).join('');
  $('top-name').textContent = basename(o.p);
  const inc = `${ff.dir}.ff`;
  $('top-excerpt').textContent = [
    '; Include forcefield parameters', `#include "${inc}/forcefield.itp"`, '',
    '[ moleculetype ]', '; Name            nrexcl', 'Protein             3', '',
    `[ atoms ]          ; ${gro.atoms.length} atoms with their type, charge and mass`, '[ bonds ]          ; then bonds, pairs, angles, dihedrals …', '',
    '; Include Position restraint file', '#ifdef POSRES', `#include "${basename(o.i)}"`, '#endif', '',
    ...(water === 'none' ? [] : ['; Include water topology', `#include "${inc}/${water}.itp"`, '']),
    '; Include topology for ions', `#include "${inc}/ions.itp"`, '',
    '[ system ]', gro.title.replace(/ t=.*/, ''), '',
    '[ molecules ]', '; Compound        #mols', 'Protein             1'
  ].join('\n');
}

function draw(refit) {
  if (!good) return;
  const { sys, gro } = good;
  const before = view === 'before';
  $('show-before').setAttribute('aria-pressed', String(before));
  $('show-after').setAttribute('aria-pressed', String(!before));
  const atoms = before ? sys.pdbAtoms : gro.atoms;
  const st = stats(atoms.map(a => a.x));
  scene.clear();
  scene.setOrigin(st.center);
  const m = scene.addAtoms(atoms, { cartoon: { color: '#4f7a94', opacity: 0.75 }, stick: { radius: 0.14, colorscheme: 'Jmol' } });
  if (!before && $('show-h').checked) m.setStyle({ elem: 'H' }, { stick: { radius: 0.1, color: '#ffffff' }, sphere: { radius: 0.32, color: '#ffffff' } }, true);
  if (refit) scene.frame(Math.max(...st.size) * 1.15); else scene.render();
}

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
