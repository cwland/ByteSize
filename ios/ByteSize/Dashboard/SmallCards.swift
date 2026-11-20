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
                    Text("Last: \(DayText.short(last.day)) · \(last.doseText) · \(ShotSite.name(last.site))")
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

}

struct ShotSheet: View {
    let dashboard: DashboardModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var form: ShotForm?
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Group {
                if let form { ShotFormView(form: form) } else { ProgressView() }
            }
            .safeAreaInset(edge: .bottom) {
                if let error { Text(error).foregroundStyle(palette.color("error")).padding() }
            }
            .navigationTitle("Log shot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let form else { return }
                        saving = true
                        Task {
                            do {
                                try await dashboard.logShot(form)
                                dismiss()
                            } catch {
                                self.error = (error as? APIError)?.message ?? error.localizedDescription
                            }
                            saving = false
                        }
                    }
                    .bold()
                    .disabled(!(form?.canSave ?? false) || saving)
                    .accessibilityIdentifier("saveShot")
                }
            }
            .onAppear {
                if form == nil, let view = dashboard.glp1 { form = ShotForm(view: view, today: dashboard.today) }
            }
        }
    }
}

/// SPEC-11: date (one shot per day), dose (the medication's steps, or custom), site and notes.
private struct ShotFormView: View {
    @Bindable var form: ShotForm
    @Environment(\.palette) private var palette
    /// The dose picker's choice: one of the steps, or -1 for Custom…
    private var stepChoice: Binding<Double> {
        Binding(
            get: { form.custom ? -1 : form.doseMg },
            set: { new in
                if new < 0 { form.custom = true } else { form.custom = false; form.doseMg = new; form.doseUnit = "mg" }
            }
        )
    }

    var body: some View {
        Form {
            Section {
                DatePicker("Date", selection: dayBinding, in: ...DayText.date(form.today), displayedComponents: .date)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    .accessibilityIdentifier("shotDate")
                if form.replaces {
                    Text("Replaces the shot logged that day").font(.footnote).foregroundStyle(palette.color("subtle"))
                }
            }
            Section("Dose") {
                if !form.doses.isEmpty {
                    Picker("Dose", selection: stepChoice) {
                        ForEach(form.doses, id: \.self) { Text("\(formatDose($0)) mg").tag($0) }
                        Text("Custom…").tag(-1.0)
                    }
                    .accessibilityIdentifier("shotDose")
                }
                if form.custom {
                    HStack {
                        TextField("Dose", text: $form.doseText)
                            .keyboardType(.decimalPad)
                            .accessibilityIdentifier("shotCustomDose")
                        Picker("Unit", selection: $form.doseUnit) {
                            ForEach(ShotForm.units, id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden()
                    }
                    if let error = form.error { Text(error).font(.footnote).foregroundStyle(palette.color("error")) }
                }
                if form.becomesCurrentDose {
                    Text("This becomes your current dose")
                        .font(.footnote).foregroundStyle(palette.color("subtle"))
                        .accessibilityIdentifier("currentDoseNote")
                }
            }
            Section("Site") {
                Picker("Site", selection: $form.site) {
                    ForEach(ShotSite.all, id: \.self) { Text(ShotSite.name($0)).tag($0) }
                }
            }
            Section("Notes") {
                TextField("Site, side effects…", text: $form.note, axis: .vertical)
                    .lineLimit(2...5)
                    .accessibilityIdentifier("shotNote")
            }
        }
    }

    private var dayBinding: Binding<Date> {
        Binding(get: { DayText.date(form.day) }, set: { form.day = DayText.day($0) })
    }
}

/// "7.5", "5" — a dose without a trailing ".0".
func formatDose(_ mg: Double) -> String { mg.rounded() == mg ? String(Int(mg)) : String(mg) }
