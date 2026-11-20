import Foundation

/// Where the day's calories sit against the calorie range (a budget, not a target to fill).
public enum BudgetStatus: Equatable, Sendable {
    case toGo(Int), inRange, over(Int)

    /// "362 to go" / "In range" / "180 over"
    public var text: String {
        switch self {
        case .toGo(let n): "\(n) to go"
        case .inRange: "In range"
        case .over(let n): "\(n) over"
        }
    }
}

/// Whole calories, as the web shows them.
public func budget(calories: Double, range: TargetRange) -> BudgetStatus {
    let eaten = Int(calories.rounded())
    let low = Int(range.min.rounded())
    let high = Int(range.max.rounded())
    if eaten < low { return .toGo(low - eaten) }
    if eaten > high { return .over(eaten - high) }
    return .inRange
}

/// A ring is full at the range's minimum; `over` once past its maximum (a small mark, no alarm).
public func ringProgress(value: Double, range: TargetRange) -> (fraction: Double, over: Bool) {
    let fraction = range.min > 0 ? min(value / range.min, 1) : 1
    return (Swift.max(0, fraction), value > range.max)
}

/// "97 / 110–130 g"
public func rangeLabel(value: Double, range: TargetRange, unit: String) -> String {
    "\(Int(value.rounded())) / \(Int(range.min.rounded()))–\(Int(range.max.rounded())) \(unit)"
}

/// Shown on the Overview when the day has no targets yet.
public func overviewNotice(_ day: DayView) -> String? {
    day.targets == nil ? "Choose a plan in the web app to see your targets" : nil
}

// MARK: - Today polish (SPEC-02, 05, 06)

/// The calorie bar's fill (SPEC-05): light green under the range, dark green within (min and max included), red over.
public enum BarFill: Equatable, Sendable { case under, within, over }

public func barFill(calories: Double, range: TargetRange) -> BarFill {
    switch budget(calories: calories, range: range) {
    case .toGo: .under
    case .inRange: .within
    case .over: .over
    }
}

/// "1,138" — whole numbers with thousands separators, as the web shows them.
func whole(_ value: Double) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "en_US")
    f.numberStyle = .decimal
    f.maximumFractionDigits = 0
    return f.string(from: NSNumber(value: value.rounded())) ?? "\(Int(value.rounded()))"
}

/// One row of the expanded overview: eaten, and the day's target range ("—" where there is none).
public struct TotalRow: Equatable, Sendable {
    public let name: String
    public let amount: String
    public let target: String
    public init(name: String, amount: String, target: String) {
        self.name = name
        self.amount = amount
        self.target = target
    }
}

/// The web's Daily Totals, in its order: Calories, Protein, Carbs, Fat, Fiber, Sugar, Sodium, Water.
public func dailyTotals(_ day: DayView, units: Units) -> [TotalRow] {
    let t = day.targets
    let range = { (r: TargetRange?, unit: String) -> String in
        guard let r else { return "—" }
        return "\(whole(r.min))–\(whole(r.max))" + (unit.isEmpty ? "" : " \(unit)")
    }
    let water = { (ml: Double) in units.waterValue(ml: ml) }
    let waterRange = t.map { TargetRange(min: water($0.water_ml.min), max: water($0.water_ml.max)) }
    return [
        TotalRow(name: "Calories", amount: whole(day.totals["calories"]), target: range(t?.calories, "")),
        TotalRow(name: "Protein", amount: "\(whole(day.totals["protein_g"])) g", target: range(t?.protein_g, "g")),
        TotalRow(name: "Carbs", amount: "\(whole(day.totals["carbs_g"])) g", target: "—"),
        TotalRow(name: "Fat", amount: "\(whole(day.totals["fat_g"])) g", target: "—"),
        TotalRow(name: "Fiber", amount: "\(whole(day.totals["fiber_g"])) g", target: range(t?.fiber_g, "g")),
        TotalRow(name: "Sugar", amount: "\(whole(day.totals["sugar_g"])) g", target: "—"),
        TotalRow(name: "Sodium", amount: "\(whole(day.totals["sodium_mg"])) mg", target: "—"),
        TotalRow(name: "Water", amount: "\(whole(water(day.totals["water_ml"]))) \(units.waterUnit)", target: range(waterRange, units.waterUnit)),
    ]
}

/// The Food Log's summary bar (SPEC-06).
public struct LogSummary: Equatable, Sendable {
    public let eaten: String
    public let left: String?
    public let protein: String?
    public let fiber: String?
    public init(eaten: String, left: String?, protein: String?, fiber: String?) {
        self.eaten = eaten
        self.left = left
        self.protein = protein
        self.fiber = fiber
    }
}

/// "1,138 eaten", "362 left" (to the range's maximum) / "over by 120", "Protein 97 / 110 g", "Fiber 18 / 25 g".
public func logSummary(_ day: DayView) -> LogSummary {
    let eaten = day.totals["calories"]
    guard let t = day.targets else { return LogSummary(eaten: "\(whole(eaten)) eaten", left: nil, protein: nil, fiber: nil) }
    let room = Int(t.calories.max.rounded()) - Int(eaten.rounded())
    return LogSummary(
        eaten: "\(whole(eaten)) eaten",
        left: room >= 0 ? "\(whole(Double(room))) left" : "over by \(whole(Double(-room)))",
        protein: "Protein \(whole(day.totals["protein_g"])) / \(whole(t.protein_g.min)) g",
        fiber: "Fiber \(whole(day.totals["fiber_g"])) / \(whole(t.fiber_g.min)) g"
    )
}
