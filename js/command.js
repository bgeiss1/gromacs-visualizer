// Parses a typed `gmx <tool> ...` line the way GROMACS 2023 does, including its error text.
// Each tool lists its options in js/specs.js.

import { SPECS, TOOLS } from './specs.js';

const isNum = s => s !== undefined && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
const isInt = s => s !== undefined && /^[-+]?\d+$/.test(s);
const optError = (opt, ...lines) => ({ title: 'Invalid command-line options', lines: [`In command-line option -${opt}`, ...lines] });

// tool: the tool this page shows. Returns { opts } or a description of what went wrong.
export function parseCommand(text, tool = 'editconf') {
  const t = text.trim().split(/\s+/).filter(Boolean);
  if (!t.length) return { empty: true };
  if (t[0] !== 'gmx' && t[0] !== 'gmx_mpi') {
    const known = TOOLS.includes(t[0]);
    return { shell: `bash: ${t[0]}: command not found`, hint: known ? `Every GROMACS tool runs through <code>gmx</code>: try <code>gmx ${t[0]} …</code>.` : `Start with <code>gmx ${tool}</code>.` };
  }
  const name = t[1];
  if (!name) return { hint: `Name a tool after <code>gmx</code>, for example <code>gmx ${tool}</code>.` };
  if (name !== tool) {
    if (TOOLS.includes(name)) return { other: name };
    return { gmxError: { title: `'${name}' is not a GROMACS command.`, lines: [] } };
  }
  const spec = SPECS[tool];
  const opts = { set: new Set(), ignored: [], order: [] };
  for (const [k, s] of Object.entries(spec)) if (s.def !== undefined) opts[k] = s.def;
  const seen = new Set();
  for (let i = 2; i < t.length; i++) {
    const tok = t[i];
    if (!tok.startsWith('-') || isNum(tok)) return { error: { title: 'Invalid command-line options', lines: [`Unexpected value: ${tok}`] }, tool };
    let key = tok.slice(1);
    let boolValue = true;
    if (!spec[key] && key.startsWith('no') && spec[key.slice(2)]?.kind === 'bool') { key = key.slice(2); boolValue = false; }
    const s = spec[key];
    if (!s) return { error: { title: 'Invalid command-line options', lines: [`Unknown command-line option ${tok}`] }, tool };
    if (seen.has(key)) return { error: optError(boolValue ? key : 'no' + key, 'Option specified multiple times'), tool };
    seen.add(key);

    let value;
    const next = t[i + 1];
    if (s.kind === 'bool') {
      if (['yes', 'no', 'true', 'false'].includes(next)) boolValue = ['yes', 'true'].includes(t[++i]) === boolValue;
      value = boolValue;
    } else if (s.kind === 'real' || s.kind === 'int') {
      if (next === undefined || (next.startsWith('-') && !isNum(next))) return { error: optError(key, 'Too few (valid) values'), tool };
      i++;
      if (!(s.kind === 'int' ? isInt(next) : isNum(next))) return { error: optError(key, `Invalid value: '${next}'; expected ${s.kind === 'int' ? 'an integer' : 'a number'}`), tool };
      value = parseFloat(next);
    } else if (s.kind === 'rvec') {
      const vals = [];
      while (isNum(t[i + 1])) vals.push(parseFloat(t[++i]));
      if (!vals.length) return { error: optError(key, 'Too few (valid) values'), tool };
      if (vals.length !== 1 && vals.length !== 3) return { error: optError(key, `Expected 1 or 3 values, got ${vals.length}`), tool };
      value = vals.length === 1 ? [vals[0], vals[0], vals[0]] : vals;
    } else if (s.kind === 'enum') {
      if (next === undefined || next.startsWith('-')) return { error: optError(key, 'Too few (valid) values'), tool };
      i++;
      const matches = s.values.filter(x => x.startsWith(next));
      if (!s.values.includes(next) && matches.length !== 1) {
        const fix = s.values.find(x => x.slice(0, 3) === next.toLowerCase().slice(0, 3));
        return { error: optError(key, `Invalid value: ${next}`), fix: fix ? { from: `-${key} ${next}`, to: `-${key} ${fix}` } : null, tool };
      }
      value = s.values.includes(next) ? next : matches[0];
    } else { // file or string
      if (next === undefined || next.startsWith('-')) return { error: optError(key, 'Too few (valid) values'), tool };
      value = t[++i];
    }
    if (s.shown === false) opts.ignored.push(tok, ...(s.kind === 'bool' ? [] : [Array.isArray(value) ? value.join(' ') : String(value)]));
    else { opts[key] = value; opts.set.add(key); opts.order.push(key); }
  }
  return { tool, opts };
}

// Writes options back as a command line: options in the order they were typed,
// then any new ones in the order of the tool's spec.
export function buildCommand(tool, o) {
  const p = ['gmx', tool];
  const keys = [...(o.order || []).filter(k => o.set.has(k)), ...Object.keys(SPECS[tool]).filter(k => o.set.has(k) && !(o.order || []).includes(k))];
  for (const k of keys) {
    const s = SPECS[tool][k];
    if (s.kind === 'bool') p.push(o[k] ? `-${k}` : `-no${k}`);
    else if (s.kind === 'rvec') p.push(`-${k}`, ...(o[k].every(x => x === o[k][0]) ? [o[k][0]] : o[k]).map(fmt));
    else if (s.kind === 'real') p.push(`-${k}`, fmt(o[k]));
    else p.push(`-${k}`, String(o[k]));
  }
  return p.concat(o.ignored).join(' ');
}
const fmt = x => String(Math.round(x * 1000) / 1000);
