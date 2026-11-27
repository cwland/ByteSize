import ByteSizeKit
import Charts
import SwiftUI

/// The Goals tab: today's targets and the active goals (read only — set on the web), the weight chart, and the
/// weigh-in history with logging and swipe to delete.
struct GoalsView: View {
    @Environment(\.dateLook) private var dateLook
    @Bindable var model: GoalsModel
    @Environment(\.palette) private var palette
    @State private var logging = false

    private var units: Units { model.units }

    var body: some View {
        List {
            targetsSection
            goalsSection
            weightSection
            historySection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(palette.color("page"))
        .refreshable { await model.load() }
        // Every time the tab opens: a weigh-in from the Dashboard, a new day or a change on the web shows up
        .task { await model.load() }
        .overlay(alignment: .bottom) {
            if let message = model.message {
                MessageBanner(text: message) { model.clearMessage() }.padding(.bottom, 8)
            }
        }
        .sheet(isPresented: $logging) { LogWeightSheet(model: model) }
    }

    // MARK: - Targets

    private var targetsSection: some View {
        Section {
            if let t = model.targets {
                targetRow("Calories", "\(whole(t.calories.min))–\(whole(t.calories.max)) cal")
                targetRow("Protein", "\(whole(t.protein_g.min))–\(whole(t.protein_g.max)) g")
                targetRow("Fiber", "\(whole(t.fiber_g.min))–\(whole(t.fiber_g.max)) g")
                targetRow("Water", "\(units.water(ml: t.water_ml.min)) – \(units.water(ml: t.water_ml.max))")
            } else if model.loaded {
                Text("No targets set").foregroundStyle(palette.color("subtle"))
            }
            if let goal = model.weight?.goalKg { targetRow("Goal weight", units.weight(kg: goal)) }
        } header: {
            Text("Targets")
        } footer: {
            Text("Goals and targets are managed in the ByteSize web app.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("goalsTargets")
    }

    private func targetRow(_ name: String, _ value: String) -> some View {
        HStack {
            Text(name).foregroundStyle(palette.color("ink"))
            Spacer()
            Text(value).foregroundStyle(palette.color("subtle")).monospacedDigit()
        }
    }

    // MARK: - Goals

    private var goalsSection: some View {
        Section("Goals") {
            if model.goals.isEmpty, model.loaded {
                Text("No active goals").foregroundStyle(palette.color("subtle"))
            }
            ForEach(model.goals) { goal in
                VStack(alignment: .leading, spacing: 4) {
                    Text(goal.name).font(.headline).foregroundStyle(palette.color("ink"))
                    Text(GoalsModel.progressText(goal, units: units)).foregroundStyle(palette.color("ink"))
                    if let overall = GoalsModel.overallText(goal) {
                        Text(overall).font(.caption).foregroundStyle(palette.color("subtle"))
                    }
                }
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("goal-\(goal.id)")
            }
        }
    }

    // MARK: - Weight

    private var weightSection: some View {
        Section("Weight") {
            HStack(spacing: 8) {
                ForEach(GoalsModel.WeightRange.allCases, id: \.self) { r in
                    Button(r.rawValue) { withAnimation(.easeInOut(duration: 0.2)) { model.range = r } }
                        .buttonStyle(.bordered)
                        .tint(model.range == r ? palette.color("primary") : palette.color("subtle"))
                        .accessibilityIdentifier("range-\(r.rawValue)")
                        .accessibilityAddTraits(model.range == r ? .isSelected : [])
                }
            }
            if model.chartPoints.isEmpty {
                Text(model.weight?.weighIns.isEmpty == false ? "No weigh-ins in this range" : "No weigh-ins yet")
                    .foregroundStyle(palette.color("subtle"))
            } else {
                chart
            }
            summary
            Button("Log weight", systemImage: "plus") { logging = true }
                .accessibilityIdentifier("logWeight")
        }
    }

    private var chart: some View {
        let points = model.chartPoints
        let values = points.flatMap { [$0.weightKg, $0.trendKg ?? $0.weightKg] } + (model.weight?.goalKg.map { [$0] } ?? [])
        let low = units.weightValue(kg: values.min() ?? 0) - 1
        let high = units.weightValue(kg: values.max() ?? 0) + 1
        return Chart {
            ForEach(points, id: \.day) { p in
                if let trend = p.trendKg {
                    LineMark(x: .value("Day", DayText.date(p.day)), y: .value("Trend", units.weightValue(kg: trend)))
                        .foregroundStyle(palette.color("primary"))
                        .interpolationMethod(.catmullRom)
                }
            }
            ForEach(points, id: \.day) { p in
                PointMark(x: .value("Day", DayText.date(p.day)), y: .value("Weight", units.weightValue(kg: p.weightKg)))
                    .foregroundStyle(palette.color("subtle"))
                    .symbolSize(30)
            }
            if let goal = model.weight?.goalKg {
                RuleMark(y: .value("Goal", units.weightValue(kg: goal)))
                    .foregroundStyle(palette.color("success"))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }
        }
        .chartYScale(domain: low...high)
        .frame(height: 200)
        .accessibilityIdentifier("weightChart")
    }

    private var summary: some View {
        let w = model.weight
        return HStack {
            stat("Start", w?.start.map { units.weight(kg: $0.weightKg) })
            stat("Trend", w?.trendKg.map { units.weight(kg: $0) })
            stat("Lost", w?.lostKg.map { units.weight(kg: $0) }, detail: w?.lostTrendKg.map { "\(units.weight(kg: $0)) by trend" })
            stat("Goal date", w?.goalDate?.date.map { DayText.short($0, dateLook) })
        }
    }

    /// detail: a smaller line under the name (Lost: the trend figure)
    private func stat(_ name: String, _ value: String?, detail: String? = nil) -> some View {
        VStack(spacing: 2) {
            Text(value ?? "—").font(.subheadline.weight(.semibold)).foregroundStyle(palette.color("ink")).monospacedDigit()
            Text(name).font(.caption).foregroundStyle(palette.color("subtle"))
            if let detail {
                Text(detail).font(.caption2).foregroundStyle(palette.color("muted")).monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("stat-\(name)")
    }

    // MARK: - History

    private var historySection: some View {
        Section("History") {
            ForEach(model.shownHistory) { row in
                HStack {
                    Text(DayText.long(row.day, dateLook)).foregroundStyle(palette.color("ink"))
                    Spacer()
                    Text(units.weight(kg: row.weightKg)).monospacedDigit().foregroundStyle(palette.color("ink"))
                    change(row.changeKg).frame(minWidth: 70, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("history-\(row.day)")
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) { Task { await model.deleteWeighIn(day: row.day) } }
                }
            }
            // The last 5 show; the rest on request
            if model.hiddenHistoryCount > 0 {
                Button("Show all \(model.history.count) weigh-ins") { withAnimation { model.showAllHistory = true } }
                    .accessibilityIdentifier("historyToggle")
            } else if model.showAllHistory, model.history.count > GoalsModel.historyLimit {
                Button("Show fewer") { withAnimation { model.showAllHistory = false } }
                    .accessibilityIdentifier("historyToggle")
            }
        }
    }

    @ViewBuilder
    private func change(_ kg: Double?) -> some View {
        if let kg {
            if abs(kg) < 0.01 {
                Text("—").foregroundStyle(palette.color("subtle"))
            } else {
                Label(units.weight(kg: abs(kg)), systemImage: kg < 0 ? "arrow.down" : "arrow.up")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.color(kg < 0 ? "success" : "error"))
                    .accessibilityLabel(kg < 0 ? "down \(units.weight(kg: -kg))" : "up \(units.weight(kg: kg))")
            }
        }
    }

    private func whole(_ v: Double) -> String { Int(v.rounded()).formatted() }
}
