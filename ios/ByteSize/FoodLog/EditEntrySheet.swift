import ByteSizeKit
import SwiftUI

/// Change how much. A food: the three-wheel amount (L1) — whole | fraction | unit, the units it was logged in plus
/// what the food offers; water: the amount typed in fl oz or ml. (Changing the meal is Move.)
struct EditEntrySheet: View {
    let entry: LogEntry
    let units: Units
    let log: FoodLogModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var amount = ""
    @State private var portion: PortionModel
    @State private var askingBig = false
    @State private var wheelOpen = false
    @State private var shownWater = ""
    /// The amount as it was logged: Save shows only once it's different
    private let logged: (UnitChoice, Int, Double)

    init(entry: LogEntry, units: Units, log: FoodLogModel) {
        self.entry = entry
        self.units = units
        self.log = log
        let p = PortionModel(entry: entry)
        _portion = State(initialValue: p)
        logged = (p.choice, p.whole, p.fraction)
    }

    private var changed: Bool {
        entry.isWater ? amount != shownWater : (portion.choice, portion.whole, portion.fraction) != logged
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text(entry.icon).font(.largeTitle)
                        VStack(alignment: .leading) {
                            Text(entry.name).font(.headline)
                            if let brand = entry.brand { Text(brand).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if !entry.isWater {
                            Text(portion.previewCalories.map { "≈ \($0) cal" } ?? "—")
                                .font(.headline).monospacedDigit()
                                .foregroundStyle(palette.color("subtle"))
                                .accessibilityLabel(portion.previewCalories.map { "About \($0) calories" } ?? "Enter an amount")
                                .accessibilityIdentifier("previewCalories")
                        }
                    }
                }
                if entry.isWater {
                    Section("Amount (\(units.waterUnit))") {
                        TextField("Amount", text: $amount).keyboardType(.decimalPad)
                    }
                } else {
                    Section {
                        ServingRow(portion: portion, open: $wheelOpen)
                        HStack {
                            Text("Meal")
                            Spacer()
                            Text(entry.meal.title).foregroundStyle(palette.color("subtle"))
                        }
                    }
                    NutritionSection(portion: portion)
                }
            }
            .navigationTitle("Logged food")
            .navigationBarTitleDisplayMode(.inline)
            .alert(BigAmount.question(calories: portion.previewCalories ?? 0, name: entry.name), isPresented: $askingBig) {
                Button("Change", role: .cancel) {}
                Button("Log it") { save() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(changed ? "Cancel" : "Close") { dismiss() } }
                if changed {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            if !entry.isWater, portion.isBig { askingBig = true } else { save() }
                        }
                        .disabled(entry.isWater ? typedWater == nil : !portion.canLog)
                        .accessibilityIdentifier("saveEntry")
                    }
                }
            }
            .onAppear {
                let shown = (units.waterValue(ml: entry.quantity) * 10).rounded() / 10
                amount = shown.rounded() == shown ? String(Int(shown)) : String(shown)
                shownWater = amount
            }
        }
    }

    private var typedWater: Double? { Double(amount.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 ? $0 : nil } }

    private func save() {
        Task {
            if entry.isWater {
                guard let typed = typedWater else { return }
                // water is typed in fl oz or ml; the server keeps ml
                await log.update(entry, quantity: (units.ml(fromWaterDisplay: typed) * 10).rounded() / 10, fraction: 1, servingIndex: entry.servingIndex)
            } else {
                await log.update(entry, portion: portion)
            }
            dismiss()
        }
    }
}

/// Pick the day and meal to move (or copy) an entry to.
struct MoveCopySheet: View {
    let entry: LogEntry
    let copy: Bool
    let log: FoodLogModel
    let today: String
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var meal: Meal = .breakfast

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(entry.name).font(.headline) }
                Section("Meal") {
                    Picker("Meal", selection: $meal) {
                        ForEach(Meal.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("Day") {
                    DatePicker("Day", selection: $date, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                }
            }
            .navigationTitle(copy ? "Copy to…" : "Move to…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(copy ? "Copy" : "Move") {
                        let day = DayText.day(date)
                        Task {
                            if copy { await log.copy(entry, to: day, meal: meal) } else { await log.move(entry, to: day, meal: meal) }
                            dismiss()
                        }
                    }
                }
            }
            .onAppear {
                date = DayText.date(entry.day)
                meal = entry.meal
            }
        }
    }
}
