import Foundation

/// The iPhone Dashboard's widgets. `allCases` is the default order. The ids are the server's
/// `PAGE_WIDGETS.ios` (backend/tests/ios-widgets.test.ts checks the two match).
public enum DashboardWidget: String, CaseIterable, Identifiable, Sendable {
    case calendar, overview, water, weight, streak, badges, shots

    public var id: String { rawValue }
}
