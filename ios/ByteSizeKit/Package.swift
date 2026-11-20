// swift-tools-version: 6.0
import PackageDescription

// ByteSizeKit: everything in the iPhone app that isn't a view — API client, session, models, view models.
// macOS is listed only so `swift test` runs on the Mac without a simulator.
let package = Package(
    name: "ByteSizeKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ByteSizeKit", targets: ["ByteSizeKit"])],
    targets: [
        .target(name: "ByteSizeKit"),
        .testTarget(name: "ByteSizeKitTests", dependencies: ["ByteSizeKit"]),
    ],
    swiftLanguageModes: [.v6]
)
