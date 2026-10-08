# Codex Theme

An installable macOS theme, with a Windows preview, for the official Codex or ChatGPT app. It adds the
current photo background, purple sidebar, animated task effects, Chat / Work
toggle, and a watch-style usage gauge above the navigation rail’s Help button.
ChatGPT projects and conversations appear in the existing sidebar sections.

The center number is the remaining percentage. The lower left and right numbers
show the reset month and day. Hover for the full reset date and time.

## Install

### Windows (preview)

Requires the official Windows Codex/ChatGPT desktop app and Node.js 20 or later.
Microsoft Store packages and ordinary desktop installations are detected on
each launch. No administrator access or app-bundle patch is required.

```powershell
git clone -b windows-support https://github.com/aloedawn/codex-theme.git
cd codex-theme
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Open **Codex Theme** from the Start menu. The installer stores the runtime in
`%LOCALAPPDATA%\Codex Theme\runtime` and uses a separate profile in
`%LOCALAPPDATA%\Codex Theme\profile`. Sign in on first launch. The PowerShell
launcher runs its Node worker without a console window and records logs under
`runtime\logs`. Closing the themed app also closes its worker.

For a portable installation or a nonstandard app location:

```powershell
.\install.ps1 -InstallDirectory 'D:\Codex Theme' -NoShortcut
# Optional explicit executable, if automatic detection fails:
.\install.ps1 -AppExecutable 'D:\Codex\ChatGPT.exe'
& 'D:\Codex Theme\runtime\Launch Codex Theme.ps1' -Console
```

Current Store builds ship `Codex.exe` as an activation stub and `ChatGPT.exe`
as the actual Chromium runtime. Automatic detection selects the runtime so it
inherits the debugging pipes. Use the runtime executable with `-AppExecutable`.

Windows host tests and installation checks are available below. Full visual
verification remains required in an ordinary desktop session: restricted agent
sessions may deny Windows app activation or close the runtime during startup.

### macOS

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

On Windows, run the PowerShell installer above. The `.command`, `.sh`, and
native macOS launchers remain specific to macOS.

To update Windows, close the themed app, run `git pull --ff-only`, and rerun
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` with the
same installation options. The installer preserves the separate profile.

## Remove the launcher

Quit the themed app and move `~/Applications/Codex Theme` to the Trash. The
separate profile remains available for reinstalling. The official app continues
to work normally.

On Windows, close the themed app, remove the **Codex Theme** Start menu shortcut,
and remove the `runtime` subdirectory. Keep `profile` to preserve the theme's
sign-in and preferences, or remove the entire theme directory to reset it.

## Verify the Windows host

```powershell
node --test Work_to_Codex/tests/windows.test.mjs
node Work_to_Codex/codex-theme.mjs --dry-run
# From an ordinary desktop session; saves a diagnostic screenshot then closes:
node Work_to_Codex/codex-theme.mjs --screenshot theme-check.png --inspect-ui --exit-after-screenshot
```

## Repository contents

GitHub contains only the installation bundle, native launcher sources and universal binaries,
assets, entry scripts, and documentation. No npm install or build step is needed.
Windows host regression tests are included. Other development modules,
dependencies, profiles, settings, logs, and local backups are excluded from Git.
The installer uses the bundled launchers and checks them before installation
completes. Native sources remain available for future launcher changes.
