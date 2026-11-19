import ByteSizeKit
import SwiftUI

/// The signed-in app: the selected tab's screen, the bottom bar with the raised (+), and the radial menu over both.
struct MainTabView: View {
    @Bindable var shell: ShellModel
    let profile: ProfileModel
    let today: TodayModels
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack(alignment: .bottom) {
            NavigationStack {
                tabContent
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
            .safeAreaPadding(.bottom, TabBar.height)

            RadialMenu(shell: shell)
            TabBar(shell: shell)
        }
        .background(palette.color("page").ignoresSafeArea())
        .sheet(item: $shell.activeAction) { action in
            NavigationStack {
                PlaceholderScreen(title: action.title, systemImage: action.systemImage)
                    .navigationTitle(action.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Close") { shell.activeAction = nil } }
                    }
            }
            .presentationDetents([.large])
        }
        .sheet(isPresented: $shell.profileOpen) {
            ProfileSheet(profile: profile)
        }
        .task { await today.load() }
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
