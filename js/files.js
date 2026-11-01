// "The files it makes": under each command, the real files that command wrote in the UncleBen run,
// with a label on every part of the file (from data/text.json, editable in the dashboard).
import { $, esc, T, hasT, hasRun, WORKFLOW, fill } from './site.js';
import { fileKind, lineInfo, segments, plan, topAt } from './annotate.js';

// Files a step changes that aren't in WORKFLOW.makes: solvate and genion rewrite the .top (-p).
const UPDATES = { solvate: ['$M.top'], genion: ['$M.top'] };
// Which .gro sets the [ molecules ] counts of the .top right after each step.
const TOP_GRO = { pdb2gmx: '$M.gro', solvate: '$M_b4ion.gro', genion: '$M_em_sol.gro' };
const MORE = 200;

const cache = new Map();
async function load(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => r.ok ? r.text() : null).catch(() => null));
  return cache.get(url);
}

function listFor(step, M) {
  const out = [];
  const mdp = step.cmd.match(/-f\s+(\S+\.mdp)/);
  if (mdp) out.push({ name: mdp[1].split('/').pop(), role: 'reads', url: `workflow/Functions/${mdp[1].split('/').pop()}` });
  for (const f of step.makes) out.push({ name: fill(f, M), role: 'makes' });
  for (const f of UPDATES[step.key] || []) out.push({ name: fill(f, M), role: 'updates' });
  return out;
}

async function contents(file, step, M) {
  if (file.url) return load(file.url);
  if (file.name === `${M}.top`) {
    const top = await load(`data/${M}/${M}.top`);
    const gro = TOP_GRO[step.key] && fill(TOP_GRO[step.key], M);
    const files = gro && JSON.parse(await load(`data/${M}/files.json`) || '{}');
    return top && gro && files[gro] ? topAt(top, files[gro].mols) : top;
  }
  return (await load(`data/${M}/${file.name}`)) ?? load(`data/${M}/files/${file.name}`);
}

let shown = null, box = null;
const state = { file: 0, ranges: null, lines: null, info: null, ext: '' };

function section() {
  if (box) return box;
  box = document.createElement('section');
  box.className = 'made';
  box.id = 'made';
  document.querySelector('.tries, footer.foot').before(box);
  box.addEventListener('click', e => {
    const tab = e.target.closest('[data-file]');
    if (tab) { state.file = +tab.dataset.file; draw(); return; }
    const more = e.target.closest('[data-gap]');
    if (more) { const [a, b] = more.dataset.gap.split(',').map(Number); state.ranges.push([a, Math.min(b, a + MORE)]); drawFile(); }
  });
  tip();
  return box;
}

// Each page has its own title for the panel ("The files editconf makes"), editable in the dashboard.
const title = key => T(WORKFLOW.find(w => w.key === key).tool + '.filesTitle');

// Call at the end of each run(). Shows the files of workflow step `key` for system M.
export function showFiles(M, key) {
  const el = section();
  if (!hasRun()) { el.innerHTML = `<h2>${title(key)}</h2><p class="note">${T('file.notRun')}</p>`; shown = null; return; }
  if (shown === `${M}/${key}`) return;
  shown = `${M}/${key}`;
  state.step = WORKFLOW.find(w => w.key === key);
  state.M = M;
  state.list = listFor(state.step, M);
  state.file = state.list.findIndex(f => fileKind(f.name).text);
  if (state.file < 0) state.file = 0;
  draw();
}

function draw() {
  const { list } = state;
  box.innerHTML = `<h2>${title(state.step.key)}</h2>
    <p class="note">${T('file.note')}</p>
    <div class="file-tabs" role="tablist">${list.map((f, i) => `<button type="button" role="tab" data-file="${i}" aria-selected="${i === state.file}"><span class="mono">${esc(f.name)}</span><span class="role">${T('file.role.' + f.role)}</span></button>`).join('')}</div>
    <div class="file-about" id="file-about"></div>
    <pre class="annfile" id="annfile" tabindex="0"></pre>`;
  load1();
}

async function load1() {
  const f = state.list[state.file], { ext, text } = fileKind(f.name);
  const want = shown + '/' + f.name;
  $('file-about').innerHTML = `<p>${T(hasT('file.kind.' + ext) ? 'file.kind.' + ext : 'file.kind.other', { name: esc(f.name) })}</p>${text && ext !== 'log' ? `<p class="small-label">${T('file.hint')}</p>` : ''}`;
  const pre = $('annfile');
  if (!text) { pre.hidden = true; return; }
  pre.textContent = '...';
  const body = await contents(f, state.step, state.M);
  if (shown + '/' + state.list[state.file].name !== want) return;
  if (body == null) { pre.innerHTML = `<span class="t-dim">${T('file.missing', { name: esc(f.name) })}</span>`; return; }
  state.lines = body.replace(/\n$/, '').split('\n');
  state.ext = ext;
  state.info = lineInfo(ext, state.lines);
  state.ranges = plan(ext, state.info);
  drawFile();
}

function merged() {
  const r = [...state.ranges].sort((a, b) => a[0] - b[0]), out = [];
  for (const x of r) { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([...x]); }
  return state.ranges = out;
}

const segHTML = (ext, line, info) => segments(ext, line, info, hasT).map(s => s.k
  ? `<span class="ann" data-k="${s.k}"${s.v && Object.keys(s.v).length ? ` data-v="${esc(JSON.stringify(s.v))}"` : ''}${s.focus ? ' tabindex="0"' : ''}>${esc(s.t)}</span>`
  : esc(s.t)).join('');
const lineHTML = i => segHTML(state.ext, state.lines[i], state.info[i]);

// The same labels for a whole small file shown somewhere else on a page (the .mdp box on the grompp
// page). Returns one HTML string per line, and turns on the hover labels for the page.
export function labeledLines(ext, text) {
  tip();
  const lines = text.replace(/\s+$/, '').split('\n'), info = lineInfo(ext, lines);
  return lines.map((l, i) => segHTML(ext, l, info[i]));
}

function drawFile() {
  const pre = $('annfile'), n = state.lines.length;
  let at = 0, html = '', gapLast = true;
  const out = { push: x => { const g = x.startsWith('<button'); html += g || gapLast ? x : '\n' + x; gapLast = g; } };
  const gap = (a, b) => `<button type="button" class="file-gap" data-gap="${a},${b}">${T('file.hidden', { n: (b - a).toLocaleString(), m: Math.min(MORE, b - a).toLocaleString() })}</button>`;
  for (const [a, b] of merged()) {
    if (a > at) out.push(gap(at, a));
    for (let i = a; i < b; i++) out.push(lineHTML(i));
    at = b;
  }
  if (at < n) out.push(gap(at, n));
  pre.innerHTML = html;
}

// One floating label, shown for whatever part of the file is under the mouse or has focus.
// A tap (or click) keeps it open until the next tap.
let tipEl = null, pinned = null;
function tip() {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'ann-tip';
  tipEl.hidden = true;
  tipEl.setAttribute('role', 'tooltip');
  document.body.append(tipEl);
  const show = el => {
    const v = el.dataset.v ? JSON.parse(el.dataset.v) : {};
    for (const k in v) v[k] = esc(v[k]);
    tipEl.innerHTML = T(el.dataset.k, v);
    tipEl.hidden = false;
    document.querySelectorAll('.ann.on').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
    const r = el.getBoundingClientRect(), w = Math.min(380, innerWidth - 24);
    tipEl.style.width = w + 'px';
    tipEl.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
    const below = r.bottom + 8, h = tipEl.offsetHeight;
    tipEl.style.top = (below + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : below) + 'px';
  };
  const hide = () => { tipEl.hidden = true; document.querySelectorAll('.ann.on').forEach(x => x.classList.remove('on')); };
  document.addEventListener('mouseover', e => { const el = e.target.closest('.ann'); if (el && !pinned) show(el); });
  document.addEventListener('mouseout', e => { if (!pinned && e.target.closest('.ann') && !e.relatedTarget?.closest?.('.ann')) hide(); });
  document.addEventListener('focusin', e => { const el = e.target.closest('.ann'); if (el) show(el); });
  document.addEventListener('focusout', e => { if (!pinned && e.target.closest?.('.ann')) hide(); });
  document.addEventListener('click', e => {
    const el = e.target.closest('.ann');
    if (!el) { if (pinned) { pinned = null; hide(); } return; }
    if (pinned === el) { pinned = null; hide(); } else { pinned = el; show(el); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { pinned = null; hide(); } });
  addEventListener('scroll', () => { if (!tipEl.hidden) (pinned ? show(pinned) : hide()); }, { passive: true });
  document.addEventListener('scroll', e => { if (e.target !== document) hide(); }, true);
}
