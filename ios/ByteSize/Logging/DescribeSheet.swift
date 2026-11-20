import ByteSizeKit
import SwiftUI

/// Describe Food: "2 eggs, toast and coffee" → the AI's list → adjust → Log all.
struct DescribeSheet: View {
    @Bindable var model: EstimateModel
    let close: () -> Void
    @FocusState private var typing: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            Section {
                TextField("e.g. 2 eggs, toast and coffee", text: $model.text, axis: .vertical)
                    .lineLimit(2...5)
                    .focused($typing)
                    .accessibilityIdentifier("describeField")
                Button {
                    typing = false
                    Task { await model.describe() }
                } label: {
                    HStack { Spacer(); if model.busy && model.items.isEmpty { ProgressView() } else { Text("Estimate").bold() }; Spacer() }
                }
                .disabled(model.busy)
                .accessibilityIdentifier("estimateButton")
            } footer: {
                if let note = model.assumedNote { Text(note) }
            }
            if let message = model.message {
                Section { Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("describeMessage") }
            }
            if !model.items.isEmpty {
                EstimateItemsView(model: model, onLogged: close)
            }
        }
        .onAppear { typing = true }
    }
}
