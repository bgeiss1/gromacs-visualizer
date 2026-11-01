#!/usr/bin/env bash
# Re-runs the commands that ask questions (pdb2gmx, genion, trjconv) the way a student runs
# them: typed at a terminal, one at a time, answering each question by hand. tty_capture.py
# gives GROMACS a real terminal, so its questions and answers come out in the order a person
# sees them (piping answers in with <<EOF scrambles that order). Run it in the run folder
# after run_workflow.sh; it writes into site-data/$MDPDB/ (export_playback.sh calls it).
#
#   MDPDB=magainin2 bash export_interactive.sh
set -uo pipefail
: "${MDPDB:?set MDPDB}"
M=$MDPDB
here=$(pwd)
out=$here/site-data/$M
tty="python3 $(cd "$(dirname "$0")" && pwd)/tty_capture.py"
have() { [ -e "$here/$1" ]; }
work=$(mktemp -d)
cd "$work"
link() { for f in "$@"; do [ -e "$here/$f" ] && cp "$here/$f" .; done; }
# Logs show the folder students work in, not this scratch folder.
clean() { sed -i -E "s#(Working dir: +).*#\1/home/student/md#; s#$work/##g" "$1"; }
mkdir -p $out/logs $out/pdb2gmx $out/genion

# Step 1, pdb2gmx: the course answer (1), every other force field, and a run without -water
# (a second question about the water model).
link $M.pdb
$tty $out/logs/01_pdb2gmx.log -a 1 -- gmx pdb2gmx -ignh -f $M.pdb -o $M.gro -p $M.top -water tip3p; clean $out/logs/01_pdb2gmx.log
# How many force fields this GROMACS lists (newer versions add more), and the page's list of them.
nff=$(grep -cE '^ ?[0-9]+: ' $out/logs/01_pdb2gmx.log)
topdir=$(sed -n 's/^Data prefix: *//p' $out/logs/01_pdb2gmx.log | head -1)/share/gromacs/top
python3 "$(cd "$(dirname "$0")" && pwd)/export_forcefields.py" "$topdir" $out/logs/01_pdb2gmx.log $here/site-data/forcefields.json
for i in $(seq 1 $nff); do
  mkdir ff$i; cp $M.pdb ff$i/
  ( cd ff$i && $tty $out/pdb2gmx/ff$i.log -a $i -- gmx pdb2gmx -ignh -f $M.pdb -o ff$i.gro -p ff$i.top -water tip3p )
  sed -i -E "s/ff$i\.(gro|top)/$M.\1/g" $out/pdb2gmx/ff$i.log; clean $out/pdb2gmx/ff$i.log
  [ -e ff$i/ff$i.gro ] && cp ff$i/ff$i.gro $out/pdb2gmx/
done
$tty $out/pdb2gmx/ff1_water1.log -a 1 -a 1 -- gmx pdb2gmx -ignh -f $M.pdb -o $M.gro -p $M.top; clean $out/pdb2gmx/ff1_water1.log
rm -rf ./*

# Step 7, genion: the course answer (SOL), and every other group in the list.
if have ${M}_ion.tpr; then
  link ${M}_ion.tpr $M.top posre.itp
  cp $M.top course.top
  # the topology as genion found it: no ions yet
  awk '/^\[ molecules \]/{m=1} m && /^(NA|CL) /{next} {print}' course.top > $M.top
  cp $M.top before.top
  $tty $out/logs/07_genion.log -a SOL -- gmx genion -s ${M}_ion.tpr -o ${M}_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p $M.top
  clean $out/logs/07_genion.log
  n=$(grep -cE '^Group +[0-9]+' $out/logs/07_genion.log)
  for g in $(seq 0 $((n - 1))); do
    cp before.top $M.top; rm -f \#*
    $tty $out/genion/group_$g.log -a $g -- gmx genion -s ${M}_ion.tpr -o ${M}_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p $M.top
    clean $out/genion/group_$g.log
  done
  cp before.top $M.top; rm -f \#*
  $tty $out/genion/group_bad.log -a foo -a SOL -- gmx genion -s ${M}_ion.tpr -o ${M}_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p $M.top
  clean $out/genion/group_bad.log
  rm -f ./* ./\#*
fi

# Steps 9 and 18-21, trjconv, with the answers the course workflow gives.
link ${M}_em_sol.gro ${M}_em_sol.tpr ${M}_longmd.xtc ${M}_longmd.tpr
have ${M}_em_sol.tpr && { $tty $out/logs/09_trjconv_pdb.log -a 0 -- gmx trjconv -f ${M}_em_sol.gro -o ${M}_em_sol.pdb -s ${M}_em_sol.tpr; clean $out/logs/09_trjconv_pdb.log; }
if have ${M}_longmd.xtc; then
  $tty $out/logs/18_trjconv_nojump.log -a 4 -a 0 -- gmx trjconv -f ${M}_longmd.xtc -s ${M}_longmd.tpr -dt 10 -ur compact -center -pbc nojump -o ${M}_longmd_nojump.xtc
  $tty $out/logs/19_trjconv_start.log -a 0 -- gmx trjconv -f ${M}_longmd.xtc -s ${M}_longmd.tpr -dump 0 -ur compact -pbc nojump -o ${M}_longmd_nojump_start.gro
  $tty $out/logs/20_trjconv_fit.log -a 4 -a 0 -- gmx trjconv -f ${M}_longmd_nojump.xtc -s ${M}_longmd.tpr -dt 10 -ur compact -fit rot+trans -o ${M}_longmd_nojump_fit.xtc
  $tty $out/logs/21_trjconv_fitstart.log -a 0 -- gmx trjconv -f ${M}_longmd_nojump.xtc -s ${M}_longmd.tpr -dump 0 -ur compact -o ${M}_longmd_nojump_fit_start.gro
  for s in 18_trjconv_nojump 19_trjconv_start 20_trjconv_fit 21_trjconv_fitstart; do clean $out/logs/$s.log; done
fi
cd "$here"; rm -rf "$work"
echo "Wrote the interactive logs in $out"
