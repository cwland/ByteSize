import ByteSizeKit
import SwiftUI

extension DashboardWidget {
    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .overview: "Today's overview"
        case .water: "Water"
        case .weight: "Weight"
        case .streak: "Streak"
        case .badges: "Badges"
        case .shots: "Shot tracking"
        }
    }

    var systemImage: String {
        switch self {
        case .calendar: "calendar"
        case .overview: "chart.bar"
        case .water: "drop"
        case .weight: "scalemass"
        case .streak: "flame"
        case .badges: "rosette"
        case .shots: "syringe"
        }
    }
}

/// The Dashboard: the person's widgets in their order. Edit (or long-press a card) to reorder, remove or add.
struct DashboardView: View {
    @Bindable var dashboard: DashboardModel
    let days: DayStore
    let units: Units
    @Environment(\.palette) private var palette
    @State private var drawerOpen = false

    var body: some View {
        Group {
            if dashboard.editing {
                editList
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        if let error = days.error {
                            MessageBanner(text: error) {}
                        }
                        ForEach(dashboard.widgets) { widget in
                            card(widget)
                                .contextMenu {
                                    Button("Edit Dashboard", systemImage: "square.and.pencil") { dashboard.startEditing() }
                                }
                        }
                    }
                    .padding()
                }
                .refreshable {
                    await days.reload()
                    await dashboard.load()
                }
            }
        }
        .background(palette.color("page").ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if dashboard.editing {
                    Button("Cancel") { dashboard.cancelEditing() }
                } else {
                    Button("Edit") { dashboard.startEditing() }
                }
            }
            if dashboard.editing {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { Task { await dashboard.finishEditing() } }
                }
            }
        }
        .sheet(isPresented: $drawerOpen) {
            WidgetDrawer(dashboard: dashboard)
        }
        .overlay(alignment: .bottom) {
            if let message = dashboard.message {
                MessageBanner(text: message) { dashboard.clearMessage() }
                    .padding(.bottom, 8)
            }
        }
    }

    @ViewBuilder
    private func card(_ widget: DashboardWidget) -> some View {
        switch widget {
        case .calendar: CalendarStrip(days: days)
        case .overview: OverviewCard(days: days, units: units)
        case .water: WaterCard(dashboard: dashboard, days: days, units: units)
        case .weight: WeightCard(dashboard: dashboard, units: units)
        case .streak: StreakCard(days: days)
        case .badges: BadgesCard(dashboard: dashboard, units: units)
        case .shots: ShotCard(dashboard: dashboard)
        }
    }

    private var editList: some View {
        List {
            Section {
                ForEach(dashboard.widgets) { widget in
                    Label(widget.title, systemImage: widget.systemImage)
                }
                .onMove { dashboard.move(from: $0, to: $1) }
                .onDelete { offsets in
                    for i in offsets.map({ dashboard.widgets[$0] }) { dashboard.remove(i) }
                }
            } footer: {
                Text("Drag to reorder. Swipe to remove.")
            }
            if !dashboard.hidden.isEmpty {
                Section {
                    Button("Add widget", systemImage: "plus.circle") { drawerOpen = true }
                }
            }
        }
        .environment(\.editMode, .constant(.active))
        .scrollContentBackground(.hidden)
    }
}

/// Widgets not on the Dashboard, to add back.
struct WidgetDrawer: View {
    let dashboard: DashboardModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(dashboard.hidden) { widget in
                Button {
                    dashboard.add(widget)
                    if dashboard.hidden.isEmpty { dismiss() }
                } label: {
                    Label(widget.title, systemImage: widget.systemImage)
                }
            }
            .navigationTitle("Add widget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
