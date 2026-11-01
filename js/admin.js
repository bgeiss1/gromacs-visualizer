// The text dashboard (admin.html): edit data/text.json key by key, with a preview, checks for
// placeholders and Brian's style rules, and Save through serve.mjs (POST /api/text).
import { esc } from './site.js';

const $ = id => document.getElementById(id);
const GROUPS = [
  { id: 'shared', title: 'Every page', page: 'index.html', match: k => /^(common|nav)\./.test(k) },
  { id: 'index', title: 'Workflow', page: 'index.html', match: k => /^(index|step|ask|system)\./.test(k) },
  { id: 'files', title: 'Files (hover labels)', page: 'pdb2gmx.html', match: k => k.startsWith('file.') },
  ...['pdb2gmx', 'editconf', 'grompp', 'mdrun', 'solvate', 'genion', 'trjconv'].map(t => ({ id: t, title: t, page: `${t}.html`, match: k => k.startsWith(t + '.') }))
];
const other = { id: 'other', title: 'Other', page: 'index.html', match: k => !GROUPS.some(g => g.match(k)) };
GROUPS.push(other);
const BANNED = /\b(importantly|notably|interestingly|indeed|crucially|simply put|of course|moreover|furthermore|hence|consequently|nevertheless|remarkable|exciting|cutting-edge|transformative|groundbreaking|novel|unprecedented)\b/i;

let saved = {}, draft = {}, group = 'shared';
const placeholders = s => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
const changed = () => Object.keys(draft).filter(k => draft[k] !== saved[k]);

function checks(k) {
  const v = draft[k], out = [];
  const before = placeholders(saved[k] ?? ''), now = placeholders(v);
  for (const p of before) if (!now.has(p)) out.push({ k: 'bad', h: `{${p}} is missing. The page fills it in, so put it back.` });
  for (const p of now) if (!before.has(p)) out.push({ k: 'bad', h: `{${p}} is not something this text can fill in. The page will show it as typed.` });
  for (const tag of ['code', 'b', 'em', 'strong', 'a', 'span']) {
    const open = (v.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length, close = (v.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) out.push({ k: 'bad', h: `There ${open === 1 ? 'is' : 'are'} ${open} &lt;${tag}&gt; and ${close} &lt;/${tag}&gt;. Every tag needs its closing tag.` });
  }
  if (/[—–]/.test(v)) out.push({ k: 'style', h: 'Style: no em or en dashes. Use a comma, a period or parentheses.' });
  if (/;/.test(v.replace(/&\w+;|&#\d+;/g, ''))) out.push({ k: 'style', h: 'Style: no semicolons. Split it into two sentences.' });
  const b = v.replace(/<[^>]+>/g, '').match(BANNED);
  if (b) out.push({ k: 'style', h: `Style: "${esc(b[0])}" is on the list of words to avoid.` });
  return out;
}

function matches(k, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return k.toLowerCase().includes(q) || draft[k].toLowerCase().includes(q);
}

function visible() {
  const q = $('q').value.trim(), onlyChanged = $('only-changed').checked, onlyStyle = $('only-style').checked;
  return Object.keys(draft).filter(k => (q ? true : GROUPS.find(g => g.id === group).match(k)) && matches(k, q)
    && (!onlyChanged || draft[k] !== saved[k]) && (!onlyStyle || checks(k).length));
}

function drawGroups() {
  const q = $('q').value.trim();
  $('groups').innerHTML = GROUPS.filter(g => Object.keys(draft).some(g.match)).map(g => {
    const keys = Object.keys(draft).filter(g.match);
    const ch = keys.filter(k => draft[k] !== saved[k]).length;
    return `<button type="button" data-g="${g.id}" aria-pressed="${!q && g.id === group}"><span>${esc(g.title)}</span><span class="n">${ch ? `<span class="ch">${ch} changed</span> · ` : ''}${keys.length}</span></button>`;
  }).join('');
}

function entryHTML(k) {
  const g = GROUPS.find(x => x.match(k));
  return `<article class="entry${draft[k] !== saved[k] ? ' changed' : ''}" data-k="${esc(k)}">
    <div class="entry-head"><span class="key">${esc(k)}</span>
      <span class="acts">${draft[k] !== saved[k] ? '<button type="button" data-undo>Undo</button>' : ''}<a href="${g.page}?showtext" target="_blank" rel="noopener">Show on page</a></span></div>
    <textarea spellcheck="true" aria-label="${esc(k)}">${esc(draft[k])}</textarea>
    <div class="preview">${preview(draft[k])}</div>
    <div class="warns">${checks(k).map(w => `<span class="${w.k}">${w.h}</span>`).join('')}</div>
  </article>`;
}
const preview = v => v.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+=/gi, ' data-x=');

function drawEntries() {
  const keys = visible();
  $('entries').innerHTML = keys.length ? keys.map(entryHTML).join('') : '<p class="empty">Nothing matches.</p>';
}

function drawBar() {
  const n = changed().length;
  $('save').disabled = !n;
  $('publish').disabled = !!n;
  $('publish').title = n ? 'Save first, then Publish' : 'Send the saved text to GitHub, which updates the website';
  $('discard').disabled = !n;
  $('save').textContent = n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'Save';
}

function draw() { drawGroups(); drawEntries(); drawBar(); }
function status(msg, k = '') { $('status').className = 'status ' + k; $('status').innerHTML = msg; }

async function boot() {
  saved = await (await fetch('data/text.json', { cache: 'no-store' })).json();
  draft = { ...saved };
  draw();
  $('groups').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b) { group = b.dataset.g; $('q').value = ''; draw(); scrollTo(0, 0); } });
  $('q').addEventListener('input', draw);
  $('only-changed').addEventListener('change', draw);
  $('only-style').addEventListener('change', draw);
  $('entries').addEventListener('input', e => {
    const box = e.target.closest('textarea'); if (!box) return;
    const art = box.closest('.entry'), k = art.dataset.k;
    draft[k] = box.value;
    art.classList.toggle('changed', draft[k] !== saved[k]);
    art.querySelector('.preview').innerHTML = preview(draft[k]);
    art.querySelector('.warns').innerHTML = checks(k).map(w => `<span class="${w.k}">${w.h}</span>`).join('');
    const acts = art.querySelector('.acts');
    if (draft[k] !== saved[k] && !acts.querySelector('[data-undo]')) acts.insertAdjacentHTML('afterbegin', '<button type="button" data-undo>Undo</button>');
    if (draft[k] === saved[k]) acts.querySelector('[data-undo]')?.remove();
    drawGroups(); drawBar(); status('');
  });
  $('entries').addEventListener('click', e => {
    if (!e.target.closest('[data-undo]')) return;
    const art = e.target.closest('.entry'), k = art.dataset.k;
    draft[k] = saved[k];
    art.outerHTML = entryHTML(k);
    drawGroups(); drawBar();
  });
  $('discard').addEventListener('click', () => { if (confirm('Undo every change since the last save?')) { draft = { ...saved }; draw(); status(''); } });
  $('save').addEventListener('click', save);
  $('publish').addEventListener('click', publish);
  $('download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 1) + '\n'], { type: 'application/json' }));
    a.download = 'text.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('upload').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const up = JSON.parse(await f.text());
      let n = 0;
      for (const [k, v] of Object.entries(up)) if (typeof v === 'string' && k in draft && draft[k] !== v) { draft[k] = v; n++; }
      draw();
      status(`Loaded ${n} change${n === 1 ? '' : 's'} from ${esc(f.name)}. Check them, then press Save.`, 'ok');
    } catch { status(`${esc(f.name)} is not a text.json file.`, 'err'); }
  });
  addEventListener('beforeunload', e => { if (changed().length) e.preventDefault(); });
}

async function save() {
  const bad = changed().filter(k => checks(k).some(w => w.k === 'bad'));
  if (bad.length && !confirm(`${bad.length} changed text${bad.length === 1 ? ' has a problem' : 's have problems'} marked in red. Save anyway?`)) return;
  $('save').disabled = true;
  status('Saving...');
  try {
    // Start from the file as it is now, so text added since this tab was opened isn't lost.
    const now = await (await fetch('data/text.json', { cache: 'no-store' })).json();
    const keys = changed(), out = { ...now };
    for (const k of keys) out[k] = draft[k];
    const r = await fetch('api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
    if (!r.ok) throw new Error(await r.text());
    const { backup } = await r.json();
    const n = keys.length;
    saved = out;
    draft = { ...out };
    draw();
    status(`Saved ${n} change${n === 1 ? '' : 's'}. The old text is in <span class="mono">${esc(backup)}</span>. Reload a page to see it.`, 'ok');
  } catch (err) {
    drawBar();
    status('Could not save. This only works through the local server (node serve.mjs). You can Download the file instead and put it in data/text.json.', 'err');
  }
}

async function publish() {
  if (!confirm('Send the saved text to GitHub? The website will show it in about a minute.')) return;
  $('publish').disabled = true;
  status('Publishing...');
  try {
    const r = await fetch('api/publish', { method: 'POST' });
    const out = await r.json().catch(() => ({ error: 'This only works through the local server (node serve.mjs).' }));
    if (!r.ok) throw new Error(out.error);
    status(out.committed ? 'Published. The website updates in about a minute.' : 'Nothing new to publish. GitHub already has this text.', 'ok');
  } catch (err) {
    status('Could not publish: ' + esc(err.message || err), 'err');
  }
  drawBar();
}

boot().catch(err => status('Could not load data/text.json. Open this page through the local server (node serve.mjs). ' + esc(err), 'err'));
