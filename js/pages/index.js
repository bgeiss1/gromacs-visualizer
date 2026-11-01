// The workflow overview: every command of the workflow, grouped into stages, each linking to its page.
// Commands that ask questions show the question and the answer the script gives.
import { $, esc, setup, T, loadSystems, WORKFLOW, fill, systemPicker, stepWhat } from '../site.js';

await setup('index');
const STAGES = [
  ['pdb2gmx'],
  ['editconf', 'grompp_em_vac', 'em_vac'],
  ['solvate', 'grompp_ion', 'genion'],
  ['grompp_em_sol', 'trjconv_pdb', 'em_sol'],
  ['grompp_pr', 'pr', 'grompp_md', 'md'],
  ['grompp_longmd', 'longmd'],
  ['trjconv_nojump', 'trjconv_start', 'trjconv_fit', 'trjconv_fitstart']
];

let systems, sys;
async function boot() {
  systems = await loadSystems();
  sys = systems.find(s => s.id === new URLSearchParams(location.search).get('sys')) || systems[0];
  draw();
}

function link(w, s) {
  const key = w.repeat ? 'grompp_em_sol' : w.key;
  return `${w.tool}.html?${new URLSearchParams({ step: key, sys: s.id, cmd: fill(w.cmd, s.id) })}`;
}

function draw() {
  systemPicker($('sys-seg'), systems, sys.id, s => { sys = s; history.replaceState(null, '', `?sys=${s.id}`); draw(); });
  $('sys-note').innerHTML = `${T(`system.${sys.id}.name`)}. ${T(`system.${sys.id}.shape`)}${sys.hasMD ? '' : ' ' + T('index.noMD', { other: systems.find(x => x.hasMD)?.short })}`;
  let n = 0;
  $('flow').innerHTML = STAGES.map((keys, i) => `
    <div class="stage">
      <h2>${T('index.stage' + (i + 1))}</h2>
      ${keys.map(k => {
        const w = WORKFLOW.find(x => x.key === k);
        n++;
        const s = w.md && !sys.hasMD ? systems.find(x => x.hasMD) : sys;
        const asks = w.asks ? `<span class="asks">${w.asks.map(([q, a]) => `<span class="q"><span class="lbl">${T('index.gromacsAsks')}</span> ${esc(q)} <span class="lbl">${T('index.youType')}</span> <b>${esc(a)}</b></span>`).join('')}<span class="why">${T('ask.' + w.key)}</span></span>` : '';
        return `<a class="wstep${w.repeat ? ' repeat' : ''}" href="${link(w, s)}">
          <span class="n">${n}</span>
          <span class="c">${esc(fill(w.cmd, s.id))}</span>
          <span class="go">${w.tool} →</span>
          ${asks}
          <span class="w">${stepWhat(w)}</span>
          <span class="io">${w.makes.map(m => `<span>${esc(fill(m, s.id))}</span>`).join('')}</span>
        </a>`;
      }).join('')}
    </div>`).join('');
}

boot().catch(err => { $('flow').innerHTML = T('index.loadError') + ' ' + esc(err); });
