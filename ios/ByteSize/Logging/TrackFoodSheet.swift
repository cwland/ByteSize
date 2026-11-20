import ByteSizeKit
import SwiftUI

/// Track Food: type to search (or a barcode's digits). With the field empty (L2, SPEC-10): Same as yesterday,
/// Favorites and Recently tracked for the meal, each with a + that logs it at once; tapping a row opens the wheels.
struct TrackFoodSheet: View {
    @Bindable var model: TrackFoodModel
    let units: Units
    let close: () -> Void
    @State private var picked: Food?
    @State private var searchShown = true
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            if let logged = model.lastLogged {
                Label("Logged \(logged)", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(palette.color("success"))
                    .accessibilityIdentifier("loggedToast")
            }
            if model.query.trimmingCharacters(in: .whitespaces).count < 2 {
                Section {
                    MealPicker(meal: $model.meal)
                }
                yesterdaySection
                foodSection("Favorites", model.favorites, quick: true)
                foodSection("Recently tracked", model.recent, quick: true)
                if model.yesterday.isEmpty, model.favorites.isEmpty, model.recent.isEmpty {
                    Text("Foods you log show up here.").foregroundStyle(palette.color("subtle"))
                }
            } else {
                if model.searching { HStack { Spacer(); ProgressView(); Spacer() } }
                if let message = model.message {
                    Text(message).foregroundStyle(palette.color("subtle")).accessibilityIdentifier("trackMessage")
                }
                ForEach(model.groups) { group in foodSection(group.label, group.foods) }
            }
        }
        .searchable(text: $model.query, isPresented: $searchShown, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search foods or type a barcode")
        .task { await model.load() }
        .task(id: model.query) {
            // A short pause so each keystroke doesn't send a search
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.search()
        }
        .onChange(of: model.meal) { Task { await model.load() } }
        .onChange(of: picked) { _, now in
            if now == nil, model.lastLogged != nil { searchShown = true } // back from logging: ready to type the next
        }
        // Pushed, not a sheet: iOS won't open a sheet over an active search
        .navigationDestination(item: $picked) { food in
            // SPEC-16: after logging, back to an empty search for the next food (Close leaves)
            FoodPortionView(food: food, meal: model.meal, pushed: true, message: model.message, favorites: model) { food, portion in
                await model.log(food, portion: portion)
            }
        }
    }

    /// Yesterday's entries in this meal, exactly as logged: + copies one, Log all copies them all.
    @ViewBuilder
    private var yesterdaySection: some View {
        if !model.yesterday.isEmpty {
            Section {
                ForEach(model.yesterday) { item in
                    HStack {
                        Button {
                            if let food = item.food, food.isLoggable { picked = food }
                        } label: {
                            FoodRow(icon: item.entry.icon, name: item.entry.name, brand: item.entry.brand,
                                    detail: "\(item.entry.amountText(units: units)) · \(Int(item.entry.calories.rounded())) cal")
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("food-\(item.entry.name)")
                        quickAdd(item.entry.name) { await model.copyYesterday(item) }
                    }
                }
            } header: {
                HStack {
                    Text("Same as yesterday")
                    Spacer()
                    Button("Log all") { Task { if await model.logAllYesterday() { Haptics.logged() } } }
                        .font(.subheadline.bold())
                        .textCase(nil)
                        .accessibilityLabel("Log all of yesterday's \(model.meal.title)")
                        .accessibilityIdentifier("logAllYesterday")
                }
            }
        }
    }

    /// The + on a quick row: logs it now (at its last amount, or yesterday's entry as it was).
    private func quickAdd(_ name: String, _ log: @escaping () async -> Bool) -> some View {
        Button {
            Task { if await log() { Haptics.logged() } }
        } label: {
            Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(palette.color("primary"))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Log \(name)")
        .accessibilityIdentifier("quickAdd-\(name)")
    }

    @ViewBuilder
    private func foodSection(_ title: String, _ foods: [Food], quick: Bool = false) -> some View {
        if !foods.isEmpty {
            Section(title) {
                ForEach(foods, id: \.ref) { food in
                    HStack {
                        Button {
                            guard food.isLoggable else { return }
                            picked = food
                        } label: {
                            FoodRow(food: food)
                        }
                        .buttonStyle(.plain)
                        .disabled(!food.isLoggable)
                        .accessibilityIdentifier("food-\(food.name)")
                        if quick, food.isLoggable {
                            quickAdd(food.name) { await model.quickLog(food) }
                        }
                    }
                }
            }
        }
    }
}
