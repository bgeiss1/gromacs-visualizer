// The 3D view, drawn with 3Dmol.js. Coordinates in the view are Å, with the
// protein held still at the origin; the box moves around it.
/* global $3Dmol */
import { toPdb } from './gro.js';
import { cellShape, unitCell, boxCenter, add, sub, scale, angles, norm, latticeShifts } from './geometry.js';

const BOX = '#5fd4c9', CELL = '#f0b35a', IMAGE = '#8ea4b5';

export class BoxViewer {
  constructor(el) {
    this.v = $3Dmol.createViewer(el, { backgroundColor: '#0b1520', antialias: true, orthographic: true });
    this.images = [];
    this.style = 'cartoon';
  }

  setSystem(sys) {
    this.v.removeAllModels();
    this.v.removeAllShapes();
    this.images = [];
    this.sys = sys;
    const toOrigin = scale(sys.stats.center, -1);
    this.main = this.v.addModel(toPdb(sys.atoms, toOrigin), 'pdb');
    this.toOrigin = toOrigin;
    this.applyStyle();
    this.fit(false);
  }

  applyStyle(style = this.style) {
    this.style = style;
    const m = this.main;
    m.setStyle({}, {});
    if (style === 'atoms') {
      m.setStyle({}, { sphere: { colorscheme: 'Jmol', scale: 1 } });
    } else {
      m.setStyle({}, { cartoon: { color: 'spectrum', thickness: 0.6 } });
      m.setStyle({ elem: 'H', invert: true }, { cartoon: { color: 'spectrum' }, stick: { radius: 0.12, colorscheme: 'Jmol', opacity: 0.85 } });
    }
    this.v.render();
  }

  // r: result of editconf(); show: { images, unitCell }
  update(r, show) {
    const v = this.v;
    v.removeAllShapes();
    for (const m of this.images) v.removeModel(m);
    this.images = [];
    const proteinCenter = add(this.sys.stats.center, r.shift);
    const ang = p => { const q = scale(p, 10); return { x: q[0], y: q[1], z: q[2] }; };
    const cell = cellShape(r.bt, r.vectors);
    const boxMid = sub(boxCenter(r.vectors), proteinCenter);

    const line = (a, b, color, radius, dashed) => v.addCylinder({
      start: ang(a), end: ang(b), radius, color, fromCap: 1, toCap: 1, dashed, dashLength: 1.2, gapLength: 0.9
    });
    for (const [i, j] of cell.edges) line(add(cell.verts[i], boxMid), add(cell.verts[j], boxMid), BOX, 0.32, false);
    if (show.unitCell) {
      const uc = unitCell(r.vectors);
      const origin = scale(proteinCenter, -1);
      for (const [i, j] of uc.edges) line(add(uc.verts[i], origin), add(uc.verts[j], origin), CELL, 0.18, true);
    }
    if (show.images) {
      for (const t of cell.shifts) {
        const m = v.addModel(toPdb(this.sys.atoms, add(this.toOrigin, t), a => a.name === 'CA'), 'pdb');
        m.setStyle({}, { cartoon: { style: 'trace', color: IMAGE, opacity: 0.55, thickness: 0.5 } });
        this.images.push(m);
        for (const [i, j] of cell.edges) line(add(add(cell.verts[i], boxMid), t), add(add(cell.verts[j], boxMid), t), '#3b6f72', 0.08, false);
      }
    }
    if (show.images !== this.lastImages) { this.lastImages = show.images; this.fit(show.images); }
    v.setSlab(-400, 400); // keep the whole box in view; the slab would otherwise clip to the protein
    v.render();
  }

  fit(images) {
    const d = this.sys.diameter;
    this.v.zoomTo({ model: this.main });
    this.v.rotate(-20, 'x');
    this.v.rotate(28, 'y');
    this.v.zoom(images ? d / (2.6 * (d + 2.4)) : d / (d + 5.2));
    this.v.setSlab(-400, 400);
    this.v.render();
  }
}

// ---------- Scene: the general 3D view used by the other pages ----------

const TYPES = [
  { bt: 'dodecahedron', angles: [60, 60, 90] },
  { bt: 'octahedron', angles: [70.53, 109.47, 70.53] }
];
// Which -bt made these box vectors.
export function boxType(v) {
  const a = angles(v);
  if (a.every(x => Math.abs(x - 90) < 0.05)) {
    const l = v.map(norm);
    return Math.abs(l[0] - l[1]) < 1e-3 && Math.abs(l[1] - l[2]) < 1e-3 ? 'cubic' : 'triclinic';
  }
  return TYPES.find(t => t.angles.every((x, i) => Math.abs(x - a[i]) < 0.05))?.bt || 'triclinic';
}

// Moves each point to the periodic copy closest to `center`, like trjconv -ur compact.
export function compact(points, v, center) {
  const shifts = [[0, 0, 0], ...latticeShifts(v)];
  return points.map(p => {
    let best = p, bd = Infinity;
    for (const s of shifts) {
      const q = add(p, s), d = sub(q, center), d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (d2 < bd) { bd = d2; best = q; }
    }
    return best;
  });
}

const ang = p => ({ x: p[0] * 10, y: p[1] * 10, z: p[2] * 10 });

export class Scene {
  constructor(el, { background = '#0b1520' } = {}) {
    this.v = $3Dmol.createViewer(el, { backgroundColor: background, antialias: true, orthographic: true });
    this.origin = [0, 0, 0];
  }
  // Everything is drawn relative to `origin` (nm), usually the box or protein center.
  setOrigin(o) { this.origin = o; }
  clear() { this.v.removeAllModels(); this.v.removeAllShapes(); this.v.removeAllLabels?.(); }
  clearShapes() { this.v.removeAllShapes(); }
  remove(m) { if (m) this.v.removeModel(m); }

  addAtoms(atoms, style, coords) {
    const shift = scale(this.origin, -1);
    const list = coords ? atoms.map((a, i) => ({ ...a, x: coords[i] })) : atoms;
    const m = this.v.addModel(toPdb(list, shift), 'pdb', { keepH: true });
    m.setStyle({}, style);
    return m;
  }

  // Multi-model playback: frames[i].x is a flat Float32Array in nm.
  addFrames(atoms, frames, style) {
    const shift = scale(this.origin, -1);
    const parts = frames.map((f, k) => {
      const list = atoms.map((a, i) => ({ ...a, x: [f.x[3 * i], f.x[3 * i + 1], f.x[3 * i + 2]] }));
      return `MODEL ${String(k + 1).padStart(8)}\n` + toPdb(list, shift).replace(/\nEND$/, '') + '\nENDMDL';
    });
    const m = this.v.addModelsAsFrames(parts.join('\n') + '\nEND\n', 'pdb', { keepH: true });
    m.setStyle({}, style);
    return m;
  }
  async setFrame(i) { await this.v.setFrame(i); this.v.render(); }

  // The box: compact cell (what -bt describes) and/or the unit cell as stored in the file.
  drawBox(v, { cell = true, stored = false, color = '#5fd4c9' } = {}) {
    const o = scale(this.origin, -1);
    const line = (a, b, c, r, dashed) => this.v.addCylinder({ start: ang(add(a, o)), end: ang(add(b, o)), radius: r, color: c, fromCap: 1, toCap: 1, dashed, dashLength: 1.2, gapLength: 0.9 });
    if (cell) {
      const s = cellShape(boxType(v), v), c = boxCenter(v);
      for (const [i, j] of s.edges) line(add(s.verts[i], c), add(s.verts[j], c), color, 0.3, false);
    }
    if (stored) {
      const u = unitCell(v);
      for (const [i, j] of u.edges) line(u.verts[i], u.verts[j], '#f0b35a', 0.18, true);
    }
  }

  // Zoom so a region `size` nm across, centered on the origin, fills the view.
  frame(size, rotate = true) {
    const h = size / 2;
    const m = this.v.addModel(toPdb([{ resnr: 1, resname: 'DUM', name: 'C', x: [-h, -h, -h] }, { resnr: 1, resname: 'DUM', name: 'C', x: [h, h, h] }]), 'pdb');
    m.setStyle({}, {});
    this.v.zoomTo({ model: m });
    this.v.removeModel(m);
    this.v.zoom(1.6); // zoomTo fits the cube's corners; the content is closer to a sphere
    if (rotate) { this.v.rotate(-20, 'x'); this.v.rotate(28, 'y'); }
    this.v.setSlab(-400, 400);
    this.v.render();
  }
  slab(near, far) { this.v.setSlab(near, far); this.v.render(); }
  render() { this.v.render(); }
}
