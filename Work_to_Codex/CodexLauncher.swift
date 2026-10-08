import AppKit

if CommandLine.arguments.dropFirst().first == "--check" {
    print("codex-theme-launcher 4")
    exit(0)
}

let files = FileManager.default
let bundle = Bundle.main.bundleURL
let project = bundle.deletingLastPathComponent()
let script = project.appendingPathComponent("codex-theme.mjs")
let helper = bundle.appendingPathComponent("Contents/MacOS/CodexAppLauncher")
let paths = ProcessInfo.processInfo.environment["PATH"]?.split(separator: ":").map { String($0) + "/node" } ?? []
let nodes = paths + ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
let apps = ["/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", "/Applications/Codex.app/Contents/MacOS/Codex"]

guard files.fileExists(atPath: script.path), files.isExecutableFile(atPath: helper.path),
    let node = nodes.first(where: { files.isExecutableFile(atPath: $0) }),
    let app = apps.first(where: { files.isExecutableFile(atPath: $0) }) else {
    fputs("Codex theme launcher: app, Node.js, or theme installation is missing\n", stderr)
    exit(1)
}
let logPath = ProcessInfo.processInfo.environment["CODEX_THEME_LOG_PATH"] ?? "/private/tmp/codex-theme-launcher.log"
let log = open(logPath, O_WRONLY | O_CREAT | O_APPEND, 0o600)
guard log >= 0 else { perror("Codex theme log"); exit(1) }
dup2(log, STDOUT_FILENO)
dup2(log, STDERR_FILENO)
if log > STDERR_FILENO { close(log) }
let profile = files.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Codex Theme")
let arguments = [helper.path, "--gui", node, script.path, app,
    // Match the disabled in-app browser policy at native startup. The new
    // framework's policy relaunch drops the theme profile and debugging pipes.
    "--codex-browser-background-networking-disabled",
    "--remote-debugging-pipe", "--user-data-dir=\(profile.path)", "--no-first-run"]
let argv = arguments.map { strdup($0) } + [nil]
// Register this bundle before exec. Otherwise the signed app's first AppKit
// check-in replaces the pinned launcher's Dock identity with its own path.
// Finish the original launch so its tile also stops the launch animation.
NSApplication.shared.finishLaunching()
// Preserve the original Dock-launched PID all the way into the signed app.
// The helper forks only the background theme worker, then execs the app here.
_ = argv.withUnsafeBufferPointer { buffer in
    execv(helper.path, buffer.baseAddress!)
}
perror("Codex theme exec")
exit(1)
