# Codex Theme

An unofficial macOS launcher that gives the unified Codex/ChatGPT desktop app a custom photo background, animated activity effects, compact usage information, native file-review cards in ChatGPT Work mode, and SSH connection indicators—without modifying the official app bundle or `app.asar`.

The included [`image.jpg`](image.jpg) and [`fire.gif`](fire.gif) reproduce the author's current setup.

> [!WARNING]
> This relies on the current Codex desktop UI structure. A major Codex update may require a theme update. It uses a separate app profile, so you may need to sign in again on first launch.

## Custom features

### Chat surface

- Shows `image.jpg` behind the active chat surface with a 60% dark overlay while retaining the native translucent sidebar material.
- Paints the wallpaper and bottom composer fade from one full-size surface, avoiding bright seams at the sidebar edge and hard gradient cuts when the top-right panel is open.
- Applies translucent colors to the current input, dropdown, secondary, and code surfaces while preserving the app's native layout and controls.

### ChatGPT Work file-review cards

- Restores the app's own Codex file-change card at the end of every completed file-modifying response in ChatGPT Work conversations.
- Loads the native card component and its live app providers rather than recreating the card, preserving the original typography, spacing, file grouping, diff counts, expansion control, **Undo**, and **Review** actions.
- Leaves cards that Codex mode already renders untouched, so native cards are never duplicated.

### Task activity

- Fills the complete current rounded composer surface with an animated rainbow while that task is running, without changing its corner radius or adding scrollbars.
- Animates the full-width usage bar while any visible or collapsed project has an active task.
- Shows the included transparent fire GIF above both thumbs for the active task. Each task keeps its own timer and grows the flames for up to five minutes.
- Keeps flames clipped to the chat surface and below chat text.

### Sidebar information

- Displays remaining usage and the reset date in a compact Japanese strip directly above the current profile footer.
- Keeps the custom usage strip out of the Settings route and separate Settings window.
- Replaces matching SSH host status dots with four cellular-style latency bars:
  - 4 bars: 40 ms or less
  - 3 bars: 100 ms or less
  - 2 bars: 250 ms or less
  - 1 bar: slower than 250 ms
  - 0 bars: unavailable

## Requirements

- macOS 12 or later
- [Codex desktop](https://openai.com/codex/) or ChatGPT installed in `/Applications`
- Node.js available as `node`
- Xcode Command Line Tools recommended so the installer can build the launcher for the current Mac

The checked-in launcher binary is for Apple Silicon. The installer recompiles it for the current architecture when `swiftc` is available.

## Install

```sh
git clone https://github.com/aloedawn/codex-theme.git
cd codex-theme
./install.sh
open "$HOME/Applications/Codex Theme/Codex.app"
```

The installer copies a self-contained working set to:

```text
~/Applications/Codex Theme/
├── Codex.app
├── codex-theme.mjs
├── fire.gif
└── image.jpg
```

To keep it in the Dock, open `~/Applications/Codex Theme` in Finder and drag `Codex.app` to the Dock. If macOS blocks the first launch, Control-click `Codex.app`, choose **Open**, then confirm.

## Update

```sh
cd codex-theme
git pull --ff-only
./install.sh
```

Quit the themed Codex instance before reinstalling, then reopen it from the Dock.

## Run without installing

```sh
./Launch\ Codex\ Theme.command
```

The terminal window owns that themed Codex process. Closing the terminal also closes the themed instance.

## Use another background or fire GIF

Run directly with absolute asset paths:

```sh
node codex-theme.mjs \
  --image /absolute/path/to/photo.jpg \
  --fire /absolute/path/to/fire.gif
```

The background may be JPEG or PNG. The fire asset must be an animated GIF with transparency. The bundled fire coordinates are calibrated for the included 2662×1776 background; another photo will probably need different coordinates in `THUMB_FIRE_POINTS`.

## SSH signal bars

The launcher reads only concrete matching entries from `~/.ssh/config` for these aliases:

```text
VPN, Proxmox, Homelab, Oracle_seoul, Oracle_osaka, Oracle_chuncheon
```

Those are the author's personal defaults, not a required server list. To use your own SSH hosts, edit `PINNED_SSH_ALIASES` near the top of `codex-theme.mjs`:

```js
const PINNED_SSH_ALIASES = new Set([
  "my-server",
  "work-server",
  "home-server",
]);
```

Each value must exactly match a concrete `Host` alias in `~/.ssh/config` and the corresponding server label shown in the Codex sidebar. Wildcard aliases containing `*`, `!`, or `?` are ignored. After changing the list, run `./install.sh` again so the installed copy receives the updated script. If you run `Launch Codex Theme.command` directly from the repository, simply restart it instead.

The launcher performs a TCP connection timing check against each configured host and port every 15 seconds. It does not authenticate or run SSH commands. If the configured aliases are absent, the feature simply stays hidden.

## How it works

- Starts the official Codex or ChatGPT executable with Chromium's `--remote-debugging-pipe`.
- Uses a parent-child process pipe rather than exposing a remote-debugging TCP port.
- Stores the separate profile in `~/Library/Application Support/Codex Theme`.
- Attaches once to each Codex page and installs a versioned, single-instance UI runtime.
- Uses the current app-shell, composer, and surface tokens while retaining fallbacks for older builds.
- Keeps animation nodes alive across activity fades and updates DOM only when state actually changes.
- Reads usage from the app's own `/wham/usage` response and caches the latest result locally for up to six hours.
- Leaves `/Applications/ChatGPT.app`, `/Applications/Codex.app`, and their `app.asar` files untouched.

## Development

The maintainable source lives under `src/host` and `src/page`. The checked-in
`codex-theme.mjs` is a generated standalone bundle so normal installation does not require npm
or anything from `node_modules`.

```sh
npm install
npm run build
npm test
npm run check
```

Run `npm run build` after changing anything under `src`. `npm run check` fails when the committed
bundle does not exactly match the source, then performs the syntax and dry-run checks used by the
installer workflow.

## Troubleshooting

Check the launcher log:

```sh
tail -n 100 /private/tmp/codex-theme-launcher.log
```

Validate the local files without launching Codex:

```sh
node --check codex-theme.mjs
node codex-theme.mjs --dry-run
```

If the app opens without the theme after a Codex update, pull the latest repository version first. If the latest version still fails, the upstream UI structure probably changed.
