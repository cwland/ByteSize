import ByteSizeKit
import SwiftUI

/// The foods the AI listed (Describe, plate photos): each checked to start; uncheck what you don't want, tap a food
/// for its amount, pick a meal, then Log selected.
struct EstimateItemsView: View {
    @Bindable var model: EstimateModel
    /// The food whose amount screen is open: pushed by the screen holding this list (a sheet here closed itself).
    @Binding var editing: EstimatePick?
    /// After logging: how many foods were logged ("2 foods") or the one food's name.
    let onLogged: (String) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Section("What the AI found") {
            ForEach(Array(model.items.enumerated()), id: \.offset) { i, item in
                let on = model.selected.indices.contains(i) && model.selected[i]
                HStack(spacing: 12) {
                    Button { model.toggle(at: i) } label: {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                            .font(.title2)
                            .foregroundStyle(on ? palette.color("primary") : palette.color("subtle"))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Include \(item.food.name)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("check-\(item.food.name)")
                    // The rest of the row: the amount wheel, in this food's own servings (L1)
                    Button { editing = EstimatePick(id: i) } label: {
                        HStack(spacing: 12) {
                            Text(item.food.icon).font(.title2).opacity(on ? 1 : 0.5)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(item.food.name).foregroundStyle(palette.color(on ? "ink" : "subtle"))
                                    AIChip()
                                }
                                Text("\(LabelReview.number(item.quantity)) × \(item.food.servings.indices.contains(item.servingIndex) ? item.food.servings[item.servingIndex].label : "serving") · ≈ \(Int(item.calories.rounded())) cal")
                                    .font(.caption)
                                    .foregroundStyle(palette.color("subtle"))
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(palette.color("subtle"))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("item-\(item.food.name)")
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
                    let names = model.items.indices.filter { model.selected[$0] }.map { model.items[$0].food.name }
                    if await model.logSelected() {
                        Haptics.logged()
                        onLogged(names.count == 1 ? names[0] : "\(names.count) foods")
                    }
                }
            } label: {
                HStack { Spacer(); Text("Log selected").bold(); Spacer() }
            }
            .disabled(!model.canLog)
            .accessibilityIdentifier("logSelected")
        }
    }
}

/// Which found food's amount screen is open.
struct EstimatePick: Identifiable, Hashable { let id: Int }

extension View {
    /// The amount screen for a found food, pushed onto the screen holding the list.
    func estimateAmount(_ editing: Binding<EstimatePick?>, model: EstimateModel) -> some View {
        navigationDestination(item: editing) { pick in
            if model.items.indices.contains(pick.id) {
                ItemAmountScreen(item: model.items[pick.id]) { servingIndex, quantity in
                    model.setPortion(servingIndex: servingIndex, quantity: quantity, at: pick.id)
                }
            }
        }
    }
}

/// One AI-listed food's amount on the wheel (its own servings only: estimates are logged in their servings).
/// Pushed: Back leaves it unchanged, Done keeps the new amount.
private struct ItemAmountScreen: View {
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
}
