// solvate: fill the box with water. Each setting the panel offers was run for real
// (data/<system>/solvate/*.json holds the water oxygens, *.log the screen output).
import { parseGro, boxFromGro } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { volume, boxCenter, norm } from '../geometry.js';
import { Scene, boxType, compact } from '../viewer.js';
import { $, esc, setup, T, loadSystems, text, trimLog, terminal, notes, showParseProblem, commandLine, tries, systemPicker, WORKFLOW, fill, filesBefore, hasFile, basename, fatalLines, gmxVersion } from '../site.js';
import { showFiles } from '../files.js';

await setup('solvate');
const STEP = WORKFLOW.find(w => w.key === 'solvate');
const START = fill(STEP.cmd, 'lysozyme');

const TRIES = [
  {
    title: 'Leave out -p',
    cmd: 'gmx solvate -cp lysozyme_em_vac.gro -cs spc216.gro -o lysozyme_b4ion.gro',
    ask: 'The picture looks the same. What is different, and which later command will complain?',
    answer: 'The topology still lists only the protein, so it describes 1,960 atoms while the new .gro has 58,561. The next grompp (step 6) stops with "number of coordinates in coordinate file does not match topology". You can fix it by adding the <code>SOL 18867</code> line to the end of the .top by hand.'
  },
  {
    title: 'Solvate before editconf',
    cmd: 'gmx solvate -cp lysozyme.gro -cs spc216.gro -o lysozyme_b4ion.gro -p lysozyme.top',
    ask: 'Use the pdb2gmx output, which never went through editconf. How many waters fit, and why is this a bad box?',
    answer: 'Only 1,272 waters in a 58 nm³ box, the box from the PDB file. The protein touches the box walls, so it would interact with its own periodic copy. That is why editconf runs first and leaves 2 nm on every side.'
  },
  {
    title: 'Peptide versus globule',
    cmd: 'gmx solvate -cp magainin2_em_vac.gro -cs spc216.gro -o magainin2_b4ion.gro -p magainin2.top',
    ask: 'Magainin 2 has 23 residues and lysozyme 129, yet the peptide still needs 11,684 waters. Why so many?',
    answer: 'editconf made the box from the longest dimension of the molecule plus 2 nm on each side. A 3.8 nm helix needs a 7.8 nm box, which holds mostly water. The water count follows the box volume much more than the size of the protein.'
  },
  {
    title: 'Cap the water',
    cmd: 'gmx solvate -cp lysozyme_em_vac.gro -cs spc216.gro -o lysozyme_b4ion.gro -p lysozyme.top -maxsol 2000',
    ask: 'Look at the density in the readout. Could you simulate this box?',
    answer: 'Not as it is. 2,000 waters fill a box that needs about 18,900, so the density drops to 143 g/L instead of about 1000. Under pressure coupling the box would collapse. <code>-maxsol</code> is for special cases, like adding a known number of waters to a membrane system.'
  },
  {
    title: 'A different water box',
    cmd: 'gmx solvate -cp lysozyme_em_vac.gro -cs tip4p.gro -o lysozyme_b4ion.gro -p lysozyme.top',
    ask: 'tip4p.gro holds 4-site waters. What goes wrong later, given that pdb2gmx was run with <code>-water tip3p</code>?',
    answer: 'solvate is happy, but each water now has 4 atoms (OW, HW1, HW2 and a virtual site MW) while the topology\'s TIP3P water has 3. grompp will stop with a coordinate count mismatch. Use spc216.gro for any 3-site model.'
  }
];

let systems, scene, good = null, mode = 'slice', line, version;
const cache = {};
const load = path => cache[path] ??= text(path);
const loadJSON = async path => JSON.parse(await load(path));

async function boot() {
  systems = await loadSystems();
  scene = new Scene($('viewer'));
  line = commandLine({ run, start: START });
  tries($('tries'), TRIES, t => { line.set(t.cmd); run(); });
  $('cp-select').addEventListener('change', e => edit(o => { o.cp = e.target.value; o.set.add('cp'); }));
  $('cs-seg').addEventListener('click', e => { const b = e.target.closest('button[data-cs]'); if (b) edit(o => { o.cs = b.dataset.cs; o.set.add('cs'); }); });
  $('p-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.p = `${good.sys.id}.top`; o.set.add('p'); } else o.set.delete('p'); }));
  $('box-seg').addEventListener('click', e => { const b = e.target.closest('button[data-box]'); if (b) edit(o => { if (+b.dataset.box) { o.box = [+b.dataset.box, +b.dataset.box, +b.dataset.box]; o.set.add('box'); } else o.set.delete('box'); }); });
  $('maxsol-seg').addEventListener('click', e => { const b = e.target.closest('button[data-maxsol]'); if (b) edit(o => { if (+b.dataset.maxsol) { o.maxsol = +b.dataset.maxsol; o.set.add('maxsol'); } else o.set.delete('maxsol'); }); });
  $('w-all').addEventListener('click', () => { mode = 'all'; draw(false); });
  $('w-slice').addEventListener('click', () => { mode = 'slice'; draw(false); });
  $('view-reset').addEventListener('click', () => draw(true));
  run();
}

function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('solvate', o));
  run();
}

async function run() {
  const command = $('cmd').value;
  const p = parseCommand(command, 'solvate');
  const sys0 = systems.find(s => command.includes(s.id)) || systems[0];
  version = await gmxVersion(sys0.id);
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'solvate', ui)) { $('stale').hidden = !good; return; }
  const o = p.opts;
  const fail = (lines, h) => { terminal(ui.term, command, lines); notes(ui.coach, [{ h, k: 'err' }]); $('stale').hidden = !good; };
  const sys = systems.find(s => basename(o.cp).startsWith(s.id));
  const present = filesBefore('solvate', sys?.id || 'lysozyme');
  if (!sys || !hasFile(present, o.cp)) {
    const later = sys && WORKFLOW.find(w => w.makes.some(m => fill(m, sys.id) === basename(o.cp)));
    return fail(fatalLines('solvate', [`File '${o.cp}' does not exist or is not accessible.`], version), later ? T('solvate.laterStep', { file: esc(o.cp), step: later.key }) : T('solvate.soluteFiles', { files: [...present].filter(f => f.endsWith('.gro')).map(f => `<code>${f}</code>`).join(', ') }));
  }
  const M = sys.id;
  showFiles(M, 'solvate');
  if (!['spc216.gro', 'tip4p.gro', 'tip5p.gro', 'spc216', 'tip4p'].includes(o.cs)) {
    return fail(fatalLines('solvate', [`Library file ${o.cs} not found in current dir nor in your GMXLIB path.`], version), T('solvate.badCs'));
  }
  if (o.set.has('p') && basename(o.p) !== `${M}.top`) {
    return fail(fatalLines('solvate', [`Can not open file '${o.p}' for reading.`], version), T('solvate.badTop', { top: `${M}.top` }));
  }

  // Which real run matches: the script's, or one that changes a single setting.
  const cp = basename(o.cp);
  const changes = [];
  if (cp === `${M}.gro`) changes.push('pdb2gmxbox');
  if (o.cs.startsWith('tip4p')) changes.push('tip4p');
  if (o.cs.startsWith('tip5p')) changes.push('tip5p');
  if (o.set.has('box')) changes.push(`box${o.box[0]}`);
  if (o.set.has('maxsol') && o.maxsol) changes.push(`maxsol${o.maxsol}`);
  const known = ['pdb2gmxbox', 'tip4p', 'box7', 'box10', 'maxsol2000', 'maxsol8000'];
  const coach = [];
  if (changes.length > 1 || (changes.length && !known.includes(changes[0])) || (o.set.has('box') && o.box.some(x => x !== o.box[0]))) {
    $('variant-note').textContent = '';
    return fail([`<span class="t-dim">${T('solvate.noComboTerm')}</span>`], T('solvate.noCombo', { M }));
  }
  const variant = changes[0] || 'script';
  const data = await loadJSON(`data/${M}/solvate/${variant === 'script' ? 'script' : variant}.json`);
  let log = trimLog(await load(variant === 'script' ? `data/${M}/logs/05_solvate.log` : `data/${M}/solvate/${variant}.log`));
  if (!o.set.has('p')) log = log.filter(l => !/^(Processing topology|Back Off!.*\.top|Adding line for)/.test(l));
  log = log.map(l => l.replace(/Writing generated configuration to \S+/, `Writing generated configuration to ${basename(o.o)}`).replace(/(m2000|m8000|box7|box10|tight|t4)\.gro/, basename(o.o)));

  const solute = parseGro(await load(`data/${M}/${variant === 'pdb2gmxbox' ? `${M}.gro` : `${M}_em_vac.gro`}`));
  let ow = data.ow;
  if (data.subset) { const base = await loadJSON(`data/${M}/solvate/script.json`); ow = data.subset.flatMap(i => base.ow.slice(3 * i, 3 * i + 3)); }
  const nSol = ow.length / 3;
  const perWater = variant === 'tip4p' ? 4 : 3;
  const v = boxFromGro(data.box);
  const density = +(log.find(l => l.startsWith('Density'))?.match(/[\d.]+/)[0] || 0);
  good = { sys, opts: o, v, solute, ow, nSol, variant, perWater, density };
  $('stale').hidden = true;

  terminal(ui.term, command, log.map(l => /^WARNING/.test(l) ? `<span class="t-warn">${esc(l)}</span>` : esc(l)));
  const topFix = `gmx grompp -f ./Functions/em_sol.mdp -c ${M}_b4ion.gro -p ${M}.top -o ${M}_ion.tpr -maxwarn 1`;
  if (!o.set.has('p')) coach.push({ k: 'err', h: T('solvate.noP', { top: solute.atoms.length.toLocaleString(), gro: (solute.atoms.length + perWater * nSol).toLocaleString(), href: `grompp.html?step=grompp_ion&amp;cmd=${encodeURIComponent(topFix)}` }) });
  if (variant === 'pdb2gmxbox') coach.push({ k: 'warn', h: T('solvate.pdb2gmxBox', { M }) });
  if (variant === 'tip4p') coach.push({ k: 'warn', h: T('solvate.tip4p') });
  if (variant.startsWith('maxsol')) coach.push({ k: 'warn', h: T('solvate.maxsol', { pct: Math.round(density / 9.87) }) });
  if (variant.startsWith('box')) coach.push({ h: T('solvate.boxFlag', { n: o.box[0] }) });
  if (cp === `${M}_b4soln.gro`) coach.push({ h: T('solvate.b4soln', { M }) });
  notes(ui.coach, coach);
  sync();
  readouts();
  draw(true);
}

function sync() {
  const { sys, opts: o, variant } = good;
  systemPicker($('sys-seg'), systems, sys.id, s => { line.set(fill(STEP.cmd, s.id)); run(); });
  const gros = [`${sys.id}_em_vac.gro`, `${sys.id}_b4soln.gro`, `${sys.id}.gro`];
  $('cp-select').innerHTML = gros.map(f => `<option value="${f}">${f}${f.includes('em_vac') ? ' ' + T('solvate.script') : ''}</option>`).join('');
  $('cp-select').value = basename(o.cp);
  for (const b of $('cs-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(o.cs.startsWith(b.dataset.cs.replace('.gro', ''))));
  $('p-on').checked = o.set.has('p');
  $('p-val').innerHTML = o.set.has('p') ? esc(basename(o.p)) : T('solvate.off');
  for (const b of $('box-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(o.set.has('box') ? +b.dataset.box === o.box[0] : +b.dataset.box === 0));
  $('box-val').innerHTML = o.set.has('box') ? T('solvate.cube', { n: o.box[0] }) : boxType(good.v);
  for (const b of $('maxsol-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.maxsol === (o.set.has('maxsol') ? o.maxsol : 0)));
  $('maxsol-val').innerHTML = o.set.has('maxsol') && o.maxsol ? T('solvate.atMost', { n: o.maxsol }) : T('solvate.fillBox');
  $('variant-note').innerHTML = variant === 'script' ? '' : T('solvate.oneAtATime');
}

function readouts() {
  const { opts: o, v, solute, nSol, perWater, density } = good;
  const V = volume(v);
  const atoms = solute.atoms.length + perWater * nSol;
  const rows = [
    [T('solvate.rows.waters'), `${nSol.toLocaleString()}<span class="sub">${T('solvate.rows.perWater', { n: perWater })}</span>`],
    [T('solvate.rows.atoms'), `${atoms.toLocaleString()}<span class="sub">${T('solvate.rows.split', { p: solute.atoms.length.toLocaleString(), w: (perWater * nSol).toLocaleString() })}</span>`],
    [T('solvate.rows.box'), `${boxType(v)}, ${V.toFixed(1)} nm³`],
    [T('solvate.rows.density'), `${density.toFixed(0)} g/L<span class="sub">${T('solvate.rows.liquid')}</span>`],
    [T('solvate.rows.ratio'), (perWater * nSol / solute.atoms.length).toFixed(1)],
    [T('solvate.rows.topology'), o.set.has('p') ? T('solvate.rows.added', { n: nSol, top: esc(basename(o.p)) }) : `<span style="color:var(--bad)">${T('solvate.rows.notUpdated')}</span>`]
  ];
  $('readout').innerHTML = rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('');
}

function draw(refit) {
  const { solute, ow, v } = good;
  $('w-all').setAttribute('aria-pressed', String(mode === 'all'));
  $('w-slice').setAttribute('aria-pressed', String(mode === 'slice'));
  const c = boxCenter(v);
  const pts = [];
  for (let i = 0; i < ow.length; i += 3) pts.push([ow[i], ow[i + 1], ow[i + 2]]);
  const placed = compact(pts, v, c);
  const shown = mode === 'slice' ? placed.filter(p => Math.abs(p[2] - c[2]) < 0.6) : placed;
  scene.clear();
  scene.setOrigin(c);
  scene.addAtoms(solute.atoms.filter(a => !/^[0-9]*H/.test(a.name)), { cartoon: { color: '#f0b35a' }, stick: { radius: 0.12, color: '#f0b35a', opacity: 0.6 } });
  scene.addAtoms(shown.map((x, i) => ({ resnr: i + 1, resname: 'HOH', name: 'O', x })), { sphere: { radius: mode === 'slice' ? 0.9 : 0.6, color: '#e05a4f', opacity: mode === 'slice' ? 1 : 0.55 } });
  scene.drawBox(v);
  if (refit) scene.frame(Math.max(...v.map(norm)) * 1.05, false); else scene.render();
}

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
