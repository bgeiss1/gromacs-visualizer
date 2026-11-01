// Splits the text files GROMACS reads and writes (.gro, .top, .itp, .mdp, .pdb, .log) into labeled
// pieces for the file viewer (files.js). Each piece names a key in data/text.json ("file.top.sec.atoms")
// whose text is shown when the student hovers over it, so the labels can be edited in the dashboard.
// Pure functions, no DOM, so the tests can run them on the real files.

const TEXT_KINDS = ['gro', 'top', 'itp', 'mdp', 'pdb', 'log'];
export const fileKind = name => {
  const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || '';
  return { ext, text: TEXT_KINDS.includes(ext) };
};

const WATER = new Set(['SOL', 'HOH', 'WAT', 'TIP3', 'SPC']);
const ION = new Set(['NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'NA+', 'CL-']);
const group = res => WATER.has(res) ? 'water' : ION.has(res) ? res : 'protein';
const norm = s => s.toLowerCase().replace(/-/g, '_');

// One entry per line: what the line is (role) and, for topologies, which [ section ] it sits in.
export function lineInfo(ext, lines) {
  if (ext === 'gro') {
    const n = parseInt(lines[1], 10) || 0;
    return lines.map((l, i) => i === 0 ? { role: 'title' } : i === 1 ? { role: 'count' }
      : i < n + 2 ? { role: 'atom', grp: group(l.slice(5, 10).trim()) }
      : i === n + 2 && l.trim() ? { role: 'box' } : { role: 'blank' });
  }
  if (ext === 'top' || ext === 'itp') {
    let sec = null, prev = null, inHeader = true;
    return lines.map(l => {
      const t = l.trim();
      let info;
      if (!t) info = { role: 'blank' };
      else if (t.startsWith(';')) {
        info = { role: inHeader ? 'header' : prev?.role === 'section' ? 'colhead' : sec === 'atoms' && /^;\s*residue\s+\d+/.test(t) ? 'residue' : 'comment' };
      } else {
        inHeader = false;
        const m = t.match(/^\[\s*([\w-]+)\s*\]/);
        if (m) { sec = m[1].toLowerCase(); info = { role: 'section', sec }; }
        else if (t.startsWith('#include')) info = { role: 'include', file: (t.match(/"([^"]+)"/) || [])[1] || '' };
        else if (/^#(ifdef|ifndef)\b/.test(t)) info = { role: 'ifdef', name: t.split(/\s+/)[1] || '' };
        else if (/^#(endif|else|define)\b/.test(t)) info = { role: t.slice(1).split(/\s+/)[0], name: t.split(/\s+/)[1] || '' };
        else info = { role: 'row', sec };
      }
      if (info.role !== 'blank' && info.role !== 'header') inHeader = false;
      if (info.role !== 'header' && info.role !== 'section') info.sec ??= sec;
      if (info.role !== 'blank') prev = info;
      return info;
    });
  }
  if (ext === 'mdp') return lines.map(l => !l.trim() ? { role: 'blank' } : l.trim().startsWith(';') ? { role: 'comment' } : /=/.test(l) ? { role: 'param', name: norm(l.split('=')[0].trim()) } : { role: 'comment' });
  if (ext === 'pdb') return lines.map(l => {
    const rec = l.slice(0, 6).trim();
    return !rec ? { role: 'blank' } : rec === 'ATOM' || rec === 'HETATM' ? { role: 'atom', rec, grp: group(l.slice(17, 21).trim()) } : { role: 'rec', rec };
  });
  return lines.map(l => ({ role: l.trim() ? 'line' : 'blank' }));
}

const INCLUDES = [[/forcefield\.itp$/, 'forcefield'], [/posre/, 'posre'], [/(tip3p|tip4p|tip5p|spce?|spc216)\.itp$/, 'water'], [/ions\.itp$/, 'ions']];
const molKey = name => /^Protein/i.test(name) ? 'protein' : WATER.has(name) ? 'water' : ION.has(name.toUpperCase()) ? 'ion' : 'other';

// The labeled pieces of one line: [{ t: text, k: key or null, v: vars, focus }].
// has(key) says whether data/text.json has that key, so missing ones fall back to a general label.
export function segments(ext, line, info, has = () => true) {
  const one = (k, v = {}, focus = false) => [{ t: line, k, v, focus }];
  const pick = (...keys) => keys.find(k => k && has(k)) || keys[keys.length - 1];
  if (info.role === 'blank') return [{ t: line, k: null }];

  if (ext === 'gro') {
    if (info.role === 'title') return one('file.gro.title', {}, true);
    if (info.role === 'count') return one('file.gro.count', { n: line.trim() }, true);
    if (info.role === 'box') return one(line.trim().split(/\s+/).length > 3 ? 'file.gro.boxTric' : 'file.gro.box', {}, true);
    const cols = [[0, 5, 'resnr'], [5, 10, 'resname'], [10, 15, 'atom'], [15, 20, 'atomnr'], [20, 44, 'xyz'], [44, Infinity, 'vel']];
    return cols.map(([a, b, k]) => ({ t: line.slice(a, b), k: `file.gro.${k}` })).filter(s => s.t);
  }

  if (ext === 'top' || ext === 'itp') {
    const sec = info.sec || '';
    switch (info.role) {
      case 'header': return one('file.top.header');
      case 'comment': return one('file.top.comment');
      case 'residue': return one('file.top.residue', {}, false);
      case 'section': return one(pick(`file.top.sec.${sec}`, 'file.top.sec.other'), { name: sec }, true);
      case 'include': {
        const kind = INCLUDES.find(([re]) => re.test(info.file))?.[1] || 'other';
        return one(`file.top.include.${kind}`, { file: info.file }, true);
      }
      case 'ifdef': return one(pick(`file.top.ifdef.${info.name}`, 'file.top.ifdef.other'), { name: info.name }, true);
      case 'endif': case 'else': case 'define': return one(`file.top.${info.role}`, { name: info.name }, true);
      case 'colhead': {
        // Each column name gets its own label where one exists, so students can hover "charge" or "funct".
        const out = [], re = /(\S+)/g;
        let last = 0, m;
        while ((m = re.exec(line))) {
          if (m.index > last) out.push({ t: line.slice(last, m.index), k: null });
          const w = m[1] === ';' ? null : m[1].toLowerCase();
          const k = w && [`file.top.col.${sec}.${w}`, `file.top.col.${w}`].find(has);
          out.push({ t: m[1], k: k || 'file.top.colhead', v: { name: sec } });
          last = m.index + m[1].length;
        }
        if (last < line.length) out.push({ t: line.slice(last), k: null });
        return out;
      }
      case 'row': {
        const [body, ...rest] = line.split(';');
        const comment = rest.length ? ';' + rest.join(';') : '';
        let k;
        if (sec === 'molecules') {
          const name = body.trim().split(/\s+/)[0];
          k = pick(`file.top.mol.${molKey(name)}`, 'file.top.row.molecules');
          return [{ t: body, k, v: { name, n: body.trim().split(/\s+/)[1] || '' }, focus: true }, ...(comment ? [{ t: comment, k: 'file.top.comment' }] : [])];
        }
        const funct = sec.match(/^(bonds|pairs|angles|dihedrals)$/) ? body.trim().split(/\s+/)[{ bonds: 2, pairs: 2, angles: 3, dihedrals: 4 }[sec]] : null;
        k = pick(funct && `file.top.row.${sec}.${funct}`, `file.top.row.${sec}`, 'file.top.row.other');
        const out = [{ t: body, k, v: { name: sec, funct: funct || '' } }];
        if (comment) out.push({ t: comment, k: /qtot/.test(comment) ? 'file.top.qtot' : 'file.top.comment', v: { q: (comment.match(/qtot\s+(\S+)/) || [])[1] || '' } });
        return out;
      }
    }
    return one(null);
  }

  if (ext === 'mdp') {
    if (info.role === 'comment') return one('file.mdp.comment');
    const i = line.indexOf(';');
    const body = i < 0 ? line : line.slice(0, i), comment = i < 0 ? '' : line.slice(i);
    const k = pick(`file.mdp.${info.name}`, 'file.mdp.other');
    const v = { name: line.split('=')[0].trim(), value: body.split('=').slice(1).join('=').trim() };
    return [{ t: body, k, v, focus: true }, ...(comment ? [{ t: comment, k: 'file.mdp.comment' }] : [])];
  }

  if (ext === 'pdb') return info.role === 'atom' ? one('file.pdb.atom', { rec: info.rec }) : one(pick(`file.pdb.${info.rec}`, 'file.pdb.other'), { rec: info.rec }, true);
  return one(null);
}

// Which lines to show at first. Big files are cut down to the parts worth reading: the start of
// each [ section ], and in coordinate files the first atoms plus the places where protein turns
// into water and water into ions. Returns sorted [start, end) ranges.
export function plan(ext, info, { rowsPerSection = 8, firstAtoms = 12, around = 3, headLines = 60, tailLines = 40 } = {}) {
  const n = info.length, keep = new Uint8Array(n);
  const mark = (a, b) => { for (let i = Math.max(0, a); i < Math.min(n, b); i++) keep[i] = 1; };
  if (ext === 'gro' || ext === 'pdb') {
    const atoms = [];
    info.forEach((x, i) => { if (x.role === 'atom') atoms.push(i); else mark(i, i + 1); });
    atoms.slice(0, firstAtoms).forEach(i => mark(i, i + 1));
    for (let j = 1; j < atoms.length; j++) if (info[atoms[j]].grp !== info[atoms[j - 1]].grp) mark(atoms[j] - around, atoms[j] + around);
    atoms.slice(-around).forEach(i => mark(i, i + 1));
  } else if (ext === 'top' || ext === 'itp') {
    let rows = 0;
    info.forEach((x, i) => {
      if (x.role === 'section') rows = 0;
      if (x.role === 'row' || x.role === 'residue') { if (x.sec === 'molecules' || x.sec === 'system' || x.sec === 'moleculetype' || rows++ < rowsPerSection) mark(i, i + 1); }
      else mark(i, i + 1);
    });
  } else if (ext === 'log' && n > headLines + tailLines + 20) {
    mark(0, headLines); mark(n - tailLines, n);
  } else mark(0, n);
  // Small gaps aren't worth a button.
  for (let i = 0; i < n;) {
    if (keep[i]) { i++; continue; }
    let j = i; while (j < n && !keep[j]) j++;
    if (j - i <= 3) mark(i, j);
    i = j;
  }
  const out = [];
  for (let i = 0; i < n;) {
    if (!keep[i]) { i++; continue; }
    let j = i; while (j < n && keep[j]) j++;
    out.push([i, j]); i = j;
  }
  return out;
}

// The .top as it was right after a given step: pdb2gmx writes [ molecules ] with only the protein,
// solvate adds a SOL line and genion takes some SOL away and adds the ions. mols is the molecule
// count of the .gro that step wrote (from files.json).
export function topAt(top, mols) {
  const lines = top.replace(/\s+$/, '').split('\n');
  const at = lines.findIndex(l => /^\[\s*molecules\s*\]/.test(l.trim()));
  if (at < 0 || !mols) return top;
  let end = at + 1;
  const head = [];
  while (end < lines.length && lines[end].trim().startsWith(';')) head.push(lines[end++]);
  const rows = lines.slice(end).filter(l => l.trim() && !l.trim().startsWith(';'));
  const width = rows[0] ? rows[0].search(/\S+\s*$/) : 20;
  const out = Object.entries(mols).map(([name, n]) => {
    const old = rows.find(r => { const w = r.trim().split(/\s+/)[0]; return w === name || (name === 'Protein' && /^Protein/.test(w)); });
    return old ? old.replace(/\d+\s*$/, String(n)) : name.padEnd(Math.max(name.length + 1, width - String(n).length)) + n;
  });
  return [...lines.slice(0, at + 1), ...head, ...out].join('\n') + '\n';
}
