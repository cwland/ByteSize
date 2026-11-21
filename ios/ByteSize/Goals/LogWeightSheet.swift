import ByteSizeKit
import SwiftUI

/// Log a weigh-in from the Goals tab: today by default, or an earlier day (never a future one).
struct LogWeightSheet: View {
    let model: GoalsModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var date = Date()
    @State private var error: String?
    @State private var saving = false

    private var units: Units { model.units }
    private var value: Double? { Double(text.replacingOccurrences(of: ",", with: ".")) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Weight", text: $text)
                            .keyboardType(.decimalPad)
                            .accessibilityIdentifier("weightField")
                        Text(units.weightUnit).foregroundStyle(.secondary)
                    }
                    DatePicker("Day", selection: $date, in: ...DayText.date(model.today), displayedComponents: .date)
                        .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                        .accessibilityIdentifier("weightDay")
                } footer: {
                    Text("A second weigh-in that day replaces the first.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Log weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(value == nil || saving)
                        .accessibilityIdentifier("saveWeight")
                }
            }
            .onAppear {
                date = DayText.date(model.today)
                if let kg = model.weight?.latest?.weightKg { text = String(format: "%.1f", units.weightValue(kg: kg)) }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard let value else { return }
        saving = true
        defer { saving = false }
        do {
            try await model.logWeight(display: value, day: DayText.day(date))
            dismiss()
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}
