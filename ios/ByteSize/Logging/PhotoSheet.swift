import ByteSizeKit
import SwiftUI

/// Photo: a barcode → its food; a nutrition label → check it, save it, log it; a plate of food → the AI's list.
struct PhotoSheet: View {
    @Bindable var model: EstimateModel
    let track: TrackFoodModel
    let close: () -> Void
    @State private var draft: AiDraft?
    @State private var portionFood: Food?
    @State private var portion: PortionModel?
    @State private var reading = false
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            if let draft {
                LabelReview(draft: draft) { edited in
                    if let food = await model.save(edited) {
                        self.draft = nil
                        openPortion(food)
                    }
                }
            } else if !model.items.isEmpty {
                EstimateItemsView(model: model, onLogged: close)
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
            if let message = model.message {
                Section { Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("photoMessage") }
            }
        }
        .sheet(item: $portionFood) { food in
            if let portion {
                PortionSheet(portion: portion, onLog: {
                    let ok = await track.log(food, portion: portion)
                    if ok { close() }
                    return ok
                }, message: track.message)
            }
        }
    }

    private func read(_ jpeg: Data) {
        reading = true
        Task {
            switch await model.photo(jpeg: jpeg) {
            case .food(let food): openPortion(food)
            case .draft(let d): draft = d
            case .items, .nothing: break
            }
            reading = false
        }
    }

    private func openPortion(_ food: Food) {
        guard food.isLoggable else { return }
        portion = PortionModel(food: food, meal: model.meal)
        portionFood = food
    }
}
