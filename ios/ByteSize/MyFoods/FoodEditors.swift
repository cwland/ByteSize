import ByteSizeKit
import SwiftUI

/// Where My Foods' editors are pushed to (R2).
enum MyFoodsRoute: Hashable {
    case food(Food?)
    case recipe(Int?)
    case meal(Int?)

    /// The editor for a row: custom foods and My edits → food; recipes; quick meals.
    static func edit(_ food: Food) -> MyFoodsRoute {
        switch food.foodKind {
        case "recipe": .recipe(food.id)
        case "quick_meal": .meal(food.id)
        default: .food(food)
        }
    }
}

/// The website's FoodForm: name, brand, barcode, servings and the 13 nutrients; Save.
struct FoodEditorView: View {
    @State var model: FoodEditorModel
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            Section("Food") {
                TextField("Name", text: $model.name).accessibilityIdentifier("foodName")
                TextField("Brand (optional)", text: $model.brand)
                TextField("Barcode (optional)", text: $model.barcode).keyboardType(.numberPad)
            }
            Section {
                ForEach($model.servings) { $row in
                    let first = model.servings.first?.id == row.id
                    HStack {
                        TextField(first ? "Serving size, like 1 cup" : "Serving", text: $row.label)
                            .accessibilityIdentifier(first ? "servingLabel" : "servingLabel-more")
                        TextField("g", text: $row.grams).keyboardType(.decimalPad).frame(width: 56)
                        TextField("ml", text: $row.ml).keyboardType(.decimalPad).frame(width: 56)
                    }
                    .deleteDisabled(first)
                }
                .onDelete { $0.forEach { model.removeServing(at: $0) } }
                Button("Add serving", systemImage: "plus") { model.addServing() }
            } header: {
                Text("Servings")
            } footer: {
                Text("The nutrients below are for the first serving.")
            }
            Section("Per serving") {
                ForEach(Nutrients.keys, id: \.key) { k in
                    HStack {
                        Text(k.label)
                        if model.aiFields.contains(k.key) { AIChip() }
                        Spacer()
                        TextField("—", text: Binding(get: { model.values[k.key] ?? "" }, set: { model.setValue(k.key, $0) }))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 96)
                            .accessibilityIdentifier("nutrient-\(k.key)")
                    }
                }
                if model.canFillGaps {
                    Button("Fill gaps with AI", systemImage: "sparkles") { Task { await model.fillGaps() } }
                        .disabled(model.busy)
                }
            }
            if let message = model.message {
                Section { Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("editorMessage") }
            }
        }
        .navigationTitle(model.isNew ? "New food" : "Edit food")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        if await model.save() != nil {
                            onSaved()
                            dismiss()
                        }
                    }
                }
                .disabled(model.busy)
                .accessibilityIdentifier("saveFood")
            }
        }
    }
}

/// The ingredients / foods of a recipe or quick meal: tap one for its amount, swipe to remove, add from a search.
struct ItemsSection: View {
    let title: String
    let addTitle: String
    let items: [EditItem]
    let onAmount: (Int) -> Void
    let onRemove: (Int) -> Void
    let onAdd: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Section(title) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                Button { onAmount(i) } label: {
                    HStack(spacing: 12) {
                        Text(item.icon).font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).foregroundStyle(palette.color(item.available ? "ink" : "subtle"))
                            Text("\(LabelReview.number(item.quantity * item.fraction)) × \(unitLabel(item)) · \(Int(item.nutrients["calories"].rounded())) cal")
                                .font(.caption)
                                .foregroundStyle(palette.color("subtle"))
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(palette.color("subtle"))
                    }
                }
                .accessibilityIdentifier("editItem-\(item.name)")
                .swipeActions {
                    Button(role: .destructive) { onRemove(i) } label: { Label("Remove", systemImage: "trash") }
                }
            }
            Button(addTitle, systemImage: "plus", action: onAdd).accessibilityIdentifier("addItem")
        }
    }

    private func unitLabel(_ item: EditItem) -> String {
        if item.unit == "serving" { return item.servings.indices.contains(item.servingIndex) ? item.servings[item.servingIndex].label : "serving" }
        return AmountUnit(rawValue: item.unit)?.label ?? item.unit
    }
}

/// Totals, as the website shows them (a value not said is 0).
struct TotalsSection: View {
    let title: String
    let n: Nutrients

    var body: some View {
        Section(title) {
            row("Calories", "\(Int(n["calories"].rounded()))")
            row("Protein", grams(n["protein_g"]))
            row("Fiber", grams(n["fiber_g"]))
            row("Carbs", grams(n["carbs_g"]))
            row("Fat", grams(n["fat_g"]))
        }
    }

    private func grams(_ v: Double) -> String { "\((v * 10).rounded() / 10) g".replacingOccurrences(of: ".0 g", with: " g") }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).monospacedDigit() }
    }
}

/// Which item's amount screen is open, or the picker.
private enum ItemsRoute: Hashable {
    case amount(Int)
    case pick
}

/// The website's RecipeEditor.
struct RecipeEditorView: View {
    @State var model: RecipeEditorModel
    let picker: (@escaping (Food) -> Bool) -> FoodPickerModel
    let onSaved: () -> Void
    @State private var route: ItemsRoute?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            Section { TextField("Name, like Chili", text: $model.name).accessibilityIdentifier("recipeName") }
            ItemsSection(title: "Ingredients", addTitle: "Add ingredient", items: model.items, onAmount: { route = .amount($0) }, onRemove: { model.remove(at: $0) }, onAdd: { route = .pick })
            Section {
                LabeledContent("Number of servings") {
                    TextField("1", text: $model.servings).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityIdentifier("recipeServings")
                }
                LabeledContent("Weight of one serving (g)") {
                    TextField("Optional", text: $model.weight).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
            }
            TotalsSection(title: "Per serving", n: model.perServing)
            Section("Notes") { TextField("Notes", text: $model.notes, axis: .vertical).lineLimit(2...6) }
            if model.id != nil {
                Section {
                    Button("Recalculate", systemImage: "arrow.clockwise") { Task { await model.recalculate() } }
                        .disabled(!model.canRecalculate)
                        .accessibilityIdentifier("recalculate")
                } footer: {
                    Text(model.changed ? "Save your changes first" : "Recalculate uses the ingredients' foods as they are now, in case their numbers changed.")
                }
            }
            EditorMessages(message: model.message, notice: model.notice)
        }
        .navigationTitle(model.id == nil ? "New recipe" : "Edit recipe")
        .navigationBarTitleDisplayMode(.inline)
        .task { if !model.loaded { await model.load() } }
        .navigationDestination(item: $route) { r in
            switch r {
            case .amount(let i) where model.items.indices.contains(i):
                EditItemAmountView(item: model.items[i]) { s, u, q in model.setPortion(at: i, servingIndex: s, unit: u, quantity: q) }
            case .amount: EmptyView()
            case .pick: ItemPickerView(title: "Add ingredient", model: picker(model.allows)) { model.add($0); route = nil }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        if await model.save() != nil {
                            onSaved()
                            dismiss()
                        }
                    }
                }
                .disabled(model.busy || !model.loaded)
                .accessibilityIdentifier("saveRecipe")
            }
        }
    }
}

/// The website's QuickMealEditor.
struct QuickMealEditorView: View {
    @State var model: QuickMealEditorModel
    let picker: (@escaping (Food) -> Bool) -> FoodPickerModel
    let onSaved: () -> Void
    @State private var route: ItemsRoute?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section { TextField("Name, like Usual breakfast", text: $model.name).accessibilityIdentifier("mealName") }
            ItemsSection(title: "Foods", addTitle: "Add food", items: model.items, onAmount: { route = .amount($0) }, onRemove: { model.remove(at: $0) }, onAdd: { route = .pick })
            TotalsSection(title: "Total", n: model.total)
            EditorMessages(message: model.message, notice: nil)
        }
        .navigationTitle(model.id == nil ? "New quick meal" : "Edit quick meal")
        .navigationBarTitleDisplayMode(.inline)
        .task { if !model.loaded { await model.load() } }
        .navigationDestination(item: $route) { r in
            switch r {
            case .amount(let i) where model.items.indices.contains(i):
                EditItemAmountView(item: model.items[i]) { s, u, q in model.setPortion(at: i, servingIndex: s, unit: u, quantity: q) }
            case .amount: EmptyView()
            case .pick: ItemPickerView(title: "Add food", model: picker(model.allows)) { model.add($0); route = nil }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        if await model.save() != nil {
                            onSaved()
                            dismiss()
                        }
                    }
                }
                .disabled(model.busy || !model.loaded)
                .accessibilityIdentifier("saveMeal")
            }
        }
    }
}

private struct EditorMessages: View {
    let message: String?
    let notice: String?
    @Environment(\.palette) private var palette

    var body: some View {
        if let message {
            Section { Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("editorMessage") }
        } else if let notice {
            Section { Label(notice, systemImage: "checkmark.circle.fill").foregroundStyle(palette.color("success")) }
        }
    }
}

/// One item's amount on the wheel; Done keeps it.
private struct EditItemAmountView: View {
    @State private var portion: PortionModel
    let onDone: (Int, String, Double) -> Void
    @Environment(\.dismiss) private var dismiss

    init(item: EditItem, onDone: @escaping (Int, String, Double) -> Void) {
        _portion = State(initialValue: item.portion())
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
                    onDone(portion.servingIndex, portion.unit.rawValue, portion.quantity)
                    dismiss()
                }
                .disabled(!portion.canLog)
                .accessibilityIdentifier("itemAmountDone")
            }
        }
    }
}

/// Search for a food to add; pick it, choose an amount, Add (back to the editor).
struct ItemPickerView: View {
    let title: String
    @State var model: FoodPickerModel
    let onAdd: (EditItem) -> Void
    @State private var picked: Food?
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            TextField("Search foods", text: $model.query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("pickerSearch")
            if model.searching { ProgressView() }
            if let message = model.message { Text(message).foregroundStyle(palette.color("subtle")) }
            ForEach(model.results) { food in
                Button { picked = food } label: { FoodRow(food: food) }
                    .accessibilityIdentifier("pick-\(food.name)")
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.query) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.search()
        }
        .navigationDestination(item: $picked) { food in
            // The editor closes the picker (both screens) once it has the item
            PickAmountView(food: food, onAdd: onAdd)
        }
    }
}

/// The amount for a picked food; Add puts it in the editor.
private struct PickAmountView: View {
    let food: Food
    let onAdd: (EditItem) -> Void
    @State private var portion: PortionModel

    init(food: Food, onAdd: @escaping (EditItem) -> Void) {
        self.food = food
        self.onAdd = onAdd
        _portion = State(initialValue: PortionModel(food: food, meal: .snacks))
    }

    var body: some View {
        Form {
            Section { FoodRow(food: food) }
            Section("Amount") { AmountWheel(portion: portion) }
        }
        .navigationTitle("Choose an amount")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add") { onAdd(EditItem(food: food, portion: portion)) }
                    .disabled(!portion.canLog)
                    .accessibilityIdentifier("addPicked")
            }
        }
    }
}
