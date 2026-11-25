import ByteSizeKit
import SwiftUI

/// Who's signed in, this phone's look, the account's settings, Apple Health, and sign out.
struct ProfileSheet: View {
    @Bindable var profile: ProfileModel
    let settings: AccountSettingsModel
    let health: HealthSync
    /// After a Health sync from here (the Dashboard's weight may have changed).
    var synced: () async -> Void = {}
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(palette.color("brand"))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.displayName).font(.headline)
                            Text("@\(profile.username)").font(.subheadline).foregroundStyle(palette.color("subtle"))
                            Text(profile.serverHost).font(.caption).foregroundStyle(palette.color("muted"))
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Picker("Theme", selection: $profile.themeOverride) {
                        Text("Match my account (\(Theme.name(profile.accountTheme)))").tag(ThemeID?.none)
                        ForEach(ThemeID.allCases) { id in
                            Label {
                                Text(Theme.name(id))
                            } icon: {
                                swatch(id)
                            }
                            .tag(ThemeID?.some(id))
                        }
                    }
                    .pickerStyle(.navigationLink)
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 } // SPEC-12: the divider spans the row
                    Picker("Appearance", selection: $profile.modeOverride) {
                        Text("Match my account (\(modeName(profile.accountMode)))").tag(ColorMode?.none)
                        ForEach(ColorMode.allCases) { mode in
                            Text(modeName(mode)).tag(ColorMode?.some(mode))
                        }
                    }
                    .pickerStyle(.navigationLink)
                } header: {
                    Text("Look")
                } footer: {
                    Text("Text size follows your iPhone's Text Size setting.")
                }

                Section {
                    Picker("Units", selection: Binding(
                        get: { settings.units == .metric ? "metric" : "imperial" },
                        set: { v in Task { await settings.setUnits(v == "metric" ? .metric : .imperial) } }
                    )) {
                        Text("Imperial (lb, fl oz)").tag("imperial")
                        Text("Metric (kg, ml)").tag("metric")
                    }
                    .pickerStyle(.navigationLink)
                    .accessibilityIdentifier("settingsUnits")
                    Picker("Week starts on", selection: Binding(
                        get: { settings.settings?.weekStart ?? 0 },
                        set: { d in Task { await settings.setWeekStart(d) } }
                    )) {
                        ForEach(0..<7, id: \.self) { i in Text(Self.weekdays[i]).tag(i) }
                    }
                    .pickerStyle(.navigationLink)
                    .disabled(settings.settings == nil)
                    .accessibilityIdentifier("settingsWeekStart")
                    Picker("Date format", selection: Binding(
                        get: { settings.dateFormat },
                        set: { f in Task { await settings.setDateFormat(f) } }
                    )) {
                        ForEach(DateFormat.allCases) { f in Text(f.long(today)).tag(f) }
                    }
                    .pickerStyle(.navigationLink)
                    .disabled(settings.settings == nil)
                    .accessibilityIdentifier("settingsDateFormat")
                    NavigationLink {
                        MealTimesView(settings: settings)
                    } label: {
                        LabeledContent("Meal times", value: mealTimesSummary)
                    }
                    .disabled(settings.settings == nil)
                    .accessibilityIdentifier("settingsMealTimes")
                } header: {
                    Text("Settings")
                } footer: {
                    if let message = settings.message {
                        Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("settingsError")
                    } else {
                        Text("Saved to your account, so the web app matches.")
                    }
                }

                Section {
                    ForEach(HealthKind.allCases, id: \.self) { kind in
                        Toggle(kind.title, isOn: Binding(
                            get: { health.isOn(kind) },
                            set: { on in Task { await health.setOn(kind, on); HealthBackground.shared.start(); await synced() } }
                        ))
                        .accessibilityIdentifier("health-\(kind.rawValue)")
                    }
                    if health.anyOn {
                        HStack {
                            Text(healthStatus).font(.footnote).foregroundStyle(palette.color("subtle"))
                                .accessibilityIdentifier("healthStatus")
                            Spacer()
                            if health.syncing { ProgressView() }
                        }
                        Button("Sync now") { Task { await health.syncNow(); await synced() } }
                            .disabled(health.syncing)
                            .accessibilityIdentifier("healthSyncNow")
                    }
                    if let message = health.message {
                        Text(message).font(.footnote).foregroundStyle(palette.color("error"))
                    }
                } header: {
                    Text("Apple Health")
                } footer: {
                    Text("ByteSize reads your weight, steps and workouts. A weigh-in you type or delete in ByteSize always wins.")
                }

                Section {
                    Text("Goals are set up in the ByteSize web app.")
                        .font(.footnote)
                        .foregroundStyle(palette.color("subtle"))
                }

                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                }
            }
            .scrollContentBackground(.hidden)
            .background(palette.color("page"))
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task(id: ObjectIdentifier(settings)) { await settings.load() }
            .confirmationDialog("Sign out of ByteSize on this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    Task { await profile.signOut() }
                }
            }
        }
    }

    private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    /// Today, to preview each date format.
    private var today: String { DateLook.localToday() }

    private var mealTimesSummary: String {
        let w = settings.settings?.mealWindows ?? .defaults
        return "\(w.breakfast) · \(w.lunch) · \(w.snacks) · \(w.dinner)"
    }

    private func swatch(_ id: ThemeID) -> some View {
        let p = Theme.palette(id, dark: false)
        return HStack(spacing: 2) {
            Circle().fill(p.color("brand")).frame(width: 10, height: 10)
            Circle().fill(p.color("primary")).frame(width: 10, height: 10)
        }
        .accessibilityHidden(true)
    }

    private func modeName(_ mode: ColorMode) -> String {
        switch mode {
        case .light: "Light"
        case .dark: "Dark"
        case .system: "Match iPhone"
        }
    }

    private var healthStatus: String {
        guard let last = health.lastSynced else { return health.syncing ? "Syncing…" : "Not synced yet" }
        let when = last.formatted(date: Calendar.current.isDateInToday(last) ? .omitted : .abbreviated, time: .shortened)
        return "Last synced \(when)" + (health.result.map { " · \($0)" } ?? "")
    }
}
