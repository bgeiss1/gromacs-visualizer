#!/usr/bin/env bash
# Runs real `gmx editconf` on the example systems and records what it prints
# and the box it writes, so tests/editconf.test.mjs can check the page against
# real GROMACS. Needs GROMACS on PATH. Run from the site folder:
#   bash tools/make-fixtures.sh > tests/fixtures/editconf.json
set -euo pipefail
tmp=$(mktemp -d)
cases=(
  "-c -d 1.0 -bt cubic" "-c -d 1.2 -bt cubic" "-c -d 1.0 -bt dodecahedron" "-c -d 1.5 -bt octahedron"
  "-c -d 1.0" "-d 0.8 -bt triclinic" "-d 1.0 -bt cubic" "-box 7" "-box 7 -noc" "-box 6 7 8"
  "-box 7 -bt dodecahedron" "-box 5 6 7 -bt cubic" "-d 1 -box 7" "-d 1 -box 7 -bt cubic" "-bt cubic" "-c"
  "-d 1.0 -noc" "-d 1.0 -bt cubic -noc" "-d 1 -bt dod" "-d 1.3 -bt c"
)
echo "["
first=1
for sys in lysozyme magainin2; do
  for args in "${cases[@]}"; do
    out=$(gmx editconf -f data/${sys}/${sys}.gro -o $tmp/o.gro $args 2>&1 | sed -n '/^Read /,$p' | grep -v '^$' || true)
    box=$(tail -1 $tmp/o.gro)
    atom=$(sed -n 3p $tmp/o.gro | cut -c21-44)
    [ $first = 1 ] || echo ","
    first=0
    python3 -c 'import json,sys; print(json.dumps({"system":sys.argv[1],"args":sys.argv[2],"stdout":sys.argv[3].splitlines(),"boxLine":sys.argv[4],"firstAtom":[float(x) for x in sys.argv[5].split()]}))' "$sys" "$args" "$out" "$box" "$atom"
  done
done
echo "]"
rm -rf $tmp
