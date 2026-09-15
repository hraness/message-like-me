import Foundation
import Darwin

private struct Failure: Error { let message: String }
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw Failure(message: message) }
}
private func rejects(_ action: () throws -> Void) throws {
    do { try action() } catch { return }
    throw Failure(message: "Expected rejection")
}
private func fixture(revision: Int = 2, paused: Bool = true, extra: String = "") -> Data {
    Data(("{\"protocol\":\"textbutler.control.v1\",\"ok\":true,\"kind\":\"snapshot\",\"snapshot\":{\"protocol\":\"textbutler.control.v1\",\"revision\":\(revision),\"connection\":\"connected\",\"detail\":\"Synthetic\",\"settings\":{\"paused\":\(paused),\"activeContactLimit\":5},\"contacts\":[],\"capabilities\":[{\"id\":\"messages\",\"status\":\"available\",\"detail\":\"Synthetic\"}],\"activity\":[{\"id\":\"a1\",\"at\":\"2026-09-14T00:00:00Z\",\"title\":\"Synthetic event\",\"detail\":\"No user data\"}],\"providerAccounts\":[{\"id\":\"demo\",\"label\":\"Synthetic account\",\"provider\":\"claude\",\"route\":\"claude-api\",\"defaultReplyModel\":\"fixture-reply\",\"classifierModel\":\"fixture-classifier\",\"status\":\"ready\",\"detail\":\"Synthetic readiness\"}]}\(extra)}\n").utf8)
}

/// Isolated one-client fixture. It never touches the installed daemon or user home.
private final class Server {
    let directory: String
    let path: String
    private let listener: Int32
    private let done = DispatchGroup()
    init(readRequest: Bool = true, handler: @escaping (Int32, Data) -> Void) throws {
        guard let temporary = realpath(FileManager.default.temporaryDirectory.path, nil) else {
            throw Failure(message: "Temporary directory is unavailable")
        }
        directory = String(cString: temporary) + "/tbm-" + UUID().uuidString.prefix(8)
        free(temporary)
        path = directory + "/daemon.sock"
        guard mkdir(directory, 0o700) == 0 else { throw Failure(message: "mkdir") }
        listener = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { throw Failure(message: "socket") }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            Darwin.close(listener)
            try? FileManager.default.removeItem(atPath: directory)
            throw Failure(message: "Temporary socket path is too long")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { target in
            for (index, byte) in bytes.enumerated() { target[index] = byte }
        }
        let bound = withUnsafePointer(to: &address) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(listener, 1) == 0 else { throw Failure(message: "bind/listen") }
        done.enter()
        let fd = listener, group = done
        DispatchQueue.global().async {
            defer { group.leave() }
            var ready = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            guard poll(&ready, 1, 1500) > 0 else { return }
            let client = accept(fd, nil, nil)
            guard client >= 0 else { return }
            defer { Darwin.close(client) }
            var noSignal: Int32 = 1
            _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
            var timeout = timeval(tv_sec: 1, tv_usec: 0)
            _ = setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            _ = setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            if !readRequest { handler(client, Data()); return }
            var request = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while request.count <= maxControlFrame {
                let count = buffer.withUnsafeMutableBytes { Darwin.read(client, $0.baseAddress, $0.count) }
                if count <= 0 { return }
                request.append(contentsOf: buffer.prefix(count))
                if request.contains(10) { handler(client, request); return }
            }
        }
    }
    deinit {
        _ = done.wait(timeout: .now() + 2)
        Darwin.close(listener)
        try? FileManager.default.removeItem(atPath: directory)
    }
}

private func send(_ fd: Int32, _ data: Data) {
    var offset = 0
    while offset < data.count {
        let written = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: offset), data.count - offset) }
        if written <= 0 { return }
        offset += written
    }
}

@main
struct MenuControlTests {
    static func main() throws {
        var passed = 0
        func test(_ name: String, _ run: () throws -> Void) throws {
            try run(); passed += 1; print("PASS \(name)")
        }
        try test("Snapshot exposes account readiness, capabilities and activity") {
            let server = try Server { fd, _ in send(fd, fixture()) }
            let snapshot = try ControlClient(socketPath: server.path).request(command: "snapshot")
            try expect(snapshot.revision == 2 && snapshot.settings.paused, "Snapshot state")
            try expect(snapshot.providerAccounts?.first?.status == "ready", "Account readiness")
            try expect(snapshot.capabilities.first?.id == "messages" && snapshot.activity.first?.id == "a1", "Rich glance fields")
        }
        try test("Pause mutation preserves command and expected revision") {
            let server = try Server { fd, request in
                let body = try! JSONSerialization.jsonObject(with: request) as! [String: Any]
                if body["command"] as? String == "global.settings.update", body["expectedRevision"] as? Int == 2 {
                    send(fd, fixture(revision: 3, paused: false))
                }
            }
            let snapshot = try ControlClient(socketPath: server.path).request(command: "global.settings.update", fields: [
                "expectedRevision": 2, "settings": ["paused": false, "activeContactLimit": 5],
            ])
            try expect(snapshot.revision == 3 && !snapshot.settings.paused, "Mutation response")
        }
        try test("Rejects unsafe parent before sending a request") {
            let server = try Server { _, _ in fatalError("Unsafe parent was contacted") }
            chmod(server.directory, 0o755)
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
        }
        try test("Rejects a symlinked parent and socket") {
            let server = try Server { _, _ in fatalError("Symlink was contacted") }
            let alias = server.directory + "-alias"
            defer { unlink(alias) }
            guard symlink(server.directory, alias) == 0 else { throw Failure(message: "symlink") }
            try rejects { _ = try ControlClient(socketPath: alias + "/daemon.sock").request(command: "snapshot") }
            let socketAlias = server.directory + "/alias.sock"
            guard symlink(server.path, socketAlias) == 0 else { throw Failure(message: "socket symlink") }
            try rejects { _ = try ControlClient(socketPath: socketAlias).request(command: "snapshot") }
        }
        try test("Rejects non-private socket") {
            let server = try Server { _, _ in fatalError("Unsafe socket was contacted") }
            chmod(server.path, 0o666)
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
        }
        try test("Slow trickle cannot extend the absolute deadline") {
            let server = try Server { fd, _ in
                for _ in 0..<20 { send(fd, Data([32])); usleep(20_000) }
            }
            let started = ProcessInfo.processInfo.systemUptime
            try rejects { _ = try ControlClient(socketPath: server.path, timeout: 0.08).request(command: "snapshot") }
            try expect(ProcessInfo.processInfo.systemUptime - started < 0.3, "Deadline must include every read")
        }
        try test("Accepts exact frame limit including newline") {
            let base = fixture(extra: ",\"padding\":\"\"")
            let data = fixture(extra: ",\"padding\":\"" + String(repeating: "x", count: maxControlFrame - base.count) + "\"")
            try expect(data.count == maxControlFrame, "Fixture boundary")
            let server = try Server { fd, _ in send(fd, data) }
            _ = try ControlClient(socketPath: server.path).request(command: "snapshot")
        }
        try test("Rejects one byte over the frame limit even with newline") {
            let base = fixture(extra: ",\"padding\":\"\"")
            let data = fixture(extra: ",\"padding\":\"" + String(repeating: "x", count: maxControlFrame + 1 - base.count) + "\"")
            let server = try Server { fd, _ in send(fd, data) }
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
        }
        try test("Rejects trailing frame data and invalid response kind") {
            let server = try Server { fd, _ in send(fd, fixture() + Data([88])) }
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
            let invalid = try Server { fd, _ in send(fd, Data("{\"protocol\":\"textbutler.control.v1\",\"ok\":true,\"kind\":\"job\"}\n".utf8)) }
            try rejects { _ = try ControlClient(socketPath: invalid.path).request(command: "snapshot") }
        }
        try test("Rejects duplicate identities and unknown snapshot state") {
            var body = try JSONSerialization.jsonObject(with: fixture()) as! [String: Any]
            var snapshot = body["snapshot"] as! [String: Any]
            snapshot["capabilities"] = Array(repeating: ["id": "messages", "status": "available", "detail": "fixture"], count: 2)
            body["snapshot"] = snapshot
            let bytes = try JSONSerialization.data(withJSONObject: body) + Data([10])
            let server = try Server { fd, _ in send(fd, bytes) }
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
            snapshot["connection"] = "invented"; body["snapshot"] = snapshot
            let invalid = try JSONSerialization.data(withJSONObject: body) + Data([10])
            let second = try Server { fd, _ in send(fd, invalid) }
            try rejects { _ = try ControlClient(socketPath: second.path).request(command: "snapshot") }
        }
        try test("Ready accounts require qualified route and both model identities") {
            for variant in 0..<5 {
                var body = try JSONSerialization.jsonObject(with: fixture()) as! [String: Any]
                var snapshot = body["snapshot"] as! [String: Any]
                var account = (snapshot["providerAccounts"] as! [[String: Any]])[0]
                switch variant {
                case 0: account["provider"] = "codex"; account["route"] = "codex"
                case 1: account["route"] = "claude-code"
                case 2: account["classifierModel"] = NSNull()
                case 3: account.removeValue(forKey: "defaultReplyModel")
                default: account["provider"] = "codex"
                }
                snapshot["providerAccounts"] = [account]; body["snapshot"] = snapshot
                let bytes = try JSONSerialization.data(withJSONObject: body) + Data([10])
                let server = try Server { fd, _ in send(fd, bytes) }
                try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
            }
        }
        try test("Display fields enforce the shared protocol bounds before presentation") {
            for variant in 0..<3 {
                var body = try JSONSerialization.jsonObject(with: fixture()) as! [String: Any]
                var snapshot = body["snapshot"] as! [String: Any]
                if variant == 0 {
                    var account = (snapshot["providerAccounts"] as! [[String: Any]])[0]
                    account["label"] = String(repeating: "x", count: 101)
                    snapshot["providerAccounts"] = [account]
                } else if variant == 1 {
                    var activity = (snapshot["activity"] as! [[String: Any]])[0]
                    activity["detail"] = String(repeating: "x", count: 4_097)
                    snapshot["activity"] = [activity]
                } else {
                    var capability = (snapshot["capabilities"] as! [[String: Any]])[0]
                    capability["detail"] = String(repeating: "x", count: 4_097)
                    snapshot["capabilities"] = [capability]
                }
                body["snapshot"] = snapshot
                let bytes = try JSONSerialization.data(withJSONObject: body) + Data([10])
                let server = try Server { fd, _ in send(fd, bytes) }
                try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
            }
        }
        try test("Managed sign-in is distinct from qualified account readiness") {
            for variant in 0..<3 {
                var body = try JSONSerialization.jsonObject(with: fixture()) as! [String: Any]
                var snapshot = body["snapshot"] as! [String: Any]
                var account = (snapshot["providerAccounts"] as! [[String: Any]])[0]
                account["provider"] = "codex"; account["route"] = "codex"; account["status"] = "setup-required"
                var managed: [String: Any] = ["state": "signed-in", "generation": 2, "modelCount": 3, "pendingLoginId": NSNull()]
                if variant == 1 { managed["state"] = "signed-out" }
                if variant == 2 { managed.removeValue(forKey: "pendingLoginId") }
                account["managedAccount"] = managed; snapshot["providerAccounts"] = [account]; body["snapshot"] = snapshot
                let bytes = try JSONSerialization.data(withJSONObject: body) + Data([10])
                let server = try Server { fd, _ in send(fd, bytes) }
                if variant == 0 {
                    let result = try ControlClient(socketPath: server.path).request(command: "snapshot")
                    try expect(result.providerAccounts?.first?.status == "setup-required", "Sign-in does not imply readiness")
                } else {
                    try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
                }
            }
        }
        try test("Closed peer is an error without process termination") {
            let server = try Server { fd, _ in _ = Darwin.shutdown(fd, SHUT_RDWR) }
            try rejects { _ = try ControlClient(socketPath: server.path).request(command: "snapshot") }
        }
        try test("Peer disconnect during a large write cannot raise SIGPIPE") {
            let server = try Server(readRequest: false) { fd, _ in _ = Darwin.shutdown(fd, SHUT_RDWR) }
            try rejects {
                _ = try ControlClient(socketPath: server.path).request(command: "global.settings.update", fields: [
                    "expectedRevision": 2, "settings": ["fixture": String(repeating: "x", count: 900_000)],
                ])
            }
        }
        try test("Unknown command cannot open a socket") {
            try rejects { _ = try ControlClient(socketPath: "/nonexistent/socket").request(command: "send.message") }
        }
        try test("Labels are bounded, single line, and remove direction overrides") {
            try expect(menuLabel(" A\nB\t\u{202E}C  ") == "A B C", "Control stripping")
            try expect(menuLabel(String(repeating: "👨‍👩‍👧‍👦", count: 100), limit: 5).count == 5, "Grapheme limit")
        }
        try test("Refresh storms coalesce and mutations cannot overlap reads") {
            var gate = MenuRequestGate()
            let first = gate.beginRefresh()!
            for _ in 0..<1_000 { try expect(gate.beginRefresh() == nil, "Coalesced request") }
            try expect(gate.beginMutation() == nil, "No overlapping mutation")
            try expect(!gate.finish(first + 1), "Late completion ignored")
            try expect(gate.finish(first) && gate.takePendingRefresh(), "One follow-up refresh")
            try expect(!gate.takePendingRefresh(), "Follow-up consumed once")
            let mutation = gate.beginMutation()!
            try expect(gate.beginRefresh() == nil, "Read waits for mutation")
            try expect(!gate.finish(first), "Old refresh cannot finish mutation")
            try expect(gate.finish(mutation) && gate.takePendingRefresh(), "Read after mutation")
        }
        print("\(passed) native menu tests passed")
    }
}
