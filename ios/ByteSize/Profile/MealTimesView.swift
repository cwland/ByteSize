import ByteSizeKit
import SwiftUI

/// Profile › Settings › Meal times: when breakfast, lunch, snacks and dinner end. The four times are edited together
/// and saved with Save (one at a time would trip the server's order check halfway through a change).
struct MealTimesView: View {
    let settings: AccountSettingsModel
    @State private var draft: MealWindows
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    init(settings: AccountSettingsModel) {
        self.settings = settings
        _draft = State(initialValue: settings.settings?.mealWindows ?? .defaults)
    }

    private static let utc = TimeZone(identifier: "UTC")!

    var body: some View {
        Form {
            Section {
                row("Breakfast until", \.breakfast)
                row("Lunch until", \.lunch)
                row("Snacks until", \.snacks)
                row("Dinner until", \.dinner)
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text("After dinner counts as snacks. New food goes to the meal for the time of day.")
                    if let message = settings.message {
                        Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("mealTimesError")
                    }
                }
            }
            Section {
                Button("Reset to defaults") { draft = .defaults }
                    .disabled(draft == .defaults)
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.color("page"))
        .navigationTitle("Meal times")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        await settings.setMealWindows(draft)
                        if settings.message == nil { dismiss() }
                    }
                }
                .disabled(settings.settings == nil || settings.saving || draft == settings.settings?.mealWindows)
            }
        }
        .environment(\.timeZone, Self.utc) // the times are wall-clock "HH:mm", shown as they are
        .onAppear { settings.clearMessage() }
        .onDisappear { settings.clearMessage() } // a refused save isn't Profile's message
    }

    private func row(_ title: String, _ key: WritableKeyPath<MealWindows, String>) -> some View {
        DatePicker(title, selection: Binding(
            get: { Self.date(draft[keyPath: key]) },
            set: { draft[keyPath: key] = Self.hhmm($0) }
        ), displayedComponents: .hourAndMinute)
        .disabled(settings.settings == nil)
    }

    /// "14:30" ↔ a Date at that time on a fixed day in UTC.
    private static func date(_ hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        return cal.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0)) ?? Date(timeIntervalSince1970: 0)
    }

    private static func hhmm(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
