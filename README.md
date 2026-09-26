# Codex Theme

An installable macOS theme for the official Codex or ChatGPT app. It restores the
Chat / Work toggle, brings ChatGPT projects and conversations into the sidebar,
removes the composer background fade, and adds a watch-style usage complication
above the navigation rail’s Help button.

The center number is the remaining percentage. The lower left and right numbers
show the reset month and day. Hover for the full reset date and time. Older sidebar
layouts show the same gauge above the profile footer.

## Install

Requires macOS 12 or later, the official app in `/Applications`, and Node.js.
Xcode Command Line Tools are recommended; bundled launchers support Apple Silicon.

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

## Repository contents

GitHub contains only the installation bundle, native launcher sources and binaries,
assets, entry scripts, and documentation. No npm install or build step is needed.
Development modules, tests, dependencies, and local backups are excluded from Git.
The installer recompiles the native launchers when the compiler is available.
