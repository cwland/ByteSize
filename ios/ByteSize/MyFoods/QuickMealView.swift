import ByteSizeKit
import SwiftUI

/// A quick meal's items before logging: untick one to leave it out, tap one to change its amount, then Log all.
struct QuickMealView: View {
    @State var model: QuickMealModel
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Int?

    var body: some View {
        List {
            Section("Items") {
                ForEach(model.rows) { row in
                    HStack(spacing: 12) {
                        Button { model.toggle(row.id) } label: {
                            Image(systemName: row.included ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(palette.color(row.included ? "primary" : "subtle"))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(row.included ? "Leave out \(row.item.name)" : "Include \(row.item.name)")
                        .accessibilityIdentifier("mealItem-\(row.id)")
                        Button { editing = row.id } label: {
                            HStack(spacing: 12) {
                                Text(row.item.icon).font(.title2)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.item.name).foregroundStyle(palette.color(row.included ? "ink" : "subtle"))
                                    Text(amount(row)).font(.caption).foregroundStyle(palette.color("subtle"))
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(palette.color("subtle"))
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("mealItemAmount-\(row.id)")
                    }
                }
            }
            Section {
                MealPicker(meal: $model.meal)
                HStack {
                    Text("Total")
                    Spacer()
                    Text("\(model.totalCalories) cal").monospacedDigit().contentTransition(.numericText())
                }
                Button {
                    Task { if await model.logAll() { Haptics.logged(); dismiss() } }
                } label: {
                    HStack { Spacer(); Text("Log all").bold(); Spacer() }
                }
                .disabled(!model.canLog)
                .accessibilityIdentifier("logMeal")
            }
            if let message = model.message {
                Section { Text(message).foregroundStyle(palette.color("error")) }
            }
        }
        .navigationTitle(model.food.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !model.loaded { await model.load() } }
        .sheet(item: Binding(get: { editing.map(RowIndex.init) }, set: { editing = $0?.id })) { pick in
            if let row = model.rows.first(where: { $0.id == pick.id }) {
                MealItemAmountSheet(row: row)
            }
        }
    }

    private func amount(_ row: QuickMealModel.Row) -> String {
        let p = row.portion
        let unit = p.choices.first { $0.choice == p.choice }?.label ?? "serving"
        let cal = p.previewCalories.map { " · \($0) cal" } ?? ""
        return "\(p.quantity.formatted(.number.precision(.fractionLength(0...2)))) × \(unit)\(cal)"
    }
}

private struct RowIndex: Identifiable { let id: Int }

/// One item's amount on the wheel.
private struct MealItemAmountSheet: View {
    let row: QuickMealModel.Row
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack {
                AmountWheel(portion: row.portion)
                if let cal = row.portion.previewCalories {
                    Text("\(cal) cal").font(.headline).monospacedDigit()
                }
            }
            .padding()
            .navigationTitle(row.item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
