// grompp: .mdp + .gro + .top -> .tpr. The page checks the three inputs the way grompp does
// (files exist, atom counts agree, restraints have a reference, warnings vs -maxwarn) and
// shows the screen output saved from real runs (data/<system>/logs and data/<system>/grompp).
import { parseTop } from '../gro.js';
import { parseCommand, buildCommand } from '../command.js';
import { $, esc, setup, T, loadSystems, text, params, trimLog, terminal, notes, showParseProblem, commandLine, tries, stepPicker, systemPicker, WORKFLOW, fill, filesBefore, hasFile, sameFile, basename, stepWhat, gmxVersion } from '../site.js';
import { showFiles, labeledLines } from '../files.js';

await setup('grompp');

const MDPS = ['em_vac', 'em_sol', 'pr', 'short_md', 'long_md'];
// What the topology's [ molecules ] holds at each point of the script.
// Lines of each .mdp worth pointing at.
const KEY_LINES = {
  em_vac: ['integrator', 'coulombtype', 'nsteps', 'emtol'],
  em_sol: ['integrator', 'coulombtype', 'nsteps', 'emtol'],
  pr: ['define', 'integrator', 'nsteps', 'gen_vel', 'continuation', 'refcoord_scaling'],
  short_md: ['integrator', 'nsteps', 'continuation', 'gen_vel'],
  long_md: ['integrator', 'nsteps', 'nstxout-compressed', 'continuation']
};

const TRIES = [
  {
    title: 'Forget the restraint reference',
    cmd: 'gmx grompp -f ./Functions/pr.mdp -c magainin2_em_sol.gro -p magainin2.top -o magainin2_pr.tpr',
    ask: 'This is the script\'s position-restraint step without <code>-r</code>. What happens, and why does pr.mdp need it when em_sol.mdp didn\'t?',
    answer: 'grompp stops: "Cannot find position restraint file restraint.gro (option -r)". pr.mdp has <code>define = -DPOSRES</code>, which switches on the springs in posre.itp. Each spring needs a point to pull towards, and <code>-r</code> supplies those points. The script uses the same file for <code>-c</code> and <code>-r</code>.'
  },
  {
    title: 'Use yesterday\'s coordinates',
    cmd: 'gmx grompp -f ./Functions/em_sol.mdp -c lysozyme_b4ion.gro -p lysozyme.top -o lysozyme_em_sol.tpr',
    ask: 'Step 8 again, but with the coordinates from before genion. Read the error. Where do the two numbers come from?',
    answer: '58,561 atoms in the .gro (protein + 18,867 waters) but 58,401 in the topology. genion replaced 80 waters (3 atoms each) with 80 single-atom ions, which takes away 160 atoms, and it updated <code>lysozyme.top</code> to match. The coordinates and the topology must come from the same point in the workflow.'
  },
  {
    title: 'Why does step 6 need -maxwarn 1?',
    cmd: 'gmx grompp -f ./Functions/em_sol.mdp -c lysozyme_b4ion.gro -p lysozyme.top -o lysozyme_ion.tpr',
    ask: 'Remove <code>-maxwarn 1</code> from the step that prepares genion. What is the warning about, and is it safe to ignore here?',
    answer: 'PME with a net charge (+8 for lysozyme). It is safe here because this .tpr is never run: genion only reads it to find the water molecules, and genion is the step that removes the charge. In any .tpr you actually run, fix the warning rather than raising <code>-maxwarn</code>.'
  },
  {
    title: 'PME in vacuum',
    cmd: 'gmx grompp -f ./Functions/em_sol.mdp -c lysozyme_b4soln.gro -p lysozyme.top -o lysozyme_em_vac.tpr',
    ask: 'Use the solvated settings for the vacuum minimization. Why does the course use a separate em_vac.mdp?',
    answer: 'em_sol.mdp uses PME, and the protein still carries its full charge before genion, so grompp warns and stops. em_vac.mdp uses a plain cut-off for Coulomb, which only gives a NOTE. (The script has no <code>-maxwarn</code> on this step, so a PME version would stop the whole workflow.)'
  },
  {
    title: 'A typo in the settings path',
    cmd: 'gmx grompp -f ./Functions/em.mdp -c magainin2_b4soln.gro -p magainin2.top -o magainin2_em_vac.tpr',
    ask: 'What does grompp say when the .mdp file isn\'t where you said?',
    answer: '"File \'./Functions/em.mdp\' does not exist or is not accessible." The <code>./Functions/</code> folder has to sit next to where you run the script. Run <code>ls Functions</code> to see the real names.'
  }
];

let systems, step, good = null, line, version;
const cache = {};
const load = path => cache[path] ??= text(path);
const loadJSON = async path => JSON.parse(await load(path));

async function boot() {
  systems = await loadSystems();
  const q = params();
  step = WORKFLOW.find(w => w.key === q.get('step') && w.tool === 'grompp') || WORKFLOW.find(w => w.key === 'grompp_em_vac');
  const sysId = q.get('sys') || 'lysozyme';
  const start = fill(step.cmd, sysId);
  if (!q.get('cmd')) history.replaceState(null, '', `?step=${step.key}&sys=${sysId}`);
  line = commandLine({ run, start });
  $('cmd-reset').onclick = () => { line.set(fill(step.cmd, good?.sys.id || sysId)); run(); };
  tries($('tries'), TRIES, t => { line.set(t.cmd); step = guessStep(t.cmd); run(); });
  $('f-select').innerHTML = MDPS.map(m => `<option value="./Functions/${m}.mdp">${m}.mdp</option>`).join('');
  $('f-select').addEventListener('change', e => edit(o => { o.f = e.target.value; o.set.add('f'); }));
  $('c-select').addEventListener('change', e => edit(o => { o.c = e.target.value; o.set.add('c'); }));
  $('r-select').addEventListener('change', e => edit(o => { if (e.target.value) { o.r = e.target.value; o.set.add('r'); } else o.set.delete('r'); }));
  $('mw-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-mw]');
    if (b) edit(o => { if (+b.dataset.mw) { o.maxwarn = +b.dataset.mw; o.set.add('maxwarn'); } else o.set.delete('maxwarn'); });
  });
  run();
}

// A loaded command picks the script step whose output file it writes.
function guessStep(cmd) {
  const o = cmd.match(/-o\s+(\S+)/)?.[1] || '';
  return WORKFLOW.find(w => w.tool === 'grompp' && !w.repeat && systems.some(s => fill(w.makes[0], s.id) === o)) || step;
}

function edit(change) {
  if (!good) return;
  const o = { ...good.opts, set: new Set(good.opts.set), ignored: [...good.opts.ignored], order: [...good.opts.order] };
  change(o);
  line.set(buildCommand('grompp', o));
  run();
}

// Which point of the script a coordinate file comes from: 0 before solvate, 1 before genion, 2 after.
const coordState = (f, files) => {
  const mols = files[basename(f)]?.mols;
  if (!mols) return null;
  return mols.NA || mols.CL ? 2 : mols.SOL ? 1 : 0;
};

async function run() {
  const command = $('cmd').value;
  const p = parseCommand(command, 'grompp');
  version = await gmxVersion(systems.find(s => command.includes(s.id))?.id || systems[0].id);
  const ui = { term: $('stdout'), coach: $('coach'), command, version };
  if (showParseProblem(p, 'grompp', ui)) return;
  const o = p.opts;
  const sys = systems.find(s => [o.c, o.p, o.o].some(f => basename(f).startsWith(s.id))) || systems[0];
  const M = sys.id;
  version = await gmxVersion(M);
  showFiles(M, step.key);
  const files = await loadJSON(`data/${M}/files.json`);
  const finalTop = parseTop(await load(`data/${M}/${M}.top`));
  const protName = finalTop.molecules[0].name;
  const present = filesBefore(step.key, M);
  const topState = step.state;
  const mdp = MDPS.find(m => sameFile(o.f, `./Functions/${m}.mdp`) || basename(o.f) === `${m}.mdp`);
  const mdpText = mdp ? await load(`workflow/Functions/${mdp}.mdp`) : '';
  const setting = k => mdpText.match(new RegExp(`^${k}\\s*=\\s*([^;\\n]*)`, 'm'))?.[1].trim();

  // The topology as it stands at this step.
  const solN = (await load(`data/${M}/logs/05_solvate.log`)).match(/SOL \(\s*3 atoms\):\s*(\d+)/)?.[1];
  const topMols = topState === 2 ? finalTop.molecules : [{ name: protName, n: 1 }, ...(topState === 1 ? [{ name: 'SOL', n: +solN }] : [])];
  const protAtoms = files[`${M}.gro`].atoms;
  const topAtoms = topMols.reduce((a, m) => a + m.n * (m.name === protName ? protAtoms : m.name === 'SOL' ? 3 : 1), 0);

  const coach = [];
  let out = null, error = null, tpr = true;
  const fileError = async (opt, f) => {
    const log = trimLog(await load(`data/${M}/grompp/nomdp.log`));
    return log.map(l => l.replace('-f', `-${opt}`).replace('./Functions/em.mdp', f));
  };

  // 1. Input files must exist (checked while the command line is parsed).
  const missing = [['f', o.f], ['c', o.c], ['p', o.p], ...(o.set.has('r') ? [['r', o.r]] : [])].find(([k, f]) => !hasFile(present, f) && !(k === 'f' && mdp && hasFile(present, `./Functions/${mdp}.mdp`)));
  if (missing) {
    const [k, f] = missing;
    out = await fileError(k, f);
    error = 'missing';
    const later = WORKFLOW.find(w => w.makes.some(m => sameFile(fill(m, M), f)));
    coach.push({ k: 'err', h: later ? T('grompp.later', { file: esc(f), step: later.key }) : k === 'f' ? T('grompp.mdpFiles', { files: MDPS.map(m => `<code>./Functions/${m}.mdp</code>`).join(', ') }) : T('grompp.notInFolder', { file: esc(f) }) });
  }

  const cState = coordState(o.c, files);
  const cAtoms = files[basename(o.c)]?.atoms;
  const charge = topState === 2 ? 0 : sys.charge;
  const pme = setting('coulombtype') === 'PME';
  const posres = /-DPOSRES/.test(setting('define') || '');
  const warnings = pme && charge ? 1 : 0;
  const maxwarn = o.set.has('maxwarn') ? o.maxwarn : 0;

  // 2. Coordinates and topology must have the same atoms.
  if (!error && cAtoms !== topAtoms) {
    error = 'mismatch';
    out = mismatchLines(o, M, cAtoms, topAtoms, topMols, protName, charge, posres || setting('constraints'));
    const extra = cAtoms - topAtoms;
    coach.push({ k: 'err', h: T('grompp.mismatch', { gro: cAtoms.toLocaleString(), top: topAtoms.toLocaleString(), diff: extra > 0 ? T('grompp.tooFew', { n: extra.toLocaleString() }) : T('grompp.tooMany', { n: (-extra).toLocaleString() }), why: cState < topState ? T('grompp.earlier', { c: esc(basename(o.c)), tool: cState === 0 ? 'solvate' : 'genion', p: esc(basename(o.p)), by: topState === 1 ? 'solvate' : 'genion' }) : T('grompp.laterCoords', { c: esc(basename(o.c)) }) }) });
  }
  // 3. Restraints need a reference.
  if (!error && posres && !o.set.has('r')) {
    error = 'posres';
    out = reorder(trimLog(await load(`data/${M}/grompp/pr_nor.log`)));
    coach.push({ k: 'err', h: T('grompp.posres') });
  }
  // 4. Warnings.
  if (!error && warnings > maxwarn) {
    error = 'maxwarn';
    out = reorder(trimLog(await load(`data/${M}/grompp/${topState === 1 ? 'ion_nomaxwarn' : 'vac_pme'}.log`)));
    coach.push({ k: 'err', h: T('grompp.maxwarn', { q: charge }) + ' ' + T(topState === 1 ? 'grompp.maxwarnIon' : 'grompp.maxwarnOther') });
  }
  if (error) tpr = false;
  else {
    out = await successLines(mdp, topState, cState, M, o);
    if (!out) {
      out = [`<span class="t-dim">${T('grompp.noSaved')}</span>`];
    }
    if (warnings && maxwarn) coach.push({ k: 'warn', h: T('grompp.letThrough', { n: maxwarn }) + ' ' + T(topState === 1 ? 'grompp.letThroughIon' : 'grompp.letThroughOther') });
    else if (maxwarn > warnings) coach.push({ h: T(warnings ? 'grompp.moreThanNeeded' : 'grompp.notNeeded', { n: maxwarn }) });
    if (!posres && o.set.has('r')) coach.push({ h: T('grompp.rIgnored', { mdp }) });
    if (mdp === 'em_vac' && topState > 0) coach.push({ k: 'warn', h: T('grompp.vacWithWater') });
    if ((mdp === 'short_md' || mdp === 'long_md') && !/_(pr|md)\.gro$/.test(o.c)) coach.push({ k: 'warn', h: T('grompp.noVelocities', { mdp, c: esc(basename(o.c)) }) });
    if (mdp && mdp !== step.cmd.match(/Functions\/(\w+)\.mdp/)[1]) coach.push({ h: T('grompp.scriptUses', { mdp: step.cmd.match(/Functions\/(\w+)\.mdp/)[1] }) });
  }

  good = { opts: o, sys };
  terminal(ui.term, command, out.map(l => l.startsWith('<span') ? l : /^(WARNING|Fatal|Too many|Cannot find|number of coord|\s+does not match)/.test(l) ? `<span class="t-err">${esc(l)}</span>` : /^NOTE/.test(l) ? `<span class="t-warn">${esc(l)}</span>` : /^-{20,}|^Program:|^Source file:|^Function:|^Error in user|^Invalid command|^\s+(In command|File|The file|Reason|\(call)/.test(l) && error ? `<span class="t-err">${esc(l)}</span>` : esc(l)));
  notes(ui.coach, coach);
  draw({ o, sys, M, files, mdp, mdpText, setting, topMols, topAtoms, topState, cAtoms, cState, posres, warnings, maxwarn, error, tpr, present, protName, charge });
}

// In a terminal, grompp's progress lines appear before its error box.
function reorder(lines) {
  const a = lines.findIndex(l => /^-{20,}/.test(l)), b = lines.findIndex((l, i) => i > a && /^-{20,}/.test(l));
  if (a < 0 || b < 0) return lines;
  const rest = [...lines.slice(0, a), ...lines.slice(b + 1)].filter(l => !/^GROMACS reminds you/.test(l));
  return [...rest, '', ...lines.slice(a, b + 1)];
}

function mismatchLines(o, M, cAtoms, topAtoms, mols, protName, charge, constraints) {
  return [
    'Generating 1-4 interactions: fudge = 0.5',
    ...(charge ? ['', `NOTE 1 [file ${basename(o.p)}]:`, `  System has non-zero total charge: ${charge.toFixed(6)}`, '  Total charge should normally be an integer. See', '  http://www.gromacs.org/Documentation/Floating_Point_Arithmetic', '  for discussion on how close it should be to an integer.', ''] : []),
    'Generated 2211 of the 2211 non-bonded parameter combinations',
    'Generated 2211 of the 2211 1-4 parameter combinations',
    ...mols.flatMap(m => [`Excluding ${m.name === protName ? 3 : m.name === 'SOL' ? 2 : 1} bonded neighbours molecule type '${m.name}'`, ...(constraints ? ['turning H bonds into constraints...'] : [])]),
    '',
    '-------------------------------------------------------',
    `Program:     gmx grompp, version ${version}`,
    'Source file: src/gromacs/gmxpreprocess/grompp.cpp (line 706)',
    '',
    'Fatal error:',
    `number of coordinates in coordinate file (${basename(o.c)}, ${cAtoms})`,
    `             does not match topology (${basename(o.p)}, ${topAtoms})`,
    '',
    'For more information and tips for troubleshooting, please check the GROMACS',
    'website at http://www.gromacs.org/Documentation/Errors',
    '-------------------------------------------------------'
  ];
}

// The saved output of the script step that ran this exact combination, if there is one.
async function successLines(mdp, topState, cState, M, o) {
  const match = WORKFLOW.find(w => w.tool === 'grompp' && !w.repeat && w.state === topState && w.cmd.includes(`/${mdp}.mdp`));
  if (match && cState === topState) {
    try { return trimLog(await load(`data/${M}/logs/${match.log}.log`)).map(l => l.replace(fill(match.makes[0], M), basename(o.o))); } catch { /* no MD logs for this system */ }
  }
  if (mdp === 'em_vac' && topState === 0) return trimLog(await load(`data/${M}/grompp/vac_ok.log`));
  if (mdp === 'em_sol' && topState === 0) { // the PME warning, let through by -maxwarn
    const l = trimLog(await load(`data/${M}/grompp/vac_pme.log`));
    const a = l.findIndex(x => /^-{20,}/.test(x)), b = l.findIndex((x, i) => i > a && /^-{20,}/.test(x));
    return [...l.slice(0, a), ...l.slice(b + 1)];
  }
  return null;
}

function draw(s) {
  const { o, sys, M, files, mdp, mdpText, setting, topMols, topAtoms, topState, cAtoms, cState, posres, warnings, maxwarn, error, present } = s;
  stepPicker($('step-seg'), 'grompp', sys, step.key, w => { step = w; line.set(fill(w.cmd, M)); history.replaceState(null, '', `?step=${w.key}&sys=${M}`); run(); });
  systemPicker($('sys-seg'), systems, M, x => { line.set(fill(step.cmd, x.id)); history.replaceState(null, '', `?step=${step.key}&sys=${x.id}`); run(); }, step.md);
  $('step-note').innerHTML = T('common.stepOf', { n: WORKFLOW.indexOf(step) + 1, what: stepWhat(step) });
  const gros = [...present].filter(f => f.endsWith('.gro') && files[basename(f)]);
  $('f-select').value = mdp ? `./Functions/${mdp}.mdp` : '';
  const opt = (list, v) => list.map(f => `<option value="${esc(f)}"${f === v ? ' selected' : ''}>${esc(f)}</option>`).join('');
  $('c-select').innerHTML = opt(gros.includes(o.c) ? gros : [o.c, ...gros], o.c);
  $('r-select').innerHTML = `<option value="">${T('grompp.card.none')}</option>` + opt(gros, o.set.has('r') ? o.r : '');
  $('r-select').value = o.set.has('r') ? o.r : '';
  for (const b of $('mw-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.mw === maxwarn));
  $('mw-val').innerHTML = T(warnings === 1 ? 'grompp.warning1' : 'grompp.warnings', { n: warnings, m: maxwarn });

  const molChips = mols => Object.entries(mols).map(([k, n]) => `<span>${esc(k)}${k === 'Protein' ? '' : ` × ${n.toLocaleString()}`}</span>`).join('');
  const cInfo = files[basename(o.c)];
  const steps = mdp ? (+setting('nsteps')) : 0, dt = +(setting('dt') || 0);
  const mdpDesc = !mdp ? T('grompp.mdp.notFound') : setting('integrator') === 'steep' ? T('grompp.mdp.min', { n: steps.toLocaleString(), coul: setting('coulombtype') }) : T('grompp.mdp.md', { ps: (steps * dt).toLocaleString(), n: steps.toLocaleString(), fs: dt * 1000 }) + (posres ? T('grompp.mdp.restrained') : '');
  $('pack').innerHTML = `
    <div class="ins">
      <div class="card ${error === 'missing' && !mdp ? 'bad' : warnings > maxwarn && !error?.match(/missing|mismatch|posres/) ? 'warn' : ''}">
        <div class="k"><span>${T('grompp.card.f')}</span><span>${warnings ? T('grompp.card.warning', { n: warnings }) : ''}</span></div>
        <div class="fn">${esc(o.f)}</div><div class="d">${mdpDesc}</div>
      </div>
      <div class="card ${!cInfo ? 'bad' : error === 'mismatch' ? 'bad' : ''}">
        <div class="k"><span>${T('grompp.card.c')}</span><span>${cInfo ? T('grompp.card.atoms', { n: cInfo.atoms.toLocaleString() }) : T('grompp.card.missing')}</span></div>
        <div class="fn">${esc(o.c)}</div>
        ${cInfo ? `<div class="mols">${molChips(cInfo.mols)}</div>` : ''}
      </div>
      <div class="card ${posres ? (o.set.has('r') ? '' : 'bad') : 'off'}">
        <div class="k"><span>${T('grompp.card.r')}</span><span>${T(posres ? 'grompp.card.needed' : 'grompp.card.notUsed')}</span></div>
        <div class="fn">${o.set.has('r') ? esc(o.r) : T('grompp.card.none')}</div>
        <div class="d">${T(posres ? 'grompp.card.rUsed' : 'grompp.card.rUnused')}</div>
      </div>
      <div class="card ${error === 'mismatch' ? 'bad' : ''}">
        <div class="k"><span>${T('grompp.card.p')}</span><span>${T('grompp.card.atoms', { n: topAtoms.toLocaleString() })}</span></div>
        <div class="fn">${esc(o.p)}</div>
        <div class="mols">${topMols.map(m => `<span>${esc(m.name)}${m.n > 1 ? ` × ${m.n.toLocaleString()}` : ''}</span>`).join('')}</div>
      </div>
    </div>
    <div class="arrow" aria-hidden="true">→</div>
    <div class="card out ${error ? 'none' : ''}">
      <div class="k"><span>${T('grompp.card.o')}</span><span>${T(error ? 'grompp.card.notWritten' : 'grompp.card.ready')}</span></div>
      <div class="fn">${esc(o.o)}</div>
      <div class="d">${error ? T('grompp.card.err.' + error) : T('grompp.card.package', { n: (cAtoms || 0).toLocaleString() })}</div>
    </div>
    ${cInfo ? `<div class="match ${cAtoms === topAtoms ? 'ok' : 'bad'}"><span>${T('grompp.match.gro', { file: esc(basename(o.c)) })}</span><span class="mono">${cAtoms.toLocaleString()}</span><span>${T('grompp.match.top')}</span><span class="mono">${topAtoms.toLocaleString()}</span></div>` : ''}`;

  const rows = [
    [T('grompp.rows.match'), !cInfo ? '' : cAtoms === topAtoms ? T('grompp.rows.yes') : `<span style="color:var(--bad)">${T('grompp.rows.no')}</span>`],
    [T('grompp.rows.charge'), `${s.charge ? '+' + s.charge : '0'} e<span class="sub">${T(s.charge ? 'grompp.rows.ionsLater' : 'grompp.rows.neutralized')}</span>`],
    [T('grompp.rows.coulomb'), mdp ? `${setting('coulombtype')}` : ''],
    [T('grompp.rows.posres'), T(posres ? (o.set.has('r') ? 'grompp.rows.on' : 'grompp.rows.onNoR') : 'grompp.rows.off')],
    [T('grompp.rows.warnings'), `${warnings} / ${maxwarn}`],
    [T('grompp.rows.output'), error ? T('grompp.rows.none') : `<span class="mono">${esc(basename(o.o))}</span>`]
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  $('mdp-name').textContent = o.f;
  const keys = KEY_LINES[mdp] || [];
  const mdpLines = mdpText.trimEnd().split('\n'), labeled = mdp ? labeledLines('mdp', mdpText) : [];
  $('mdp-text').innerHTML = mdp ? mdpLines.map((l, i) => keys.some(k => l.startsWith(k + ' ') || l.startsWith(k + '\t')) ? `<span class="hl">${labeled[i]}</span>` : labeled[i]).join('\n') : T('grompp.mdpMissing');
  $('top-name').textContent = o.p;
  $('top-note').innerHTML = T('grompp.topNote', { state: T('grompp.state' + topState) });
  $('top-text').innerHTML = [`; ... ${topState ? 'force field, protein, water and ion includes' : 'force field, protein and water includes'} ...`, '', '[ system ]', esc(sys.name), '', '[ molecules ]', '; Compound        #mols',
    ...topMols.map((m, i) => { const l = `${m.name.padEnd(16)}${String(m.n).padStart(6)}`; return (i && topState) ? `<span class="add">${esc(l)}</span>` : esc(l); })].join('\n');
}

boot().catch(err => { $('stdout').innerHTML = T('common.loadError') + '\n\n' + esc(err); });
