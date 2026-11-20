import ByteSizeKit
import SwiftUI

/// How much to log: a serving, an amount, a fraction and the meal, with an ≈ calorie preview.
struct PortionSheet: View {
    @Bindable var portion: PortionModel
    /// Logs it; true closes the sheet.
    let onLog: () async -> Bool
    var message: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var logging = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Text(portion.icon).font(.largeTitle)
                        Text(portion.name).font(.headline)
                        Spacer()
                        // ≈: the server's numbers rule once it's logged
                        Text(portion.previewCalories.map { "≈ \($0) cal" } ?? "—")
                            .font(.headline)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .foregroundStyle(palette.color("subtle"))
                            .accessibilityLabel(portion.previewCalories.map { "About \($0) calories" } ?? "Enter an amount")
                            .accessibilityIdentifier("previewCalories")
                    }
                }
                Section("Amount") {
                    if portion.servings.count > 1 {
                        Picker("Serving", selection: $portion.servingIndex) {
                            ForEach(portion.servings.indices, id: \.self) { i in
                                Text(portion.servings[i].label).tag(i)
                            }
                        }
                    } else if let only = portion.servings.first {
                        LabeledContent("Serving", value: only.label)
                    }
                    HStack {
                        Text("How many")
                        TextField("1", text: $portion.quantityText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("quantityField")
                    }
                    FractionChips(fraction: $portion.fraction)
                }
                Section {
                    MealPicker(meal: $portion.meal)
                }
                if let message {
                    Section { Text(message).foregroundStyle(palette.color("error")) }
                }
            }
            .navigationTitle("Track")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log") {
                        logging = true
                        Task {
                            let ok = await onLog()
                            logging = false
                            if ok {
                                Haptics.logged()
                                dismiss()
                            }
                        }
                    }
                    .bold()
                    .disabled(!portion.canLog || logging)
                    .accessibilityIdentifier("logButton")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// ¼ ⅓ ½ ¾ All
struct FractionChips: View {
    @Binding var fraction: Double
    @Environment(\.palette) private var palette
    private static let labels = ["¼", "⅓", "½", "¾", "All"]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(PortionModel.fractions.enumerated()), id: \.offset) { i, value in
                let on = abs(fraction - value) < 0.001
                Button(Self.labels[i]) { fraction = value }
                    .buttonStyle(.plain)
                    .font(.subheadline.weight(on ? .semibold : .regular))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(on ? palette.color("primary") : palette.color("brand-subtle"), in: Capsule())
                    .foregroundStyle(on ? palette.color("on-primary") : palette.color("ink"))
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityLabel(Self.labels[i] == "All" ? "All of it" : "\(Self.labels[i]) of it")
            }
        }
    }
}

struct MealPicker: View {
    @Binding var meal: Meal

    var body: some View {
        Picker("Meal", selection: $meal) {
            ForEach(Meal.allCases) { Text($0.title).tag($0) }
        }
    }
}

enum Haptics {
    static func logged() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func scanned() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}

/// A food in a list: icon, name, brand and ≈ calories per serving.
struct FoodRow: View {
    let icon: String
    let name: String
    let brand: String?
    let detail: String
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            Text(icon).font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).foregroundStyle(palette.color("ink"))
                Text([brand, detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(palette.color("subtle"))
            }
            Spacer()
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    init(food: Food) {
        icon = food.icon
        name = food.name
        brand = food.brand
        detail = food.isLoggable
            ? "≈ \(Int(food.calories.rounded())) cal / \(food.servings.first?.label ?? "serving")"
            : "Track Culury recipes in the web app"
    }
}
