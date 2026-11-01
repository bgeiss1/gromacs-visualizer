// The editconf page: command line <-> controls <-> 3D view.
import { parseGro, groBoxLine, isHydrogen } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { editconf, prepareSystem } from '../editconf.js';
import { volume, norm, angles, latticeShifts, closestImage, boxVectors } from '../geometry.js';
import { BoxViewer } from '../viewer.js';
import { $, esc, setup, T, terminal, errorLines, showParseProblem, commandLine, tries, notes as showNotes, basename, gmxVersion } from '../site.js';
import { showFiles } from '../files.js';

await setup('editconf');
const nm = (x, d = 2) => `${x.toFixed(d)} nm`;
const START = 'gmx editconf -f lysozyme.gro -bt octahedron -d 2 -o lysozyme_b4soln.gro';
const CUTOFF = 1.0; // nm, the usual short-range cutoff in the course .mdp files

const TRIES = [
  {
    title: 'The box in the workflow',
    cmd: 'gmx editconf -f lysozyme.gro -bt octahedron -d 2 -o lysozyme_b4soln.gro',
    ask: 'The command has no <code>-c</code>. Is the protein centered anyway? And how much water will a 2 nm gap cost compared with 1 nm?',
    answer: 'Yes: <code>-d</code> switches centering on by itself. Drag <code>-d</code> down to 1.0 and the volume falls from 597.5 to 286.1 nm³, about 10,000 fewer waters to simulate. 2 nm is generous; 1.0 to 1.2 nm is the usual minimum.'
  },
  {
    title: 'Add half a nanometre on every side',
    cmd: 'gmx editconf -f lysozyme.gro -o lysozyme_b4soln.gro -c -d 1.0 -bt cubic',
    ask: 'Note the box volume, then drag <code>-d</code> to 1.5. How much bigger does the box get?',
    answer: 'From 371.8 to 549.4 nm³, almost 50% more, and roughly 5,900 extra waters to simulate. Volume grows with the cube of the box length, so a small change to <code>-d</code> costs a lot of computer time.'
  },
  {
    title: 'Same gap, different shape',
    cmd: 'gmx editconf -f lysozyme.gro -o lysozyme_b4soln.gro -c -d 1.0 -bt dodecahedron',
    ask: 'Compare the volume and the water count with the cubic box from the card before.',
    answer: '262.9 nm³ instead of 371.8 nm³: 29% smaller and about 3,600 fewer waters, while the copies stay just as far apart. The rhombic dodecahedron and the truncated octahedron are the most sphere-like shapes that still stack to fill space, which suits a roughly round protein.'
  },
  {
    title: 'A long peptide in a fitted box',
    cmd: 'gmx editconf -f magainin2.gro -o magainin2_b4soln.gro -c -d 1.0',
    ask: 'There is no <code>-bt</code>. Read the warning GROMACS prints, then turn on the neighbouring copies. What could go wrong once the helix starts to tumble?',
    answer: 'The box is fitted to each axis (5.0 × 4.1 × 4.7 nm). The helix is 3.8 nm long, so if it turns to point along y, its ends sit only about 0.3 nm from its own copy, well inside the 1.0 nm cutoff. A cubic, dodecahedral or octahedral box is sized from the diameter, so it keeps a 2 nm gap whichever way the helix points.'
  },
  {
    title: 'A fixed box without centering',
    cmd: 'gmx editconf -f lysozyme.gro -o lysozyme_b4soln.gro -noc -box 7',
    ask: 'Where does the protein end up? Turn on "Box as stored in .gro" to see the box GROMACS writes.',
    answer: 'It stays at its coordinates from the input file, so it hangs off the corner of the box. Because the box repeats, nothing is physically wrong, but the system is hard to look at and to check. Drop <code>-noc</code> (or add <code>-c</code>) and it moves to the middle.'
  },
  {
    title: 'A shape with no size',
    cmd: 'gmx editconf -f lysozyme.gro -o lysozyme_b4soln.gro -bt cubic',
    ask: 'Why didn\'t the box become a cube?',
    answer: '<code>-bt</code> only names the shape. Without <code>-d</code> or <code>-box</code>, GROMACS keeps the box from the input file. pdb2gmx wrote a box that just fits the protein (3.9 × 3.4 × 4.5 nm), so every atom near the edge touches its neighbouring copy.'
  },
  {
    title: 'Read the error',
    cmd: 'gmx editconf -f lysozyme.gro -bt octohedral -d 2 -o lysozyme_b4soln.gro',
    ask: 'What does GROMACS complain about, and how do you fix it?',
    answer: 'Option values must be spelled the way GROMACS lists them: <code>triclinic</code>, <code>cubic</code>, <code>dodecahedron</code> or <code>octahedron</code>. A unique start also works, so <code>-bt dod</code> is accepted.'
  }
];

let systems = [];
let good = null; // { sys, opts, r }
let viewer;
let gapFrame = 0;
let line, version;

async function boot() {
  const list = await (await fetch('data/systems.json')).json();
  systems = await Promise.all(list.map(async meta => {
    meta.file = `${meta.id}.gro`;
    const sys = prepareSystem(parseGro(await (await fetch(`data/${meta.id}/${meta.id}.gro`)).text()));
    sys.heavy = sys.atoms.filter(a => !isHydrogen(a)).map(a => a.x);
    return Object.assign(sys, { meta });
  }));
  $('sys-seg').innerHTML = systems.map(s => `<button type="button" data-file="${esc(s.meta.file)}">${esc(s.meta.short)}</button>`).join('');
  version = await gmxVersion('lysozyme');
  viewer = new BoxViewer($('viewer'));
  wire();
  run();
}

function wire() {
  line = commandLine({ run, start: START });
  tries($('tries'), TRIES, t => { line.set(t.cmd); run(); });
  $('sys-seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    edit(o => { o.f = b.dataset.file; o.o = b.dataset.file.replace('.gro', '_b4soln.gro'); o.set.add('f'); o.set.add('o'); });
  });
  $('d-on').addEventListener('change', e => edit(o => { if (e.target.checked) { o.d = parseFloat($('d-range').value); o.set.add('d'); } else o.set.delete('d'); }));
  $('d-range').addEventListener('input', e => edit(o => { o.d = parseFloat(e.target.value); o.set.add('d'); }));
  $('box-on').addEventListener('change', e => edit(o => { if (e.target.checked) { const v = parseFloat($('box-range').value); o.box = [v, v, v]; o.set.add('box'); } else o.set.delete('box'); }));
  $('box-range').addEventListener('input', e => edit(o => { const v = parseFloat(e.target.value); o.box = [v, v, v]; o.set.add('box'); }));
  $('bt-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) edit(o => { o.bt = b.dataset.bt; o.set.add('bt'); }); });
  $('c-on').addEventListener('change', e => edit(o => {
    const implied = o.set.has('d') || o.set.has('box');
    if (e.target.checked) { o.c = true; o.set.add('c'); }
    else if (implied) { o.c = false; o.set.add('c'); }
    else o.set.delete('c');
  }));
  for (const id of ['show-images', 'show-cell']) $(id).addEventListener('change', redraw);
  $('show-atoms').addEventListener('change', e => viewer.applyStyle(e.target.checked ? 'atoms' : 'cartoon'));
  $('view-reset').addEventListener('click', () => viewer.fit($('show-images').checked));
}

// A control changed: rewrite the command from the last good options.
function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('editconf', o));
  run();
}


function run() {
  const text = $('cmd').value;
  const p = parseCommand(text, 'editconf');
  const ui = { term: $('stdout'), coach: $('coach'), command: text, version };
  if (showParseProblem(p, 'editconf', ui)) { $('stale').hidden = !good || !!p.empty; return; }
  const sys = systems.find(s => s.meta.file === basename(p.opts.f));
  if (!sys) {
    terminal(ui.term, text, errorLines('editconf', { title: 'Invalid command-line options', lines: [`In command-line option -f`, `File '${p.opts.f}' does not exist or is not accessible.`, 'The file could not be opened.', '  Reason: No such file or directory'] }, version));
    showNotes($('coach'), [{ h: T('editconf.noFile', { files: systems.map(s => `<code>${s.meta.file}</code>`).join(' and ') }), k: 'err' }]);
    $('stale').hidden = !good;
    return;
  }
  showFiles(sys.meta.id, 'editconf');
  const r = editconf(sys, p.opts);
  good = { sys, opts: p.opts, r };
  $('stale').hidden = true;
  if (viewer.sys !== sys) viewer.setSystem(sys);
  syncControls();
  redraw();

  const lines = [...r.stdout.map(esc), ...r.warnings.map(l => `<span class="t-warn">${esc(l)}</span>`)];
  if (!r.changedBox && !r.centered) lines.push('', `<span class="t-dim">${T('editconf.unchangedTerm')}</span>`);
  terminal($('stdout'), text, lines);
  showNotes($('coach'), notes(sys, p.opts, r));
}

function syncControls() {
  const { sys, opts: o, r } = good;
  document.querySelectorAll('#sys-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.file === sys.meta.file)));
  $('sys-note').innerHTML = T(`system.${sys.meta.id}.shape`) + ' ' + T(`system.${sys.meta.id}.source`);
  const hasD = o.set.has('d'), hasBox = o.set.has('box');
  $('d-on').checked = hasD;
  $('d-range').disabled = !hasD;
  if (hasD) $('d-range').value = o.d;
  $('d-val').innerHTML = !hasD ? T('editconf.notSet') : (hasBox && r.bt !== 'triclinic') ? T('editconf.ignoredBox', { v: nm(o.d) }) : nm(o.d);
  document.querySelectorAll('#bt-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bt === r.bt)));
  $('bt-val').innerHTML = o.set.has('bt') ? '' : T('editconf.default');
  $('box-on').checked = hasBox;
  $('box-range').disabled = !hasBox;
  if (hasBox) $('box-range').value = o.box[0];
  const boxText = !hasBox ? T('editconf.notSet') : o.box.every(x => x === o.box[0]) ? nm(o.box[0], 1) : o.box.join(' × ') + ' nm';
  $('box-val').innerHTML = hasBox && hasD && r.bt === 'triclinic' ? T('editconf.ignoredD', { v: boxText }) : boxText;
  $('c-on').checked = r.centered;
  $('c-val').innerHTML = T(o.set.has('c') ? (o.c ? 'editconf.cOn' : 'editconf.cOff') : r.centered ? 'editconf.cImplied' : 'editconf.cOffPlain');
  $('legend-bt').innerHTML = T('editconf.legend.box', { bt: r.bt });
  $('gro-label').innerHTML = T('editconf.groLine', { file: esc(basename(o.o)) });
}

function redraw() {
  if (!good) return;
  const { sys, r, opts } = good;
  const show = { images: $('show-images').checked, unitCell: $('show-cell').checked };
  viewer.update(r, show);
  $('legend-img').hidden = !show.images;
  $('legend-cell').hidden = !show.unitCell;

  const V = volume(r.vectors);
  const lens = r.vectors.map(norm);
  const ang = angles(r.vectors);
  const rect = ang.every(a => Math.abs(a - 90) < 0.01);
  const water = Math.max(0, Math.round(sys.meta.water.perNm3 * (V - sys.meta.water.excludedNm3) / 10) * 10);
  let vsCube = '';
  if (opts.set.has('d') && !opts.set.has('box') && (r.bt === 'dodecahedron' || r.bt === 'octahedron')) {
    const cube = volume(boxVectors('cubic', sys.diameter + 2 * opts.d));
    vsCube = `<span class="sub">${T('editconf.vsCube', { n: Math.round((1 - V / cube) * 100) })}</span>`;
  }
  const rows = [
    [T('editconf.rows.protein'), T('editconf.rows.atoms', { n: sys.atoms.length.toLocaleString() })],
    [T('editconf.rows.diameter'), nm(sys.diameter)],
    [T('editconf.rows.size'), sys.stats.size.map(x => x.toFixed(2)).join(' × ') + ' nm'],
    [T('editconf.rows.box'), r.bt + (r.changedBox ? '' : ' ' + T('editconf.rows.fromInput'))],
    [T('editconf.rows.vectors'), lens.map(x => x.toFixed(2)).join(', ') + ' nm' + (rect ? '' : `<span class="sub">${T('editconf.rows.angles', { a: ang.map(a => a.toFixed(1) + '°').join(', ') })}</span>`)],
    [T('editconf.rows.volume'), `${V.toFixed(1)} nm³${vsCube}`],
    [T('editconf.rows.water'), T('editconf.rows.molecules', { n: water.toLocaleString() })],
    [T('editconf.rows.centered'), T(r.centered ? 'editconf.yes' : 'editconf.no')]
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('groline').textContent = groBoxLine(r.vectors);

  cancelAnimationFrame(gapFrame);
  gapFrame = requestAnimationFrame(() => {
    const gap = closestImage(sys.heavy, latticeShifts(r.vectors), sys.diameter);
    const k = gap < CUTOFF ? 'bad' : gap < 2 * CUTOFF ? 'warn' : 'ok';
    const msg = T('editconf.gap.' + k, { cut: CUTOFF.toFixed(1) });
    $('gap').className = 'gap ' + k;
    $('gap').innerHTML = `<div class="gap-num"><span class="small-label">${T('editconf.gap.label')}</span><strong>${nm(gap)}</strong></div><p>${msg}</p>`;
  });
}

function notes(sys, o, r) {
  const out = [];
  const hasD = o.set.has('d'), hasBox = o.set.has('box');
  if (!hasD && !hasBox) {
    out.push({ h: T('editconf.noSize', { size: sys.stats.size.map(x => x.toFixed(2)).join(' × ') }), k: 'warn' });
  }
  if (hasD && hasBox) {
    out.push({ h: T(r.bt === 'triclinic' ? 'editconf.dWins' : 'editconf.boxWins') });
  }
  if (hasBox && o.box.some(x => x !== o.box[0]) && r.bt !== 'triclinic') {
    out.push({ h: T('editconf.oneLength', { bt: r.bt }) });
  }
  if ((hasD || hasBox) && !r.centered) {
    out.push({ h: T('editconf.notCentered'), k: 'warn' });
  }
  if (hasD && o.d < 0) out.push({ h: T('editconf.negD'), k: 'warn' });
  if (r.bt === 'triclinic' && hasD && !o.set.has('bt')) {
    out.push({ h: T('editconf.triclinic') });
  }
  for (const flag of o.ignored.filter(x => x.startsWith('-'))) out.push({ h: T('editconf.notDrawn', { flag: esc(flag) }) });
  if (!/\.(gro|pdb)$/.test(o.o)) out.push({ h: T('editconf.groOut'), k: 'warn' });
  return out;
}

boot().catch(err => {
  $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err);
});
