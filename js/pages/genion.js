// genion: replace waters with ions. data/<system>/genion/{neutral,plain}_<conc>.txt hold the
// real "Replacing solvent molecule k" lines; molecule k is the k-th water in the solvated box,
// so the page puts each ion exactly where genion did.
import { parseGro, boxFromGro } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { volume, boxCenter, norm } from '../geometry.js';
import { Scene, compact } from '../viewer.js';
import { $, esc, setup, T, loadSystems, text, trimLog, shell, terminal, notes, showParseProblem, commandLine, tries, systemPicker, WORKFLOW, fill, basename, fatalLines, splitTyped, pickGroup, groupNames, gmxVersion, hasRun } from '../site.js';
import { showFiles } from '../files.js';

await setup('genion');
const STEP = WORKFLOW.find(w => w.key === 'genion');
const START = fill(STEP.cmd, 'lysozyme');
const CONCS = Array.from({ length: 11 }, (_, i) => +(i * 0.05).toFixed(2));
const AVOGADRO_L = 0.6022; // ions per nm³ at 1 mol/L

const TRIES = [
  {
    title: 'Pick the wrong group',
    cmd: START, stdin: 'Protein',
    ask: 'Answer the group question with <code>Protein</code>. What does genion say, and what would it have done if it had worked?',
    answer: '"Your solvent group size (1960) is not a multiple of 24". genion swaps whole molecules from the group you pick for ions; it checks that the group is made of identical small molecules and the protein is not. With <code>System</code> it fails the same way. Choose <code>SOL</code> (13), <code>Water</code> (12) or <code>non-Protein</code> (11).'
  },
  {
    title: 'Only neutralize',
    cmd: 'gmx genion -s lysozyme_ion.tpr -o lysozyme_em_sol.gro -conc 0 -rmin 0.3 -neutral -nname CL -pname NA -p lysozyme.top', stdin: 'SOL',
    ask: 'Set <code>-conc 0</code> but keep <code>-neutral</code>. How many ions, of which kind, and why?',
    answer: '8 Cl⁻ and no Na⁺. Lysozyme is +8, so 8 negative ions bring the box to zero. This is the minimum; real cells have about 0.15 M salt, which is why the script adds 0.1 M on top.'
  },
  {
    title: 'Forget -neutral',
    cmd: 'gmx genion -s lysozyme_ion.tpr -o lysozyme_em_sol.gro -conc 0.1 -rmin 0.3 -nname CL -pname NA -p lysozyme.top', stdin: 'SOL',
    ask: 'Look at the charge bars. Would the next grompp accept this system?',
    answer: '36 Na⁺ and 36 Cl⁻: the salt is neutral, so the box keeps the protein\'s +8. grompp would warn about PME with a net charge, and step 8 has no <code>-maxwarn</code>, so the script would stop there.'
  },
  {
    title: 'Same salt, different box',
    cmd: 'gmx genion -s magainin2_ion.tpr -o magainin2_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p magainin2.top', stdin: 'SOL',
    ask: 'Magainin 2 gets 22 Na⁺ and 25 Cl⁻. Work out both numbers from the readout.',
    answer: '0.1 mol/L × 361.4 nm³ × 0.6022 = 21.8, rounded to 22 pairs. Magainin is +3, so -neutral adds 3 more Cl⁻: 22 Na⁺ and 25 Cl⁻. The number of ions follows the box volume, not the size of the protein.'
  },
  {
    title: 'No answer for the group question',
    cmd: START, stdin: '',
    ask: 'Empty the answers box. What happens in a batch job?',
    answer: 'genion prints the list of groups and waits for an answer. In a batch job it waits until the time limit. The script pipes <code>SOL</code> in with <code>&lt;&lt;EOF</code>; <code>echo SOL | gmx genion …</code> works too.'
  }
];

let systems, scene, good = null, mode = 'slice', line, version = '2026.4';
const cache = {};
const load = path => cache[path] ??= text(path);
const loadJSON = async path => JSON.parse(await load(path));

async function boot() {
  systems = await loadSystems();
  scene = new Scene($('viewer'));
  line = commandLine({ run, start: START });
  tries($('tries'), TRIES, t => { line.set(t.cmd); run(); });
  $('conc').addEventListener('input', e => edit(o => { o.conc = +e.target.value; o.set.add('conc'); }));
  $('neutral-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.neutral = true; o.set.add('neutral'); } else o.set.delete('neutral'); }));
  $('p-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.p = `${good.sys.id}.top`; o.set.add('p'); } else o.set.delete('p'); }));
  $('w-slice').addEventListener('click', () => { mode = 'slice'; draw(false); });
  $('w-none').addEventListener('click', () => { mode = 'none'; draw(false); });
  $('view-reset').addEventListener('click', () => draw(true));
  run();
}

// Changing a control re-runs the command and types the group you answered last time (SOL to start).
let lastGroup = 'SOL';
function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('genion', o));
  run({ auto: [lastGroup] });
}

async function run({ focus = false, auto = [] } = {}) {
  const command = $('cmd').value;
  const p = parseCommand(command, 'genion');
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'genion', ui)) { $('stale').hidden = !good; return; }
  const o = p.opts;
  const fail = (lines, h) => { terminal(ui.term, command, lines); notes(ui.coach, [{ h, k: 'err' }]); $('stale').hidden = !good; };
  const sys = systems.find(s => basename(o.s) === `${s.id}_ion.tpr`);
  if (!sys) {
    const s2 = systems.find(s => basename(o.s).startsWith(s.id));
    return fail(fatalLines('genion', [`File '${o.s}' does not exist or is not accessible.`], version), s2 ? T('genion.wrongTpr', { tpr: `${s2.id}_ion.tpr` }) + (/\.gro$/.test(o.s) ? ' ' + T('genion.groNotTpr') : '') : T('genion.noTpr'));
  }
  const M = sys.id;
  version = await gmxVersion(M);
  showFiles(M, 'genion');
  if (o.set.has('p') && basename(o.p) !== `${M}.top`) return fail(fatalLines('genion', [`Can not open file '${o.p}' for reading.`], version), T('genion.wrongTop', { top: `${M}.top` }));
  if (o.set.has('np') || o.set.has('nn')) return fail([`<span class="t-dim">${T('genion.npTerm')}</span>`], T('genion.np'));
  const conc = o.conc;
  if (!CONCS.includes(+conc.toFixed(2)) || Math.abs(conc - +conc.toFixed(2)) > 1e-9) return fail([`<span class="t-dim">${T('genion.noConcTerm')}</span>`], T('genion.noConc') + (conc > 0.5 ? ' ' + T('genion.highConc') : ''));

  const files = await loadJSON(`data/${M}/files.json`);
  const V = volume(boxFromGro(files[`${M}_b4ion.gro`].box.map(Number)));
  const nSol = files[`${M}_b4ion.gro`].mols.SOL;
  const raw = (await load(`data/${M}/genion/${o.neutral ? 'neutral' : 'plain'}_${conc}.txt`)).trim().split('\n').filter(Boolean);
  const tryLine = raw.find(l => l.startsWith('Will try')) || 'Will try to add 0 NA ions and 0 CL ions.';
  const [, nNA, nCL] = tryLine.match(/add (\d+) \w+ ions and (\d+)/).map(Number);
  const replaced = raw.filter(l => l.startsWith('Replacing')).map(l => ({ k: +l.match(/molecule (\d+)/)[1], ion: l.trim().split(' ').pop() }));
  const pname = o.pname, nname = o.nname;
  const ionName = l => l.replace(/with NA$/, `with ${pname}`).replace(/with CL$/, `with ${nname}`);

  // The course run, typed at a terminal: everything up to "Select a group:", then the rest.
  const course = splitTyped(trimLog(await load(`data/${M}/logs/07_genion.log`)));
  const before = course.parts[0].map(l => l.replace(`${M}_ion.tpr`, o.s));
  const names = groupNames(before);
  const net = sys.charge + nNA - nCL;
  const pairs = Math.round(conc * V * AVOGADRO_L);
  const state = { sys, opts: o, V, nSol, nNA, nCL, replaced, net, pairs };
  const term = shell(ui.term, command, { auto, focus });
  const coach = [];
  if (!nNA && !nCL) {
    term.print([...before.filter(l => /^Reading file/.test(l)), 'No ions to add, will just copy input configuration.'].map(esc));
    coach.push({ h: T('genion.nothingToAdd') });
    return finish(state, coach, ui);
  }
  term.print(before.slice(0, -1).map(l => (/^Will try/.test(l) ? tryLine.replace(' NA ', ` ${pname} `).replace(' CL ', ` ${nname} `) : l)).map(esc));
  waiting(state);
  const prompt = before.at(-1);
  const bad = splitTyped(trimLog(await load(`data/${M}/genion/group_bad.log`)));
  const errLine = (bad.parts[1] || []).find(l => /^Error: No such group/.test(l)) || "Error: No such group 'foo'";
  const ans = await term.ask({
    prompt,
    check: v => (pickGroup(v, names) < 0 ? { lines: [`<span class="t-err">${esc(errLine.replace(/'.*'/, `'${v}'`))}</span>`] } : null),
    onWait: st => notes(ui.coach, [{ k: 'wait', h: st === 'again' ? T('genion.waitAgain', { max: names.length - 1 }) : st === 'stopped' ? T('common.stopped') : T('genion.wait') }])
  });
  const idx = pickGroup(ans, names);
  lastGroup = ans;
  const sol = names.indexOf('SOL');
  const water = idx === sol || (!o.set.has('p') && ['Water', 'non-Protein'].includes(names[idx]));
  if (!water) {
    // A real run with that answer: genion stops with an error.
    const g = splitTyped(trimLog(await load(`data/${M}/genion/group_${idx}.log`))).parts.at(-1);
    term.print(g.map(l => (/^(-{20,}|Program:|Source file:|Fatal error|Your solvent|The solvent|No line with|'|For more|website)/.test(l) ? `<span class="t-err">${esc(l)}</span>` : esc(l))));
    notes(ui.coach, [{ k: 'err', h: names[idx] === 'Water' || names[idx] === 'non-Protein' ? T('genion.groupNotInTop', { n: idx, name: esc(names[idx]) }) : T('genion.groupNotWater', { n: idx, name: esc(names[idx]), sol }) }]);
    $('stale').hidden = !good;
    return;
  }
  // The course answer (SOL), with this command's numbers of ions put in.
  const after = course.parts.at(-1);
  const out = [];
  let replacedDone = false;
  for (const l of after) {
    if (/^Selected /.test(l)) out.push(`Selected ${idx}: '${names[idx]}'`);
    else if (/^(Processing topology|Back Off! I just backed up .*\.top)/.test(l)) { if (o.set.has('p')) out.push(l); }
    else if (/^Replacing \d+ solute molecules/.test(l)) { if (o.set.has('p')) out.push(`Replacing ${nNA + nCL} solute molecules in topology file (${basename(o.p)})  by ${nNA} ${pname} and ${nCL} ${nname} ions.`); }
    else if (/^Using random seed/.test(l)) { if (!o.set.has('seed')) out.push(l); }
    else if (/^Replacing solvent molecule/.test(l)) { if (!replacedDone) { out.push(...raw.filter(x => x.startsWith('Replacing')).map(ionName)); replacedDone = true; } }
    else out.push(l);
  }
  term.print(out.map(esc));
  if (idx !== sol) coach.push({ h: T('genion.otherWaterGroup', { name: esc(names[idx]) }) });
  return finish(state, coach, ui);
}

async function finish(state, coach, ui) {
  const { sys, opts: o, nSol, nNA, nCL, net } = state;
  good = state;
  $('stale').hidden = true;
  if (!o.set.has('p') && (nNA || nCL)) coach.push({ k: 'err', h: T('genion.noP', { nsol: nSol, missing: ((nNA + nCL) * 2).toLocaleString() }) });
  if (net) coach.push({ k: 'warn', h: T('genion.netCharge', { net: `${net > 0 ? '+' : ''}${net}` }) });
  if (![o.pname, o.nname].every(n => ['NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'CS', 'LI', 'RB', 'F', 'BR', 'I'].includes(n))) coach.push({ k: 'warn', h: T('genion.ionNames', { p: esc(o.pname), n: esc(o.nname) }) });
  if (o.rmin !== 0.3 && o.set.has('rmin')) coach.push({ h: T('genion.rmin') });
  else if (!o.set.has('rmin')) coach.push({ h: T('genion.noRmin') });
  notes(ui.coach, coach);
  sync();
  readouts();
  await draw(true);
}

// While genion waits for the group, the box has water but no ions yet.
async function waiting(state) {
  good = { ...state, replaced: [], nNA: 0, nCL: 0, net: state.sys.charge, waiting: true };
  sync();
  $('readout').innerHTML = `<dt>${T(hasRun() ? 'genion.rows.waiting' : 'common.notRunRow')}</dt><dd>${T(hasRun() ? 'genion.rows.waitingNote' : 'common.notRunNote')}</dd>`;
  $('charge').innerHTML = '';
  await draw(true);
}

function sync() {
  const { sys, opts: o } = good;
  systemPicker($('sys-seg'), systems, sys.id, s => { line.set(fill(STEP.cmd, s.id)); run({ auto: [lastGroup] }); });
  $('conc').value = o.conc;
  $('conc-val').textContent = `${o.conc} M`;
  $('neutral-on').checked = !!o.neutral;
  $('neutral-val').textContent = o.neutral ? 'on' : 'off';
  $('p-on').checked = o.set.has('p');
  $('p-val').textContent = o.set.has('p') ? basename(o.p) : 'off';
  $('names-val').textContent = `${o.pname} / ${o.nname}`;
}

function readouts() {
  const { sys, opts: o, V, nSol, nNA, nCL, net, pairs } = good;
  const counter = nCL - nNA;
  const rows = [
    ['ions', `${nNA} ${esc(o.pname)} + ${nCL} ${esc(o.nname)}`],
    ['fromConc', `${T('genion.rows.pairs', { n: pairs })}<span class="sub">${o.conc} mol/L × ${V.toFixed(1)} nm³ × 0.6022</span>`],
    ['counter', o.neutral ? `${Math.abs(counter)} ${counter >= 0 ? esc(o.nname) : esc(o.pname)}<span class="sub">${T('genion.rows.toCancel', { q: `${sys.charge > 0 ? '+' : ''}${sys.charge}` })}</span>` : T('genion.rows.noNeutral')],
    ['watersLeft', `${(nSol - nNA - nCL).toLocaleString()}<span class="sub">${T('genion.rows.ofWaters', { n: nSol.toLocaleString() })}</span>`],
    ['netAfter', `${net > 0 ? '+' : ''}${net} e`],
    ['topology', o.set.has('p') ? `<span class="mono">SOL ${nSol - nNA - nCL}, ${esc(o.pname)} ${nNA}, ${esc(o.nname)} ${nCL}</span>` : `<span style="color:var(--bad)">${T('genion.rows.notUpdated')}</span>`]
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${T('genion.rows.' + k)}</dt><dd>${v}</dd>`).join('');
  const max = Math.max(sys.charge, nNA, nCL, 10);
  const bar = (label, q, cls) => {
    const w = Math.abs(q) / max * 50;
    return `<div class="crow"><span>${label}</span><div class="bar"><div class="fill ${cls}" style="${q >= 0 ? `left:50%` : `left:${50 - w}%`};width:${w}%"></div></div><span class="num">${q > 0 ? '+' : ''}${q}</span></div>`;
  };
  $('charge').innerHTML = bar(T('genion.bar.protein'), sys.charge, 'prot') + bar(T('genion.bar.ions', { name: esc(o.pname) }), nNA, 'pos') + bar(T('genion.bar.ions', { name: esc(o.nname) }), -nCL, 'neg') + bar(T('genion.bar.box'), net, net ? 'off' : 'zero');
}

async function draw(refit) {
  const { sys, replaced } = good;
  const M = sys.id;
  $('w-slice').setAttribute('aria-pressed', String(mode === 'slice'));
  $('w-none').setAttribute('aria-pressed', String(mode === 'none'));
  const solute = parseGro(await load(`data/${M}/${M}_em_vac.gro`));
  const water = await loadJSON(`data/${M}/solvate/script.json`);
  const v = boxFromGro(water.box);
  const c = boxCenter(v);
  const ow = water.ow;
  const at = k => [ow[3 * (k - 1)], ow[3 * (k - 1) + 1], ow[3 * (k - 1) + 2]];
  const gone = new Set(replaced.map(r => r.k));
  const ions = compact(replaced.map(r => at(r.k)), v, c);
  scene.clear();
  scene.setOrigin(c);
  scene.addAtoms(solute.atoms.filter(a => !/^[0-9]*H/.test(a.name)), { cartoon: { color: '#f0b35a' } });
  if (mode === 'slice') {
    const pts = [];
    for (let k = 1; k <= ow.length / 3; k++) if (!gone.has(k)) pts.push(at(k));
    const slice = compact(pts, v, c).filter(p => Math.abs(p[2] - c[2]) < 0.6);
    scene.addAtoms(slice.map((x, i) => ({ resnr: i + 1, resname: 'HOH', name: 'O', x })), { sphere: { radius: 0.7, color: '#e05a4f', opacity: 0.35 } });
  }
  const pos = replaced.map((r, i) => ({ r, x: ions[i] }));
  const ionAtoms = (kind, color) => {
    const list = pos.filter(p => (kind === 'pos') === (p.r.ion === 'NA'));
    if (list.length) scene.addAtoms(list.map((p, i) => ({ resnr: i + 1, resname: 'ION', name: kind === 'pos' ? 'NA' : 'CL', x: p.x })), { sphere: { radius: 2.2, color } });
  };
  ionAtoms('pos', '#a77df0');
  ionAtoms('neg', '#6fd08f');
  scene.drawBox(v);
  if (refit) scene.frame(Math.max(...v.map(norm)) * 1.05, false); else scene.render();
}

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
