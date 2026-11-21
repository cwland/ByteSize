import ByteSizeKit
import SwiftUI

/// Photo: a barcode → its food; a nutrition label → check it, save it, log it; a plate of food → the AI's list.
struct PhotoSheet: View {
    @Bindable var model: EstimateModel
    let track: TrackFoodModel
    /// After logging: the (+) menu's sheet closes; inside Track Food it goes back to the search.
    let onLogged: (String) -> Void
    @State private var draft: AiDraft?
    @State private var read: AiDraft? // what the AI read, so values corrected on review aren't marked AI
    @State private var notHere: String?
    @State private var portionFood: Food?
    @State private var reading = false
    @State private var editing: EstimatePick?
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            if let draft {
                LabelReview(draft: draft) { edited in
                    if let food = await model.save(edited, original: read) {
                        self.draft = nil
                        openPortion(food)
                    }
                }
            } else if !model.items.isEmpty {
                EstimateItemsView(model: model, editing: $editing, onLogged: onLogged)
            } else {
                Section {
                    Text("A barcode, a Nutrition Facts label or a plate of food.")
                        .foregroundStyle(palette.color("subtle"))
                    if reading {
                        HStack { ProgressView(); Text("Reading the photo…") }
                    } else {
                        PhotoButtons { jpeg in read(jpeg) }
                    }
                }
            }
            if let message = notHere ?? model.message {
                Section { Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("photoMessage") }
            }
        }
        .estimateAmount($editing, model: model)
        .sheet(item: $portionFood) { food in
            FoodPortionView(food: food, meal: model.meal, message: track.message, favorites: track) { food, portion in
                let ok = await track.log(food, portion: portion)
                if ok { onLogged(food.name) }
                return ok
            }
        }
    }

    private func read(_ jpeg: Data) {
        reading = true
        Task {
            switch await model.photo(jpeg: jpeg) {
            case .food(let food): openPortion(food)
            case .draft(let d):
                draft = d
                read = d
            case .items, .nothing: break
            }
            reading = false
        }
    }

    private func openPortion(_ food: Food) {
        guard food.isLoggable else {
            notHere = "\(food.name): log quick meals from My Foods"
            return
        }
        portionFood = food
    }
}
