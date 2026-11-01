// mdrun: plays back the real runs of the workflow. Minimizations show the energy and the
// largest force falling step by step (from the -v screen output); MD runs show temperature,
// pressure and density (from gmx energy) next to the moving protein.
import { parseGroFrames, parseXvg } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { boxCenter, norm, stats } from '../geometry.js';
import { Scene } from '../viewer.js';
import { lineChart } from '../chart.js';
import { $, esc, setup, T, Tplain, loadSystems, text, params, trimLog, terminal, notes, showParseProblem, commandLine, tries, stepPicker, systemPicker, WORKFLOW, fill, basename, errorLines, stepWhat, gmxVersion } from '../site.js';
import { showFiles } from '../files.js';

await setup('mdrun');

const MD_TRIES = [
  {
    title: 'Forget -deffnm',
    cmd: 'gmx mdrun -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto',
    ask: 'Leave out <code>-deffnm</code>. What file does mdrun look for?',
    answer: 'It looks for <code>topol.tpr</code>, the default name, and stops because there is none. With <code>-deffnm lysozyme_em_vac</code> it reads <code>lysozyme_em_vac.tpr</code> and names every output the same way. (<code>-s file.tpr</code> also works, but then the outputs get default names like <code>confout.gro</code> and <code>md.log</code>, and the next run overwrites them.)'
  },
  {
    title: 'When has it minimized enough?',
    cmd: 'gmx mdrun -deffnm lysozyme_em_vac -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto',
    ask: 'Watch the two charts. Which one decides when minimization stops, and what is the target?',
    answer: 'The largest force on any atom (Fmax). The run stops once it is below <code>emtol = 1000</code> kJ/mol/nm from em_vac.mdp. The energy keeps creeping down after the big early drop, but the stopping rule is about force. Notice the log scale: the first step starts near 10⁸.'
  },
  {
    title: 'Water makes a difference',
    cmd: 'gmx mdrun -deffnm magainin2_em_sol -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto',
    ask: 'Compare the number of steps with the vacuum minimization. Why does the solvated system need so many more?',
    answer: 'solvate placed thousands of waters without relaxing their contacts with the protein or with the ions genion added. Every one of them has to settle, so the solvated minimization takes hundreds of steps. Notice also that mdrun backs up the old <code>magainin2_em_sol.gro</code>: genion wrote a file with the same name, and this run replaces it.'
  },
  {
    title: 'Heating up',
    cmd: 'gmx mdrun -deffnm magainin2_pr -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto',
    ask: 'Read the temperature chart. Where does it start, how fast does it reach 300 K, and why does the pressure jump around so much?',
    answer: 'pr.mdp generates velocities at 300 K, and the thermostat keeps it there within a few kelvin. Pressure in a small box swings by hundreds of bar from one frame to the next; what matters is the average over time, which should be near 1 bar. Density is the steadier measure.'
  },
  {
    title: 'What do the hardware flags change?',
    cmd: 'gmx mdrun -deffnm magainin2_md -v -ntmpi 1 -ntomp 4 -nb cpu',
    ask: 'Drop the GPU and use 4 threads. Does the trajectory change?',
    answer: 'No: the physics is all in the .tpr. Only the speed changes (and the last digits of the numbers, because the arithmetic happens in a different order). On a shared cluster, ask Slurm for the cores and GPU you use: <code>-ntomp</code> should match <code>--cpus-per-task</code>.'
  }
];

const RUNS = ['em_vac', 'em_sol', 'pr', 'md', 'longmd'];
let systems, step, scene, good = null, timer = null, charts = [], line, version;
const cache = {};
const load = path => cache[path] ??= text(path);

async function boot() {
  systems = await loadSystems();
  const q = params();
  step = WORKFLOW.find(w => w.key === q.get('step') && w.tool === 'mdrun') || WORKFLOW.find(w => w.key === 'em_vac');
  const sysId = q.get('sys') || (step.md ? systems.find(s => s.hasMD) : systems[0]).id;
  scene = new Scene($('viewer'));
  line = commandLine({ run, start: fill(step.cmd, sysId) });
  $('cmd-reset').onclick = () => { line.set(fill(step.cmd, good?.sys.id || sysId)); run(); };
  tries($('tries'), MD_TRIES, t => { line.set(t.cmd); run(); });
  $('v-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.v = true; o.set.add('v'); } else o.set.delete('v'); }));
  $('nb-seg').addEventListener('click', e => { const b = e.target.closest('button[data-nb]'); if (b) edit(o => { if (b.dataset.nb === 'auto') o.set.delete('nb'); else { o.nb = b.dataset.nb; o.set.add('nb'); } }); });
  $('frame').addEventListener('input', e => show(+e.target.value));
  $('play').addEventListener('click', togglePlay);
  $('show-box').addEventListener('change', () => drawScene(false));
  $('view-reset').addEventListener('click', () => drawScene(true));
  run();
}

function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('mdrun', o));
  run();
}

async function run() {
  stop();
  const command = $('cmd').value;
  const p = parseCommand(command, 'mdrun');
  version = await gmxVersion(systems.find(s => command.includes(s.id))?.id || systems[0].id);
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'mdrun', ui)) { $('stale').hidden = !good; return; }
  const o = p.opts;
  const tpr = o.set.has('s') ? o.s : o.set.has('deffnm') ? `${o.deffnm}.tpr` : o.s;
  const fail = (lines, h) => { terminal(ui.term, command, lines); notes(ui.coach, [{ h, k: 'err' }]); $('stale').hidden = !good; };

  // Which run of which system the .tpr belongs to.
  let sys = null, runName = null;
  for (const s of systems) for (const r of RUNS) if (basename(tpr) === `${s.id}_${r}.tpr`) { sys = s; runName = r; }
  if (!sys) {
    const hint = !o.set.has('deffnm') && !o.set.has('s') ? T('mdrun.noDeffnm')
      : /\.tpr$/.test(o.deffnm || '') ? T('mdrun.deffnmExt', { name: esc(o.deffnm.replace(/\.tpr$/, '')) })
      : T('mdrun.noTpr', { tpr: esc(tpr), example: `${systems[0].id}_em_vac.tpr` });
    return fail(errorLines('mdrun', { title: 'Invalid command-line options', lines: [`In command-line option -s`, `File '${tpr}' does not exist or is not accessible.`, 'The file could not be opened.', '  Reason: No such file or directory'] }, version), hint);
  }
  const stepFor = WORKFLOW.find(w => w.key === runName);
  if (stepFor.md && !sys.hasMD) return fail([`<span class="t-dim">${T('mdrun.noMDTerm')}</span>`], T('mdrun.noMD', { systems: systems.filter(s => s.hasMD).map(s => s.short).join(' and ') }));
  if (step !== stepFor) { step = stepFor; history.replaceState(null, '', `?step=${step.key}&sys=${sys.id}`); }
  const M = sys.id;
  showFiles(M, step.key);

  const log = trimLog(await load(`data/${M}/logs/${step.log}.log`));
  const isEM = runName.startsWith('em');
  const frames = parseGroFrames(await load(`data/${M}/${runName}_frames.gro`));
  let series;
  if (isEM) {
    const rows = log.filter(l => l.startsWith('Step=')).map(l => ({ step: +l.match(/Step=\s*(\d+)/)[1], epot: +l.match(/Epot=\s*([-\d.eE+]+)/)[1], fmax: +l.match(/Fmax=\s*([-\d.eE+]+)/)[1] }));
    series = { x: rows.map(r => r.step), epot: rows.map(r => r.epot), fmax: rows.map(r => r.fmax), xlabel: Tplain('mdrun.chart.xEM') };
  } else {
    const xvg = parseXvg(await load(`data/${M}/${runName}_energy.xvg`));
    series = { x: xvg.x, xlabel: Tplain('mdrun.chart.xMD'), terms: Object.fromEntries(xvg.series.map(s => [s.name, s.y])) };
  }
  // -nsteps cuts the run short.
  let cut = Infinity;
  if (o.set.has('nsteps') && o.nsteps >= 0) cut = isEM ? o.nsteps : o.nsteps * 0.002;
  const keepFrames = frames.frames.filter(f => (isEM ? f.step ?? f.t : f.t) <= cut);
  const fr = { atoms: frames.atoms, frames: keepFrames.length ? keepFrames : frames.frames.slice(0, 1) };

  // Screen output, adjusted for the options typed.
  let out = log.filter(l => !/^Compiled SIMD/.test(l));
  if (!o.v) out = out.filter(l => !/^Step=\s/.test(l) && !/^step \d/.test(l));
  if (cut < Infinity && isEM) {
    const i = out.findIndex(l => l.startsWith('Step=') && +l.match(/Step=\s*(\d+)/)[1] > cut);
    const j = out.findIndex(l => /^writing lowest energy/.test(l));
    if (j > 0 && series.x.at(-1) > cut) out = [...out.slice(0, i >= 0 ? i : j), `<span class="t-dim">${T('mdrun.nstepsTerm')}</span>`];
  }
  if (cut < Infinity && !isEM) out = out.map(l => l.replace(/^\d+ steps,\s+[\d.]+ ps\./, `${o.nsteps} steps, ${(o.nsteps * 0.002).toFixed(1)} ps.`));
  out = out.map(l => l
    .replace(/^Using 1 MPI (thread|process)$/, (m, w) => o.set.has('ntmpi') ? `Using ${o.ntmpi} MPI ${w}${o.ntmpi === 1 ? '' : w === 'process' ? 'es' : 's'}` : m)
    .replace(/^Using \d+ OpenMP threads\s*$/, o.set.has('ntomp') ? `Using ${o.ntomp} OpenMP threads` : l)
    .replace(new RegExp(`${M}_${runName}\\.`, 'g'), basename(tpr).replace(/\.tpr$/, '.')));
  const k = out.findIndex(l => /^Using \d+ OpenMP/.test(l));
  const gpuRun = log.some(l => /GPU selected for this run/.test(l));
  if (o.nb === 'gpu' && k >= 0 && !gpuRun) out.splice(k + 1, 0, `<span class="t-dim">${T('mdrun.gpuTerm')}</span>`);

  good = { sys, opts: o, runName, isEM, fr, series, log, tpr, cut, gpuRun };
  $('stale').hidden = true;
  terminal(ui.term, command, out.map(l => l.startsWith('<span') ? l : /^Back Off/.test(l) ? `<span class="t-warn">${esc(l)}</span>` : esc(l)));

  const coach = [];
  if (!o.set.has('deffnm')) coach.push({ k: 'warn', h: T('mdrun.defaultNames') });
  if (runName === 'em_sol') coach.push({ h: T('mdrun.emSolName', { M }) });
  if (o.set.has('nsteps') && o.nsteps >= 0) coach.push({ k: 'warn', h: T('mdrun.nsteps', { n: o.nsteps }) });
  if (o.set.has('ntmpi') && o.ntmpi > 1) coach.push({ h: T('mdrun.ranks', { n: o.ntmpi }) });
  if (o.set.has('cpi')) coach.push({ h: T('mdrun.cpi') });
  notes(ui.coach, coach);
  sync();
  readouts();
  drawCharts();
  await drawScene(true);
}

function sync() {
  const { sys, opts: o } = good;
  stepPicker($('step-seg'), 'mdrun', sys, step.key, w => { line.set(fill(w.cmd, w.md && !sys.hasMD ? systems.find(s => s.hasMD).id : sys.id)); run(); });
  systemPicker($('sys-seg'), systems, sys.id, s => { line.set(fill(step.cmd, s.id)); run(); }, step.md);
  $('step-note').innerHTML = T('common.stepOf', { n: WORKFLOW.indexOf(step) + 1, what: stepWhat(step) });
  $('deffnm-val').innerHTML = o.set.has('deffnm') ? esc(o.deffnm) : T('mdrun.notSet');
  $('v-on').checked = !!o.v;
  $('v-val').innerHTML = T(o.v ? 'mdrun.on' : 'mdrun.off');
  for (const b of $('nb-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String((o.set.has('nb') ? o.nb : 'auto') === b.dataset.nb));
  const ntmpi = o.set.has('ntmpi') ? o.ntmpi : 0, ntomp = o.set.has('ntomp') ? o.ntomp : 0;
  const rows = [
    ['-ntmpi', ntmpi ? `${ntmpi === 1 ? T('mdrun.hw.rank1') : T('mdrun.hw.ranks', { n: ntmpi })}<span class="sub">${T(ntmpi === 1 ? 'mdrun.hw.oneRank' : 'mdrun.hw.splitRanks')}</span>` : T('mdrun.auto')],
    ['-ntomp', ntomp ? `${T('mdrun.hw.threads', { n: ntomp })}<span class="sub">${T('mdrun.hw.cores', { n: ntomp * (ntmpi || 1) })}</span>` : T('mdrun.hw.allCores')],
    ['-pin', o.set.has('pin') ? `${o.pin}${o.pin === 'on' ? `<span class="sub">${T('mdrun.hw.pinned')}${o.set.has('pinstride') ? T('mdrun.hw.stride', { n: o.pinstride }) : ''}</span>` : ''}` : T('mdrun.auto')],
    ['-dlb', o.set.has('dlb') ? `${o.dlb}<span class="sub">${T(ntmpi === 1 ? 'mdrun.hw.dlbOne' : 'mdrun.hw.dlbMany')}</span>` : T('mdrun.auto')]
  ];
  $('hw').innerHTML = rows.map(([k, v]) => `<dt class="mono">${k}</dt><dd>${v}</dd>`).join('');
}

function readouts() {
  const { isEM, series, log, fr, cut, gpuRun } = good;
  let rows;
  if (isEM) {
    const n = series.x.filter(x => x <= cut).length;
    const conv = log.find(l => /converged to Fmax/.test(l));
    const fEnd = series.fmax[n - 1], eEnd = series.epot[n - 1];
    rows = [
      [T('mdrun.rows.steps'), `${n.toLocaleString()}`],
      [T('mdrun.rows.result'), conv && cut === Infinity ? `${T('mdrun.rows.converged')}<span class="sub">${esc(conv.replace(/^Steepest Descents /, ''))}</span>` : T('mdrun.rows.stopped')],
      [T('mdrun.rows.energy'), `${fmtE(series.epot[0])} → ${fmtE(eEnd)}<span class="sub">kJ/mol</span>`],
      [T('mdrun.rows.force'), `${fmtE(series.fmax[0])} → ${fmtE(fEnd)}<span class="sub">${T('mdrun.rows.emtol')}</span>`],
      [T('mdrun.rows.frames'), `${fr.frames.length}<span class="sub">${T('mdrun.rows.framesNote')}</span>`]
    ];
  } else {
    const t = series.terms, ok = series.x.map(x => x <= cut);
    const pick = name => (t[name] || []).filter((_, i) => ok[i]);
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const sd = a => Math.sqrt(avg(a.map(x => (x - avg(a)) ** 2)));
    const Temp = pick('Temperature'), P = pick('Pressure'), D = pick('Density');
    const perf = log.find(l => /^Performance:/.test(l))?.trim().split(/\s+/)[1];
    rows = [
      [T('mdrun.rows.time'), `${Math.min(series.x.at(-1), cut).toFixed(0)} ps<span class="sub">${T('mdrun.rows.nFrames', { n: fr.frames.length })}</span>`],
      [T('mdrun.rows.temp'), `${avg(Temp).toFixed(1)} ± ${sd(Temp).toFixed(1)} K<span class="sub">${T('mdrun.rows.target300')}</span>`],
      [T('mdrun.rows.pressure'), `${avg(P).toFixed(0)} ± ${sd(P).toFixed(0)} bar<span class="sub">${T('mdrun.rows.target1')}</span>`],
      [T('mdrun.rows.density'), D.length ? `${avg(D).toFixed(0)} ± ${sd(D).toFixed(1)} kg/m³` : ''],
      [T('mdrun.rows.speed'), perf ? `${perf} ns/day<span class="sub">${T(gpuRun ? 'mdrun.rows.gpu' : 'mdrun.rows.cpu')}</span>` : '']
    ];
  }
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const o = good.opts;
  const name = o.set.has('deffnm') ? o.deffnm : null;
  const f = (ext, def, what, keep) => ({ file: name ? `${name}.${ext}` : def, what, keep });
  const list = [
    f('gro', 'confout.gro', T(isEM ? 'mdrun.file.groEM' : 'mdrun.file.groMD'), true),
    f('log', 'md.log', T('mdrun.file.log')),
    f('edr', 'ener.edr', T('mdrun.file.edr')),
    isEM ? f('trr', 'traj.trr', T('mdrun.file.trr')) : f('xtc', 'traj_comp.xtc', T('mdrun.file.xtc')),
    ...(isEM ? [] : [f('cpt', 'state.cpt', T('mdrun.file.cpt'))])
  ];
  $('files').innerHTML = list.map(x => `<div class="file ${x.keep ? 'ok' : ''}"><span class="mono">${esc(x.file)}</span><span>${x.what}</span><span class="tag">${x.keep ? T('mdrun.file.usedNext') : ''}</span></div>`).join('');
}
const fmtE = v => Math.abs(v) >= 1e5 ? v.toExponential(2).replace('e+', '×10^') : Math.round(v).toLocaleString();

function drawCharts() {
  const { isEM, series, cut } = good;
  const keep = series.x.map(x => x <= cut);
  const xs = series.x.filter((_, i) => keep[i]);
  const pick = a => a.filter((_, i) => keep[i]);
  const defs = isEM ? [
    { title: T('mdrun.chart.fmax'), note: T('mdrun.chart.fmaxNote'), y: pick(series.fmax), ylabel: 'Fmax (kJ/mol/nm)', log: true, hline: { y: 1000, label: 'emtol 1000' } },
    { title: T('mdrun.chart.epotEM'), note: T('mdrun.chart.epotEMNote'), y: pick(series.epot), ylabel: 'Epot (kJ/mol)', yRange: emRange(pick(series.epot)) }
  ] : [
    { title: T('mdrun.chart.temp'), note: T('mdrun.chart.tempNote'), y: pick(series.terms.Temperature), ylabel: 'T (K)', hline: { y: 300, label: 'ref_t 300 K' } },
    { title: T('mdrun.chart.pressure'), note: T('mdrun.chart.pressureNote'), y: pick(series.terms.Pressure), ylabel: 'P (bar)', hline: { y: 1, label: 'ref_p 1 bar' } },
    { title: T('mdrun.chart.density'), note: T('mdrun.chart.densityNote'), y: pick(series.terms.Density || []), ylabel: 'ρ (kg/m³)' },
    { title: T('mdrun.chart.epot'), note: T('mdrun.chart.epotNote'), y: pick(series.terms.Potential), ylabel: 'Epot (kJ/mol)' }
  ].filter(d => d.y.length);
  $('charts').innerHTML = defs.map((d, i) => `<div class="chart-card"><h3>${d.title}</h3><p>${d.note}</p><div id="chart-${i}"></div></div>`).join('');
  charts = defs.map((d, i) => lineChart($(`chart-${i}`), { x: xs, y: d.y, xlabel: series.xlabel, ylabel: d.ylabel, log: d.log, hline: d.hline, yRange: d.yRange, onPick: xv => show(nearestFrame(xv)) }));
}

// Skip the huge first steps so the slow approach to the minimum is visible.
const emRange = y => { const tail = y.slice(Math.ceil(y.length * 0.05)); return tail.length > 3 ? [Math.min(...y), Math.max(...tail)] : undefined; };

const frameX = f => good.isEM ? (f.step ?? f.t) : f.t;
function nearestFrame(xv) {
  const fs = good.fr.frames;
  let best = 0;
  fs.forEach((f, i) => { if (Math.abs(frameX(f) - xv) < Math.abs(frameX(fs[best]) - xv)) best = i; });
  return best;
}

let model = null;
async function drawScene(refit) {
  const { fr } = good;
  const first = fr.frames[0];
  const v = first.box;
  const c = boxCenter(v);
  scene.clear();
  scene.setOrigin(c);
  model = scene.addFrames(fr.atoms, fr.frames, { cartoon: { color: '#f0b35a' } });
  model.setStyle({ resn: 'NA' }, { sphere: { radius: 2.0, color: '#a77df0' } });
  model.setStyle({ resn: 'CL' }, { sphere: { radius: 2.0, color: '#6fd08f' } });
  model.setStyle({ resn: 'CLA' }, { sphere: { radius: 2.0, color: '#6fd08f' } });
  if ($('show-box').checked) scene.drawBox(v);
  $('legend-note').innerHTML = T(good.runName === 'em_vac' ? 'mdrun.legend.vacuum' : 'mdrun.legend.noWater');
  $('frame').max = fr.frames.length - 1;
  const size = $('show-box').checked ? Math.max(...v.map(norm)) : Math.max(...stats(fr.atoms.map((_, i) => [first.x[3 * i], first.x[3 * i + 1], first.x[3 * i + 2]])).size) + 1;
  if (refit) scene.frame(size * 1.05);
  await show(+$('frame').value > fr.frames.length - 1 ? 0 : +$('frame').value);
}

async function show(i) {
  if (!good) return;
  const f = good.fr.frames[i];
  $('frame').value = i;
  $('frame-t').innerHTML = good.isEM ? T('mdrun.frameStep', { n: f.step ?? f.t }) : `${f.t.toFixed(0)} ps`;
  await scene.setFrame(i);
  for (const c of charts) c.at(frameX(f));
}

function togglePlay() { timer ? stop() : start(); }
function start() {
  $('play').innerHTML = T('common.pause');
  const n = good.fr.frames.length;
  let i = +$('frame').value;
  if (i >= n - 1) i = 0;
  timer = setInterval(() => { i++; if (i >= n) { stop(); return; } show(i); }, Math.max(60, 4000 / n));
}
function stop() { clearInterval(timer); timer = null; $('play').innerHTML = T('common.play'); }

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
