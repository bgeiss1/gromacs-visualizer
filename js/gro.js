// Reading and writing GROMACS .gro files, and turning atoms into PDB text for the viewer.

export function parseGro(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const n = parseInt(lines[1], 10);
  const atoms = [];
  for (let i = 0; i < n; i++) {
    const l = lines[2 + i];
    atoms.push({
      resnr: parseInt(l.slice(0, 5), 10),
      resname: l.slice(5, 10).trim(),
      name: l.slice(10, 15).trim(),
      x: [parseFloat(l.slice(20, 28)), parseFloat(l.slice(28, 36)), parseFloat(l.slice(36, 44))]
    });
  }
  const box = lines[2 + n].trim().split(/\s+/).map(Number);
  return { title: lines[0].trim(), atoms, box: boxFromGro(box) };
}

// The last line of a .gro file: v1(x) v2(y) v3(z) v1(y) v1(z) v2(x) v2(z) v3(x) v3(y).
export function boxFromGro(b) {
  if (b.length < 9) return [[b[0], 0, 0], [0, b[1], 0], [0, 0, b[2]]];
  return [[b[0], b[3], b[4]], [b[5], b[1], b[6]], [b[7], b[8], b[2]]];
}

export function groBoxLine(v) {
  const f = x => (Math.abs(x) < 5e-6 ? 0 : x).toFixed(5).padStart(10);
  const vals = [v[0][0], v[1][1], v[2][2]];
  const off = [v[0][1], v[0][2], v[1][0], v[1][2], v[2][0], v[2][1]];
  if (off.some(x => Math.abs(x) >= 5e-6)) vals.push(...off);
  return vals.map(f).join('');
}

export const isHydrogen = a => /^[0-9]*H/.test(a.name);

const RESNAME = { HISA: 'HIS', HISB: 'HIS', HISD: 'HIS', HISE: 'HIS', HISH: 'HIS', HID: 'HIS', HIE: 'HIS', HIP: 'HIS', LYSH: 'LYS', LYN: 'LYS', CYX: 'CYS', CYS2: 'CYS', ASH: 'ASP', GLH: 'GLU' };
const STD = new Set(['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL']);
function pdbResname(r) {
  if (RESNAME[r]) return RESNAME[r];
  if (r.length === 4 && /^[NC]/.test(r)) { const s = r.slice(1); return RESNAME[s] || s; }
  return STD.has(r) ? r : r.slice(0, 3);
}

// PDB text in Ångström (the viewer's unit), coordinates = x + shift (nm).
export function toPdb(atoms, shift = [0, 0, 0], keep = () => true) {
  const out = [];
  let serial = 0;
  for (const a of atoms) {
    if (!keep(a)) continue;
    serial++;
    const name = a.name.length < 4 ? ' ' + a.name.padEnd(3) : a.name.slice(0, 4);
    const el = (a.name.match(/[A-Z]/) || ['C'])[0];
    const xyz = [0, 1, 2].map(k => ((a.x[k] + shift[k]) * 10).toFixed(3).padStart(8)).join('');
    out.push(`ATOM  ${String(serial % 100000).padStart(5)} ${name} ${pdbResname(a.resname).padEnd(3)} A${String(a.resnr % 10000).padStart(4)}    ${xyz}  1.00  0.00          ${el.padStart(2)}`);
  }
  out.push('END');
  return out.join('\n');
}

// A multi-frame .gro (as trjconv writes it): shared atom list, one coordinate array per frame.
export function parseGroFrames(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const frames = [];
  let atoms = null;
  for (let i = 0; i + 1 < lines.length && lines[i] !== '';) {
    const title = lines[i];
    const n = parseInt(lines[i + 1], 10);
    if (!n) break;
    const x = new Float32Array(n * 3);
    const first = !atoms;
    if (first) atoms = [];
    for (let j = 0; j < n; j++) {
      const l = lines[i + 2 + j];
      x[3 * j] = parseFloat(l.slice(20, 28)); x[3 * j + 1] = parseFloat(l.slice(28, 36)); x[3 * j + 2] = parseFloat(l.slice(36, 44));
      if (first) atoms.push({ resnr: parseInt(l.slice(0, 5), 10), resname: l.slice(5, 10).trim(), name: l.slice(10, 15).trim(), x: [x[3 * j], x[3 * j + 1], x[3 * j + 2]] });
    }
    const t = title.match(/t=\s*([-\d.eE+]+)/);
    const step = title.match(/step=\s*(\d+)/);
    frames.push({ t: t ? parseFloat(t[1]) : frames.length, step: step ? +step[1] : null, x, box: boxFromGro(lines[i + 2 + n].trim().split(/\s+/).map(Number)) });
    i += n + 3;
  }
  return { atoms, frames };
}

// xmgrace .xvg: legends and columns.
export function parseXvg(text) {
  const legends = [], rows = [];
  let xlabel = '';
  for (const l of text.split('\n')) {
    if (l.startsWith('@')) {
      const m = l.match(/^@ s(\d+) legend "(.*)"/);
      if (m) legends[+m[1]] = m[2];
      const x = l.match(/xaxis\s+label "(.*)"/);
      if (x) xlabel = x[1];
    } else if (l.trim() && !l.startsWith('#')) rows.push(l.trim().split(/\s+/).map(Number));
  }
  const cols = rows.length ? rows[0].map((_, k) => rows.map(r => r[k])) : [];
  return { xlabel, x: cols[0] || [], series: legends.map((name, k) => ({ name, y: cols[k + 1] || [] })) };
}

// The [ molecules ] section and #include lines of a .top file.
export function parseTop(text) {
  const includes = [...text.matchAll(/^#include "([^"]+)"/gm)].map(m => m[1]);
  const i = text.lastIndexOf('[ molecules ]');
  const molecules = [];
  if (i >= 0) for (const l of text.slice(i).split('\n').slice(1)) {
    const s = l.split(';')[0].trim();
    if (!s) continue;
    if (s.startsWith('[')) break;
    const [name, n] = s.split(/\s+/);
    molecules.push({ name, n: +n });
  }
  return { includes, molecules };
}
