import AppKit
import Foundation
import Darwin

private let defaultRefreshInterval: TimeInterval = 15

private func acquireInstanceLock(directory: URL) -> Int32? {
    do {
        let parent = directory.deletingLastPathComponent().path
        guard let physical = realpath(parent, nil) else { return nil }
        defer { free(physical) }
        guard String(cString: physical) == parent else { return nil }
        if mkdir(directory.path, 0o700) != 0 && errno != EEXIST { return nil }
        let before = try privateDirectory(directory.path)
        let path = directory.appendingPathComponent("menubar.lock").path
        // O_EXLOCK takes the same BSD advisory lock atomically with open.
        let descriptor = Darwin.open(path, O_CREAT | O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_EXLOCK, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { return nil }
        var retained = false
        defer { if !retained { Darwin.close(descriptor) } }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1, info.st_uid == getuid(), info.st_mode & 0o077 == 0,
              try privateDirectory(directory.path) == before else { return nil }
        retained = true
        return descriptor
    } catch { return nil }
}

/// Native glance surface; all state and actions use the owner-only control socket.
final class TextbutlerMenuController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let status = NSMenuItem(title: "Checking daemon…", action: nil, keyEquivalent: "")
    private let summary = NSMenuItem(title: "Loading status…", action: nil, keyEquivalent: "")
    private let pauseItem = NSMenuItem(title: "Automatic replies paused", action: #selector(togglePause), keyEquivalent: "p")
    private let contactsMenu = NSMenu()
    private let accountsMenu = NSMenu()
    private let capabilitiesMenu = NSMenu()
    private let activityMenu = NSMenu()
    private let accountsItem = NSMenuItem(title: "Agent accounts", action: nil, keyEquivalent: "")
    private let updatedItem = NSMenuItem(title: "Waiting for daemon status", action: nil, keyEquivalent: "")
    private let refreshItem = NSMenuItem(title: "Refresh status", action: #selector(refresh), keyEquivalent: "r")
    private let client: ControlClient
    private let worker = DispatchQueue(label: "app.textbutler.menubar.control", qos: .utility)
    private var timer: Timer?
    private var requests = MenuRequestGate()
    private var snapshot: Snapshot?
    private var lastUpdated: Date?
    private var fresh = false
    private var actionInFlight = false

    init(directory: URL) {
        client = ControlClient(socketPath: directory.appendingPathComponent("daemon.sock").path)
        super.init()
        let menu = NSMenu()
        // AppKit's automatic validation would otherwise re-enable an in-flight action.
        menu.autoenablesItems = false
        status.isEnabled = false; summary.isEnabled = false; updatedItem.isEnabled = false
        menu.addItem(status); menu.addItem(summary); menu.addItem(.separator()); menu.addItem(pauseItem)
        for (title, submenu) in [("Contacts", contactsMenu), ("Capabilities", capabilitiesMenu), ("Recent activity", activityMenu)] {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.submenu = submenu; menu.addItem(item)
        }
        accountsItem.submenu = accountsMenu
        menu.insertItem(accountsItem, at: 5)
        menu.addItem(.separator()); menu.addItem(updatedItem); menu.addItem(refreshItem)
        let website = NSMenuItem(title: "Open Textbutler…", action: #selector(openWebsite), keyEquivalent: "o")
        website.toolTip = "Open textbutler.app in your browser"
        menu.addItem(website); menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Textbutler", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        menu.delegate = self; statusItem.menu = menu
        if let button = statusItem.button {
            button.title = "Tb"
            button.toolTip = "Textbutler status and controls"
            button.setAccessibilityLabel("Textbutler status and controls")
        }
        updateIcon(symbol: "text.bubble")
        refresh()
        let refreshTimer = Timer(timeInterval: defaultRefreshInterval, repeats: true) { [weak self] _ in self?.refresh() }
        timer = refreshTimer
        RunLoop.main.add(refreshTimer, forMode: .common)
    }

    @objc func refresh() {
        guard let token = requests.beginRefresh() else { return }
        updateActions()
        worker.async { [weak self] in
            guard let self else { return }
            let result = Result { try self.client.request(command: "snapshot") }
            DispatchQueue.main.async { [weak self] in self?.complete(result, token: token, mutation: false) }
        }
    }

    func menuWillOpen(_ menu: NSMenu) { updateAge(); refresh() }

    private func complete(_ result: Result<Snapshot, Error>, token: UInt64, mutation: Bool) {
        guard requests.finish(token) else { return }
        if mutation { actionInFlight = false }
        switch result {
        case .success(let value):
            // A late response cannot undo a newer observed owner revision.
            if let prior = snapshot, value.revision < prior.revision {
                applyError(ControlError.invalid("The daemon returned an older settings revision."))
            } else {
                apply(value)
            }
        case .failure(let error):
            applyError(error)
            if mutation {
                // Delivery may have succeeded. Re-read state; never resend the mutation.
                updatedItem.title = "Action outcome unconfirmed · checking status"
                refresh()
                return
            }
        }
        updateActions()
        if requests.takePendingRefresh() { refresh() }
    }

    private func updateActions() {
        refreshItem.isEnabled = requests.inFlight == nil
        pauseItem.isEnabled = fresh && snapshot?.connection == "connected" && requests.inFlight == nil && !actionInFlight
        pauseItem.toolTip = actionInFlight ? "Waiting for the daemon to confirm the change" : "Checked means automatic replies are paused. Click to toggle."
    }

    private func informational(_ title: String, detail: String? = nil, checked: Bool? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: menuLabel(title), action: nil, keyEquivalent: "")
        item.isEnabled = false
        if let checked { item.state = checked ? .on : .off }
        if let detail { item.toolTip = menuLabel(detail, limit: 240) }
        return item
    }

    private func apply(_ value: Snapshot) {
        snapshot = value; lastUpdated = Date(); fresh = true
        let running = value.automation?.state == "running"
        let paused = value.settings.paused
        let state = value.connection == "connected" ? (paused ? "Automatic replies paused" : (running ? "Automatic replies running" : "Automatic replies need setup")) : "Daemon disconnected"
        status.title = state
        status.toolTip = menuLabel(value.automation?.detail ?? value.detail, limit: 240)
        updateIcon(symbol: paused ? "pause.circle" : (running ? "text.bubble" : "exclamationmark.triangle"))
        statusItem.button?.setAccessibilityLabel("Textbutler: \(state)")
        statusItem.button?.toolTip = state
        let active = value.contacts.filter { $0.settings.enabled }.count
        summary.title = "\(active) enabled of \(value.contacts.count) contacts · limit \(value.settings.activeContactLimit)"
        summary.toolTip = menuLabel(value.detail, limit: 240)
        pauseItem.state = paused ? .on : .off
        contactsMenu.removeAllItems()
        for contact in value.contacts.prefix(20) {
            contactsMenu.addItem(informational(contact.name, detail: contact.subtitle, checked: contact.settings.enabled))
        }
        if value.contacts.isEmpty { contactsMenu.addItem(informational("No contacts configured")) }
        if value.contacts.count > 20 { contactsMenu.addItem(informational("\(value.contacts.count - 20) more contacts")) }
        accountsMenu.removeAllItems()
        let accounts = value.providerAccounts ?? []
        let ready = accounts.filter { $0.status == "ready" }.count
        accountsItem.title = "Agent accounts · \(ready) of \(accounts.count) ready"
        for account in accounts {
            let state = account.status == "ready" ? "Ready" : account.status == "setup-required" ? "Setup required" : "Unavailable"
            accountsMenu.addItem(informational("\(account.label) · \(state)", detail: account.detail, checked: account.status == "ready"))
        }
        if accounts.isEmpty { accountsMenu.addItem(informational("No agent accounts reported")) }
        capabilitiesMenu.removeAllItems()
        for capability in value.capabilities {
            let state = capability.status == "available" ? "Available" : capability.status == "setup-required" ? "Setup required" : "Unsupported"
            capabilitiesMenu.addItem(informational("\(capability.id.capitalized) · \(state)", detail: capability.detail, checked: capability.status == "available"))
        }
        if value.capabilities.isEmpty { capabilitiesMenu.addItem(informational("No capabilities reported")) }
        activityMenu.removeAllItems()
        for event in value.activity.sorted(by: { $0.at > $1.at }).prefix(8) {
            let item = NSMenuItem(title: menuLabel(event.title), action: nil, keyEquivalent: "")
            let details = NSMenu()
            details.addItem(informational(event.at))
            details.addItem(informational(event.detail, detail: event.detail))
            item.submenu = details; activityMenu.addItem(item)
        }
        if value.activity.isEmpty { activityMenu.addItem(informational("No recent activity")) }
        updateAge(); updateActions()
    }

    private func updateAge() {
        guard let date = lastUpdated else { return }
        let age = max(0, Int(Date().timeIntervalSince(date)))
        let text = age < 60 ? "\(age)s ago" : "\(age / 60)m ago"
        updatedItem.title = "\(fresh ? "Updated" : "Last confirmed") \(text)"
    }

    private func applyError(_ error: Error) {
        fresh = false
        let detail: String
        switch error {
        case ControlError.unavailable(let message), ControlError.invalid(let message): detail = message
        default: detail = "The daemon returned unreadable status."
        }
        updateIcon(symbol: "exclamationmark.triangle")
        status.title = snapshot == nil ? "Daemon unavailable" : "Status unavailable · last known state"
        statusItem.button?.setAccessibilityLabel("Textbutler: \(status.title)")
        statusItem.button?.toolTip = status.title
        summary.title = menuLabel(detail)
        summary.toolTip = menuLabel(detail, limit: 240)
        updateAge(); updateActions()
    }

    private func updateIcon(symbol: String) {
        guard let button = statusItem.button,
              let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Textbutler") else { return }
        image.isTemplate = true; button.image = image; button.imagePosition = .imageOnly
    }

    @objc private func togglePause() {
        guard fresh, let current = snapshot, current.connection == "connected", !actionInFlight,
              let token = requests.beginMutation() else { return }
        actionInFlight = true; updateActions()
        worker.async { [weak self] in
            guard let self else { return }
            let result = Result { try self.client.request(command: "global.settings.update", fields: [
                "expectedRevision": current.revision,
                "settings": ["paused": !current.settings.paused, "activeContactLimit": current.settings.activeContactLimit],
            ]) }
            DispatchQueue.main.async { [weak self] in self?.complete(result, token: token, mutation: true) }
        }
    }

    @objc private func openWebsite() {
        guard let url = URL(string: "https://textbutler.app/"), NSWorkspace.shared.open(url) else {
            summary.title = "Could not open textbutler.app in your browser"
            return
        }
    }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
    deinit { timer?.invalidate() }
}

@main
struct TextbutlerMenuApp {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.isEmpty || arguments.count == 2 && arguments[0] == "--data-dir" && arguments[1].hasPrefix("/") else {
            fputs("Usage: textbutler-menubar [--data-dir /physical/private/path]\n", stderr)
            exit(2)
        }
        let directory = arguments.isEmpty ? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Textbutler", isDirectory: true)
            : URL(fileURLWithPath: arguments[1], isDirectory: true)
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        if let lock = acquireInstanceLock(directory: directory) {
            let controller = TextbutlerMenuController(directory: directory)
            withExtendedLifetime((lock, controller)) { application.run() }
        }
    }
}
