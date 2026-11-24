import ByteSizeKit
import SwiftUI

/// The foods the AI listed (Describe, plate photos). Describe: tap a food for its amount, + to log just that one,
/// Log all for the rest (each its own entry). Photos: each checked to start, then Log selected. Several described foods with a name together (2026-11-22 design)
/// get a One meal / Separate items switch, opening on One meal: one entry under the (renameable) name, optionally
/// saved to My foods. A food can be swiped away (or removed on its amount screen) and, in Describe, more added.
struct EstimateItemsView: View {
    @Bindable var model: EstimateModel
    /// The food whose amount screen is open: pushed by the screen holding this list (a sheet here closed itself).
    @Binding var editing: EstimatePick?
    /// Describe: an "Add a food" row asks the AI for more foods.
    var allowAdd = false
    /// After logging: how many foods were logged ("2 foods"), the one food's name, or the meal's.
    let onLogged: (String) -> Void
    @Environment(\.palette) private var palette

    private var isMeal: Bool { model.showsSwitch && model.mode == .meal }
    /// Describe lists each food with a + (log it on its own; tap the row for its amount); photos keep checkboxes.
    private var plusRows: Bool { allowAdd }

    var body: some View {
        if model.showsSwitch {
            Section {
                Picker("Log as", selection: $model.mode) {
                    Text("One meal").tag(EstimateModel.LogMode.meal)
                    Text("Separate items").tag(EstimateModel.LogMode.items)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("logAs")
                if isMeal {
                    TextField("Meal name", text: $model.mealName)
                        .accessibilityLabel("Meal name")
                        .accessibilityIdentifier("mealName")
                }
            }
        }
        Section(isMeal ? "Made with" : "What the AI found") {
            ForEach(Array(model.items.enumerated()), id: \.offset) { i, item in
                let done = model.logged.indices.contains(i) && model.logged[i]
                let on = !done && (isMeal || plusRows || (model.selected.indices.contains(i) && model.selected[i]))
                HStack(spacing: 12) {
                    if !isMeal && !plusRows {
                        Button { model.toggle(at: i) } label: {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.title2)
                                .foregroundStyle(on ? palette.color("primary") : palette.color("subtle"))
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Include \(item.food.name)")
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("check-\(item.food.name)")
                    }
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
                    // Describe: + logs just this food (its own entry); a ✓ once it's logged
                    if plusRows && !isMeal {
                        Button {
                            Task { if await model.logOne(at: i) { Haptics.logged() } }
                        } label: {
                            Image(systemName: done ? "checkmark.circle.fill" : "plus.circle.fill")
                                .font(.title2)
                                .foregroundStyle(palette.color(done ? "subtle" : "primary"))
                        }
                        .buttonStyle(.borderless)
                        .disabled(done || model.busy)
                        .accessibilityLabel(done ? "\(item.food.name) logged" : "Log \(item.food.name)")
                        .accessibilityIdentifier("plus-\(item.food.name)")
                    }
                }
                .swipeActions {
                    Button(role: .destructive) { model.remove(at: i) } label: { Label("Remove", systemImage: "trash") }
                }
            }
            if allowAdd {
                HStack {
                    TextField("Add a food, e.g. a black coffee", text: $model.addText)
                        .accessibilityLabel("Add a food")
                        .accessibilityIdentifier("addFoodField")
                    if model.adding {
                        ProgressView()
                    } else {
                        Button("Add") { Task { await model.addFood() } }
                            .buttonStyle(.borderless)
                            .disabled(model.addText.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                            .accessibilityIdentifier("addFood")
                    }
                }
            }
        }
        Section {
            MealPicker(meal: $model.meal)
            if isMeal {
                Toggle("Save to My foods", isOn: $model.saveToMyFoods)
                    .accessibilityIdentifier("saveToMyFoods")
            }
            HStack {
                Text("Total")
                Spacer()
                Text("≈ \(model.totalCalories) cal").monospacedDigit()
            }
            Button {
                Task {
                    let meal = isMeal ? model.mealName.trimmingCharacters(in: .whitespacesAndNewlines) : nil
                    let names = model.items.indices.filter { model.selected[$0] && !model.logged[$0] }.map { model.items[$0].food.name }
                    if await model.logSelected() {
                        Haptics.logged()
                        onLogged(meal ?? (names.count == 1 ? names[0] : "\(names.count) foods"))
                    }
                }
            } label: {
                HStack { Spacer(); Text(logTitle).bold(); Spacer() }
            }
            .disabled(!model.canLog)
            .accessibilityIdentifier("logSelected")
        }
    }

    /// One meal: "Log Egg sandwich"; Describe: "Log all 2" (each its own entry); photos: "Log selected".
    private var logTitle: String {
        if isMeal { return "Log \(model.mealName.trimmingCharacters(in: .whitespacesAndNewlines))" }
        return plusRows ? "Log all \(model.remainingCount)" : "Log selected"
    }
}

/// Which found food's amount screen is open.
struct EstimatePick: Identifiable, Hashable { let id: Int }

extension View {
    /// The amount screen for a found food, pushed onto the screen holding the list.
    func estimateAmount(_ editing: Binding<EstimatePick?>, model: EstimateModel) -> some View {
        navigationDestination(item: editing) { pick in
            if model.items.indices.contains(pick.id) {
                ItemAmountScreen(item: model.items[pick.id], onRemove: { model.remove(at: pick.id) }) { servingIndex, quantity in
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
    let onRemove: () -> Void
    let onDone: (Int, Double) -> Void
    @Environment(\.dismiss) private var dismiss

    init(item: EstimateItem, onRemove: @escaping () -> Void, onDone: @escaping (Int, Double) -> Void) {
        self.onRemove = onRemove
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
            Section {
                Button("Remove from the list", role: .destructive) {
                    onRemove()
                    dismiss()
                }
                .accessibilityIdentifier("removeItem")
            }
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
