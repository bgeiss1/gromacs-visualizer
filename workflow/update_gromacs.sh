#!/usr/bin/env bash
# Runs on UncleBen. Builds GROMACS (default 2026.4, CUDA, single precision) into ~/opt/gromacs-$VER
# if it isn't there yet, then reruns the course commands for every system in ./systems/ and packs
# the visualizer data into ~/gmx-visualizer-runs/site-data-$VER.tgz.
set -euo pipefail
VER=${VER:-2026.4}
JOBS=${JOBS:-32}
here=$(cd "$(dirname "$0")" && pwd)
prefix=$HOME/opt/gromacs-$VER
runs=$HOME/gmx-visualizer-runs
if [ ! -x "$prefix/bin/gmx" ]; then
  echo "== building GROMACS $VER into $prefix"
  command -v cmake >/dev/null || { echo "cmake not found"; exit 1; }
  nvcc=$(command -v nvcc || ls /usr/local/cuda/bin/nvcc 2>/dev/null || true)
  [ -n "$nvcc" ] || { echo "nvcc (CUDA toolkit) not found"; exit 1; }
  echo "CUDA: $($nvcc --version | tail -1)"
  src=$runs/build-$VER
  mkdir -p "$src" && cd "$src"
  [ -e gromacs-$VER.tar.gz ] || curl -fLO https://ftp.gromacs.org/gromacs/gromacs-$VER.tar.gz
  rm -rf gromacs-$VER && tar xzf gromacs-$VER.tar.gz && mkdir gromacs-$VER/build && cd gromacs-$VER/build
  cmake .. -DCMAKE_INSTALL_PREFIX="$prefix" -DGMX_GPU=CUDA -DCUDA_TOOLKIT_ROOT_DIR="$(dirname "$(dirname "$nvcc")")" \
    -DGMX_BUILD_OWN_FFTW=ON -DGMX_MPI=OFF -DREGRESSIONTEST_DOWNLOAD=OFF -DCMAKE_BUILD_TYPE=Release
  make -j"$JOBS"
  make install
fi
set +u; source "$prefix/bin/GMXRC"; set -u   # GMXRC reads unset variables
echo "== using $(gmx --version 2>/dev/null | grep 'GROMACS version')"
out=$runs/site-data-$VER
rm -rf "$out" && mkdir -p "$out"
for pdb in "$here"/systems/*.pdb; do
  M=$(basename "$pdb" .pdb)
  dir=$runs/${M}_$VER
  echo "== $M in $dir"
  rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
  cp "$pdb" . && cp -r "$here/Functions" .
  MDPDB=$M CURRENT_WATER=tip3p bash "$here/run_workflow.sh"
  MDPDB=$M bash "$here/export_playback.sh"
  grep -q '{{' site-data/$M/logs/01_pdb2gmx.log 2>/dev/null || MDPDB=$M bash "$here/export_interactive.sh"
  cp -r site-data/$M "$out/"
  [ -e site-data/forcefields.json ] && cp site-data/forcefields.json "$out/"
done
cd "$runs" && tar czf site-data-$VER.tgz -C "$out" .
echo "== done: $runs/site-data-$VER.tgz"
