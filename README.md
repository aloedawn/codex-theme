# Codex Theme

An installable macOS theme for the official Codex or ChatGPT app. It adds the
current photo background, purple sidebar, animated task effects, Chat / Work
toggle, and a watch-style usage gauge above the navigation rail’s Help button.
ChatGPT projects and conversations appear in the existing sidebar sections.

The center number is the remaining percentage. The lower left and right numbers
show the reset month and day. Hover for the full reset date and time.

## Install

Requires macOS 12 or later (and the official app's own system requirements), the
official app in `/Applications`, and Node.js 20 or later available as `node`.
Bundled launchers support **Apple Silicon and Intel Macs**. No npm install,
compiler, or build step is needed for those architectures.

```sh
git clone https://github.com/aloedawn/codex-theme.git
cd codex-theme
./install.sh
open "$HOME/Applications/Codex Theme/Codex.app"
```

## Update

Quit the themed app, then run:

```sh
git pull --ff-only
./install.sh
open "$HOME/Applications/Codex Theme/Codex.app"
```

The installer creates a separate launcher in `~/Applications/Codex Theme` and
leaves the official app untouched. See [theme details](Work_to_Codex/README.md)
for customization and troubleshooting.

## Use on another computer

Run the same installation commands on each Mac. The included background and fire
assets reproduce this theme; no paths refer to the author's checkout. Each Mac
uses its own profile at `~/Library/Application Support/Codex Theme`, so sign in
on first launch. Credentials, conversations, SSH configuration, and cached usage
are not included in the repository.

The current distribution is **macOS only**. Windows adaptation is planned
separately; the `.command`, `.sh`, and native launchers do not run on Windows.

## Remove the launcher

Quit the themed app and move `~/Applications/Codex Theme` to the Trash. The
separate profile remains available for reinstalling. The official app continues
to work normally.

## Repository contents

GitHub contains only the installation bundle, native launcher sources and universal binaries,
assets, entry scripts, and documentation. No npm install or build step is needed.
Development modules, tests, dependencies, and local backups are excluded from Git.
The installer uses the bundled launchers and checks them before installation
completes. Native sources remain available for future launcher changes.
