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
    @State private var cameraFailed = false
    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if case .review(let draft, _) = model.step {
                Form {
                    if let message = model.message {
                        Section { Text(message).foregroundStyle(palette.color("error")) }
                    }
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
        // Pushed, not a sheet (R1). Logged or Scan again: the camera for the next barcode (SPEC-16); Back: the list
        .navigationDestination(item: $portionFood) { food in
            FoodPortionView(food: food, meal: track.meal, pushed: true, message: track.message, favorites: track,
                            again: PortionSheet.Again(title: "Scan again") { portionFood = nil; model.restart() }) { food, portion in
                let ok = await track.log(food, portion: portion)
                if ok { model.logged(food.name) }
                return ok
            }
        }
    }

    @ViewBuilder
    private var stepView: some View {
        switch model.step {
        case .scanning:
            if let logged = model.lastLogged {
                Label("Logged \(logged)", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(palette.color("success"))
                    .accessibilityIdentifier("loggedToast")
            }
            if BarcodeScanner.isAvailable && !cameraFailed {
                BarcodeScanner(onCode: { code in
                    Haptics.scanned()
                    Task { await model.scanned(code, fromCamera: true) }
                }, onUnavailable: { cameraFailed = true })
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
            // Owner: always a list first (even of one): tap the food for its amount, or + to log it now
            Card(title: model.code.map { "Barcode \($0)" }) {
                scannedRow(food, id: "scanned-\(food.name)") { openPortion(food) } quick: { await quickLog(food) }
                Button("Scan another") { model.restart() }
            }
        case .choose(let foods, let code):
            Card(title: "Which one is it?") {
                Text("The sources don't agree on barcode \(code). Pick the right one:")
                    .font(.subheadline)
                    .foregroundStyle(palette.color("subtle"))
                ForEach(foods, id: \.id) { food in
                    scannedRow(food, id: "choice-\(food.name)") {
                        Task { await model.pick(food); openPortion(food) }
                    } quick: {
                        await model.pick(food)
                        return await quickLog(food)
                    }
                }
                Button("None of these — scan its label") { model.noneOfThese() }
                    .accessibilityIdentifier("noneOfThese")
                Button("Scan something else") { model.restart() }
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

    /// A found food's row: tap it for the amount; + logs it now (its last amount, or one serving).
    private func scannedRow(_ food: Food, id: String, open: @escaping () -> Void, quick: @escaping () async -> Bool) -> some View {
        HStack {
            Button(action: open) { FoodRow(food: food).contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .disabled(!food.isLoggable)
                .accessibilityIdentifier(id)
            if food.isLoggable {
                Button {
                    Task { if await quick() { Haptics.logged() } }
                } label: {
                    Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(palette.color("primary"))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Log \(food.name)")
                .accessibilityIdentifier("quickAdd-\(food.name)")
            }
        }
    }

    /// The + : logged as the search's + logs it, then back to the camera for the next barcode (SPEC-16).
    private func quickLog(_ food: Food) async -> Bool {
        let ok = await track.quickLog(food)
        if ok { model.logged(food.name) }
        return ok
    }

    private func openPortion(_ food: Food) {
        guard food.isLoggable else { return }
        portionFood = food
    }
}
