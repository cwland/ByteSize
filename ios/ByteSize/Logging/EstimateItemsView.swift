import ByteSizeKit
import SwiftUI

/// The foods the AI listed (Describe, plate photos): amounts to adjust, rows to remove, a meal, then Log all.
struct EstimateItemsView: View {
    @Bindable var model: EstimateModel
    let onLogged: () -> Void
    @Environment(\.palette) private var palette

    @State private var editing: Int?

    var body: some View {
        Section("What the AI found") {
            ForEach(Array(model.items.enumerated()), id: \.offset) { i, item in
                // Tap: the amount wheel, in this food's own servings (L1)
                Button { editing = i } label: {
                    HStack(spacing: 12) {
                        Text(item.food.icon).font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(item.food.name).foregroundStyle(palette.color("ink"))
                                AIChip()
                            }
                            Text("\(LabelReview.number(item.quantity)) × \(item.food.servings.indices.contains(item.servingIndex) ? item.food.servings[item.servingIndex].label : "serving") · ≈ \(Int(item.calories.rounded())) cal")
                                .font(.caption)
                                .foregroundStyle(palette.color("subtle"))
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(palette.color("subtle"))
                    }
                }
                .accessibilityIdentifier("item-\(item.food.name)")
                .swipeActions {
                    Button(role: .destructive) { model.remove(at: i) } label: { Label("Remove", systemImage: "trash") }
                }
            }
        }
        .sheet(item: Binding(get: { editing.map(ItemIndex.init) }, set: { editing = $0?.id })) { pick in
            if model.items.indices.contains(pick.id) {
                ItemAmountSheet(item: model.items[pick.id]) { servingIndex, quantity in
                    model.setPortion(servingIndex: servingIndex, quantity: quantity, at: pick.id)
                }
            }
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

private struct ItemIndex: Identifiable { let id: Int }

/// One AI-listed food's amount on the wheel (its own servings only: estimates are logged in their servings).
private struct ItemAmountSheet: View {
    @State private var portion: PortionModel
    let onDone: (Int, Double) -> Void
    @Environment(\.dismiss) private var dismiss

    init(item: EstimateItem, onDone: @escaping (Int, Double) -> Void) {
        let p = PortionModel(name: item.food.name, icon: item.food.icon, servings: item.food.servings, nutrients: item.food.nutrients, meal: .snacks, servingsOnly: true)
        p.choice = .serving(item.servingIndex)
        (p.whole, p.fraction) = PortionModel.split(item.quantity)
        _portion = State(initialValue: p)
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text(portion.icon).font(.largeTitle)
                        Text(portion.name).font(.headline)
                        Spacer()
                        Text(portion.previewCalories.map { "≈ \($0) cal" } ?? "—").monospacedDigit()
                    }
                }
                Section("Amount") { AmountWheel(portion: portion) }
            }
            .navigationTitle("Amount")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDone(portion.servingIndex, portion.quantity)
                        dismiss()
                    }
                    .disabled(!portion.canLog)
                    .accessibilityIdentifier("amountDone")
                }
            }
        }
        .presentationDetents([.medium])
    }
}
