import Foundation

let fileManager = FileManager.default
let projectURL = Bundle.main.bundleURL.deletingLastPathComponent()
let scriptURL = projectURL.appendingPathComponent("codex-theme.mjs")
let logURL = URL(fileURLWithPath: "/private/tmp/codex-theme-launcher.log")

guard fileManager.fileExists(atPath: scriptURL.path) else {
    fputs("Codex theme script not found: \(scriptURL.path)\n", stderr)
    exit(1)
}

if !fileManager.fileExists(atPath: logURL.path) {
    fileManager.createFile(atPath: logURL.path, contents: nil)
}

let logHandle = try FileHandle(forWritingTo: logURL)
try logHandle.seekToEnd()

let inheritedNodePaths = ProcessInfo.processInfo.environment["PATH"]?
    .split(separator: ":")
    .map { String($0) + "/node" } ?? []
let nodeCandidates = inheritedNodePaths + [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
]

guard let nodePath = nodeCandidates.first(where: { fileManager.isExecutableFile(atPath: $0) }) else {
    let message = "Codex theme launcher failed: Node.js executable not found\n"
    if let data = message.data(using: .utf8) {
        try? logHandle.write(contentsOf: data)
    }
    try? logHandle.close()
    exit(1)
}

let process = Process()
process.executableURL = URL(fileURLWithPath: nodePath)
process.arguments = [scriptURL.path]
process.standardOutput = logHandle
process.standardError = logHandle

do {
    try process.run()
    process.waitUntilExit()
    try? logHandle.close()
    exit(process.terminationStatus)
} catch {
    let message = "Codex theme launcher failed: \(error.localizedDescription)\n"
    if let data = message.data(using: .utf8) {
        try? logHandle.write(contentsOf: data)
    }
    try? logHandle.close()
    exit(1)
}
