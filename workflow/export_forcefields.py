#!/usr/bin/env python3
"""Writes forcefields.json for the pdb2gmx page: the force fields in the order pdb2gmx lists them
(read from a pdb2gmx screen log), each with its folder name (for -ff) and its water models.

    python3 export_forcefields.py $GMXDATA/top site-data/<name>/pdb2gmx/ff1.log forcefields.json
"""
import json, re, sys
from pathlib import Path

top, log, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
# The menu lines: " 1: AMBER03 protein, nucleic AMBER94 (...)"
menu = []
for line in log.read_text().splitlines():
    m = re.match(r'^\s*(\d+): (.+)$', line)
    if m and int(m.group(1)) == len(menu) + 1:
        menu.append(m.group(2).strip())
    elif menu and line.startswith('{{'):
        break
by_label = {}
for d in sorted(top.glob('*.ff')):
    doc = d / 'forcefield.doc'
    if doc.exists():
        by_label[doc.read_text().splitlines()[0].strip()] = d
ffs = []
for n, label in enumerate(menu, 1):
    d = by_label.get(label)
    if d is None:
        sys.exit(f'no force field folder in {top} has the label: {label}')
    waters = []
    wm = d / 'watermodels.dat'
    if wm.exists():
        for w in wm.read_text().splitlines():
            parts = w.split(None, 2)
            if len(parts) >= 2 and not w.startswith(';'):
                waters.append({'id': parts[0], 'name': parts[1], 'desc': parts[2].strip() if len(parts) > 2 else ''})
    ffs.append({'n': n, 'dir': d.name[:-3], 'label': label, 'waters': waters})
out.write_text(json.dumps(ffs, indent=1) + '\n')
print(f'{out}: {len(ffs)} force fields')
