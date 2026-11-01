# GROMACS Visualizer (MIP 662)

A static website where students type a real `gmx` command and see what it does. It follows the
course workflow command by command, on two example systems: hen egg-white
lysozyme (globular) and magainin 2 (a long helix). Every screen of output on the site comes from
real GROMACS runs of those commands (both systems: GROMACS 2026.4 on UncleBen).

Students type each command at the command line and press Enter, the same way they will on
Geiss-01. When a command asks a question (pdb2gmx, genion, trjconv), the page prints the question
the way GROMACS does and waits for the student to type an answer in the terminal. The course
script answers these with `<<EOF` blocks. The workflow page shows each question and the script's
answer.

Separate from the Shell Lab practice site. Not on GitHub yet.

## Pages

| Page | Command(s) in the script | What students can change |
| --- | --- | --- |
| `index.html` | all 21, in order | links each step to its page, with the command filled in |
| `pdb2gmx.html` | step 1 | force field (by number or `-ff`), `-water`, `-ignh`, the typed answers |
| `editconf.html` | step 2 | `-d`, `-bt`, `-box`, `-c`/`-noc` (computed in the browser, checked against 40 real runs) |
| `grompp.html` | steps 3, 6, 8, 10, 12, 14, 16 | `-f`, `-c`, `-r`, `-maxwarn`; shows the coordinate/topology check and real errors |
| `mdrun.html` | steps 4, 11, 13, 15, 17 | `-deffnm`, `-v`, hardware flags; plays back the minimizations and MD with charts |
| `solvate.html` | step 5 | `-cp`, `-cs`, `-p`, `-box`, `-maxsol` |
| `genion.html` | step 7 | `-conc`, `-neutral`, `-p`, the group answer; ions drawn where genion put them |
| `trjconv.html` | steps 9, 18-21 | `-pbc`, `-center`, `-fit`, `-dt`, `-dump`, output group; file size per choice |

## Run it

The pages load their data with `fetch`, so open them through a local server, not by
double-clicking a file.

```
node serve.mjs          # or: npm run serve
```

then open http://localhost:8002/ . (Shell Lab uses port 8000 or 8001, so both can run at once.)
Without Node installed, use VS Code's bundled Node the same way as for Shell Lab:

```
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" serve.mjs
```

## Edit the text

All the text on the pages (titles, explanations, notes, labels) lives in `data/text.json`. Open
http://localhost:8002/admin.html to edit it. Each entry shows a preview and warns about missing
`{placeholders}`, unclosed tags, dashes, semicolons and words to avoid. Save writes
`data/text.json` and first copies the old file to `data/text-backups/`. Download and Upload move
the file between computers. Add `?showtext` to any page (for example `genion.html?showtext`) to
outline every editable piece of text and show its name on hover.

The "Try it" exercise cards are switched off (`SHOW_TRIES` in `js/site.js`). Their code is still
in each page.

## Test it

```
npm test
```

`tests/fixtures/editconf.json` holds the output of 40 real `gmx editconf` runs. The tests check
that the editconf page prints the same lines and writes the same box, and that every command in
the workflow parses and rebuilds exactly. Regenerate the fixtures on a machine with GROMACS
with `bash tools/make-fixtures.sh > tests/fixtures/editconf.json`.

## Replacing the runs (UncleBen or Geiss-01)

The data in `data/<system>/` was made on a 4-core test machine with stand-in `.mdp` files
(`workflow/Functions/`). To use your own runs:

1. Put `<name>.pdb`, `workflow/run_workflow.sh`, `workflow/export_playback.sh` and your
   `Functions/` folder in an empty directory on the server.
2. `MDPDB=<name> CURRENT_WATER=tip3p bash run_workflow.sh` runs the workflow's commands in
   order and keeps each one's screen output in `logs/`. `STOP_AFTER=em_sol` skips the MD runs.
3. `MDPDB=<name> bash export_playback.sh` packs everything the pages need into
   `site-data/<name>/` (a few MB): structures, logs, playback frames, energies, and the extra
   runs behind the panels (each force field, each salt concentration, the grompp mistakes,
   the solvate settings, the trjconv variants).
4. `MDPDB=<name> bash export_interactive.sh` reruns the commands that ask questions under a
   pseudo-terminal (`tty_capture.py`) so the logs show each question and answer in the order a
   student sees them. It needs Python 3.
5. Copy `site-data/<name>` to `data/<name>` here and add an entry to `data/systems.json`
   (`hasMD: true` if the MD steps ran).

The `em_vac.mdp` stand-in uses a plain cut-off for Coulomb (with PME, grompp stops on the
net-charge warning because that step has no `-maxwarn`).

## What's where

| Path | What it is |
| --- | --- |
| `*.html`, `css/style.css` | One page per tool, plus the workflow overview |
| `js/pages/*.js` | Each page's logic |
| `js/site.js` | Shared: the script's steps (`WORKFLOW`), page text (`T`), header, the interactive terminal (`shell`), notes, exercises |
| `admin.html`, `js/admin.js` | The text dashboard |
| `data/text.json` | All page text, edited from the dashboard |
| `js/command.js`, `js/specs.js` | Parses a typed command with GROMACS's own error messages; the options of each tool (from `gmx <tool> -h`) |
| `js/editconf.js`, `js/geometry.js` | editconf's box calculation; box vectors, shapes, periodic copies |
| `js/gro.js` | Reads `.gro`, multi-frame `.gro`, `.xvg` and `.top` files |
| `js/viewer.js`, `js/chart.js` | The 3D view (3Dmol.js, kept locally in `vendor/`) and the SVG charts |
| `data/` | Each system's runs, made by `workflow/export_playback.sh` |
| `workflow/` | The scripts and `.mdp` files used to make `data/` |
