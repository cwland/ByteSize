import ByteSizeKit
import SwiftUI

/// Describe Food: "2 eggs, toast and coffee" → the AI's list → adjust → Log all.
struct DescribeSheet: View {
    @Bindable var model: EstimateModel
    /// After Log all: the (+) menu's sheet closes; inside Track Food it goes back to the search.
    let onLogged: (String) -> Void
    @FocusState private var typing: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 8) {
                    TextField("e.g. 2 eggs, toast and coffee", text: $model.text, axis: .vertical)
                        .lineLimit(2...5)
                        .focused($typing)
                        .accessibilityIdentifier("describeField")
                    // SPEC-21: one tap clears it (and the last list); the keyboard stays up for the next
                    if !model.text.isEmpty {
                        Button {
                            model.clearDescription()
                            typing = true
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(palette.color("subtle"))
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Clear description")
                    }
                }
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
                EstimateItemsView(model: model, onLogged: onLogged)
            }
        }
        .onAppear { typing = true }
    }
}
