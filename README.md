# Codex Theme

An unofficial macOS launcher that gives the Codex desktop app a custom photo background, animated activity effects, compact usage information, and SSH connection indicators—without modifying the official app bundle or `app.asar`.

The included [`image.jpg`](image.jpg) and [`fire.gif`](fire.gif) reproduce the author's current setup.

> [!WARNING]
> This relies on the current Codex desktop UI structure. A major Codex update may require a theme update. It uses a separate app profile, so you may need to sign in again on first launch.

## What it changes

- Shows `image.jpg` only behind the chat surface with a 60% dark overlay.
- Keeps the native translucent sidebar material.
- Displays a compact Japanese usage strip at the bottom of the sidebar.
- Animates the current composer border while that task is running.
- Animates the usage bar while any visible or collapsed project has an active task.
- Shows the included transparent fire GIF above both thumbs for the active task. Each task keeps its own timer and grows the flames for up to five minutes.
- Keeps flames clipped to the chat surface and below chat text.
- Replaces matching SSH host status dots with four cellular-style latency bars:
  - 4 bars: 40 ms or less
  - 3 bars: 100 ms or less
  - 2 bars: 250 ms or less
  - 1 bar: slower than 250 ms
  - 0 bars: unavailable
- Hides the in-app upgrade prompt while leaving the profile footer intact.

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
VPN, Proxmox, Homelab, Oracle_seoul
```

It performs a TCP connection timing check against each configured host and port every 15 seconds. It does not authenticate or run SSH commands. If those aliases are absent, the feature simply stays hidden.

## How it works

- Starts the official Codex or ChatGPT executable with Chromium's `--remote-debugging-pipe`.
- Uses a parent-child process pipe rather than exposing a remote-debugging TCP port.
- Stores the separate profile in `~/Library/Application Support/Codex Theme`.
- Injects CSS and UI helpers into Codex pages as they are created or refreshed.
- Reads usage from the app's own `/wham/usage` response and caches the latest result locally for up to six hours.
- Leaves `/Applications/ChatGPT.app`, `/Applications/Codex.app`, and their `app.asar` files untouched.

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
