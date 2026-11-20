import ByteSizeKit
import SwiftUI

/// The signed-in app: the selected tab's screen, the bottom bar with the raised (+), and the radial menu over both.
struct MainTabView: View {
    @Bindable var shell: ShellModel
    let profile: ProfileModel
    let today: TodayModels
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .bottom) {
            NavigationStack {
                tabContent
                    // Room for the tab bar as a real inset (inside the stack, so each screen's lists and toasts see it)
                    .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: TabBar.height) }
                    .navigationTitle(shell.tab.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { shell.profileOpen = true } label: {
                                Image(systemName: "person.crop.circle").font(.title3)
                            }
                            .accessibilityLabel("Profile")
                        }
                    }
            }

            RadialMenu(shell: shell)
            TabBar(shell: shell)
        }
        .background(palette.color("page").ignoresSafeArea())
        .sheet(item: $shell.activeAction) { action in
            QuickActionSheet(action: action, today: today) { shell.activeAction = nil }
                .presentationDetents([.large])
        }
        .sheet(isPresented: $shell.profileOpen) {
            ProfileSheet(profile: profile)
        }
        .task { await today.load() }
        // Back in the app (maybe the next morning): follow today if that's what was showing
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await today.days.dayMayHaveChanged() } }
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch shell.tab {
        case .dashboard: DashboardView(dashboard: today.dashboard, days: today.days, units: today.units)
        case .foodLog: FoodLogView(log: today.log, days: today.days, units: today.units)
        case .goals, .myFoods: PlaceholderScreen(title: shell.tab.title, systemImage: shell.tab.systemImage)
        }
    }
}

/// One (+) action, with its own models for as long as the sheet is up.
private struct QuickActionSheet: View {
    let action: QuickAction
    let close: () -> Void
    @State private var track: TrackFoodModel
    @State private var scan: ScanModel
    @State private var estimate: EstimateModel

    init(action: QuickAction, today: TodayModels, close: @escaping () -> Void) {
        self.action = action
        self.close = close
        _track = State(initialValue: TrackFoodModel(api: today.api, dayStore: today.days))
        _scan = State(initialValue: ScanModel(api: today.api))
        _estimate = State(initialValue: EstimateModel(api: today.api, dayStore: today.days))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(action.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close", action: close) }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch action {
        case .track: TrackFoodSheet(model: track, close: close)
        case .scan: ScanSheet(model: scan, track: track, close: close)
        case .photo: PhotoSheet(model: estimate, track: track, close: close)
        case .describe: DescribeSheet(model: estimate, close: close)
        }
    }
}
