// trjconv: the production run written out different ways. Each -pbc/-center/-fit choice the page
// draws is a real trjconv run (data/<system>/trjconv/*.gro, protein + ions); -dt, -b, -e, -skip
// and -dump pick frames from it the way trjconv does, and the output group picks atoms.
import { parseGroFrames } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { boxCenter, norm, stats } from '../geometry.js';
import { Scene } from '../viewer.js';
import { $, esc, setup, T, loadSystems, text, params, shell, terminal, notes, showParseProblem, commandLine, tries, stepPicker, WORKFLOW, fill, basename, errorLines, pickGroup, groupNames, stepWhat, hasRun } from '../site.js';
import { showFiles } from '../files.js';

await setup('trjconv');

const TRIES = [
  {
    title: 'Straight out of mdrun',
    cmd: 'gmx trjconv -f magainin2_longmd.xtc -s magainin2_longmd.tpr -o raw.xtc', stdin: '1',
    ask: 'No <code>-pbc</code> at all. Drag the slider to 300 ps and look near the bottom wall of the box. Part of the peptide is missing from the helix. Where did it go?',
    answer: 'The N-terminal end of the peptide (the Ile2 side chain and part of Gly3) has crossed the box wall and reappears on the opposite side. Nothing is wrong with the simulation; mdrun keeps every atom inside the box, so molecules near a wall come out split. Between 250 and 360 ps the peptide is split this way in every frame. <code>-pbc mol</code> puts each molecule back together.'
  },
  {
    title: 'Whole, but jumping',
    cmd: 'gmx trjconv -f magainin2_longmd.xtc -s magainin2_longmd.tpr -pbc mol -o mol.xtc', stdin: '1',
    ask: 'Now the peptide is whole. Watch where it is from frame to frame. What still looks wrong?',
    answer: 'When its center crosses a wall, the whole molecule jumps to the other side of the box. Distances and RMSD computed on this would show sudden spikes. <code>-pbc nojump</code> undoes those jumps by following each atom continuously.'
  },
  {
    title: 'Too much water',
    cmd: 'gmx trjconv -f magainin2_longmd.xtc -s magainin2_longmd.tpr -dt 10 -ur compact -center -pbc nojump -o magainin2_longmd_nojump.xtc', stdin: '4\n0',
    ask: 'The script answers <code>0</code> for the output group. Compare the file size with output group <code>1</code>. How big would 100 ns be?',
    answer: 'Group 0 (System) keeps all 35,315 atoms, mostly water: about 100 times the size of the peptide alone. For 100 ns at this frame rate that is hundreds of MB instead of a few. If you only want to watch the protein, write group 1 (Protein); keep the full system only if you will analyse the water or ions.'
  },
  {
    title: 'Hold still',
    cmd: 'gmx trjconv -f magainin2_longmd_nojump.xtc -s magainin2_longmd.tpr -dt 10 -ur compact -fit rot+trans -o magainin2_longmd_nojump_fit.xtc', stdin: '4\n1',
    ask: 'With <code>-fit rot+trans</code> the backbone is superimposed on the first frame. What can you see now that you couldn\'t before?',
    answer: 'The tumbling and drifting are gone, so only changes in shape are left: the ends of the helix fraying and the side chains moving. This is what you want for watching flexibility or computing RMSD. The box no longer means anything once every frame is rotated, so don\'t use a fitted trajectory for anything that needs periodic boundaries.'
  },
  {
    title: 'A warning worth reading',
    cmd: 'gmx trjconv -f magainin2_longmd.xtc -s magainin2_longmd.tpr -dump 0 -ur compact -pbc nojump -o magainin2_longmd_nojump_start.gro', stdin: '0',
    ask: 'Read the first lines GROMACS prints. Does <code>-ur compact</code> do anything in this command?',
    answer: 'No. "Option for unitcell representation (-ur compact) only has effect in combination with -pbc mol, res or atom." With <code>-pbc nojump</code> the molecule is followed out of the box, so there is no box shape to wrap it into. The script\'s commands still work; the option is just ignored.'
  }
];

let systems, step, scene, good = null, timer = null, line, version = '2026.4', lastAnswers = null;
const cache = {};
const load = path => cache[path] ??= text(path);

async function boot() {
  systems = await loadSystems();
  const q = params();
  step = WORKFLOW.find(w => w.key === q.get('step') && w.tool === 'trjconv') || WORKFLOW.find(w => w.key === 'trjconv_nojump');
  const asked = systems.find(s => s.id === q.get('sys')) || systems[0];
  const sysId = step.md && !asked.hasMD ? systems.find(s => s.hasMD).id : asked.id;
  scene = new Scene($('viewer'));
  line = commandLine({ run, start: fill(step.cmd, sysId) });
  $('cmd-reset').onclick = () => { line.set(fill(step.cmd, good?.sys.id || sysId)); run({ focus: true }); };
  tries($('tries'), TRIES, t => { line.set(t.cmd); run(); });
  $('pbc-seg').addEventListener('click', e => { const b = e.target.closest('button[data-pbc]'); if (b) edit(o => { if (b.dataset.pbc === 'none') o.set.delete('pbc'); else { o.pbc = b.dataset.pbc; o.set.add('pbc'); } }); });
  $('center-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.center = true; o.set.add('center'); } else o.set.delete('center'); }, true));
  $('fit-seg').addEventListener('click', e => { const b = e.target.closest('button[data-fit]'); if (b) edit(o => { if (b.dataset.fit === 'none') o.set.delete('fit'); else { o.fit = b.dataset.fit; o.set.add('fit'); } }, true); });
  $('dt-seg').addEventListener('click', e => { const b = e.target.closest('button[data-dt]'); if (b) edit(o => { if (+b.dataset.dt) { o.dt = +b.dataset.dt; o.set.add('dt'); } else o.set.delete('dt'); }); });
  $('frame').addEventListener('input', e => show(+e.target.value));
  $('play').addEventListener('click', () => timer ? stop() : start());
  $('show-box').addEventListener('change', () => drawScene(false));
  $('view-reset').addEventListener('click', () => drawScene(true));
  run();
}

// Changing a control re-runs the command and types your last answers again. Turning -center or
// -fit on or off changes how many groups trjconv asks for, so the answers are rebuilt
// (Backbone, 4, for fitting and centering, as the workflow does).
function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('trjconv', o));
  const out = String(good.answers.at(-1) ?? 0);
  run({ auto: [...(o.set.has('fit') && o.fit !== 'none' ? ['4'] : []), ...(o.set.has('center') && o.center ? ['4'] : []), out] });
}
// Which of the drawn atoms (protein + ions) belong to an output group.
const MAIN = new Set(['N', 'CA', 'C', 'O', 'OC1', 'OC2']);
const GROUP_PICK = {
  System: () => true, 'non-Water': () => true, Protein: a => !a.ion, 'Prot-Masses': a => !a.ion,
  'Protein-H': a => !a.ion && !a.h, 'C-alpha': a => a.name === 'CA', Backbone: a => ['N', 'CA', 'C'].includes(a.name),
  MainChain: a => MAIN.has(a.name), 'MainChain+Cb': a => MAIN.has(a.name) || a.name === 'CB', 'MainChain+H': a => MAIN.has(a.name) || ['H', 'H1', 'H2', 'H3'].includes(a.name),
  SideChain: a => !a.ion && !MAIN.has(a.name) && !['H', 'H1', 'H2', 'H3'].includes(a.name), 'SideChain-H': a => !a.ion && !a.h && !MAIN.has(a.name),
  'non-Protein': a => a.ion, Ion: a => a.ion, NA: a => a.resname === 'NA', CL: a => a.resname === 'CL', 'Water_and_ions': a => a.ion, Water: () => false, SOL: () => false
};

async function run({ focus = false, auto = [] } = {}) {
  stop();
  const command = $('cmd').value;
  const p = parseCommand(command, 'trjconv');
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'trjconv', ui)) { $('stale').hidden = !good; return; }
  const o = p.opts;
  const fail = (lines, h) => { terminal(ui.term, command, lines); notes(ui.coach, [{ h, k: 'err' }]); $('stale').hidden = !good; };
  const notFound = (opt, f, h) => fail(errorLines('trjconv', { title: 'Invalid command-line options', lines: [`In command-line option -${opt}`, `File '${f}' does not exist or is not accessible.`, 'The file could not be opened.', '  Reason: No such file or directory'] }, version), h);

  const sys = systems.find(s => basename(o.f).startsWith(s.id));
  const inputs = sys ? { gro: `${sys.id}_em_sol.gro`, xtc: `${sys.id}_longmd.xtc`, nojump: `${sys.id}_longmd_nojump.xtc` } : {};
  const kind = !sys ? null : basename(o.f) === inputs.gro ? 'pdb' : basename(o.f) === inputs.xtc ? 'xtc' : basename(o.f) === inputs.nojump ? 'nojump' : null;
  if (!kind) return notFound('f', o.f, T('trjconv.noInput'));
  if (kind !== 'pdb' && !sys.hasMD) return fail([`<span class="t-dim">${T('trjconv.noMDTerm')}</span>`], T('trjconv.noMD', { systems: systems.filter(s => s.hasMD).map(s => s.short).join(' and ') }));
  const M = sys.id;
  const tprOK = kind === 'pdb' ? [`${M}_em_sol.tpr`] : [`${M}_longmd.tpr`, `${M}_md.tpr`, `${M}_pr.tpr`];
  if (!o.set.has('s')) return notFound('s', 'topol.tpr', T('trjconv.noS'));
  if (!tprOK.includes(basename(o.s))) return notFound('s', o.s, T('trjconv.wrongS', { tpr: tprOK[0] }));

  const pbc = o.set.has('pbc') ? o.pbc : 'none', fit = o.set.has('fit') ? o.fit : 'none', center = !!o.center;
  const thisStep = WORKFLOW.find(w => w.tool === 'trjconv' && basename(fill(w.cmd, M).match(/-o (\S+)/)[1]) === basename(o.o)) || (kind === 'pdb' ? WORKFLOW.find(w => w.key === 'trjconv_pdb') : step);
  step = thisStep;
  showFiles(M, step.key);

  // Which saved trajectory matches the -pbc / -center / -fit combination.
  const coach = [];
  let variant;
  if (kind === 'pdb') variant = 'pdb';
  else if (fit !== 'none') {
    variant = 'fit';
    if (fit !== 'rot+trans') coach.push({ h: T('trjconv.fitOther', { fit: esc(fit) }) });
    if (kind === 'xtc' && pbc !== 'nojump') coach.push({ k: 'warn', h: T('trjconv.fitRaw') });
  } else if (pbc === 'nojump' || kind === 'nojump') variant = 'nojump';
  else if (pbc === 'mol') variant = center ? 'center' : 'mol';
  else if (pbc === 'none' || pbc === 'atom') variant = 'raw';
  else return fail([`<span class="t-dim">${T('trjconv.noPbcTerm', { pbc: esc(pbc) })}</span>`], T('trjconv.noPbc', { pbc: esc(pbc) }) + ' ' + T(`trjconv.pbc.${pbc === 'res' ? 'res' : pbc === 'whole' ? 'whole' : 'cluster'}`));
  if (center && variant === 'raw') coach.push({ h: T('trjconv.centerNoPbc') });
  if (pbc === 'nojump' && !center && variant === 'nojump') coach.push({ h: T('trjconv.nojumpNoCenter') });

  // What trjconv prints, in the order it prints it at a terminal (see data/<system>/logs/09-21):
  // the header, then one group question per -fit / -center / output, then the frames.
  const groupLines = (await load(kind === 'pdb' ? `data/${M}/trjconv_groups_em_sol.txt` : `data/${M}/trjconv/groups.txt`)).trim().split('\n');
  const names = groupNames(groupLines);
  const prompts = [...(fit !== 'none' ? ['least squares fit'] : []), ...(center ? ['centering'] : []), 'output'];
  const template = await load(`data/${M}/logs/${kind === 'pdb' ? '09_trjconv_pdb' : '18_trjconv_nojump'}.log`);
  version = template.match(/VERSION (\S+)/)?.[1] || version;
  const ext = (o.o.match(/\.(\w+)$/) || [])[1];
  const formats = { xtc: 'Compressed trajectory (portable xdr format): xtc', trr: 'Trajectory in portable xdr format', gro: 'Coordinate file in Gromos-87 format', pdb: 'Protein data bank file' };
  if (!formats[ext]) return fail(errorLines('trjconv', { title: 'Invalid command-line options', lines: ['In command-line option -o', `File '${o.o}' cannot be used by GROMACS because it does not have a recognizable extension.`, 'The following extensions are possible for this option:', '  .xtc, .trr, .gro, .g96, .pdb, .tng'] }, version), T('trjconv.badExt'));
  const out = ['Note that major changes are planned in future for trjconv, to improve usability and utility.'];
  if (o.set.has('ur') && !['mol', 'res', 'atom'].includes(pbc)) out.push(`<span class="t-warn">WARNING: Option for unitcell representation (-ur ${esc(o.ur)})</span>`, '<span class="t-warn">         only has effect in combination with -pbc mol, res or atom.</span>', '<span class="t-warn">         Ignoring unitcell representation.</span>', '');
  out.push(esc(`Will write ${ext}: ${formats[ext]}`), ...Array(2).fill(esc(`Reading file ${basename(o.s)}, VERSION ${version} (single precision)`)));
  const term = shell(ui.term, command, { auto, focus });
  const answers = [];
  for (const [i, what] of prompts.entries()) {
    out.push(esc(`Select group for ${what}`), ...groupLines.map(esc));
    term.print(out.splice(0));
    if (!auto.length && i === 0) waiting();
    const a = await term.ask({
      prompt: 'Select a group: ',
      check: v => (pickGroup(v, names) < 0 ? { lines: [`<span class="t-err">Error: No such group '${esc(v)}'</span>`] } : null),
      onWait: st => notes(ui.coach, [{ k: 'wait', h: st === 'again' ? T('trjconv.waitAgain', { max: names.length - 1 }) : st === 'stopped' ? T('common.stopped') : T(`trjconv.wait.${what.split(' ').pop()}`, { n: prompts.length, i: i + 1 }) }])
    });
    const idx = pickGroup(a, names);
    out.push(esc(`Selected ${idx}: '${names[idx]}'`));
    answers.push(idx);
  }
  lastAnswers = answers.map(String);
  const outGroup = names[answers.at(-1)];

  const fr = parseGroFrames(await load(variant === 'pdb' ? `data/${M}/em_sol_frames.gro` : `data/${M}/trjconv/${variant}.gro`));
  for (const a of fr.atoms) { a.ion = ['NA', 'CL'].includes(a.resname); a.h = /^[0-9]*H/.test(a.name); }
  // Frame selection: -b, -e, -dt, -skip, -dump.
  let frames = variant === 'pdb' ? fr.frames.slice(-1).map(f => ({ ...f, t: 0 })) : fr.frames;
  const all = frames.length;
  if (variant !== 'pdb') {
    if (o.set.has('b')) frames = frames.filter(f => f.t >= o.b - 1e-6);
    if (o.set.has('e') && o.e > 0) frames = frames.filter(f => f.t <= o.e + 1e-6);
    if (o.set.has('dt') && o.dt > 0) frames = frames.filter(f => Math.abs(f.t / o.dt - Math.round(f.t / o.dt)) < 1e-6);
    if (o.set.has('skip') && o.skip > 1) frames = frames.filter((_, i) => i % o.skip === 0);
    if (o.set.has('dump') && o.dump >= 0) frames = [frames.find(f => f.t >= o.dump - 1e-6) || frames.at(-1)];
  }
  if (!frames.length) { term.print(out.splice(0)); term.print(['Last written: none']); notes(ui.coach, [{ k: 'err', h: T('trjconv.noFrames') }]); return; }
  const pick = GROUP_PICK[outGroup] || (() => true);
  const keep = fr.atoms.map(pick);

  // The rest of the screen output: reading the input, then what was written.
  const inFrames = variant === 'pdb' ? 1 : kind === 'nojump' ? Math.floor((all - 1) / 2) + 1 : all;
  const dtIn = kind === 'nojump' ? 10 : fr.frames[1] ? fr.frames[1].t - fr.frames[0].t : 0;
  const last = frames.at(-1);
  const pad = (v, n) => String(v).padStart(n);
  if (kind === 'pdb') out.push(esc((template.match(/^Reading frames from gro file.*$/m) || [''])[0]));
  out.push('Reading frame       0 time    0.000   ', esc(`Precision of ${basename(o.f)} is 0.001 (nm)`));
  if (ext === 'xtc') out.push('Using output precision of 0.001 (nm)');
  if (o.set.has('dump') && o.dump >= 0) out.push(`Reading frame       1 time ${pad((dtIn).toFixed(3), 8)}   `, `Dumping frame at t= ${frames[0].t} ps`);
  else out.push(`Last frame ${pad(inFrames - 1, 10)} time ${pad(((inFrames - 1) * (variant === 'pdb' ? 0 : dtIn)).toFixed(3), 8)}   `);
  out.push('', `Last written: frame ${pad(frames.length - 1, 6)} time ${pad(last.t.toFixed(3), 8)}`, '');
  const quote = template.match(/^GROMACS reminds you: .*$/m);
  if (quote) out.push('', esc(quote[0]));

  // Output size: measured for xtc at a few settings, scaled by frames and atoms otherwise.
  const groupAtoms = +groupLines[answers.at(-1)].match(/has\s+(\d+)/)[1];
  let bytes = null;
  if (variant !== 'pdb') {
    const sizes = Object.fromEntries((await load(`data/${M}/trjconv/sizes.txt`)).trim().split('\n').map(l => l.split(' ')).map(([g, dt, b]) => [`${g} ${dt}`, +b]));
    const sysAtoms = +groupLines[0].match(/has\s+(\d+)/)[1];
    const perAtomFrame = sizes[`${outGroup} 0`] ? sizes[`${outGroup} 0`] / all / groupAtoms : sizes['System 0'] / all / sysAtoms;
    bytes = ext === 'xtc' ? perAtomFrame * groupAtoms * frames.length : groupAtoms * frames.length * (ext === 'gro' ? 45 : ext === 'pdb' ? 79 : 12);
  } else bytes = groupAtoms * (ext === 'gro' ? 45 : 79);

  good = { sys, opts: o, variant, frames, atoms: fr.atoms, keep, outGroup, groupAtoms, bytes, ext, answers, all, kind, names };
  $('stale').hidden = true;
  term.print(out);

  if (['System', 'non-Protein', 'Water', 'SOL', 'Water_and_ions'].includes(outGroup)) coach.push({ k: outGroup === 'System' ? 'warn' : '', h: T('trjconv.waterInOutput', { n: answers.at(-1), name: esc(outGroup), water: (groupAtoms - (good.keep.filter(Boolean).length)).toLocaleString() }) + (outGroup === 'System' && ext !== 'gro' && ext !== 'pdb' ? ' ' + T('trjconv.systemBig') : '') });
  if (ext === 'gro' && frames.length > 1) coach.push({ k: 'warn', h: T('trjconv.groTrajectory', { n: frames.length, size: fmtSize(bytes) }) });
  if (variant === 'fit' && $('show-box').checked) coach.push({ h: T('trjconv.fitNoBox') });
  if (kind === 'pdb') coach.push({ h: T('trjconv.pdbCheck', { n: answers.at(-1), name: esc(outGroup) }) });
  notes(ui.coach, coach);
  sync();
  readouts();
  await drawScene(true);
}

// While trjconv waits for a group, nothing has been written yet.
function waiting() {
  $('readout').innerHTML = `<dt>${T(hasRun() ? 'trjconv.rows.waiting' : 'common.notRunRow')}</dt><dd>${T(hasRun() ? 'trjconv.rows.waitingNote' : 'common.notRunNote')}</dd>`;
}

function sync() {
  const { sys, opts: o, kind } = good;
  stepPicker($('step-seg'), 'trjconv', sys.hasMD ? sys : { ...sys, hasMD: false }, step.key, w => { line.set(fill(w.cmd, w.md && !sys.hasMD ? systems.find(s => s.hasMD).id : sys.id)); step = w; run({ auto: w.stdin.split('\n') }); });
  $('step-note').innerHTML = T('common.stepOf', { n: WORKFLOW.indexOf(step) + 1, what: stepWhat(step) });
  const pbc = o.set.has('pbc') ? o.pbc : 'none';
  for (const b of $('pbc-seg').querySelectorAll('button')) { b.setAttribute('aria-pressed', String(b.dataset.pbc === pbc)); b.disabled = kind === 'pdb'; }
  $('pbc-val').innerHTML = ['none', 'mol', 'nojump', 'atom'].includes(pbc) ? T('trjconv.pbcVal.' + pbc) : esc(pbc);
  $('center-on').checked = !!o.center;
  $('center-val').innerHTML = o.center ? T('trjconv.onGroup', { n: good.answers[o.set.has('fit') ? 1 : 0] ?? '?' }) : 'off';
  const fit = o.set.has('fit') ? o.fit : 'none';
  for (const b of $('fit-seg').querySelectorAll('button')) { b.setAttribute('aria-pressed', String(b.dataset.fit === fit)); b.disabled = kind === 'pdb'; }
  $('fit-val').innerHTML = fit === 'none' ? 'off' : T('trjconv.onGroup', { n: good.answers[0] });
  const dt = o.set.has('dt') ? o.dt : 0;
  for (const b of $('dt-seg').querySelectorAll('button')) { b.setAttribute('aria-pressed', String(+b.dataset.dt === dt)); b.disabled = kind === 'pdb'; }
  $('dt-val').innerHTML = dt ? `${dt} ps` : T('trjconv.everyFrame');
  $('dump-val').textContent = o.set.has('dump') && o.dump >= 0 ? `${o.dump} ps` : 'off';
}

const fmtSize = b => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${(b / 1e3).toFixed(0)} kB` : `${Math.round(b)} bytes`;
function readouts() {
  const { opts: o, frames, outGroup, groupAtoms, bytes, ext, answers, all, variant } = good;
  const rows = [
    ['file', `<span class="mono">${esc(basename(o.o))}</span>`],
    ['frames', variant === 'pdb' ? '1' : `${T('trjconv.rows.nOf', { n: frames.length, all })}<span class="sub">${frames.length > 1 ? T('trjconv.rows.every', { dt: (frames[1].t - frames[0].t).toFixed(0) }) : `t = ${frames[0].t} ps`}</span>`],
    ['atoms', `${groupAtoms.toLocaleString()}<span class="sub">${T('trjconv.rows.group', { n: answers.at(-1), name: esc(outGroup) })}</span>`],
    ['size', `${T('trjconv.rows.about', { size: fmtSize(bytes) })}<span class="sub">${ext === 'xtc' ? T('trjconv.rows.measured') : T('trjconv.rows.estimated')}${variant !== 'pdb' && frames.length > 1 ? '. ' + T('trjconv.rows.per100ns', { size: fmtSize(bytes / Math.max(frames.at(-1).t - frames[0].t, 1) * 100000) }) : ''}</span>`],
    ['treatment', esc([o.set.has('pbc') ? `-pbc ${o.pbc}` : 'no -pbc', o.center ? '-center' : '', o.set.has('fit') ? `-fit ${o.fit}` : ''].filter(Boolean).join(', '))]
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${T('trjconv.rows.' + k)}</dt><dd>${v}</dd>`).join('');
}

async function drawScene(refit) {
  const { frames, atoms, keep, variant } = good;
  const v = frames[0].box;
  const idx = atoms.map((_, i) => i).filter(i => keep[i]);
  const sub = idx.map(i => atoms[i]);
  const subFrames = frames.map(f => { const x = new Float32Array(idx.length * 3); idx.forEach((i, k) => { x[3 * k] = f.x[3 * i]; x[3 * k + 1] = f.x[3 * i + 1]; x[3 * k + 2] = f.x[3 * i + 2]; }); return { ...f, x }; });
  const prot = atoms.map((a, i) => [frames[0].x[3 * i], frames[0].x[3 * i + 1], frames[0].x[3 * i + 2]]).filter((_, i) => !atoms[i].ion);
  const origin = variant === 'fit' ? stats(prot).center : boxCenter(v);
  scene.clear();
  scene.setOrigin(origin);
  if (sub.length) {
    const fullProtein = sub.some(a => a.name === 'CA') && sub.some(a => a.name === 'O');
    const m = scene.addFrames(sub, subFrames, fullProtein ? { cartoon: { color: '#f0b35a' }, stick: { radius: 0.18, color: '#f0b35a' } } : { stick: { radius: 0.25, color: '#f0b35a' }, sphere: { radius: 0.4, color: '#f0b35a' } });
    m.setStyle({ resn: 'NA' }, { sphere: { radius: 2.0, color: '#a77df0' } });
    m.setStyle({ resn: 'CL' }, { sphere: { radius: 2.0, color: '#6fd08f' } });
  }
  if ($('show-box').checked && variant !== 'fit') scene.drawBox(v, { cell: variant === 'center', stored: variant !== 'center' });
  $('legend-note').innerHTML = T('trjconv.legend.' + (variant === 'center' ? 'compact' : variant === 'fit' ? 'fit' : 'stored'));
  $('frame').max = frames.length - 1;
  $('frame').disabled = frames.length < 2;
  $('play').disabled = frames.length < 2;
  if (refit) scene.frame(Math.max(...v.map(norm)) * (variant === 'fit' ? 0.7 : 1.25));
  await show(0);
}

async function show(i) {
  if (!good) return;
  $('frame').value = i;
  $('frame-t').innerHTML = good.variant === 'pdb' ? T('trjconv.singleFrame') : `${good.frames[i].t.toFixed(0)} ps`;
  await scene.setFrame(i);
}
function start() {
  $('play').innerHTML = T('common.pause');
  const n = good.frames.length;
  let i = +$('frame').value;
  if (i >= n - 1) i = 0;
  timer = setInterval(() => { i++; if (i >= n) { stop(); return; } show(i); }, Math.max(80, 5000 / n));
}
function stop() { clearInterval(timer); timer = null; $('play').innerHTML = T('common.play'); }

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
