import Foundation
import Observation

/// Log shot (SPEC-11): the dose (the medication's standard steps, or custom), the day (one shot per day, date only),
/// the site and notes. A day that already has a shot opens with it, so saving it unchanged changes nothing.
@MainActor
@Observable
public final class ShotForm {
    public var day: String { didSet { if day != oldValue { fill() } } }
    public var custom: Bool
    public var doseMg: Double
    public var doseUnit: String
    public var site: String
    public var note: String

    public let today: String
    @ObservationIgnored private let view: Glp1View

    /// The server's limits on a dose, by unit.
    public static let maxDose: [String: Double] = ["mg": 100, "units": 1000, "ml": 100]
    public static let units = ["mg", "units", "ml"]

    public init(view: Glp1View, today: String) {
        self.view = view
        self.today = today
        day = today
        custom = false
        doseMg = 0
        doseUnit = "mg"
        site = view.suggestedSite
        note = ""
        fill()
    }

    /// The current medication's dose steps, matched by brand name as the web does; empty when compounded.
    public var doses: [Double] {
        guard let name = view.settings?.medication else { return [] }
        return view.medications?.first { $0.name == name }?.doses ?? []
    }

    private var shots: [Shot] { view.shots ?? [] }

    /// The day already has a shot: saving replaces it.
    public var replaces: Bool { shots.contains { $0.day == day } }

    /// A different dose on the latest shot becomes the current one (the server's rule; a backdated shot never does).
    public var becomesCurrentDose: Bool {
        guard let s = view.settings else { return false }
        let differs = doseMg != s.doseMg || doseUnit != (s.doseUnit ?? "mg")
        let latest = shots.map(\.day).max()
        return differs && (latest.map { day >= $0 } ?? true)
    }

    public var error: String? {
        guard doseMg > 0 else { return "Enter a dose" }
        if let max = Self.maxDose[doseUnit], doseMg > max { return "A dose is at most \(Int(max)) \(doseUnit)" }
        return nil
    }

    public var canSave: Bool { error == nil && day <= today && !site.isEmpty }

    private func fill() {
        if let shot = shots.first(where: { $0.day == day }) {
            doseMg = shot.doseMg
            doseUnit = shot.doseUnit ?? "mg"
            site = shot.site
            note = shot.note ?? ""
        } else {
            doseMg = view.settings?.doseMg ?? 0
            doseUnit = view.settings?.doseUnit ?? "mg"
            site = view.suggestedSite
            note = ""
        }
        custom = doses.isEmpty || doseUnit != "mg" || !doses.contains(doseMg)
    }
}
