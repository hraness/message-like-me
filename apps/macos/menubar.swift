import AppKit
import Foundation
import Darwin

private func acquireInstanceLock() -> Int32? {
    let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Textbutler", isDirectory: true)
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                  attributes: [.posixPermissions: 0o700])
    } catch {
        return nil
    }
    let path = directory.appendingPathComponent("menubar.lock").path
    let descriptor = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { return nil }
    guard Darwin.flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        Darwin.close(descriptor)
        return nil
    }
    return descriptor
}

/// A small, unbundled status item for day-to-day Textbutler control.
///
/// This intentionally does not embed a webview, hold provider credentials, or
/// start a daemon. It only reports the private daemon socket, opens the public
/// dashboard, and provides a clean quit path.
final class TextbutlerMenuController: NSObject {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let status = NSMenuItem(title: "Checking daemon…", action: nil, keyEquivalent: "")
    private let setup = NSMenuItem(title: "Getting started", action: #selector(refresh), keyEquivalent: "")
    private let refreshItem = NSMenuItem(title: "Refresh status", action: #selector(refresh), keyEquivalent: "r")

    override init() {
        super.init()
        let menu = NSMenu()
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(setup)
        menu.addItem(NSMenuItem(title: "Open textbutler.app", action: #selector(openDashboard), keyEquivalent: ""))
        menu.addItem(refreshItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Textbutler", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
        if let button = statusItem.button {
            let font = NSFont(name: "Georgia-Bold", size: 12) ?? NSFont.systemFont(ofSize: 12, weight: .bold)
            button.attributedTitle = NSAttributedString(string: "Tb", attributes: [.font: font])
            button.toolTip = "Textbutler"
        }
        refresh()
    }

    @objc private func refresh() {
        let socket = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Textbutler/daemon.sock")
        let connected = FileManager.default.fileExists(atPath: socket.path)
        status.title = connected ? "Daemon connected" : "Daemon not running"
        setup.title = connected ? "Textbutler is ready" : "Start the local daemon from Textbutler settings"
        refreshItem.isEnabled = true
    }

    @objc private func openDashboard() {
        NSWorkspace.shared.open(URL(string: "https://textbutler.app/")!)
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
if let lock = acquireInstanceLock() {
    let controller = TextbutlerMenuController()
    withExtendedLifetime((lock, controller)) {
        application.run()
    }
}
