#!/usr/bin/env bash
# Copies the student pages into a folder for GitHub Pages. Leaves out the text dashboard
# (admin.html, js/admin.js), the local server, the tests, the run scripts and every backup.
#   bash tools/build_pages.sh _site            (NOINDEX=1 asks search engines not to list it)
set -euo pipefail
out=${1:-_site}
cd "$(dirname "$0")/.."
rm -rf "$out" && mkdir -p "$out/data" "$out/workflow"
for f in *.html; do [ "$f" = admin.html ] || cp "$f" "$out/"; done
cp -R css vendor "$out/"
mkdir -p "$out/js" && cp -R js/pages "$out/js/" && for f in js/*.js; do [ "$f" = js/admin.js ] || cp "$f" "$out/js/"; done
cp -R workflow/Functions "$out/workflow/"
cp data/*.json "$out/data/"
for M in $(python3 -c "import json; print(' '.join(s['id'] for s in json.load(open('data/systems.json'))))"); do
  cp -R "data/$M" "$out/data/"
done
if [ "${NOINDEX:-}" = 1 ]; then
  perl -pi -e 's#<head>#<head>\n<meta name="robots" content="noindex, nofollow">#' "$out"/*.html
fi
touch "$out/.nojekyll"
echo "built $out: $(find "$out" -type f | wc -l | tr -d ' ') files, $(du -sh "$out" | cut -f1)"
