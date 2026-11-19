import ByteSizeKit
import SwiftUI

/// Water for the selected day, with the quick-add buttons from the person's web settings.
struct WaterCard: View {
    let dashboard: DashboardModel
    let days: DayStore
    let units: Units
    @Environment(\.palette) private var palette

    var body: some View {
        Card(title: "Water") {
            let ml = days.day?.totals["water_ml"] ?? 0
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: "drop.fill").foregroundStyle(palette.color("link"))
                Text(units.water(ml: ml)).font(.title2.bold()).foregroundStyle(palette.color("ink"))
                    .accessibilityIdentifier("waterTotal")
                if let goal = days.day?.targets?.water_ml {
                    Text("of \(units.water(ml: goal.min))").foregroundStyle(palette.color("subtle"))
                }
            }
            HStack {
                ForEach(dashboard.waterButtonsMl, id: \.self) { amount in
                    Button {
                        Task { await dashboard.addWater(ml: amount) }
                    } label: {
                        Text("+\(units.water(ml: Double(amount)))")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .foregroundStyle(palette.color("on-primary"))
                            .background(palette.color("primary"), in: RoundedRectangle(cornerRadius: 10))
                    }
                    .accessibilityLabel("Add \(units.water(ml: Double(amount))) of water")
                }
            }
        }
    }
}

/// The latest weigh-in, its change from the one before, and a quick way to log today's.
struct WeightCard: View {
    let dashboard: DashboardModel
    let units: Units
    @Environment(\.palette) private var palette
    @State private var logging = false

    var body: some View {
        Card(title: "Weight") {
            if let latest = dashboard.weight?.latest {
                HStack(alignment: .firstTextBaseline) {
                    Text(units.weight(kg: latest.weightKg)).font(.title2.bold()).foregroundStyle(palette.color("ink"))
                    if let change = change {
                        Label(units.weight(kg: abs(change)), systemImage: change > 0 ? "arrow.up" : change < 0 ? "arrow.down" : "minus")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(palette.color(change > 0 ? "error" : change < 0 ? "success" : "muted"))
                    }
                }
                Text("Last weigh-in \(DayText.short(latest.day))").font(.caption).foregroundStyle(palette.color("muted"))
            } else {
                Text("No weigh-ins yet").foregroundStyle(palette.color("subtle"))
            }
            Button("Log weight", systemImage: "plus") { logging = true }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.color("primary"))
        }
        .sheet(isPresented: $logging) { WeightSheet(dashboard: dashboard, units: units) }
    }

    /// kg since the weigh-in before the latest
    private var change: Double? {
        guard let w = dashboard.weight?.weighIns, w.count >= 2 else { return nil }
        return w[w.count - 1].weightKg - w[w.count - 2].weightKg
    }
}

struct WeightSheet: View {
    let dashboard: DashboardModel
    let units: Units
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Weight", text: $text).keyboardType(.decimalPad)
                        Text(units.weightUnit).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Saved for the day you're looking at. A second weigh-in that day replaces the first.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Log weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(Double(text.replacingOccurrences(of: ",", with: ".")) == nil || saving)
                }
            }
            .onAppear {
                if let kg = dashboard.weight?.latest?.weightKg { text = String(format: "%.1f", units.weightValue(kg: kg)) }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard let value = Double(text.replacingOccurrences(of: ",", with: ".")) else { return }
        saving = true
        defer { saving = false }
        do {
            try await dashboard.logWeight(display: value)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

/// The logging streak.
struct StreakCard: View {
    let days: DayStore
    @Environment(\.palette) private var palette

    var body: some View {
        Card {
            HStack(spacing: 12) {
                Text("🔥").font(.system(size: 36))
                VStack(alignment: .leading) {
                    let n = days.day?.streak ?? 0
                    Text(n == 1 ? "1-day streak" : "\(n)-day streak").font(.title3.bold()).foregroundStyle(palette.color("ink"))
                    Text(milestone(n)).font(.caption).foregroundStyle(palette.color("subtle"))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func milestone(_ n: Int) -> String {
        guard let next = [7, 14, 30, 60, 100, 365].first(where: { $0 > n }) else { return "Keep it going" }
        return "\(next - n) to the \(next)-day badge"
    }
}

/// Recently earned badges.
struct BadgesCard: View {
    let dashboard: DashboardModel
    let units: Units
    @Environment(\.palette) private var palette

    var body: some View {
        Card(title: "Badges") {
            if dashboard.badges.isEmpty {
                Text("Your badges will show here").foregroundStyle(palette.color("subtle"))
            } else {
                HStack(alignment: .top) {
                    ForEach(dashboard.badges, id: \.id) { badge in
                        let info = badgeInfo(badge.id, units: units)
                        VStack(spacing: 4) {
                            Text(info.icon).font(.system(size: 30))
                            Text(info.name).font(.caption2).multilineTextAlignment(.center)
                                .foregroundStyle(palette.color("ink"))
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

/// GLP-1: the last shot, when the next is due, the suggested site, and Log shot.
struct ShotCard: View {
    let dashboard: DashboardModel
    @Environment(\.palette) private var palette
    @State private var logging = false

    var body: some View {
        Card(title: "Shot tracking") {
            if let g = dashboard.glp1 {
                if let due = g.nextDue {
                    Text(dueText(g, due)).font(.headline)
                        .foregroundStyle(palette.color(g.status == "overdue" ? "error" : g.status == "due" ? "warning" : "ink"))
                }
                if let last = g.lastShot {
                    Text("Last: \(DayText.short(last.day)) · \(formatDose(last.doseMg)) mg · \(ShotSite.name(last.site))")
                        .font(.caption).foregroundStyle(palette.color("subtle"))
                }
                Text("Next site: \(ShotSite.name(g.suggestedSite))").font(.caption).foregroundStyle(palette.color("subtle"))
                Button("Log shot", systemImage: "syringe") { logging = true }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.color("primary"))
            } else {
                Text("Set up GLP-1 tracking in the web app").foregroundStyle(palette.color("subtle"))
            }
        }
        .sheet(isPresented: $logging) { ShotSheet(dashboard: dashboard) }
    }

    private func dueText(_ g: Glp1View, _ due: String) -> String {
        switch g.status {
        case "due": "Shot due today"
        case "overdue": g.overdueDays == 1 ? "1 day overdue" : "\(g.overdueDays) days overdue"
        default: "Next shot \(DayText.short(due))"
        }
    }

    private func formatDose(_ mg: Double) -> String { mg.rounded() == mg ? String(Int(mg)) : String(mg) }
}

struct ShotSheet: View {
    let dashboard: DashboardModel
    @Environment(\.dismiss) private var dismiss
    @State private var site = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Site", selection: $site) {
                    ForEach(ShotSite.all, id: \.self) { Text(ShotSite.name($0)).tag($0) }
                }
                .pickerStyle(.inline)
                Section { Text("Logged for today with your usual dose.").font(.footnote).foregroundStyle(.secondary) }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Log shot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            do {
                                try await dashboard.logShot(site: site)
                                dismiss()
                            } catch {
                                self.error = (error as? APIError)?.message ?? error.localizedDescription
                            }
                        }
                    }
                }
            }
            .onAppear { site = dashboard.glp1?.suggestedSite ?? ShotSite.all[0] }
        }
    }
}
