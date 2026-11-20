import ByteSizeKit
import SwiftUI

/// The day at a glance: the calorie budget bar (range band, "N to go"), protein / fiber / water rings full at
/// the range minimum. The chevron (SPEC-02) opens the full daily totals, as on the web; it stays as left.
struct OverviewCard: View {
    let days: DayStore
    let units: Units
    @Environment(\.palette) private var palette
    @AppStorage("overviewExpanded") private var expanded = false

    var body: some View {
        Card {
            HStack {
                Text(days.isToday ? "Today's overview" : "Overview · \(DayText.short(days.selected))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.color("subtle"))
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { expanded.toggle() }
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .foregroundStyle(palette.color("primary"))
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(expanded ? "Hide daily totals" : "Show daily totals")
                .accessibilityIdentifier("overviewChevron")
            }
            if let day = days.day {
                let calories = day.totals["calories"]
                if let targets = day.targets {
                    budgetBar(calories: calories, range: targets.calories)
                    HStack(spacing: 8) {
                        ring("Protein", value: day.totals["protein_g"], range: targets.protein_g, unit: "g", color: "brand")
                        ring("Fiber", value: day.totals["fiber_g"], range: targets.fiber_g, unit: "g", color: "success")
                        ring("Water", value: day.totals["water_ml"], range: targets.water_ml, unit: "ml", color: "link")
                    }
                } else {
                    Text("\(Int(calories.rounded())) cal").font(.title2.bold()).foregroundStyle(palette.color("ink"))
                    if let notice = overviewNotice(day) {
                        Text(notice).font(.footnote).foregroundStyle(palette.color("subtle"))
                    }
                }
                if expanded {
                    totals(dailyTotals(day, units: units))
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    private func budgetBar(calories: Double, range: TargetRange) -> some View {
        let status = budget(calories: calories, range: range)
        let scaleMax = max(range.max * 1.15, calories)
        // SPEC-05: light green under the range, dark green within, red over
        let (fill, strength): (String, Double) = switch barFill(calories: calories, range: range) {
        case .under: ("success", 0.45)
        case .within: ("success", 1)
        case .over: ("error", 1)
        }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(Int(calories.rounded()))").font(.title.bold()).foregroundStyle(palette.color("ink"))
                    .contentTransition(.numericText())
                Text("cal").foregroundStyle(palette.color("subtle"))
                Spacer()
                Text(status.text).font(.headline).foregroundStyle(palette.color(status == .inRange ? "success" : "ink"))
            }
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(palette.color("pressed"))
                    Rectangle().fill(palette.color("success-subtle"))
                        .frame(width: w * (range.max - range.min) / scaleMax)
                        .offset(x: w * range.min / scaleMax)
                    Capsule().fill(palette.color(fill).opacity(strength))
                        .frame(width: max(6, w * min(calories, scaleMax) / scaleMax))
                }
                .clipShape(Capsule())
            }
            .frame(height: 12)
            Text("Budget \(Int(range.min))–\(Int(range.max)) cal").font(.caption).foregroundStyle(palette.color("muted"))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Int(calories.rounded())) calories, \(status.text), budget \(Int(range.min)) to \(Int(range.max))")
    }

    private func ring(_ name: String, value: Double, range: TargetRange, unit: String, color: String) -> some View {
        let progress = ringProgress(value: value, range: range)
        let shown: (Double, TargetRange, String) = unit == "ml" && units == .imperial
            ? (value / Units.mlPerFlOz, TargetRange(min: range.min / Units.mlPerFlOz, max: range.max / Units.mlPerFlOz), "fl oz")
            : (value, range, unit)
        return VStack(spacing: 6) {
            ZStack {
                Circle().stroke(palette.color("pressed"), lineWidth: 8)
                Circle().trim(from: 0, to: progress.fraction)
                    .stroke(palette.color(color), style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if progress.over {
                    Image(systemName: "arrow.up").font(.caption2.bold()).foregroundStyle(palette.color("warning"))
                        .offset(y: -22)
                }
                Text("\(Int(shown.0.rounded()))").font(.headline).foregroundStyle(palette.color("ink"))
            }
            .frame(width: 64, height: 64)
            Text(name).font(.caption.weight(.semibold)).foregroundStyle(palette.color("ink"))
            Text("\(Int(shown.1.min.rounded()))–\(Int(shown.1.max.rounded())) \(shown.2)").font(.caption2).foregroundStyle(palette.color("muted"))
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name): " + rangeLabel(value: shown.0, range: shown.1, unit: shown.2))
    }

    /// The web's Daily Totals: eaten, and the target range where there is one.
    private func totals(_ rows: [TotalRow]) -> some View {
        VStack(spacing: 6) {
            ForEach(rows, id: \.name) { row in
                HStack {
                    Text(row.name).font(.subheadline).foregroundStyle(palette.color("ink"))
                    Spacer()
                    Text(row.amount).font(.subheadline.weight(.semibold)).foregroundStyle(palette.color("ink"))
                        .contentTransition(.numericText())
                    Text(row.target).font(.caption).foregroundStyle(palette.color("muted"))
                        .frame(width: 110, alignment: .trailing)
                }
                .monospacedDigit()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dailyTotals")
    }
}
