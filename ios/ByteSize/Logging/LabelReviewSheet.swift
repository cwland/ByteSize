import ByteSizeKit
import SwiftUI

/// What the AI read from a nutrition label, to check and fix before it's saved as the person's food.
/// Every value it read is marked "AI".
struct LabelReview: View {
    let draft: AiDraft
    var saveTitle = "Save food"
    let onSave: (AiDraft) async -> Void
    @State private var name: String
    @State private var brand: String
    @State private var serving: String
    @State private var values: [String: String]
    @State private var saving = false
    @Environment(\.palette) private var palette

    static let fields: [(key: String, label: String)] = [
        ("calories", "Calories"), ("protein_g", "Protein (g)"), ("fiber_g", "Fiber (g)"), ("carbs_g", "Carbs (g)"), ("fat_g", "Fat (g)"),
    ]

    init(draft: AiDraft, saveTitle: String = "Save food", onSave: @escaping (AiDraft) async -> Void) {
        self.draft = draft
        self.saveTitle = saveTitle
        self.onSave = onSave
        _name = State(initialValue: draft.name)
        _brand = State(initialValue: draft.brand ?? "")
        _serving = State(initialValue: draft.servings.first?.label ?? "1 serving")
        var start: [String: String] = [:]
        for f in Self.fields where draft.nutrients.values[f.key] != nil {
            start[f.key] = Self.number(draft.nutrients[f.key])
        }
        _values = State(initialValue: start)
    }

    /// Sections only: put it in a Form.
    var body: some View {
        Group {
            Section("Food") {
                TextField("Name", text: $name).accessibilityIdentifier("labelName")
                TextField("Brand (optional)", text: $brand)
                TextField("Serving", text: $serving)
            }
            Section("Per serving") {
                ForEach(Self.fields, id: \.key) { field in
                    HStack {
                        Text(field.label)
                        if draft.nutrients.values[field.key] != nil { AIChip() }
                        TextField("—", text: Binding(get: { values[field.key] ?? "" }, set: { values[field.key] = $0 }))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
            Section {
                Button {
                    saving = true
                    Task {
                        await onSave(edited)
                        saving = false
                    }
                } label: {
                    HStack { Spacer(); if saving { ProgressView() } else { Text(saveTitle).bold() }; Spacer() }
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                .accessibilityIdentifier("saveFood")
            }
        }
    }

    /// The draft with the person's changes (a cleared value is left out; other nutrients it read are kept).
    private var edited: AiDraft {
        var out = draft
        out.name = name.trimmingCharacters(in: .whitespaces)
        out.brand = brand.trimmingCharacters(in: .whitespaces).isEmpty ? nil : brand.trimmingCharacters(in: .whitespaces)
        var servings = draft.servings
        let first = servings.first ?? Serving(label: serving)
        let label = serving.trimmingCharacters(in: .whitespaces).isEmpty ? first.label : serving
        if servings.isEmpty { servings = [Serving(label: label)] } else { servings[0] = Serving(label: label, grams: first.grams, ml: first.ml) }
        out.servings = servings
        var nutrients = draft.nutrients.values
        for f in Self.fields {
            let text = (values[f.key] ?? "").replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
            if let v = Double(text), v >= 0 { nutrients[f.key] = v } else { nutrients[f.key] = nil }
        }
        out.nutrients = Nutrients(nutrients)
        return out
    }

    static func number(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }
}

/// The small "AI" mark on a value the AI estimated or read.
struct AIChip: View {
    @Environment(\.palette) private var palette
    var body: some View {
        Text("AI").font(.caption2.bold()).padding(.horizontal, 5).padding(.vertical, 1)
            .background(palette.color("brand-subtle"), in: Capsule())
            .foregroundStyle(palette.color("brand"))
            .accessibilityLabel("AI estimated")
    }
}
