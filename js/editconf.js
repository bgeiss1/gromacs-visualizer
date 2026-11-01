// What `gmx editconf` does to a structure, following GROMACS 2023 (src/gromacs/gmxpreprocess/editconf.cpp).

import { stats, diameter, boxVectors, rectVectors, volume, boxCenter, angles, norm, sub } from './geometry.js';

const f3 = x => x.toFixed(3).padStart(7);
const f2 = x => x.toFixed(2).padStart(7);
const g6 = x => String(Number(x.toPrecision(6)));
const PAD = ' '.repeat(15);

// sys: { atoms, box, stats, diameter } ; o: options from parseCommand
export function editconf(sys, o) {
  const setD = o.set.has('d'), setBox = o.set.has('box');
  const bt = o.set.has('bt') ? o.bt : 'triclinic';
  const centered = o.set.has('c') ? o.c : (setD || setBox);
  const { size, center } = sys.stats;
  const diam = sys.diameter;

  let vectors = sys.box;
  if (bt === 'triclinic') {
    if (setD) vectors = rectVectors(size.map(s => s + 2 * o.d));
    else if (setBox) vectors = rectVectors(o.box);
  } else if (setBox) vectors = boxVectors(bt, o.box[0]);
  else if (setD) vectors = boxVectors(bt, diam + 2 * o.d);

  const newCenter = centered ? boxCenter(vectors) : center;
  const shift = centered ? sub(newCenter, center) : [0, 0, 0];

  const oldV = volume(sys.box);
  const out = [
    `Read ${sys.atoms.length} atoms`,
    `Volume: ${g6(oldV)} nm^3, corresponds to roughly ${Math.floor(oldV * 4.5) * 100} electrons`,
    'No velocities found'
  ];
  if (centered || setD) {
    out.push(`    system size :${size.map(f3).join('')} (nm)`);
    if (bt !== 'triclinic' && (setD || setBox)) out.push(`    diameter    :${f3(diam)}${PAD}(nm)`);
    out.push(`    center      :${center.map(f3).join('')} (nm)`);
    out.push(`    box vectors :${sys.box.map(v => f3(norm(v))).join('')} (nm)`);
    out.push(`    box angles  :${angles(sys.box).map(f2).join('')} (degrees)`);
    out.push(`    box volume  :${f2(oldV)}${PAD}(nm^3)`);
  }
  if (centered) out.push(`    shift       :${shift.map(f3).join('')} (nm)`);
  if (centered || setD) out.push(`new center      :${newCenter.map(f3).join('')} (nm)`);
  if (setD || setBox) {
    out.push(`new box vectors :${vectors.map(v => f3(norm(v))).join('')} (nm)`);
    out.push(`new box angles  :${angles(vectors).map(f2).join('')} (degrees)`);
    out.push(`new box volume  :${f2(volume(vectors))}${PAD}(nm^3)`);
  }
  const warnings = [];
  if (setD && !o.set.has('bt')) {
    warnings.push('WARNING: No boxtype specified - distance condition applied in each dimension.',
      'If the molecule rotates the actual distance will be smaller. You might want',
      'to use a cubic box instead, or why not try a dodecahedron today?');
  }
  return { bt, vectors, centered, shift, newCenter, diameter: diam, size, center, stdout: out, warnings, changedBox: setD || setBox };
}

export function prepareSystem(gro) {
  const xs = gro.atoms.map(a => a.x);
  return { ...gro, stats: stats(xs), diameter: diameter(xs) };
}
