#!/usr/bin/env bash
# Opens the text dashboard. Starts the local server first if it isn't running, using VS Code's
# Node (or node, if installed). The "GROMACS Dashboard" app on the Desktop runs this.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # apps start with a short PATH, and Publish needs git and gh
site=$(cd "$(dirname "$0")/.." && pwd)
port=${PORT:-8002}
url=http://localhost:$port/admin.html
if ! curl -s -o /dev/null "$url"; then
  cd "$site"
  if command -v node >/dev/null; then run=(node serve.mjs)
  else export ELECTRON_RUN_AS_NODE=1; run=("/Applications/Visual Studio Code.app/Contents/MacOS/Code" serve.mjs); fi
  PORT=$port nohup "${run[@]}" > "$HOME/Library/Logs/gromacs-visualizer.log" 2>&1 < /dev/null &
  for _ in $(seq 1 50); do curl -s -o /dev/null "$url" && break; sleep 0.2; done
fi
open "$url"
