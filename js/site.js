// Shared by every page: the workflow, the header, data loading,
// and the command line + terminal + notes that each page uses.

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const $ = id => document.getElementById(id);
export const WATER = 'tip3p';

// One page per GROMACS tool, in the order the script first uses them.
export const PAGES = [
  { tool: 'pdb2gmx', title: 'Build the topology' },
  { tool: 'editconf', title: 'Make the box' },
  { tool: 'grompp', title: 'Package a run' },
  { tool: 'mdrun', title: 'Run it' },
  { tool: 'solvate', title: 'Add water' },
  { tool: 'genion', title: 'Add ions' },
  { tool: 'trjconv', title: 'Clean up the trajectory' }
];

// Every command of the workflow, in order. $M is the system name ($MDPDB).
// log: the screen output the real run saved in data/<system>/logs/. asks: the questions GROMACS
// prints while the command runs, and what the script answers (the lines between <<EOF and EOF).
export const WORKFLOW = [
  { key: 'pdb2gmx', tool: 'pdb2gmx', log: '01_pdb2gmx', cmd: 'gmx pdb2gmx -ignh -f $M.pdb -o $M.gro -p $M.top -water tip3p', asks: [['Select the Force Field:', '1']], makes: ['$M.gro', '$M.top', 'posre.itp'] },
  { key: 'editconf', tool: 'editconf', log: '02_editconf', cmd: 'gmx editconf -f $M.gro -bt octahedron -d 2 -o $M_b4soln.gro', makes: ['$M_b4soln.gro'] },
  { key: 'grompp_em_vac', tool: 'grompp', log: '03_grompp_em_vac', cmd: 'gmx grompp -f ./Functions/em_vac.mdp -c $M_b4soln.gro -p $M.top -o $M_em_vac.tpr', makes: ['$M_em_vac.tpr'], state: 0 },
  { key: 'em_vac', tool: 'mdrun', log: '04_mdrun_em_vac', cmd: 'gmx mdrun -deffnm $M_em_vac -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto', makes: ['$M_em_vac.gro', '$M_em_vac.edr', '$M_em_vac.log', '$M_em_vac.trr'] },
  { key: 'solvate', tool: 'solvate', log: '05_solvate', cmd: 'gmx solvate -cp $M_em_vac.gro -cs spc216.gro -o $M_b4ion.gro -p $M.top', makes: ['$M_b4ion.gro'] },
  { key: 'grompp_ion', tool: 'grompp', log: '06_grompp_ion', cmd: 'gmx grompp -f ./Functions/em_sol.mdp -c $M_b4ion.gro -p $M.top -o $M_ion.tpr -maxwarn 1', makes: ['$M_ion.tpr'], state: 1 },
  { key: 'genion', tool: 'genion', log: '07_genion', cmd: 'gmx genion -s $M_ion.tpr -o $M_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p $M.top', asks: [['Select a continuous group of solvent molecules', 'SOL']], makes: ['$M_em_sol.gro'] },
  { key: 'grompp_em_sol', tool: 'grompp', log: '08_grompp_em_sol', cmd: 'gmx grompp -f ./Functions/em_sol.mdp -c $M_em_sol.gro -p $M.top -o $M_em_sol.tpr', makes: ['$M_em_sol.tpr'], state: 2 },
  { key: 'trjconv_pdb', tool: 'trjconv', log: '09_trjconv_pdb', cmd: 'gmx trjconv -f $M_em_sol.gro -o $M_em_sol.pdb -s $M_em_sol.tpr', asks: [['Select group for output', '0']], makes: ['$M_em_sol.pdb'] },
  { key: 'em_sol', tool: 'mdrun', log: '10_mdrun_em_sol', cmd: 'gmx mdrun -deffnm $M_em_sol -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto', makes: ['$M_em_sol.gro', '$M_em_sol.edr', '$M_em_sol.log', '$M_em_sol.trr'] },
  { key: 'grompp_pr', tool: 'grompp', log: '12_grompp_pr', cmd: 'gmx grompp -f ./Functions/pr.mdp -c $M_em_sol.gro -r $M_em_sol.gro -p $M.top -o $M_pr.tpr', makes: ['$M_pr.tpr'], state: 2, md: true },
  { key: 'pr', tool: 'mdrun', log: '13_mdrun_pr', cmd: 'gmx mdrun -deffnm $M_pr -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto', makes: ['$M_pr.gro', '$M_pr.edr', '$M_pr.log', '$M_pr.xtc', '$M_pr.cpt'], md: true },
  { key: 'grompp_md', tool: 'grompp', log: '14_grompp_md', cmd: 'gmx grompp -f ./Functions/short_md.mdp -c $M_pr.gro -p $M.top -o $M_md.tpr', makes: ['$M_md.tpr'], state: 2, md: true },
  { key: 'md', tool: 'mdrun', log: '15_mdrun_md', cmd: 'gmx mdrun -deffnm $M_md -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto', makes: ['$M_md.gro', '$M_md.edr', '$M_md.log', '$M_md.xtc', '$M_md.cpt'], md: true },
  { key: 'grompp_longmd', tool: 'grompp', log: '16_grompp_longmd', cmd: 'gmx grompp -f ./Functions/long_md.mdp -c $M_md.gro -p $M.top -o $M_longmd.tpr', makes: ['$M_longmd.tpr'], state: 2, md: true },
  { key: 'longmd', tool: 'mdrun', log: '17_mdrun_longmd', cmd: 'gmx mdrun -deffnm $M_longmd -v -ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto', makes: ['$M_longmd.gro', '$M_longmd.edr', '$M_longmd.log', '$M_longmd.xtc', '$M_longmd.cpt'], md: true },
  { key: 'trjconv_nojump', tool: 'trjconv', log: '18_trjconv_nojump', cmd: 'gmx trjconv -f $M_longmd.xtc -s $M_longmd.tpr -dt 10 -ur compact -center -pbc nojump -o $M_longmd_nojump.xtc', asks: [['Select group for centering', '4'], ['Select group for output', '0']], makes: ['$M_longmd_nojump.xtc'], md: true },
  { key: 'trjconv_start', tool: 'trjconv', log: '19_trjconv_start', cmd: 'gmx trjconv -f $M_longmd.xtc -s $M_longmd.tpr -dump 0 -ur compact -pbc nojump -o $M_longmd_nojump_start.gro', asks: [['Select group for output', '0']], makes: ['$M_longmd_nojump_start.gro'], md: true },
  { key: 'trjconv_fit', tool: 'trjconv', log: '20_trjconv_fit', cmd: 'gmx trjconv -f $M_longmd_nojump.xtc -s $M_longmd.tpr -dt 10 -ur compact -fit rot+trans -o $M_longmd_nojump_fit.xtc', asks: [['Select group for least squares fit', '4'], ['Select group for output', '0']], makes: ['$M_longmd_nojump_fit.xtc'], md: true },
  { key: 'trjconv_fitstart', tool: 'trjconv', log: '21_trjconv_fitstart', cmd: 'gmx trjconv -f $M_longmd_nojump.xtc -s $M_longmd.tpr -dump 0 -ur compact -o $M_longmd_nojump_fit_start.gro', asks: [['Select group for output', '0']], makes: ['$M_longmd_nojump_fit_start.gro'], md: true }
];

export const fill = (s, sys) => s.replace(/\$M/g, sys);
export const stepWhat = w => T('step.' + w.key);
export const stepsFor = tool => WORKFLOW.filter(w => w.tool === tool && !w.repeat);

// Files present in the run folder just before workflow step `key`.
export function filesBefore(key, sys) {
  const files = new Set([`${sys}.pdb`, './Functions/em_vac.mdp', './Functions/em_sol.mdp', './Functions/pr.mdp', './Functions/short_md.mdp', './Functions/long_md.mdp']);
  for (const w of WORKFLOW) {
    if (w.key === key) break;
    for (const f of w.makes) files.add(fill(f, sys));
  }
  return files;
}
export const sameFile = (a, b) => a.replace(/^\.\//, '') === b.replace(/^\.\//, '');
export const hasFile = (files, f) => [...files].some(x => sameFile(x, f));

// Page text lives in data/text.json so it can be edited from the dashboard (admin.html).
// Keys are flat ("pdb2gmx.intro"); {name} placeholders are filled from vars.
let TEXT = {};
const SHOW_KEYS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('showtext');
export async function loadText() {
  try { TEXT = await (await fetch('data/text.json', { cache: 'no-store' })).json(); } catch { TEXT = {}; }
  if (SHOW_KEYS) document.documentElement.classList.add('showtext');
}
export function T(key, vars = {}) {
  const v = TEXT[key];
  if (typeof v !== 'string') return `<span class="t-missing">[${esc(key)}]</span>`;
  const out = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return SHOW_KEYS ? `<span class="tk" title="${esc(key)}">${out}</span>` : out;
}
export const hasT = key => typeof TEXT[key] === 'string';
// Same, as plain text (for attributes and textContent).
export const Tplain = (key, vars) => { const d = document.createElement('div'); d.innerHTML = T(key, vars); return d.textContent; };
export function applyText(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) {
    el.innerHTML = T(el.dataset.t);
    if (SHOW_KEYS) el.title = el.dataset.t;
  }
}

// Every page starts with this: load the text, draw the header, fill in the static text.
export async function setup(active) {
  await loadText();
  header(active);
  applyText();
  const tr = document.querySelector('.tries');
  if (tr && !SHOW_TRIES) tr.hidden = true;
}

// The "Try it" exercise cards are switched off for now (Brian, 2026-10-28). The cards and their
// code stay in each page; set this to true to bring them back.
export const SHOW_TRIES = false;

export function header(active) {
  const el = document.createElement('header');
  el.className = 'top';
  el.innerHTML = `
    <a class="brand" href="index.html">
      <span class="brand-name">${T('common.brand')}</span>
      <span class="brand-sub">${T('common.brandSub')}</span>
    </a>
    <nav class="tools" aria-label="GROMACS tools">
      <a class="tool${active === 'index' ? ' on' : ''}" href="index.html">${T('common.navWorkflow')}</a>
      ${PAGES.map(p => `<a class="tool${p.tool === active ? ' on' : ''}" href="${p.tool}.html" title="${esc(Tplain('nav.' + p.tool))}"${p.tool === active ? ' aria-current="page"' : ''}>${p.tool}</a>`).join('')}
    </nav>`;
  document.body.prepend(el);
}

export async function loadSystems() {
  return (await fetch('data/systems.json')).json();
}
export async function text(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Could not load ${path}`);
  return r.text();
}
export const params = () => new URLSearchParams(location.search);

// The screen output a step saved, without the command echo and the GROMACS banner.
export function trimLog(log) {
  let out = log.replace(/\r/g, '').split('\n').slice(1);
  const banner = out.findIndex(l => /^Command line:/.test(l));
  if (banner >= 0) out = out.slice(banner + 3);
  while (out.length && !out[0].trim()) out.shift();
  // gmx_mpi follows each fatal error with Open MPI's MPI_ABORT box; plain gmx doesn't.
  const abort = out.findIndex(l => /^MPI_ABORT was invoked/.test(l));
  if (abort > 0) out.splice(abort - 1, out.findIndex((l, i) => i > abort && /^-{70,}/.test(l)) - abort + 2);
  return out.filter((l, i) => l.trim() || (out[i - 1] || '').trim()); // one blank line at most
}

// Logs from export_interactive.sh mark what the student typed as {{answer}}. Splits a log
// into the output before each question, the answers, and the output after the last one:
// { parts: [lines before answer 1, lines after answer 1, ...], answers: [...] }. The last line
// of each part (but the final one) is the question as GROMACS printed it, e.g. "Select a group: ".
export function splitTyped(lines) {
  const parts = [[]], answers = [];
  for (const l of lines) {
    const m = l.match(/^(.*?)\{\{(.*)\}\}$/);
    if (!m) { parts.at(-1).push(l); continue; }
    if (m[1] || !parts.at(-1).length) parts.at(-1).push(m[1]);
    else if (!/: $/.test(parts.at(-1).at(-1))) parts.at(-1).push('');
    answers.push(m[2]);
    parts.push([]);
  }
  return { parts, answers };
}

// A command typed at the terminal, run the way the shell runs it: GROMACS prints until it asks
// a question, then waits until the student types an answer and presses Enter. Starting a new
// command abandons the old one, the same as pressing Ctrl-C.
// Nothing appears in the terminal until the student runs a command (Run or Enter). Until then the
// page can still set itself up from the example command, but shell() only shows a hint and never
// asks its questions.
let current = 0, started = false;
export const hasRun = () => started;
export function shell(term, command, { auto = [], focus = false } = {}) {
  const id = ++current;
  if (!started) {
    term.innerHTML = `<span class="t-dim">${T('common.notRun')}</span>`;
    return { live: false, print() {}, ask: () => new Promise(() => {}) };
  }
  auto = [...auto];
  let html = `<span class="t-prompt">$</span> ${esc(command.trim())}\n`;
  const draw = () => { term.innerHTML = html; term.scrollTop = term.scrollHeight; };
  draw();
  const s = {
    get live() { return id === current; },
    print(lines) { if (s.live && lines.length) { html += lines.join('\n') + '\n'; draw(); } },
    // prompt: the last line GROMACS printed (the question), shown with the answer box after it.
    // check(answer) returns null if GROMACS accepts it, or { lines } to print before asking again.
    ask({ prompt = '', check = () => null, onWait }) {
      return new Promise(resolve => {
        const take = v => {
          html += `${esc(prompt)}<span class="t-stdin">${esc(v)}</span>\n`;
          const bad = check(v);
          if (bad) { if (bad.lines?.length) html += bad.lines.join('\n') + '\n'; wait(true); }
          else { draw(); resolve(v); }
        };
        const wait = again => {
          if (!s.live) return;
          if (auto.length) { take(auto.shift()); return; }
          draw();
          const line = document.createElement('span');
          line.className = 't-ask';
          line.textContent = prompt;
          const box = document.createElement('input');
          box.className = 't-in';
          box.type = 'text';
          box.spellcheck = false;
          box.autocomplete = 'off';
          box.setAttribute('aria-label', Tplain('common.answerLabel'));
          box.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); take(box.value.trim()); }
            else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); current++; html += `${esc(prompt)}^C\n`; draw(); onWait?.('stopped'); }
          });
          line.append(box);
          term.append(line);
          term.scrollTop = term.scrollHeight;
          onWait?.(again ? 'again' : 'first');
          if (focus || again) box.focus({ preventScroll: !again });
        };
        wait(false);
      });
    }
  };
  return s;
}

// Prints a whole run at once (commands that ask nothing).
export function terminal(el, command, lines) {
  const s = shell(el, command);
  s.print(lines);
  return s;
}

// Error boxes the page builds itself use the version of GROMACS that made the system's runs.
export function errorLines(tool, e, version = '2026.4') {
  return ['-------------------------------------------------------', `Program:     gmx ${tool}, version ${version}`, '', 'Error in user input:', e.title, ...e.lines.map((l, i) => '  ' + '  '.repeat(i ? 1 : 0) + l), '-------------------------------------------------------']
    .map(l => `<span class="t-err">${esc(l)}</span>`);
}
export function fatalLines(tool, lines, version = '2026.4') {
  return ['-------------------------------------------------------', `Program:     gmx ${tool}, version ${version}`, '', 'Fatal error:', ...lines, '', 'For more information and tips for troubleshooting, please check the GROMACS', 'website at http://www.gromacs.org/Documentation/Errors', '-------------------------------------------------------']
    .map(l => `<span class="t-err">${esc(l)}</span>`);
}
// The GROMACS version a system's runs were made with, read from its first log.
const versions = {};
export async function gmxVersion(sys) {
  return versions[sys] ??= (await text(`data/${sys}/logs/02_editconf.log`).catch(() => '')).match(/GROMACS - gmx \w+, ([\d.]+)/)?.[1] || '2026.4';
}

export function notes(el, list) {
  if (!started && el.id === 'coach') { el.innerHTML = ''; return; }
  el.innerHTML = list.map(n => `<p class="cn ${n.k || ''}">${n.h}</p>`).join('');
}

// Shared handling for a command that didn't parse. Returns true if it handled it.
export function showParseProblem(p, tool, ui) {
  const { term, coach, command } = ui;
  if (p.opts) return false;
  if (p.empty) { term.innerHTML = ''; notes(coach, [{ h: T('common.typeCommand', { tool }), k: 'err' }]); return true; }
  if (p.shell) { terminal(term, command, [esc(p.shell)]); notes(coach, [{ h: p.hint, k: 'err' }]); return true; }
  if (p.other) {
    terminal(term, command, [`<span class="t-dim">${T('common.otherToolTerm', { other: esc(p.other), tool })}</span>`]);
    const page = PAGES.find(x => x.tool === p.other);
    notes(coach, [{ h: page ? T('common.otherTool', { other: esc(p.other), tool, href: `${p.other}.html?cmd=${encodeURIComponent(command)}` }) : T('common.otherToolNoPage', { tool }), k: 'err' }]);
    return true;
  }
  if (p.hint) { notes(coach, [{ h: p.hint, k: 'err' }]); return true; }
  const e = p.error || p.gmxError;
  terminal(term, command, errorLines(tool, e, ui.version));
  let h;
  if (p.fix) h = T('common.didYouMean', { fix: `<button type="button" data-from="${esc(p.fix.from)}" data-fix="${esc(p.fix.to)}">${esc(p.fix.to)}</button>` });
  else if (e.lines.some(l => l.startsWith('Unknown'))) h = T('common.unknownOption', { tool });
  else if (e.lines.includes('Option specified multiple times')) h = T('common.optionTwice');
  else h = T('common.badOption');
  notes(coach, [{ h, k: 'err' }]);
  return true;
}

// The command line works like a terminal: edit the command, press Enter (or Run) to run it.
// run({ focus }) is called with focus: true when the student ran it, so a question from
// GROMACS can take the keyboard.
export function commandLine({ run, start }) {
  const cmd = $('cmd');
  const q = params();
  cmd.value = q.get('cmd') || start;
  let ran = cmd.value;
  const box = cmd.closest('.cmd');
  if (!$('cmd-run')) box.querySelector('#cmd-reset')?.insertAdjacentHTML('beforebegin', `<button type="button" id="cmd-run" class="run">${T('common.run')}</button>`);
  const hint = document.createElement('span');
  hint.className = 'cmd-hint';
  hint.innerHTML = T('common.pressEnter');
  hint.hidden = true;
  cmd.after(hint);
  const go = () => { started = true; ran = cmd.value; hint.hidden = true; run({ focus: true }); };
  cmd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  cmd.addEventListener('input', () => { hint.hidden = cmd.value === ran; });
  $('cmd-run').addEventListener('click', go);
  $('cmd-reset')?.addEventListener('click', () => { cmd.value = start; go(); });
  $('coach').addEventListener('click', e => {
    const b = e.target.closest('button[data-fix]');
    if (b) { cmd.value = cmd.value.replace(b.dataset.from, b.dataset.fix); go(); }
  });
  // Commands set by the page's controls count as run.
  return { set(v) { cmd.value = v; ran = v; hint.hidden = true; } };
}

export function tries(el, list, load) {
  if (!SHOW_TRIES) return;
  el.innerHTML = list.map((t, i) => `
    <article class="try">
      <h3>${esc(t.title)}</h3>
      <pre class="try-cmd">${esc(t.cmd)}</pre>
      <p>${t.ask}</p>
      <div class="try-actions"><button type="button" class="load" data-try="${i}">Load this command</button></div>
      <details><summary>Show the answer</summary><p>${t.answer}</p></details>
    </article>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-try]');
    if (!b) return;
    load(list[+b.dataset.try]);
    $('cmd').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  });
}

// "Which step of the script?" buttons for tools the script runs several times.
export function stepPicker(el, tool, sys, current, onPick) {
  const steps = stepsFor(tool);
  el.innerHTML = steps.map(w => `<button type="button" data-key="${w.key}" aria-pressed="${w.key === current}" ${w.md && !sys.hasMD ? `disabled title="${esc(Tplain('common.noMD'))}"` : ''}>${esc(w.key.replace(/^(grompp|trjconv)_/, ''))}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button[data-key]'); if (b && !b.disabled) onPick(WORKFLOW.find(w => w.key === b.dataset.key)); };
}

export function systemPicker(el, systems, current, onPick, needMD = false) {
  el.innerHTML = systems.map(s => `<button type="button" data-id="${s.id}" aria-pressed="${s.id === current}" ${needMD && !s.hasMD ? `disabled title="${esc(Tplain('common.noMD'))}"` : ''}>${esc(s.short)}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button[data-id]'); if (b && !b.disabled) onPick(systems.find(s => s.id === b.dataset.id)); };
}

export const basename = p => p.split('/').pop();

// Group number or name, the way GROMACS reads an answer to "Select a group:".
export function pickGroup(answer, names) {
  if (/^\d+$/.test(answer)) return +answer < names.length ? +answer : -1;
  return names.findIndex(n => n.toLowerCase() === answer.toLowerCase());
}
export const groupNames = lines => lines.filter(l => /^Group\s+\d+/.test(l)).map(g => g.match(/\(\s*(.+?)\)/)[1]);
