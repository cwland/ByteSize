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
