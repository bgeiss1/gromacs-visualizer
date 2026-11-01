// Small SVG line charts that follow the page theme. One series per chart keeps them readable.

const W = 640, H = 210, L = 62, R = 14, T = 14, B = 34;

function ticks(min, max, n = 5) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
const fmt = v => {
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-2)) return (+v.toPrecision(3)).toExponential().replace('e+', 'e');
  return String(+v.toPrecision(4));
};

// opts: { x, y, xlabel, ylabel, log, hline: { y, label }, yRange: [min, max], cursor, onPick }
export function lineChart(el, opts) {
  const { x, y, log = false } = opts;
  const tr = v => log ? Math.log10(Math.max(v, 1e-12)) : v;
  const ys = y.map(tr);
  let [y0, y1] = opts.yRange ? opts.yRange.map(tr) : [Math.min(...ys), Math.max(...ys)];
  if (opts.hline) { y0 = Math.min(y0, tr(opts.hline.y)); y1 = Math.max(y1, tr(opts.hline.y)); }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const x0 = Math.min(...x), x1 = Math.max(...x) || 1;
  const px = v => L + (v - x0) / (x1 - x0 || 1) * (W - L - R);
  const py = v => T + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (H - T - B);
  const path = ys.map((v, i) => `${i ? 'L' : 'M'}${px(x[i]).toFixed(1)},${py(v).toFixed(1)}`).join('');
  const yt = log ? ticks(Math.ceil(y0), Math.floor(y1), 5).filter(Number.isInteger) : ticks(y0, y1);
  const xt = ticks(x0, x1, 6);
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${opts.ylabel} against ${opts.xlabel}">
      ${yt.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}"/><text class="tick" x="${L - 6}" y="${py(v) + 4}" text-anchor="end">${log ? fmt(10 ** v) : fmt(v)}</text>`).join('')}
      ${xt.map(v => `<text class="tick" x="${px(v)}" y="${H - B + 16}" text-anchor="middle">${fmt(v)}</text>`).join('')}
      <text class="axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${opts.xlabel}</text>
      <text class="axis" x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${opts.ylabel}</text>
      ${opts.hline ? `<line class="target" x1="${L}" x2="${W - R}" y1="${py(tr(opts.hline.y))}" y2="${py(tr(opts.hline.y))}"/><text class="target-label" x="${W - R - 4}" y="${py(tr(opts.hline.y)) - 5}" text-anchor="end">${opts.hline.label}</text>` : ''}
      <path class="series" d="${path}"/>
      <line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <circle class="dot" r="4" visibility="hidden"/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
  const svg = el.querySelector('svg');
  const cursor = svg.querySelector('.cursor'), dot = svg.querySelector('.dot');
  const api = {
    at(xv) {
      let i = 0;
      for (let k = 0; k < x.length; k++) if (Math.abs(x[k] - xv) < Math.abs(x[i] - xv)) i = k;
      const X = px(x[i]);
      cursor.setAttribute('x1', X); cursor.setAttribute('x2', X); cursor.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X); dot.setAttribute('cy', py(ys[i])); dot.setAttribute('visibility', 'visible');
      return i;
    }
  };
  if (opts.onPick) {
    const pick = e => {
      const r = svg.getBoundingClientRect();
      const xv = x0 + ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
      opts.onPick(xv);
    };
    svg.querySelector('.hit').addEventListener('pointerdown', e => { pick(e); svg.setPointerCapture(e.pointerId); svg.onpointermove = pick; });
    svg.addEventListener('pointerup', () => { svg.onpointermove = null; });
  }
  return api;
}
