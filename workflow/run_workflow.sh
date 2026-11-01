#!/usr/bin/env bash
# Runs the course setup-and-run workflow and keeps
# every command's screen output in logs/, so the visualizer can play the run back.
#
#   MDPDB=magainin2 CURRENT_WATER=tip3p bash run_workflow.sh
#
# Options (environment variables):
#   MDRUN_FLAGS  flags for every gmx mdrun (default: the GPU flags from the course workflow)
#   STOP_AFTER   stop after this step name, e.g. em_sol to skip the MD runs
# Expects $MDPDB.pdb and ./Functions/*.mdp in the current folder.
set -euo pipefail
: "${MDPDB:?set MDPDB to the PDB name without .pdb}"
CURRENT_WATER=${CURRENT_WATER:-tip3p}
MDRUN_FLAGS=${MDRUN_FLAGS:--ntmpi 1 -ntomp 24 -nb gpu -pin on -pinstride 1 -dlb auto}
STOP_AFTER=${STOP_AFTER:-}
mkdir -p logs
n=0
step() { # step <name> <stdin> <command...>
  local name=$1 input=$2; shift 2
  n=$((n + 1))
  local log=$(printf 'logs/%02d_%s.log' $n "$name")
  { echo "\$ $*"; printf '%b' "$input" | "$@" 2>&1; } > "$log" || { echo "FAILED: $name (see $log)"; exit 1; }
  echo "done: $name"
  if [ "$name" = "$STOP_AFTER" ]; then exit 0; fi
}
[ -e "$MDPDB.pdb" ] || { echo "Could not find $MDPDB.pdb"; exit 1; }

step pdb2gmx       '1\n'   gmx pdb2gmx -ignh -f $MDPDB.pdb -o $MDPDB.gro -p $MDPDB.top -water $CURRENT_WATER
step editconf      ''      gmx editconf -f $MDPDB.gro -bt octahedron -d 2 -o ${MDPDB}_b4soln.gro
step grompp_em_vac ''      gmx grompp -f ./Functions/em_vac.mdp -c ${MDPDB}_b4soln.gro -p $MDPDB.top -o ${MDPDB}_em_vac.tpr
step mdrun_em_vac  ''      gmx mdrun -deffnm ${MDPDB}_em_vac -v $MDRUN_FLAGS
step solvate       ''      gmx solvate -cp ${MDPDB}_em_vac.gro -cs spc216.gro -o ${MDPDB}_b4ion.gro -p $MDPDB.top
step grompp_ion    ''      gmx grompp -f ./Functions/em_sol.mdp -c ${MDPDB}_b4ion.gro -p $MDPDB.top -o ${MDPDB}_ion.tpr -maxwarn 1
step genion        'SOL\n' gmx genion -s ${MDPDB}_ion.tpr -o ${MDPDB}_em_sol.gro -conc 0.1 -rmin 0.3 -neutral -nname CL -pname NA -p $MDPDB.top
step grompp_em_sol ''      gmx grompp -f ./Functions/em_sol.mdp -c ${MDPDB}_em_sol.gro -p $MDPDB.top -o ${MDPDB}_em_sol.tpr
step trjconv_pdb   '0\n'   gmx trjconv -f ${MDPDB}_em_sol.gro -o ${MDPDB}_em_sol.pdb -s ${MDPDB}_em_sol.tpr
step mdrun_em_sol  ''      gmx mdrun -deffnm ${MDPDB}_em_sol -v $MDRUN_FLAGS
step em_sol        ''      true
step grompp_pr     ''      gmx grompp -f ./Functions/pr.mdp -c ${MDPDB}_em_sol.gro -r ${MDPDB}_em_sol.gro -p $MDPDB.top -o ${MDPDB}_pr.tpr
step mdrun_pr      ''      gmx mdrun -deffnm ${MDPDB}_pr -v $MDRUN_FLAGS
step grompp_md     ''      gmx grompp -f ./Functions/short_md.mdp -c ${MDPDB}_pr.gro -p $MDPDB.top -o ${MDPDB}_md.tpr
step mdrun_md      ''      gmx mdrun -deffnm ${MDPDB}_md -v $MDRUN_FLAGS
step grompp_longmd ''      gmx grompp -f ./Functions/long_md.mdp -c ${MDPDB}_md.gro -p $MDPDB.top -o ${MDPDB}_longmd.tpr
step mdrun_longmd  ''      gmx mdrun -deffnm ${MDPDB}_longmd -v $MDRUN_FLAGS
step trjconv_nojump '4\n0\n' gmx trjconv -f ${MDPDB}_longmd.xtc -s ${MDPDB}_longmd.tpr -dt 10 -ur compact -center -pbc nojump -o ${MDPDB}_longmd_nojump.xtc
step trjconv_start  '0\n'    gmx trjconv -f ${MDPDB}_longmd.xtc -s ${MDPDB}_longmd.tpr -dump 0 -ur compact -pbc nojump -o ${MDPDB}_longmd_nojump_start.gro
step trjconv_fit    '4\n0\n' gmx trjconv -f ${MDPDB}_longmd_nojump.xtc -s ${MDPDB}_longmd.tpr -dt 10 -ur compact -fit rot+trans -o ${MDPDB}_longmd_nojump_fit.xtc
step trjconv_fitstart '0\n'  gmx trjconv -f ${MDPDB}_longmd_nojump.xtc -s ${MDPDB}_longmd.tpr -dump 0 -ur compact -o ${MDPDB}_longmd_nojump_fit_start.gro
echo "All steps finished."
