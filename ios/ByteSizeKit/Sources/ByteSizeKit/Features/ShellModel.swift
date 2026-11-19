import Foundation
import Observation

/// The four tabs around the center (+) button.
public enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case dashboard, foodLog, goals, myFoods

    public var id: String { rawValue }

    /// Used as the VoiceOver label (the bar shows icons only).
    public var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .foodLog: "Food Log"
        case .goals: "Goals"
        case .myFoods: "My Foods"
        }
    }

    public var systemImage: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .foodLog: "list.bullet.rectangle"
        case .goals: "target"
        case .myFoods: "fork.knife"
        }
    }
}

/// The radial (+) menu's buttons, in arc order left to right.
public enum QuickAction: String, CaseIterable, Identifiable, Sendable {
    case add, scan, photo, describe

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .add: "Add Food"
        case .scan: "Scan Food"
        case .photo: "Photo"
        case .describe: "Describe Food"
        }
    }

    public var systemImage: String {
        switch self {
        case .add: "magnifyingglass"
        case .scan: "barcode.viewfinder"
        case .photo: "camera"
        case .describe: "text.bubble"
        }
    }
}

/// Which tab is showing, whether the (+) menu is open, and which quick action or sheet is up.
@MainActor
@Observable
public final class ShellModel {
    public private(set) var tab: AppTab = .dashboard
    public private(set) var menuOpen = false
    public var activeAction: QuickAction?
    public var profileOpen = false

    public init() {}

    public func select(_ tab: AppTab) {
        self.tab = tab
        menuOpen = false
    }

    public func toggleMenu() { menuOpen.toggle() }
    public func closeMenu() { menuOpen = false }

    public func choose(_ action: QuickAction) {
        menuOpen = false
        activeAction = action
    }
}

/// Offsets (from the center of the (+) button) for `count` buttons spread evenly over `spreadDegrees`
/// of an arc of `radius`, centered straight up (negative y is up, as on screen).
public func radialOffsets(count: Int, radius: Double, spreadDegrees: Double) -> [(x: Double, y: Double)] {
    guard count > 0 else { return [] }
    if count == 1 { return [(0, -radius)] }
    let step = spreadDegrees / Double(count - 1)
    return (0..<count).map { i in
        let degrees = -spreadDegrees / 2 + step * Double(i) // 0 = straight up, negative = left
        let radians = degrees * .pi / 180
        return (radius * sin(radians), -radius * cos(radians))
    }
}
