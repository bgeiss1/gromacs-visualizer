// The editconf page: command line <-> controls <-> 3D view.
import { parseGro, groBoxLine, isHydrogen } from './gro.js';
import { parseCommand, buildCommand } from './command.js';
import { editconf, prepareSystem } from './editconf.js';
import { volume, norm, angles, latticeShifts, closestImage, boxVectors } from './geometry.js';
import { BoxViewer } from './viewer.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nm = (x, d = 2) => `${x.toFixed(d)} nm`;
const START = $('cmd').value;
const CUTOFF = 1.0; // nm, the usual short-range cutoff in the course .mdp files

const TRIES = [
  {
    title: 'Add half a nanometre on every side',
    cmd: 'gmx editconf -f lysozyme_processed.gro -o lysozyme_newbox.gro -c -d 1.0 -bt cubic',
    ask: 'Note the box volume, then drag <code>-d</code> to 1.5. How much bigger does the box get?',
    answer: 'From 371.6 to 549.3 nm³, almost 50% more, and roughly 5,900 extra waters to simulate. Volume grows with the cube of the box length, so a small change to <code>-d</code> costs a lot of computer time.'
  },
  {
    title: 'Same gap, different shape',
    cmd: 'gmx editconf -f lysozyme_processed.gro -o lysozyme_newbox.gro -c -d 1.0 -bt dodecahedron',
    ask: 'Compare the volume and the water count with the cubic box from the first card.',
    answer: '262.8 nm³ instead of 371.6 nm³: 29% smaller and about 3,600 fewer waters, while the copies stay just as far apart. The rhombic dodecahedron is the most sphere-like shape that still stacks to fill space, which suits a roughly round protein.'
  },
  {
    title: 'A long peptide in a fitted box',
    cmd: 'gmx editconf -f magainin2_processed.gro -o magainin2_newbox.gro -c -d 1.0',
    ask: 'There is no <code>-bt</code>. Read the warning GROMACS prints, then turn on the neighbouring copies. What could go wrong once the helix starts to tumble?',
    answer: 'The box is fitted to each axis (5.0 × 4.1 × 4.7 nm). The helix is 3.8 nm long, so if it turns to point along y, its ends sit only about 0.3 nm from its own copy, well inside the 1.0 nm cutoff. A cubic or dodecahedral box is sized from the diameter, so it keeps a 2 nm gap whichever way the helix points.'
  },
  {
    title: 'A fixed box without centering',
    cmd: 'gmx editconf -f lysozyme_processed.gro -o lysozyme_newbox.gro -noc -box 7',
    ask: 'Where does the protein end up? Turn on "Box as stored in .gro" to see the box GROMACS writes.',
    answer: 'It stays at its coordinates from the input file, so it hangs off the corner of the box. Because the box repeats, nothing is physically wrong, but the system is hard to look at and to check. Drop <code>-noc</code> (or add <code>-c</code>) and it moves to the middle.'
  },
  {
    title: 'A shape with no size',
    cmd: 'gmx editconf -f lysozyme_processed.gro -o lysozyme_newbox.gro -bt cubic',
    ask: 'Why didn\'t the box become a cube?',
    answer: '<code>-bt</code> only names the shape. Without <code>-d</code> or <code>-box</code>, GROMACS keeps the box from the input file. Here that is the crystal\'s unit cell from the PDB (7.91 × 7.91 × 3.79 nm), which is thinner than the protein itself.'
  },
  {
    title: 'Read the error',
    cmd: 'gmx editconf -f lysozyme_processed.gro -o lysozyme_newbox.gro -c -d 1.0 -bt octohedral',
    ask: 'What does GROMACS complain about, and how do you fix it?',
    answer: 'Option values must be spelled the way GROMACS lists them: <code>triclinic</code>, <code>cubic</code>, <code>dodecahedron</code> or <code>octahedron</code>. A unique start also works, so <code>-bt dod</code> is accepted.'
  }
];

let systems = [];
let good = null; // { sys, opts, r }
let viewer;
let gapFrame = 0;

async function boot() {
  const list = await (await fetch('data/systems.json')).json();
  systems = await Promise.all(list.map(async meta => {
    const sys = prepareSystem(parseGro(await (await fetch('data/' + meta.file)).text()));
    sys.heavy = sys.atoms.filter(a => !isHydrogen(a)).map(a => a.x);
    return Object.assign(sys, { meta });
  }));
  $('sys-seg').innerHTML = systems.map(s => `<button type="button" data-file="${esc(s.meta.file)}">${esc(s.meta.id === 'lysozyme' ? 'lysozyme' : 'magainin 2')}</button>`).join('');
  $('tries').innerHTML = TRIES.map((t, i) => `
    <article class="try">
      <h3>${esc(t.title)}</h3>
      <pre class="try-cmd">${esc(t.cmd)}</pre>
      <p>${t.ask}</p>
      <div class="try-actions"><button type="button" class="load" data-try="${i}">Load this command</button></div>
      <details><summary>Show the answer</summary><p>${t.answer}</p></details>
    </article>`).join('');
  viewer = new BoxViewer($('viewer'));
  wire();
  run(true);
}

function wire() {
  $('cmd').addEventListener('input', () => run(true));
  $('cmd-reset').addEventListener('click', () => { $('cmd').value = START; run(true); });
  $('sys-seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    edit(o => { o.f = b.dataset.file; o.o = b.dataset.file.replace('_processed.gro', '_newbox.gro'); });
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
  $('tries').addEventListener('click', e => {
    const b = e.target.closest('button[data-try]'); if (!b) return;
    $('cmd').value = TRIES[+b.dataset.try].cmd; run(true);
    $('cmd').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  });
  $('coach').addEventListener('click', e => {
    const fix = e.target.closest('button[data-fix]');
    if (fix) { $('cmd').value = $('cmd').value.replace(fix.dataset.from, fix.dataset.fix); run(true); }
  });
}

// A control changed: rewrite the command from the last good options.
function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored] };
  change(o);
  $('cmd').value = buildCommand(o);
  run(false);
}

const basename = p => p.split('/').pop();

function run() {
  const text = $('cmd').value;
  const p = parseCommand(text);
  const echo = `<span class="t-prompt">$</span> ${esc(text.trim())}\n`;
  if (!p.opts) return fail(p, echo);
  const sys = systems.find(s => s.meta.file === basename(p.opts.f));
  if (!sys) {
    return fail({
      error: { title: 'Invalid command-line options', lines: [`In command-line option -f`, `File '${p.opts.f}' does not exist or is not accessible.`, 'The file could not be opened.', '  Reason: No such file or directory'] },
      coach: `This folder has <code>${systems.map(s => s.meta.file).join('</code> and <code>')}</code>.`
    }, echo);
  }
  const r = editconf(sys, p.opts);
  good = { sys, opts: p.opts, r };
  $('stale').hidden = true;
  if (viewer.sys !== sys) viewer.setSystem(sys);
  syncControls();
  redraw();

  const lines = [...r.stdout.map(esc), ...r.warnings.map(l => `<span class="t-warn">${esc(l)}</span>`)];
  if (!r.changedBox && !r.centered) lines.push('', '<span class="t-dim">(the box is unchanged)</span>');
  $('stdout').innerHTML = echo + lines.join('\n');
  $('coach').innerHTML = notes(sys, p.opts, r).map(n => `<p class="cn ${n.k || ''}">${n.h}</p>`).join('');
}

function fail(p, echo) {
  let out = echo, coach = p.coach || '';
  if (p.empty) { out = ''; coach = 'Type a command, for example <code>gmx editconf -f lysozyme_processed.gro -o out.gro -c -d 1.0 -bt cubic</code>.'; }
  else if (p.shell) { out += esc(p.shell); coach = p.hint; }
  else if (p.later) { out += `<span class="t-dim">(gmx ${esc(p.later)} isn't on this page yet)</span>`; coach = `This page covers <code>gmx editconf</code> so far. <code>gmx ${esc(p.later)}</code> comes in a later version.`; }
  else if (p.hint) { coach = p.hint; }
  else {
    const e = p.error || p.gmxError;
    out += ['-------------------------------------------------------', 'Program:     gmx editconf, version 2026.4', '', 'Error in user input:', e.title, ...e.lines.map((l, i) => '  ' + '  '.repeat(i ? 1 : 0) + l), '-------------------------------------------------------'].map(esc).map(l => `<span class="t-err">${l}</span>`).join('\n');
    if (p.fix) coach = `GROMACS only accepts the exact names. Did you mean <button type="button" data-from="-bt ${esc(p.fix.from)}" data-fix="-bt ${esc(p.fix.to)}">-bt ${esc(p.fix.to)}</button>?`;
    else if (!coach && e.lines.some(l => l.startsWith('Unknown'))) coach = 'That option doesn\'t exist for editconf. Check the spelling, or run <code>gmx editconf -h</code> on the cluster to list every option.';
    else if (!coach && e.lines.includes('Option specified multiple times')) coach = 'Each option can appear once. <code>-c</code> and <code>-noc</code> are the same option switched on and off.';
    else if (!coach) coach = 'GROMACS stops before reading any files when an option is wrong. Fix it and the box comes back.';
  }
  $('stdout').innerHTML = out;
  $('coach').innerHTML = coach ? `<p class="cn err">${coach}</p>` : '';
  $('stale').hidden = !good || !!p.empty;
}

function syncControls() {
  const { sys, opts: o, r } = good;
  document.querySelectorAll('#sys-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.file === sys.meta.file)));
  $('sys-note').textContent = `${sys.meta.shape}. ${sys.meta.source}`;
  const hasD = o.set.has('d'), hasBox = o.set.has('box');
  $('d-on').checked = hasD;
  $('d-range').disabled = !hasD;
  if (hasD) $('d-range').value = o.d;
  $('d-val').textContent = !hasD ? 'not set' : (hasBox && r.bt !== 'triclinic') ? `${o.d} nm, ignored: -box wins` : nm(o.d);
  document.querySelectorAll('#bt-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bt === r.bt)));
  $('bt-val').textContent = o.set.has('bt') ? '' : 'default';
  $('box-on').checked = hasBox;
  $('box-range').disabled = !hasBox;
  if (hasBox) $('box-range').value = o.box[0];
  const boxText = !hasBox ? 'not set' : o.box.every(x => x === o.box[0]) ? nm(o.box[0], 1) : o.box.join(' × ') + ' nm';
  $('box-val').textContent = hasBox && hasD && r.bt === 'triclinic' ? `${boxText}, ignored: -d wins` : boxText;
  $('c-on').checked = r.centered;
  $('c-val').textContent = o.set.has('c') ? (o.c ? 'on' : 'off (-noc)') : r.centered ? 'on, implied' : 'off';
  $('legend-bt').textContent = r.bt;
  $('out-name').textContent = basename(o.o);
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
    vsCube = `<span class="sub">${Math.round((1 - V / cube) * 100)}% smaller than a cube with the same -d</span>`;
  }
  const rows = [
    ['Protein', `${sys.atoms.length.toLocaleString()} atoms`],
    ['Diameter', nm(sys.diameter)],
    ['Size x, y, z', sys.stats.size.map(x => x.toFixed(2)).join(' × ') + ' nm'],
    ['Box', r.bt + (r.changedBox ? '' : ' (from the input file)')],
    ['Box vectors', lens.map(x => x.toFixed(2)).join(', ') + ' nm' + (rect ? '' : `<span class="sub">angles ${ang.map(a => a.toFixed(1) + '°').join(', ')}</span>`)],
    ['Volume', `${V.toFixed(1)} nm³${vsCube}`],
    ['Water solvate would add', `≈ ${water.toLocaleString()} molecules`],
    ['Protein centered', r.centered ? 'yes' : 'no']
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('groline').textContent = groBoxLine(r.vectors);

  cancelAnimationFrame(gapFrame);
  gapFrame = requestAnimationFrame(() => {
    const gap = closestImage(sys.heavy, latticeShifts(r.vectors), sys.diameter);
    let k, msg;
    if (gap < CUTOFF) { k = 'bad'; msg = `Less than the ${CUTOFF.toFixed(1)} nm cutoff: the protein would interact with its own copy. Make the box bigger.`; }
    else if (gap < 2 * CUTOFF) { k = 'warn'; msg = `Clear of the ${CUTOFF.toFixed(1)} nm cutoff for now, with little room to spare if the protein turns or changes shape.`; }
    else { k = 'ok'; msg = `More than twice the ${CUTOFF.toFixed(1)} nm cutoff, so the protein can tumble without meeting its own copy.`; }
    $('gap').className = 'gap ' + k;
    $('gap').innerHTML = `<div class="gap-num"><span class="small-label">Closest approach to a periodic copy</span><strong>${nm(gap)}</strong></div><p>${msg}</p>`;
  });
}

function notes(sys, o, r) {
  const out = [];
  const hasD = o.set.has('d'), hasBox = o.set.has('box');
  if (!hasD && !hasBox) {
    out.push({ h: `No <code>-d</code> or <code>-box</code>, so the box is the one from the input file${sys.meta.id === 'lysozyme' ? ': the crystal unit cell from the PDB, 7.91 × 7.91 × 3.79 nm, which is thinner than the protein' : ''}. Add <code>-d 1.0</code> to size the box around the protein.`, k: 'warn' });
  }
  if (hasD && hasBox) {
    out.push({ h: r.bt === 'triclinic' ? 'With a triclinic box, <code>-d</code> wins and <code>-box</code> is ignored.' : 'With this box type, <code>-box</code> wins and <code>-d</code> is ignored. Use one or the other.' });
  }
  if (hasBox && o.box.some(x => x !== o.box[0]) && r.bt !== 'triclinic') {
    out.push({ h: `A ${r.bt} box has one length, so GROMACS uses only the first <code>-box</code> value.` });
  }
  if ((hasD || hasBox) && !r.centered) {
    out.push({ h: 'The protein is not centered, so it keeps its coordinates from the input file and can hang outside the box. The box repeats, so the physics is fine, but the system is hard to check by eye. Leave out <code>-noc</code>.', k: 'warn' });
  }
  if (hasD && o.d < 0) out.push({ h: 'A negative <code>-d</code> makes the box smaller than the protein.', k: 'warn' });
  if (r.bt === 'triclinic' && hasD && !o.set.has('bt')) {
    out.push({ h: 'GROMACS warns because each side was fitted separately. A long molecule that turns can end up close to its own copy. Try <code>-bt cubic</code> or <code>-bt dodecahedron</code>.' });
  }
  for (const flag of o.ignored.filter(x => x.startsWith('-'))) out.push({ h: `<code>${esc(flag)}</code> is a real editconf option, but this page doesn't draw it yet.` });
  if (!/\.(gro|pdb)$/.test(o.o)) out.push({ h: 'Give <code>-o</code> a <code>.gro</code> name so the next step, <code>gmx solvate</code>, can read it.', k: 'warn' });
  return out;
}

boot().catch(err => {
  $('stdout').textContent = 'Could not load the example structures. Open this page through the local server (node serve.mjs), not by double-clicking the file.\n\n' + err;
});
