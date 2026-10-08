# Codex Theme — Work to Codex

An unofficial macOS launcher, with a Windows preview, that gives the unified Codex/ChatGPT desktop app a custom photo background, animated activity effects, compact usage information, and SSH connection indicators—without modifying the official app bundle or `app.asar`.

The included [`image.jpg`](image.jpg) and [`fire.gif`](fire.gif) reproduce the author's current setup.

> [!WARNING]
> This relies on the current Codex desktop UI structure. A major Codex update may require a theme update. It uses a separate app profile, so you may need to sign in again on first launch.

## Custom features

### macOS launcher and Dock

- Registers the theme bundle with AppKit and completes its launch before replacing the process with the signed app. This preserves the pinned Codex tile's bundle path and name and completes its launch animation.
- Keeps the installed app's bundle identifier while retaining the theme launcher's Dock identity. Matching the identifier alone does not prevent a separate ChatGPT tile; registration must happen before the executable handoff.
- Runs the theme worker in the background with inherited debugging pipes; the worker exits when the app closes those pipes.
- Preserves the official app's separate privacy-permission identity and signature.

### Chat surface

- Shows `image.jpg` behind the active chat surface with a 60% dark overlay, alongside a solid `#583FC4` project/chat sidebar with light text and darker hover/selection highlights. The narrow navigation rail retains its native appearance.
- Removes the native top and bottom surface fades so the wallpaper keeps one uniform dimming level from edge to edge.
- Applies translucent colors to the current input, dropdown, secondary, and code surfaces while preserving the app's native layout and controls.

### Codex Home Chat / Work toggle

- Adds a native-styled **Chat / Work** composer toggle to the center of the Codex titlebar only on new-chat screens. Opening an existing session removes it and restores its mode bridge.
- Keeps the toggle in a stable standalone DOM host so Home route changes never remount or reposition it.
- Connects the app's saved preference to the exact effective-mode subscription used by its Home route: **Chat** uses the Chat home interface, while **Work** returns to native Codex Home. It does not replace Home components or change the global product setting.
- Applies the selection to that subscription's scoped atom read so native dependency updates notify Home even when it no longer subscribes directly to the saved preference. Restores the original reads when the route is replaced or the theme is disposed.
- Commits mode changes synchronously and updates the selection only after the current React tree confirms the screen changed. Unsupported builds and restricted Chat access fail explicitly.
- Tracks the native mode owner when seat-enabled Chat replaces the shared composer Home. A stalled switch unlocks the buttons after two seconds without waiting for another UI update.
- Prefers live mode properties and the Home scope's exact subscription over component source signatures. Added wrappers, moved hooks, renamed setter arguments, and bundle formatting changes can be handled without a version-specific patch.
- Checks compatibility before patching subscriptions. If native internals are unsupported or ambiguous, it removes its own toggle and restores its owned hooks so the native interface remains available. Runtime diagnostics report the compatibility state and detection method.
- Leaves the toggle already rendered by ChatGPT and ChatGPT Work untouched.

### Task activity

- Outlines the current composer with a 2 px animated rainbow border while that task is running, following its native rounded corners and leaving the input background unchanged. The border fades out when the task finishes.
- Highlights the usage gauge marker while any visible or collapsed project has an active task.
- Shows the included transparent fire GIF rising from the person's raised hands for the active task. Each task keeps its own timer and grows the flames for up to five minutes.
- Keeps flames clipped to the chat surface and below chat text.

### Queued message editing

- Repairs local queued-message resubmission after the native editor removes the original queue entry. The replacement keeps its neighboring queue position and attachments.
- Applies only to server queue IDs whose successful deletion the theme observed. Existing updates, consumed messages, remote queues, and native undo keep their normal behavior; uncertain submissions are never retried automatically.

### Sidebar information

- Merges ChatGPT web projects and conversations into Codex mode's existing **Projects** and **Recents** sections without adding separate ChatGPT groups.
- Displays a watch-style rainbow usage gauge above the navigation rail’s Help button. The large center number is the remaining percentage; the lower left and right numbers are the reset month and day. Hover for the full reset timestamp. Unknown values show dashes.
- Keeps the custom usage gauge out of the Settings route and separate Settings window.
- Places the running-task spinner before the server name in collapsed SSH projects, keeping the latency bars at the right.
- Replaces matching SSH host status dots with four cellular-style latency bars:
  - 4 bars: 40 ms or less
  - 3 bars: 100 ms or less
  - 2 bars: 250 ms or less
  - 1 bar: slower than 250 ms
  - 0 bars: unavailable

## Requirements

- macOS 12 or later
- [Codex desktop](https://openai.com/codex/) or ChatGPT installed in `/Applications`
- Node.js 20 or later available as `node`

Both checked-in launchers are universal binaries for Apple Silicon and Intel.
Installation uses the bundled binaries without Xcode Command Line Tools. The
installer can compile the included native sources if a future architecture is
missing from the bundle. The official app's own system requirements also apply.

Windows preview requirements and installation are documented in the [root README](../README.md#windows-preview). Use `install.ps1` on Windows; the native macOS launchers are not used there. The Windows runtime detects Microsoft Store packages on each launch, uses a separate per-user profile, and launches Store apps through Windows package activation to preserve their updater identity. It requires Node.js 22 or later on Windows and connects the theme over a loopback-only CDP WebSocket. GUI verification must run outside restricted agent sessions that deny app activation.

## Install

```sh
git clone https://github.com/aloedawn/codex-theme.git
cd codex-theme/Work_to_Codex
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
cd codex-theme/Work_to_Codex
git pull --ff-only
./install.sh
```

Quit the themed Codex instance before reinstalling, then reopen it from the Dock.
When updating an older launcher, remove its old Dock pin and drag the installed
`Codex.app` back to the same position so macOS refreshes its bundle identity.

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

The background may be JPEG or PNG. The fire asset must be an animated GIF with transparency. The bundled fire coordinates are calibrated for the included 4032×3024 background; another photo may need adjusted coordinates in the standalone bundle.

## SSH signal bars

The launcher reads only concrete matching entries from `~/.ssh/config` for these aliases:

```text
VPN, Proxmox, Homelab, Oracle_seoul, Oracle_osaka, Oracle_chuncheon
```

Those are the author's personal defaults, not a required server list. Each value must match a concrete `Host` alias in `~/.ssh/config` and its Codex sidebar label. Wildcard aliases containing `*`, `!`, or `?` are ignored. The standalone bundle contains this default list.

The launcher performs a TCP connection timing check against each configured host and port every 15 seconds. It does not authenticate or run SSH commands. If the configured aliases are absent, the feature simply stays hidden.

## How it works

- Starts the official Codex or ChatGPT executable through a native app launcher with Chromium's `--remote-debugging-pipe`.
- Makes the official app responsible for its own macOS privacy requests, including requests from its audio and capture helpers. The native launcher replaces itself with the app so process lifetime and pipe ownership remain unchanged.
- Uses inherited process pipes rather than exposing a remote-debugging TCP port. Dock launches keep the app as the parent and the theme worker as its child; terminal launches keep the terminal-owned worker as the parent.
- Stores the separate profile in `~/Library/Application Support/Codex Theme`.
- Attaches once to each Codex page and installs a versioned, single-instance UI runtime.
- Uses the current app-shell, composer, navigation rail, and surface tokens.
- Keeps animation nodes alive across activity fades and updates DOM only when state actually changes.
- Reads the canonical Codex limit from the bundled `codex app-server`, retains the app's own `/wham/usage` response as a compatibility fallback, and caches the latest result locally for up to six hours.
- Leaves `/Applications/ChatGPT.app`, `/Applications/Codex.app`, and their `app.asar` files untouched.

## Distribution and compatibility

App version 26.928.20755 restarts at startup to match its in-app browser policy.
For installations where that feature is disabled, both launch paths now pass
`--codex-browser-background-networking-disabled` immediately. This avoids a native
restart that discards the theme profile and debugging pipes. This startup default
assumes the in-app browser remains disabled.

The repository ships the standalone `codex-theme.mjs`, assets, installer, and
native launcher sources/binaries. Development modules, fixtures, tests, and npm
dependencies remain local and are not needed for installation.
No login data, profile contents, SSH configuration, usage cache, or machine-specific
absolute checkout paths are shipped. On another Mac, install the official app and
Node.js, clone this repository, run the installer, then sign in to the separate
theme profile. The bundled assets are included.

The current Home adapter is tested against captured app version 26.930.41038
exports and components, including switching into the seat-enabled Chat Home and
back to Work. Live UI verification after restarting the app remains required.
It uses scoped
Chat / Work mode selection, shared-module imports, native Home input controllers,
navigation-rail gauge placement, and the split composer scrim. Older Home-mode
setters, embedded ReactDOM discovery, profile-footer gauge placement, and the
root-level usage CLI path are no longer supported. The Chat / Work bridge resolves
the primitive wrapper around the current keyed mode selector so the tabs can mount
on the new Home route. It also adapts the wrapper’s scoped, read-only mode
dependency so cached Work values notify React when a tab requests Chat. The
original reads are restored when the bridge closes.

Compatibility detection runs when a new-chat screen is reconciled. The local
regression suite covers captured native builds plus simulated component renames,
inserted wrappers, moved subscription hooks, changed dependency ordering, and
reformatted or renamed module bindings. This reduces routine update breakage;
changes to the underlying Home mode contract can still require an adapter update.

The usage gauge reads the limiting usage window: the window with the highest
percentage used, preferring the longer window when percentages are equal.
Reset dates use the Mac’s local timezone and display as month / day. The gauge
has extra horizontal breathing room in the rail, stays out of Settings, and
keeps the native Help and profile controls available.

Usage refreshes at launch and every 60 seconds through the app's bundled Codex
CLI. The theme starts a separate usage-only app-server process for each check
and terminates it as soon as the check succeeds or fails, releasing its memory
between checks. This adds a brief CLI startup to each refresh; it does not stop
the app's own task-running server. The packaged `Resources/codex-cli/bin/codex` shim and its nested
`CodexCLI.app` executable are supported. The launcher logs the selected CLI path;
an unavailable CLI is reported explicitly instead of silently disabling polling.

## Troubleshooting

### Repeated screen recording prompts, visualizer permission errors, or voice crashes

Older launchers made the theme app responsible for the official app and its
capture helpers. macOS could then evaluate the theme launcher's permissions and
usage descriptions instead of the official app's. Rebuilding the ad-hoc-signed
theme launcher could also change its code identity.

Reinstall with `./install.sh`, then fully quit the themed instance and reopen it
from `~/Applications/Codex Theme/Codex.app`. The installed `CodexAppLauncher`
starts the official app with its own responsibility chain, preserving normal
macOS permission checks and the existing CDP pipes. Both the app icon and the
command-line entry point use this path. Updating only `codex-theme.mjs` is not
sufficient for an older installation.

The helper uses the macOS `responsibility_spawnattrs_setdisclaim` spawn SPI,
resolved at runtime as in [LLDB](https://lldb.llvm.org/cpp_reference/PosixSpawnResponsible_8h_source.html).
If the API becomes unavailable, startup fails explicitly. It does not reset or
modify the privacy database, grant permissions, or patch the official app.
Permissions for the official app and Codex Computer Use still need to be allowed
in System Settings. Existing theme-launcher permission entries can remain in
place; the installer does not remove them.

### Launcher diagnostics

On Windows, inspect `runtime\logs\*-error.log` in the theme installation and
run `runtime\Launch Codex Theme.ps1 -Console` for live output. `--app` overrides
automatic detection; `--profile` selects an alternative dedicated profile.
Never point it at an official app profile that is already in use. If startup
is denied inside an agent sandbox, open the installed Start menu shortcut from
the ordinary desktop. The host tests do not require a running GUI.

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
