import Foundation
import Observation

/// Log shot (SPEC-11): the dose (the medication's standard steps, or custom), the day (one shot per day, date only),
/// the site and notes. A day that already has a shot opens with it, so saving it unchanged changes nothing.
@MainActor
@Observable
public final class ShotForm {
    public var day: String { didSet { if day != oldValue { fill() } } }
    public var custom: Bool
    public var doseMg: Double { didSet { if doseMg != oldValue, Double(doseText) != doseMg { doseText = Self.text(doseMg) } } }
    /// The custom dose as typed: an empty field is no dose (never the previous one behind it).
    public var doseText: String = "" { didSet { if doseText != oldValue { doseMg = Double(doseText.replacingOccurrences(of: ",", with: ".")) ?? 0 } } }
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

    /// The day's shot, if it has one.
    private var shotThatDay: Shot? { shots.first { $0.day == day } }

    /// The dose to send: left out when re-saving a day's shot with its own dose, so the server keeps the current
    /// dose as it is (a dose it's sent for the latest shot becomes the current one).
    public var sentDose: (mg: Double, unit: String)? {
        if let shot = shotThatDay, shot.doseMg == doseMg, (shot.doseUnit ?? "mg") == doseUnit { return nil }
        return (doseMg, doseUnit)
    }

    /// A dose sent for the latest shot (or a new latest one) becomes the current one; a backdated shot never does.
    public var becomesCurrentDose: Bool {
        guard let s = view.settings, sentDose != nil else { return false }
        let differs = doseMg != s.doseMg || doseUnit != (s.doseUnit ?? "mg")
        let latest = shots.map(\.day).max()
        return differs && (latest.map { day >= $0 } ?? true)
    }

    static func text(_ dose: Double) -> String {
        dose == 0 ? "" : (dose.rounded() == dose ? String(Int(dose)) : String(dose))
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
