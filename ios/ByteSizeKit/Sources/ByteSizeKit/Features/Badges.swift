import Foundation

public struct BadgeInfo: Equatable, Sendable {
    public let name: String
    public let icon: String
}

/// A badge's name and emoji, as the web shows them (frontend/src/components/goals/Badges.tsx). Weight-loss badges
/// keep their lb id but read in kg for metric, rounded down to the half kg (5 lb → 2 kg).
public func badgeInfo(_ id: String, units: Units) -> BadgeInfo {
    if id.hasPrefix("lost_"), let lb = Double(id.dropFirst("lost_".count)) {
        let amount: String
        if units == .metric {
            let kg = (lb / Units.lbPerKg * 2).rounded(.down) / 2
            amount = "\(kg.rounded() == kg ? String(Int(kg)) : String(kg)) kg"
        } else {
            amount = "\(Int(lb)) lb"
        }
        return BadgeInfo(name: "\(amount) down", icon: "📉")
    }
    if id.hasPrefix("streak_"), let days = Int(id.dropFirst("streak_".count)) {
        return BadgeInfo(name: "\(days)-day streak", icon: "🔥")
    }
    switch id {
    case "first_weigh_in": return BadgeInfo(name: "First weigh-in", icon: "⚖️")
    case "halfway": return BadgeInfo(name: "Halfway there", icon: "🚩")
    case "goal_reached": return BadgeInfo(name: "Goal reached", icon: "🎯")
    case "shots_on_time_4": return BadgeInfo(name: "4 shots on time", icon: "💉")
    case "goal_met": return BadgeInfo(name: "Goal met", icon: "🏆")
    default: return BadgeInfo(name: id, icon: "🏅")
    }
}
