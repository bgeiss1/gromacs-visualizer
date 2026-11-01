#!/usr/bin/env bash
# Runs on the Mac, from the visualizer folder. Sends the workflow scripts and PDB files to UncleBen
# and starts update_gromacs.sh there in the background.
#   bash workflow/run_on_uncleben.sh start|status|fetch
set -euo pipefail
HOST=${HOST:-uncleben.cvmbs.colostate.edu}
VER=${VER:-2026.4}
site=$(cd "$(dirname "$0")/.." && pwd)
remote=gmx-visualizer-runs/update-$VER
case ${1:-} in
  start)
    ssh "$HOST" "mkdir -p $remote/systems"
    scp -r "$site"/workflow/{update_gromacs.sh,run_workflow.sh,export_playback.sh,export_interactive.sh,export_forcefields.py,tty_capture.py,Functions} "$HOST:$remote/"
    scp "$site"/data/lysozyme/lysozyme.pdb "$site"/data/magainin2/magainin2.pdb "$HOST:$remote/systems/"
    ssh "$HOST" "cd $remote && VER=$VER nohup bash update_gromacs.sh > update.log 2>&1 < /dev/null &"
    echo "Started." ;;
  status) ssh "$HOST" "tail -n 15 $remote/update.log" ;;
  fetch)
    tmp=$(mktemp -d)
    scp "$HOST:gmx-visualizer-runs/site-data-$VER.tgz" "$tmp/"
    tar xzf "$tmp/site-data-$VER.tgz" -C "$tmp"
    if [ -e "$tmp/forcefields.json" ]; then cp "$site/data/forcefields.json" "$site/data/forcefields_before_$VER.json"; cp "$tmp/forcefields.json" "$site/data/"; fi
    for d in "$tmp"/*/; do
      M=$(basename "$d")
      [ -d "$site/data/$M" ] && mv "$site/data/$M" "$site/data/${M}_before_$VER"
      cp -R "$d" "$site/data/$M"
      echo "installed data/$M (old copy in data/${M}_before_$VER)"
    done ;;
  *) echo "usage: start|status|fetch"; exit 1 ;;
esac
