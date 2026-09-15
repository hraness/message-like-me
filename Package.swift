// swift-tools-version: 5.9
import PackageDescription

// CodeQL's Swift autobuilder discovers this executable package. The normal
// companion build remains apps/macos/scripts/menubar.ts; neither creates an app.
let package = Package(
    name: "TextbutlerMenu",
    platforms: [.macOS("14.5")],
    products: [.executable(name: "textbutler-menubar", targets: ["TextbutlerMenu"])],
    targets: [
        .executableTarget(
            name: "TextbutlerMenu",
            path: "apps/macos",
            exclude: ["README.md", "package.json", "tsconfig.json", "scripts", "tests"],
            sources: ["MenuControl.swift", "menubar.swift"],
            linkerSettings: [.linkedFramework("AppKit")]
        )
    ]
)
