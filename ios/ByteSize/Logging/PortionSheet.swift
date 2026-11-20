import ByteSizeKit
import SwiftUI

/// How much to log: a serving, an amount, a fraction and the meal, with an ≈ calorie preview.
struct PortionSheet: View {
    @Bindable var portion: PortionModel
    /// Logs it; true closes the sheet.
    let onLog: () async -> Bool
    var message: String?
    /// Pushed onto a navigation stack (Track Food, where a sheet can't open over an active search) rather than a sheet.
    var pushed = false
    struct Bookmark {
        let isOn: Bool
        let toggle: () async -> Void
    }
    var bookmark: Bookmark?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var logging = false
    @State private var askingBig = false

    private func log() {
        logging = true
        Task {
            let ok = await onLog()
            logging = false
            if ok {
                Haptics.logged()
                dismiss() // a sheet closes; pushed (Track Food), it goes back to the search
            }
        }
    }

    var body: some View {
        if pushed {
            form
        } else {
            NavigationStack { form }
                .presentationDetents([.medium, .large])
        }
    }

    private var form: some View {
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
                    AmountWheel(portion: portion)
                }
                Section {
                    MealPicker(meal: $portion.meal)
                }
                if let message {
                    Section { Text(message).foregroundStyle(palette.color("error")) }
                }
            }
            .alert(BigAmount.question(calories: portion.previewCalories ?? 0, name: portion.name), isPresented: $askingBig) {
                Button("Change", role: .cancel) {}
                Button("Log it") { log() }
            }
            .navigationTitle("Track")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !pushed {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
                if let bookmark {
                    ToolbarItem(placement: .primaryAction) {
                        Button { Task { await bookmark.toggle() } } label: {
                            Image(systemName: bookmark.isOn ? "bookmark.fill" : "bookmark")
                        }
                        .accessibilityLabel(bookmark.isOn ? "Remove from Favorites" : "Add to Favorites")
                        .accessibilityIdentifier("bookmark")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log") {
                        if portion.isBig { askingBig = true } else { log() }
                    }
                    .bold()
                    .disabled(!portion.canLog || logging)
                    .accessibilityIdentifier("logButton")
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

    init(icon: String, name: String, brand: String?, detail: String) {
        self.icon = icon
        self.name = name
        self.brand = brand
        self.detail = detail
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

/// The portion screen for a food: makes (and keeps) its own portion, so it never opens empty.
struct FoodPortionView: View {
    let food: Food
    var pushed = false
    var message: String?
    /// Where the bookmark lives (Track Food's favorites); nil hides it.
    var favorites: TrackFoodModel?
    let log: (Food, PortionModel) async -> Bool
    @State private var portion: PortionModel

    init(food: Food, meal: Meal, pushed: Bool = false, message: String? = nil, favorites: TrackFoodModel? = nil, log: @escaping (Food, PortionModel) async -> Bool) {
        self.food = food
        self.pushed = pushed
        self.message = message
        self.favorites = favorites
        self.log = log
        _portion = State(initialValue: PortionModel(food: food, meal: meal))
    }

    /// A database food or one of the person's own, loggable here (SPEC-10).
    private var bookmark: PortionSheet.Bookmark? {
        guard let favorites, food.isLoggable, food.kind == "cache" || food.kind == "user_food" else { return nil }
        return PortionSheet.Bookmark(isOn: favorites.isFavorite(food)) { await favorites.toggleFavorite(food) }
    }

    var body: some View {
        // The model's message read here, so a failed bookmark or log shows while this screen is open
        PortionSheet(portion: portion, onLog: { await log(food, portion) }, message: favorites?.message ?? message, pushed: pushed, bookmark: bookmark)
    }
}
