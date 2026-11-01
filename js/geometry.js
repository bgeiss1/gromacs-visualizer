// Box math for gmx editconf. Box vectors follow GROMACS: rows v1, v2, v3, lower triangular, in nm.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = a => Math.sqrt(dot(a, a));

export function stats(xs) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
  for (const x of xs) for (let k = 0; k < 3; k++) {
    if (x[k] < min[k]) min[k] = x[k];
    if (x[k] > max[k]) max[k] = x[k];
    sum[k] += x[k];
  }
  return { min, max, size: sub(max, min), center: scale(sum, 1 / xs.length) };
}

// Largest distance between any two atoms, as editconf reports it.
export function diameter(xs) {
  let best = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    for (let j = i + 1; j < xs.length; j++) {
      const b = xs[j], dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > best) best = d2;
    }
  }
  return Math.sqrt(best);
}

export const BOX_TYPES = ['triclinic', 'cubic', 'dodecahedron', 'octahedron'];

// Box vectors for a box type with image distance L (nm).
export function boxVectors(bt, L) {
  if (bt === 'dodecahedron') return [[L, 0, 0], [0, L, 0], [L / 2, L / 2, L * Math.SQRT1_2]];
  if (bt === 'octahedron') return [[L, 0, 0], [L / 3, 2 * Math.SQRT2 * L / 3, 0], [-L / 3, Math.SQRT2 * L / 3, Math.sqrt(6) * L / 3]];
  return [[L, 0, 0], [0, L, 0], [0, 0, L]];
}
export const rectVectors = d => [[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]];

export function det(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}
export const volume = v => Math.abs(det(v));
export const boxCenter = v => scale(add(add(v[0], v[1]), v[2]), 0.5);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180 / Math.PI;
// alpha (v2,v3), beta (v1,v3), gamma (v1,v2)
export const angles = v => [angle(v[1], v[2]), angle(v[0], v[2]), angle(v[0], v[1])];

function inverse(m) {
  const d = det(m);
  const c = (r1, c1, r2, c2) => m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1];
  return [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d]
  ];
}
const matmul = (a, b) => a.map(row => [0, 1, 2].map(j => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const apply = (m, x) => [dot(m[0], x), dot(m[1], x), dot(m[2], x)];
const transpose = m => [0, 1, 2].map(i => [m[0][i], m[1][i], m[2][i]]);

function signedPerms(base) {
  const out = new Map();
  for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    for (let s = 0; s < 8; s++) {
      const v = [0, 1, 2].map(i => base[p[i]] * ((s >> i) & 1 ? -1 : 1) + 0);
      out.set(v.join(','), v);
    }
  }
  return [...out.values()];
}
function edgesAt(verts, len2) {
  const e = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    const d = sub(verts[i], verts[j]);
    if (Math.abs(dot(d, d) - len2) < 1e-6) e.push([i, j]);
  }
  return e;
}

// Wigner-Seitz cells in a symmetric frame: the solid each box type stands for.
// basis = three lattice vectors that map onto GROMACS's v1, v2, v3.
const CELLS = {
  dodecahedron: {
    verts: [...signedPerms([1, 1, 1]), ...signedPerms([2, 0, 0])], edge2: 3,
    lattice: signedPerms([2, 2, 0]), basis: [[2, 0, 2], [2, 0, -2], [2, 2, 0]]
  },
  octahedron: {
    verts: signedPerms([0, 1, 2]), edge2: 2,
    lattice: [...signedPerms([2, 2, 2]), ...signedPerms([4, 0, 0])], basis: [[2, 2, 2], [2, 2, -2], [2, -2, -2]]
  }
};
for (const c of Object.values(CELLS)) c.edges = edgesAt(c.verts, c.edge2);

function parallelepiped(v, centered) {
  const verts = [];
  for (let s = 0; s < 8; s++) {
    const f = [0, 1, 2].map(i => ((s >> i) & 1) ? 1 : 0);
    let p = [0, 0, 0];
    for (let i = 0; i < 3; i++) p = add(p, scale(v[i], centered ? f[i] - 0.5 : f[i]));
    verts.push(p);
  }
  const edges = [];
  for (let a = 0; a < 8; a++) for (let i = 0; i < 3; i++) { const b = a | (1 << i); if (b !== a) edges.push([a, b]); }
  return { verts, edges };
}

// The box as students should picture it, centered on the origin, plus the
// translations to the neighbouring periodic copies.
export function cellShape(bt, v) {
  const cell = CELLS[bt];
  if (!cell) {
    const shifts = [];
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) shifts.push(scale(v[i], s));
    return { ...parallelepiped(v, true), shifts };
  }
  // rotation R with R * basis_i = v_i
  const R = matmul(transpose(v), inverse(transpose(cell.basis)));
  return {
    verts: cell.verts.map(p => apply(R, p)),
    edges: cell.edges,
    shifts: cell.lattice.map(p => apply(R, p)),
    rotation: R
  };
}

// The unit cell exactly as stored in the .gro file: from the origin along v1, v2, v3.
export const unitCell = v => parallelepiped(v, false);

// All 26 neighbouring lattice translations (n1 v1 + n2 v2 + n3 v3, each n in -1..1).
export function latticeShifts(v) {
  const out = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    if (a || b || c) out.push(add(add(scale(v[0], a), scale(v[1], b)), scale(v[2], c)));
  }
  return out;
}

// Closest distance between an atom and any atom of a periodic copy.
export function closestImage(xs, shifts, diam) {
  let best = Infinity;
  for (const t of shifts) {
    if (norm(t) - diam >= best) continue;
    for (let i = 0; i < xs.length; i++) {
      const a = xs[i], ax = a[0] - t[0], ay = a[1] - t[1], az = a[2] - t[2];
      for (let j = 0; j < xs.length; j++) {
        const b = xs[j], dx = ax - b[0], dy = ay - b[1], dz = az - b[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best * best) best = Math.sqrt(d2);
      }
    }
  }
  return best;
}
