import ByteSizeKit
import SwiftUI

/// Track Food: type to search (or a barcode's digits); recent and frequent foods for the meal when the field is empty.
struct TrackFoodSheet: View {
    @Bindable var model: TrackFoodModel
    let close: () -> Void
    @State private var picked: Food?
    @State private var portion: PortionModel?
    @State private var searchShown = true
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            if model.query.trimmingCharacters(in: .whitespaces).count < 2 {
                Section {
                    MealPicker(meal: $model.meal)
                }
                foodSection("Recent", model.recent)
                foodSection("Frequent", model.frequent)
                if model.recent.isEmpty, model.frequent.isEmpty {
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
        // Pushed, not a sheet: iOS won't open a sheet over an active search
        .navigationDestination(item: $picked) { food in
            if let portion {
                PortionSheet(portion: portion, onLog: {
                    let ok = await model.log(food, portion: portion)
                    if ok { close() }
                    return ok
                }, message: model.message, pushed: true)
            }
        }
    }

    @ViewBuilder
    private func foodSection(_ title: String, _ foods: [Food]) -> some View {
        if !foods.isEmpty {
            Section(title) {
                ForEach(foods, id: \.ref) { food in
                    Button {
                        guard food.isLoggable else { return }
                        portion = PortionModel(food: food, meal: model.meal)
                        picked = food
                    } label: {
                        FoodRow(food: food)
                    }
                    .disabled(!food.isLoggable)
                    .accessibilityIdentifier("food-\(food.name)")
                }
            }
        }
    }
}
