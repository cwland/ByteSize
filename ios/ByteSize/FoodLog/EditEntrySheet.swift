import ByteSizeKit
import SwiftUI

/// Change how much: the amount, a fraction (¼ ⅓ ½ ¾ all), and which serving. Water: just the amount.
/// (Changing the meal is Move.)
struct EditEntrySheet: View {
    let entry: LogEntry
    let units: Units
    let log: FoodLogModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var amount = ""
    @State private var fraction = 1.0
    @State private var serving = 0

    static let fractions: [Double] = [0.25, 1.0 / 3, 0.5, 0.75, 1]

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
                    }
                }
                Section(entry.isWater ? "Amount (\(units.waterUnit))" : "Amount") {
                    TextField("Amount", text: $amount).keyboardType(.decimalPad)
                    if !entry.isWater, entry.unit == "serving", entry.servings.count > 1 {
                        Picker("Serving", selection: $serving) {
                            ForEach(entry.servings.indices, id: \.self) { Text(entry.servings[$0].label).tag($0) }
                        }
                    } else if !entry.isWater, entry.unit == "serving", let only = entry.servings.first {
                        LabeledContent("Serving", value: only.label)
                    }
                }
                if !entry.isWater {
                    Section("Portion") {
                        HStack {
                            ForEach(Self.fractions, id: \.self) { f in
                                let on = abs(fraction - f) < 0.001
                                Button(f == 1 ? "All" : LogEntry.fractionText(f)) { fraction = f }
                                    .buttonStyle(.plain)
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .background(on ? palette.color("primary") : palette.color("pressed"), in: RoundedRectangle(cornerRadius: 8))
                                    .foregroundStyle(palette.color(on ? "on-primary" : "ink"))
                                    .accessibilityAddTraits(on ? .isSelected : [])
                            }
                        }
                    }
                }
            }
            .navigationTitle("Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let typed = Double(amount.replacingOccurrences(of: ",", with: ".")) else { return }
                        // water is typed in fl oz or ml; the server keeps ml
                        let q = entry.isWater ? (units.ml(fromWaterDisplay: typed) * 10).rounded() / 10 : typed
                        Task {
                            await log.update(entry, quantity: q, fraction: fraction, servingIndex: serving)
                            dismiss()
                        }
                    }
                    .disabled(Double(amount.replacingOccurrences(of: ",", with: ".")) == nil)
                }
            }
            .onAppear {
                let shown = entry.isWater ? (units.waterValue(ml: entry.quantity) * 10).rounded() / 10 : entry.quantity
                amount = shown.rounded() == shown ? String(Int(shown)) : String(shown)
                fraction = entry.fraction
                serving = entry.servingIndex
            }
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
