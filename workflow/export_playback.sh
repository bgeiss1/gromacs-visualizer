#!/usr/bin/env bash
# After run_workflow.sh, packs what the visualizer needs into site-data/$MDPDB/.
# Copy that folder to the visualizer's data/ folder afterwards.
#
#   MDPDB=magainin2 bash export_playback.sh
#
# Steps whose files are missing (for example the MD runs, if you stopped
# early with STOP_AFTER) are skipped.
set -uo pipefail
: "${MDPDB:?set MDPDB}"
out=site-data/$MDPDB
mkdir -p $out/logs
have() { [ -e "$1" ]; }

# Structures from the setup steps, and the screen output of every step.
cp $MDPDB.pdb $MDPDB.gro $MDPDB.top $out/
for f in b4soln em_vac b4ion em_sol; do have ${MDPDB}_$f.gro && cp ${MDPDB}_$f.gro $out/; done
# The other text files the steps write, for the "files it makes" viewer (data/<system>/files/).
mkdir -p $out/files
for f in posre.itp ${MDPDB}_em_sol.pdb ${MDPDB}_{em_vac,em_sol,pr,md,longmd}.log ${MDPDB}_{pr,md,longmd,longmd_nojump_start,longmd_nojump_fit_start}.gro; do
  have $f && cp $f $out/files/
done
for f in logs/*.log; do
  # mdrun -v rewrites one progress line many times; keep the screen output short
  sed -E 's/\r/\n/g' "$f" | awk '!/^(step|imb F) .*(will finish|remaining wall clock)/' > $out/$f
done

# Energy minimizations: protein (+ ions) frames.
have ${MDPDB}_em_vac.trr && echo Protein | gmx trjconv -s ${MDPDB}_em_vac.tpr -f ${MDPDB}_em_vac.trr -o $out/em_vac_frames.gro -quiet
have ${MDPDB}_em_sol.trr && echo non-Water | gmx trjconv -s ${MDPDB}_em_sol.tpr -f ${MDPDB}_em_sol.trr -o $out/em_sol_frames.gro -quiet

# MD runs: whole, centered protein + ions for playback, and the energy terms.
for run in pr md longmd; do
  have ${MDPDB}_$run.xtc || continue
  printf 'Protein\nnon-Water\n' | gmx trjconv -s ${MDPDB}_$run.tpr -f ${MDPDB}_$run.xtc -pbc mol -center -ur compact -o $out/${run}_frames.gro -quiet
  printf 'Potential\nTemperature\nPressure\nDensity\nVolume\n\n' | gmx energy -f ${MDPDB}_$run.edr -o $out/${run}_energy.xvg -quiet > /dev/null
done

# grompp page: the mistakes students make, run for real. top0/top1 are the topology as it
# was before solvate and before genion (the final one, after genion, is $MDPDB.top).
if have ${MDPDB}_em_sol.gro && have ${MDPDB}_b4ion.gro; then
  mkdir -p $out/grompp /tmp/gp_$$
  cp -r Functions posre*.itp ${MDPDB}_b4soln.gro ${MDPDB}_b4ion.gro ${MDPDB}_em_sol.gro /tmp/gp_$$/
  awk '/^\[ molecules \]/{m=1} m && /^(SOL|NA|CL) /{next} {print}' $MDPDB.top > /tmp/gp_$$/top0.top
  nsol=$(grep -oE 'SOL \(\s*3 atoms\):\s*[0-9]+' logs/*_solvate.log | grep -oE '[0-9]+$' | tail -1)
  { cat /tmp/gp_$$/top0.top; printf 'SOL         %s\n' $nsol; } > /tmp/gp_$$/top1.top
  cp $MDPDB.top /tmp/gp_$$/top2.top
  # -po goes to a scratch file: GROMACS 2025 adds .mdp to /dev/null and then cannot write it.
  gp() { local name=$1; shift; ( cd /tmp/gp_$$ && { echo "\$ gmx grompp $*"; gmx grompp "$@" -po mdout_po.mdp 2>&1; } ) \
    | sed -E "s/top[012]\.top/$MDPDB.top/g; s# -po mdout_po\.mdp##; s#(Working dir: +).*#\1/home/student/md#" > $out/grompp/$name.log; }
  M=$MDPDB
  gp vac_pme        -f ./Functions/em_sol.mdp -c ${M}_b4soln.gro -p top0.top -o x.tpr
  gp ion_nomaxwarn  -f ./Functions/em_sol.mdp -c ${M}_b4ion.gro  -p top1.top -o x.tpr
  gp pr_nor         -f ./Functions/pr.mdp     -c ${M}_em_sol.gro -p top2.top -o x.tpr
  gp mm_b4soln_top2 -f ./Functions/em_sol.mdp -c ${M}_b4soln.gro -p top2.top -o x.tpr
  gp mm_b4ion_top2  -f ./Functions/em_sol.mdp -c ${M}_b4ion.gro  -p top2.top -o x.tpr
  gp mm_emsol_top0  -f ./Functions/em_vac.mdp -c ${M}_em_sol.gro -p top0.top -o x.tpr
  gp nomdp          -f ./Functions/em.mdp     -c ${M}_b4soln.gro -p top0.top -o x.tpr
  gp vac_ok         -f ./Functions/em_vac.mdp -c ${M}_b4soln.gro -p top0.top -o x.tpr
  rm -rf /tmp/gp_$$
fi
# Atom and molecule counts of each structure (the grompp page compares them with the topology).
python3 - $MDPDB $out <<'PY'
import glob, json, os, sys
m, out = sys.argv[1:]
res = {}
for g in sorted(glob.glob(f'{m}*.gro')):
    L = open(g).read().split('\n'); n = int(L[1]); mols = {}; last = None
    for l in L[2:2 + n]:
        key, rn = (l[0:5], l[5:10]), l[5:10].strip()
        if key != last:
            cat = rn if rn in ('SOL', 'NA', 'CL') else 'Protein'
            mols[cat] = 1 if cat == 'Protein' else mols.get(cat, 0) + 1
            last = key
    res[os.path.basename(g)] = {'atoms': n, 'mols': mols, 'box': L[2 + n].split()}
json.dump(res, open(f'{out}/files.json', 'w'), indent=1)
PY

# solvate page: one setting changed at a time. Water oxygens go to JSON for drawing.
if have ${MDPDB}_em_vac.gro; then
  mkdir -p $out/solvate /tmp/sv_$$
  cp ${MDPDB}_em_vac.gro $MDPDB.gro /tmp/sv_$$/
  awk '/^\[ molecules \]/{m=1} m && /^(SOL|NA|CL) /{next} {print}' $MDPDB.top > /tmp/sv_$$/top0.top
  sv() { local name=$1; shift; ( cd /tmp/sv_$$ && cp top0.top $MDPDB.top && { echo "\$ gmx solvate $*"; gmx solvate "$@" 2>&1; } ) \
    | sed -E "s#(Working dir: +).*#\1/home/student/md#" > $out/solvate/$name.log; }
  M=$MDPDB
  sv maxsol2000 -cp ${M}_em_vac.gro -cs spc216.gro -o m2000.gro -p $M.top -maxsol 2000
  sv maxsol8000 -cp ${M}_em_vac.gro -cs spc216.gro -o m8000.gro -p $M.top -maxsol 8000
  sv nop        -cp ${M}_em_vac.gro -cs spc216.gro -o nop.gro
  sv box7       -cp ${M}_em_vac.gro -cs spc216.gro -o box7.gro -p $M.top -box 7
  sv box10      -cp ${M}_em_vac.gro -cs spc216.gro -o box10.gro -p $M.top -box 10
  sv pdb2gmxbox -cp $M.gro -cs spc216.gro -o tight.gro -p $M.top
  sv tip4p      -cp ${M}_em_vac.gro -cs tip4p.gro -o t4.gro -p $M.top
  python3 - ${MDPDB}_b4ion.gro /tmp/sv_$$ $out/solvate <<'PY'
import json, sys
base_gro, d, out = sys.argv[1:]
def read(f):
    L = open(f).read().split('\n'); n = int(L[1]); ow = []
    for l in L[2:2 + n]:
        if l[10:15].strip() == 'OW': ow += [round(float(l[20:28]), 2), round(float(l[28:36]), 2), round(float(l[36:44]), 2)]
    return ow, [float(x) for x in L[2 + n].split()]
base, box = read(base_gro)
json.dump({'box': box, 'ow': base}, open(f'{out}/script.json', 'w'), separators=(',', ':'))
where = {tuple(base[i:i + 3]): i // 3 for i in range(0, len(base), 3)}
for name, g in [('maxsol2000', 'm2000'), ('maxsol8000', 'm8000'), ('box7', 'box7'), ('box10', 'box10'), ('pdb2gmxbox', 'tight'), ('tip4p', 't4')]:
    ow, b = read(f'{d}/{g}.gro')
    data = {'box': b, 'subset': [where[tuple(ow[i:i + 3])] for i in range(0, len(ow), 3)]} if name.startswith('maxsol') else {'box': b, 'ow': ow}
    json.dump(data, open(f'{out}/{name}.json', 'w'), separators=(',', ':'))
PY
  rm -rf /tmp/sv_$$
fi

# trjconv page: the production run handled different ways. Every variant writes protein + ions
# (non-Water) so the page can draw it; sizes.txt records the real file size for each output group.
if have ${MDPDB}_longmd.xtc; then
  mkdir -p $out/trjconv
  T="-s ${MDPDB}_longmd.tpr -quiet"
  echo non-Water | gmx trjconv $T -f ${MDPDB}_longmd.xtc -o $out/trjconv/raw.gro
  echo non-Water | gmx trjconv $T -f ${MDPDB}_longmd.xtc -pbc mol -o $out/trjconv/mol.gro
  printf 'Backbone\nnon-Water\n' | gmx trjconv $T -f ${MDPDB}_longmd.xtc -ur compact -center -pbc nojump -o $out/trjconv/nojump.gro
  printf 'Backbone\nnon-Water\n' | gmx trjconv $T -f ${MDPDB}_longmd.xtc -ur compact -pbc mol -center -o $out/trjconv/center.gro
  # the fit starts from the script's nojump trajectory, as step 20 does
  printf 'Backbone\nSystem\n' | gmx trjconv $T -f ${MDPDB}_longmd.xtc -ur compact -center -pbc nojump -o /tmp/nojump_$$.xtc
  printf 'Backbone\nnon-Water\n' | gmx trjconv $T -f /tmp/nojump_$$.xtc -ur compact -fit rot+trans -o $out/trjconv/fit.gro
  : > $out/trjconv/sizes.txt
  for g in System Protein non-Water Backbone; do
    for dt in 0 10 50; do
      dtflag=$([ $dt = 0 ] || echo "-dt $dt")
      printf "Backbone\n$g\n" | gmx trjconv $T -f ${MDPDB}_longmd.xtc $dtflag -ur compact -center -pbc nojump -o /tmp/size_$$.xtc > /dev/null 2>&1
      echo "$g $dt $(stat -c %s /tmp/size_$$.xtc)" >> $out/trjconv/sizes.txt
    done
  done
  rm -f /tmp/nojump_$$.xtc /tmp/size_$$.xtc
  gmx check -f ${MDPDB}_longmd.xtc 2>&1 | grep -E '^(Step|Coords|Box)' > $out/trjconv/check.txt
  echo q | gmx trjconv $T -f ${MDPDB}_longmd.xtc -dump 0 -o /tmp/x_$$.gro 2>&1 | grep -E '^Group' > $out/trjconv/groups.txt; rm -f /tmp/x_$$.gro
fi
# trjconv step 9 (gro to pdb): the groups on offer and the PDB it writes.
have ${MDPDB}_em_sol.tpr && echo q | gmx trjconv -s ${MDPDB}_em_sol.tpr -f ${MDPDB}_em_sol.gro -o /tmp/x_$$.pdb 2>&1 | grep -E '^Group' > $out/trjconv_groups_em_sol.txt; rm -f /tmp/x_$$.pdb

# genion page: how many ions each -conc gives, and which waters they replace.
if have ${MDPDB}_ion.tpr; then
  mkdir -p $out/genion
  for c in 0 0.05 0.1 0.15 0.2 0.25 0.3 0.35 0.4 0.45 0.5; do
    for n in neutral plain; do
      flag=$([ $n = neutral ] && echo -neutral)
      echo SOL | gmx genion -s ${MDPDB}_ion.tpr -o /tmp/genion_$$.gro -conc $c -rmin 0.3 $flag -nname CL -pname NA -seed 662 2>&1 \
        | grep -E 'Will try|Replacing solvent' > $out/genion/${n}_$c.txt
    done
  done
  for g in Protein System; do echo $g | gmx genion -s ${MDPDB}_ion.tpr -o /tmp/genion_$$.gro -conc 0.1 -neutral -nname CL -pname NA > $out/genion/group_$g.log 2>&1; done
  rm -f /tmp/genion_$$.gro
fi

# pdb2gmx page: every force field in the list.
mkdir -p $out/pdb2gmx /tmp/pdb2gmx_$$
for i in $(seq 1 $(grep -cE '^ ?[0-9]+: ' logs/01_pdb2gmx.log)); do
  ( cd /tmp/pdb2gmx_$$ && printf "$i\n" | gmx pdb2gmx -ignh -f $OLDPWD/$MDPDB.pdb -o ff$i.gro -p ff$i.top -water spce > ff$i.log 2>&1 ) || continue
  cp /tmp/pdb2gmx_$$/ff$i.gro /tmp/pdb2gmx_$$/ff$i.log $out/pdb2gmx/
done
rm -rf /tmp/pdb2gmx_$$ \#*
echo "Wrote $out"
