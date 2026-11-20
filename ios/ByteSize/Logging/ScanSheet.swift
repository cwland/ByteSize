import ByteSizeKit
import SwiftUI

/// Scan Food: the live barcode reader (or a typed barcode); a barcode nobody knows yet → photograph its label →
/// check what the AI read → saved as the person's food with that barcode → log a portion.
struct ScanSheet: View {
    let model: ScanModel
    let track: TrackFoodModel
    let close: () -> Void
    @State private var typed = ""
    @State private var portionFood: Food?
    @State private var portion: PortionModel?
    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if case .review(let draft, _) = model.step {
                Form {
                    LabelReview(draft: draft) { edited in await model.save(edited) }
                }
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        stepView
                        if case .scanning = model.step { typeBarcode }
                    }
                    .padding()
                }
            }
        }
        .onChange(of: model.step) { _, step in
            switch step {
            case .found(let food), .saved(let food): openPortion(food)
            default: break
            }
        }
        .sheet(item: $portionFood, onDismiss: { model.restart() }) { food in
            if let portion {
                PortionSheet(portion: portion, onLog: {
                    let ok = await track.log(food, portion: portion)
                    if ok { close() }
                    return ok
                }, message: track.message)
            }
        }
    }

    @ViewBuilder
    private var stepView: some View {
        switch model.step {
        case .scanning:
            if BarcodeScanner.isAvailable {
                BarcodeScanner { code in
                    Haptics.scanned()
                    Task { await model.scanned(code) }
                }
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel("Barcode camera")
            } else {
                Card {
                    Label("Camera isn't available — type the barcode instead", systemImage: "camera.metering.unknown")
                        .accessibilityIdentifier("cameraUnavailable")
                }
            }
        case .looking(let code):
            Card { HStack { ProgressView(); Text("Looking up \(code)…") } }
        case .found(let food), .saved(let food):
            Card {
                FoodRow(food: food)
                Button("Scan another") { model.restart() }
            }
        case .notFound(let code):
            Card(title: "Barcode \(code)") {
                Text("We don't know this barcode yet").font(.headline).accessibilityIdentifier("unknownBarcode")
                Text("Photograph its Nutrition Facts label: the AI reads it and saves it as your food, so the next scan finds it.")
                    .font(.subheadline)
                    .foregroundStyle(palette.color("subtle"))
                PhotoButtons(takeTitle: "Scan the label", chooseTitle: "Choose a photo of the label") { jpeg in
                    Task { await model.readLabel(jpeg: jpeg) }
                }
                Button("Scan something else") { model.restart() }
            }
        case .readingLabel:
            Card { HStack { ProgressView(); Text("Reading the label…") } }
        case .review:
            EmptyView() // shown full-size above
        case .saving:
            Card { HStack { ProgressView(); Text("Saving…") } }
        case .failed(let message):
            Card {
                Text(message).accessibilityIdentifier("scanMessage")
                if model.code != nil, message == ScanModel.unreadable {
                    PhotoButtons(takeTitle: "Try the label again", chooseTitle: "Choose a photo of the label") { jpeg in
                        Task { await model.readLabel(jpeg: jpeg) }
                    }
                }
                Button("Start over") { model.restart() }
            }
        }
    }

    private var typeBarcode: some View {
        HStack {
            TextField("Type a barcode", text: $typed)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("barcodeField")
            Button("Look up") {
                Task { await model.scanned(typed) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(typed.filter(\.isNumber).count < 6)
            .accessibilityIdentifier("lookUpBarcode")
        }
    }

    private func openPortion(_ food: Food) {
        guard food.isLoggable else { return }
        portion = PortionModel(food: food, meal: track.meal)
        portionFood = food
    }
}
