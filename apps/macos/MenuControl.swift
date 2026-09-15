import Foundation
import Darwin

let controlProtocol = "textbutler.control.v1"
let maxControlFrame = 1_048_576 // Includes the newline, as in daemon.ts.

enum ControlError: Error {
    case unavailable(String)
    case invalid(String)
}

/// Presentation never lets daemon text add lines, bidi overrides or unbounded menus.
func menuLabel(_ text: String, limit: Int = 72) -> String {
    let clean = text.unicodeScalars.map { scalar -> String in
        if CharacterSet.controlCharacters.contains(scalar) || CharacterSet.newlines.contains(scalar)
            || (0x202A...0x202E).contains(scalar.value) || (0x2066...0x2069).contains(scalar.value) {
            return " "
        }
        return String(scalar)
    }.joined().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    guard clean.count > limit else { return clean }
    return String(clean.prefix(max(0, limit - 1))) + "…"
}

struct Snapshot: Decodable {
    struct Settings: Decodable { let paused: Bool; let activeContactLimit: Int }
    struct Contact: Decodable {
        let id: String; let name: String; let subtitle: String; let settings: ContactSettings
        struct ContactSettings: Decodable { let enabled: Bool; let responseMode: String; let provider: String }
    }
    struct Automation: Decodable { let state: String; let detail: String }
    struct Account: Decodable {
        let id: String; let label: String; let status: String; let detail: String
        let provider: String; let route: String
        let defaultReplyModel: String?; let classifierModel: String?
        struct Managed: Decodable {
            let state: String; let generation: Int; let modelCount: Int; let pendingLoginId: String?
            enum CodingKeys: String, CodingKey { case state, generation, modelCount, pendingLoginId }
            init(from decoder: Decoder) throws {
                let fields = try decoder.container(keyedBy: CodingKeys.self)
                state = try fields.decode(String.self, forKey: .state)
                generation = try fields.decode(Int.self, forKey: .generation)
                modelCount = try fields.decode(Int.self, forKey: .modelCount)
                pendingLoginId = try fields.decode(String?.self, forKey: .pendingLoginId)
            }
        }
        let managedAccount: Managed?
        enum CodingKeys: String, CodingKey {
            case id, label, status, detail, provider, route, defaultReplyModel, classifierModel
            case managedAccount
        }
        init(from decoder: Decoder) throws {
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            id = try fields.decode(String.self, forKey: .id)
            label = try fields.decode(String.self, forKey: .label)
            status = try fields.decode(String.self, forKey: .status)
            detail = try fields.decode(String.self, forKey: .detail)
            provider = try fields.decode(String.self, forKey: .provider)
            route = try fields.decode(String.self, forKey: .route)
            // Null is explicit in textbutler.control.v1; missing model fields are invalid.
            defaultReplyModel = try fields.decode(String?.self, forKey: .defaultReplyModel)
            classifierModel = try fields.decode(String?.self, forKey: .classifierModel)
            managedAccount = fields.contains(.managedAccount) ? try fields.decode(Managed.self, forKey: .managedAccount) : nil
        }
    }
    struct Capability: Decodable { let id: String; let status: String; let detail: String }
    struct Activity: Decodable { let id: String; let at: String; let title: String; let detail: String }
    let protocolName: String
    let revision: Int
    let connection: String
    let detail: String
    let settings: Settings
    let contacts: [Contact]
    let automation: Automation?
    let providerAccounts: [Account]?
    let capabilities: [Capability]
    let activity: [Activity]
    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol", revision, connection, detail, settings, contacts, automation
        case providerAccounts, capabilities, activity
    }

    func validate() throws {
        func bounded(_ value: String, _ limit: Int) -> Bool { value.utf16.count <= limit }
        let accounts = providerAccounts ?? []
        for account in accounts {
            if let managed = account.managedAccount {
                guard account.route == "codex", account.status != "ready",
                      ["unchecked", "signed-out", "signing-in", "signed-in", "unavailable", "recovery-required", "closed"].contains(managed.state),
                      (0...9_007_199_254_740_991).contains(managed.generation), (0...5_000).contains(managed.modelCount),
                      managed.state == "signed-in" || managed.modelCount == 0,
                      managed.pendingLoginId == nil || bounded(managed.pendingLoginId!, 160)
                        && managed.pendingLoginId!.range(of: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$", options: .regularExpression) != nil else {
                    throw ControlError.invalid("The daemon returned invalid managed account readiness.")
                }
            }
        }
        guard protocolName == controlProtocol, (0...9_007_199_254_740_991).contains(revision),
              ["connected", "disconnected", "demo"].contains(connection),
              bounded(detail, 4_096),
              (1...50).contains(settings.activeContactLimit), contacts.count <= 1_000,
              capabilities.count <= 9, activity.count <= 200, (providerAccounts?.count ?? 0) <= 10,
              Set(contacts.map(\.id)).count == contacts.count,
              Set(capabilities.map(\.id)).count == capabilities.count,
              Set((providerAccounts ?? []).map(\.id)).count == (providerAccounts?.count ?? 0),
              contacts.allSatisfy({ bounded($0.id, 256) && bounded($0.name, 256) && bounded($0.subtitle, 512)
                  && ["smart", "keyword"].contains($0.settings.responseMode)
                  && ["codex", "claude"].contains($0.settings.provider) }),
              capabilities.allSatisfy({ ["messages", "contacts", "agent", "attachments", "reactions", "stickers", "links", "polls", "mini-apps"].contains($0.id)
                  && ["available", "setup-required", "unsupported"].contains($0.status) && bounded($0.detail, 4_096) }),
              activity.allSatisfy({ bounded($0.id, 256) && bounded($0.at, 64) && bounded($0.title, 256) && bounded($0.detail, 4_096) }),
              accounts.allSatisfy({ account in
                  bounded(account.id, 80) && account.id.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$", options: .regularExpression) != nil
                  && bounded(account.label, 100) && bounded(account.detail, 512)
                  && ["ready", "setup-required", "unavailable"].contains(account.status)
                  && ["claude-api", "claude-code", "codex"].contains(account.route)
                  && account.provider == (account.route == "codex" ? "codex" : "claude")
                  && bounded(account.defaultReplyModel ?? "", 160) && bounded(account.classifierModel ?? "", 160)
                  && (account.status != "ready" || account.route == "claude-api"
                      && !(account.defaultReplyModel ?? "").isEmpty && !(account.classifierModel ?? "").isEmpty)
              }),
              automation == nil || ["running", "paused", "unavailable"].contains(automation!.state) && bounded(automation!.detail, 512) else {
            throw ControlError.invalid("The daemon returned an invalid snapshot.")
        }
    }
}

struct ControlResponse: Decodable {
    let protocolName: String
    let ok: Bool
    let kind: String?
    let snapshot: Snapshot?
    let code: String?
    let message: String?
    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol", ok, kind, snapshot, code, message
    }
}

struct FileIdentity: Equatable { let device: dev_t; let inode: ino_t }

/// Validate the full physical path and the owner-only immediate directory.
@discardableResult
func privateDirectory(_ path: String) throws -> FileIdentity {
    guard path.hasPrefix("/"), let physical = realpath(path, nil) else {
        throw ControlError.unavailable("The Textbutler data directory is unavailable.")
    }
    defer { free(physical) }
    var info = stat()
    guard String(cString: physical) == path, lstat(path, &info) == 0,
          info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
        throw ControlError.invalid("The Textbutler data directory must be physical, owned and private.")
    }
    return FileIdentity(device: info.st_dev, inode: info.st_ino)
}

final class ControlClient {
    private let socketPath: String
    private let timeout: TimeInterval
    init(socketPath: String, timeout: TimeInterval = 4) { self.socketPath = socketPath; self.timeout = timeout }

    private func validateSocket() throws -> (FileIdentity, FileIdentity) {
        let parent = (socketPath as NSString).deletingLastPathComponent
        let directory = try privateDirectory(parent)
        var info = stat()
        guard lstat(socketPath, &info) == 0 else { throw ControlError.unavailable("The Textbutler daemon is not running.") }
        guard info.st_mode & S_IFMT == S_IFSOCK, info.st_uid == getuid(), info.st_mode & 0o777 == 0o600 else {
            throw ControlError.invalid("The Textbutler control socket is unsafe.")
        }
        return (directory, FileIdentity(device: info.st_dev, inode: info.st_ino))
    }

    private func wait(_ fd: Int32, events: Int16, until deadline: TimeInterval) throws {
        while true {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw ControlError.unavailable("The Textbutler control request timed out.") }
            var item = pollfd(fd: fd, events: events, revents: 0)
            let result = Darwin.poll(&item, 1, Int32(min(ceil(remaining * 1_000), Double(Int32.max))))
            if result < 0 && errno == EINTR { continue }
            guard result > 0 else { throw ControlError.unavailable("The Textbutler control request timed out.") }
            guard item.revents & Int16(POLLNVAL) == 0 else { throw ControlError.unavailable("The Textbutler connection is unavailable.") }
            // HUP/ERR also wake the next read/write, which reports EOF or its error.
            return
        }
    }

    private func connectSocket(until deadline: TimeInterval) throws -> Int32 {
        let before = try validateSocket()
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ControlError.unavailable("Unable to open the Textbutler control socket.") }
        var retained = false
        defer { if !retained { Darwin.close(descriptor) } }
        var noSignal: Int32 = 1
        guard setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0,
              fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0 else {
            throw ControlError.unavailable("Unable to secure the Textbutler connection.")
        }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let pathBytes = Array(socketPath.utf8) + [0]
        guard !socketPath.utf8.contains(0), pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw ControlError.invalid("The control socket path is too long or invalid.")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (index, byte) in pathBytes.enumerated() { buffer[index] = byte }
        }
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if connected != 0 {
            guard errno == EINPROGRESS || errno == EAGAIN || errno == EINTR else {
                throw ControlError.unavailable("The Textbutler daemon is unavailable.")
            }
            try wait(descriptor, events: Int16(POLLOUT), until: deadline)
            var error: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &error, &length) == 0, error == 0 else {
                throw ControlError.unavailable("The Textbutler daemon is unavailable.")
            }
        }
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(descriptor, &uid, &gid) == 0, uid == getuid() else {
            throw ControlError.invalid("The Textbutler peer is not owned by the current user.")
        }
        let after = try validateSocket()
        guard before.0 == after.0 && before.1 == after.1 else {
            throw ControlError.invalid("The Textbutler control socket changed during connection.")
        }
        retained = true
        return descriptor
    }

    func request(command: String, fields: [String: Any] = [:]) throws -> Snapshot {
        guard command == "snapshot" && fields.isEmpty
            || command == "global.settings.update" && Set(fields.keys) == Set(["expectedRevision", "settings"]) else {
            throw ControlError.invalid("Unsupported menu control request.")
        }
        var payload: [String: Any] = ["protocol": controlProtocol, "command": command]
        fields.forEach { payload[$0.key] = $0.value }
        guard JSONSerialization.isValidJSONObject(payload) else { throw ControlError.invalid("Invalid control request.") }
        var frame = try JSONSerialization.data(withJSONObject: payload)
        frame.append(10)
        guard frame.count <= maxControlFrame else { throw ControlError.invalid("Control request exceeds its limit.") }
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        let descriptor = try connectSocket(until: deadline)
        defer { Darwin.close(descriptor) }
        var offset = 0
        while offset < frame.count {
            try wait(descriptor, events: Int16(POLLOUT), until: deadline)
            let written = frame.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress!.advanced(by: offset), frame.count - offset) }
            if written < 0 && [EINTR, EAGAIN, EWOULDBLOCK].contains(errno) { continue }
            guard written > 0 else { throw ControlError.unavailable("The Textbutler daemon closed the control request.") }
            offset += written
        }
        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            try wait(descriptor, events: Int16(POLLIN), until: deadline)
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 && [EINTR, EAGAIN, EWOULDBLOCK].contains(errno) { continue }
            guard count > 0 else { throw ControlError.unavailable("The Textbutler daemon closed without a response.") }
            response.append(contentsOf: buffer[0..<count])
            guard response.count <= maxControlFrame else { throw ControlError.invalid("Control response exceeds its limit.") }
            if let newline = response.firstIndex(of: 10) {
                guard newline > 0, newline == response.count - 1 else { throw ControlError.invalid("Unexpected control output.") }
                let decoded = try JSONDecoder().decode(ControlResponse.self, from: response.prefix(upTo: newline))
                guard decoded.protocolName == controlProtocol else { throw ControlError.invalid("The daemon uses an incompatible control protocol.") }
                guard decoded.ok else {
                    guard let message = decoded.message, message.utf16.count <= 4_096,
                          ["disconnected", "invalid-request", "conflict", "capacity", "unavailable"].contains(decoded.code ?? "") else {
                        throw ControlError.invalid("The daemon returned an invalid failure response.")
                    }
                    throw ControlError.unavailable(menuLabel(message, limit: 180))
                }
                guard decoded.kind == "snapshot", let snapshot = decoded.snapshot else { throw ControlError.invalid("The daemon returned an incompatible response.") }
                try snapshot.validate()
                return snapshot
            }
            guard response.count < maxControlFrame else { throw ControlError.invalid("Control response exceeds its limit.") }
        }
    }
}

/// Main-thread operation admission: one socket request and at most one pending refresh.
struct MenuRequestGate {
    private(set) var inFlight: UInt64?
    private(set) var refreshPending = false
    private var generation: UInt64 = 0
    mutating func beginRefresh() -> UInt64? {
        guard inFlight == nil else { refreshPending = true; return nil }
        generation &+= 1; inFlight = generation; return generation
    }
    mutating func beginMutation() -> UInt64? {
        guard inFlight == nil else { return nil }
        generation &+= 1; inFlight = generation; return generation
    }
    mutating func finish(_ token: UInt64) -> Bool {
        guard inFlight == token else { return false }
        inFlight = nil
        return true
    }
    mutating func takePendingRefresh() -> Bool {
        guard inFlight == nil else { return false }
        let pending = refreshPending; refreshPending = false; return pending
    }
}
