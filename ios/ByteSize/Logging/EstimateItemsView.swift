import ByteSizeKit
import SwiftUI

/// The foods the AI listed (Describe, plate photos): amounts to adjust, rows to remove, a meal, then Log all.
struct EstimateItemsView: View {
    @Bindable var model: EstimateModel
    let onLogged: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Section("What the AI found") {
            ForEach(Array(model.items.enumerated()), id: \.offset) { i, item in
                HStack(spacing: 12) {
                    Text(item.food.icon).font(.title2)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(item.food.name)
                            AIChip()
                        }
                        Text("\(LabelReview.number(item.quantity)) × \(item.food.servings.first?.label ?? "serving") · ≈ \(Int(item.calories.rounded())) cal")
                            .font(.caption)
                            .foregroundStyle(palette.color("subtle"))
                    }
                    Spacer()
                    Stepper("Amount", value: Binding(get: { item.quantity }, set: { model.setQuantity($0, at: i) }), in: 0.25...100, step: 0.5)
                        .labelsHidden()
                        .accessibilityLabel("Amount of \(item.food.name)")
                }
                .accessibilityIdentifier("item-\(item.food.name)")
                .swipeActions {
                    Button(role: .destructive) { model.remove(at: i) } label: { Label("Remove", systemImage: "trash") }
                }
            }
            .onDelete { offsets in offsets.sorted(by: >).forEach { model.remove(at: $0) } }
        }
        Section {
            MealPicker(meal: $model.meal)
            HStack {
                Text("Total")
                Spacer()
                Text("≈ \(model.totalCalories) cal").monospacedDigit()
            }
            Button {
                Task {
                    if await model.logAll() {
                        Haptics.logged()
                        onLogged()
                    }
                }
            } label: {
                HStack { Spacer(); Text("Log all").bold(); Spacer() }
            }
            .disabled(model.items.isEmpty || model.busy)
            .accessibilityIdentifier("logAll")
        }
    }
}
