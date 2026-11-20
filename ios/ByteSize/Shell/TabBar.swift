import ByteSizeKit
import SwiftUI

/// Five slots, icons only: Dashboard · Food Log · (+) · Goals · My Foods. The (+) is an oversized circle
/// that sits above the bar and turns into an × while the menu is open.
struct TabBar: View {
    static let height: CGFloat = 64

    let shell: ShellModel
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.dashboard)
            tabButton(.foodLog)
            plusButton
            tabButton(.goals)
            tabButton(.myFoods)
        }
        .frame(height: Self.height)
        .background(alignment: .top) {
            palette.color("container")
                .overlay(alignment: .top) { palette.color("line").frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func tabButton(_ tab: AppTab) -> some View {
        let selected = shell.tab == tab
        return Button { shell.select(tab) } label: {
            Image(systemName: tab.systemImage)
                .font(.system(size: 22, weight: selected ? .semibold : .regular))
                .foregroundStyle(palette.color(selected ? "primary" : "muted"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var plusButton: some View {
        Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { shell.toggleMenu() }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(palette.color("on-primary"))
                .rotationEffect(.degrees(shell.menuOpen ? 45 : 0))
                .frame(width: 64, height: 64)
                .background(palette.color("primary"), in: Circle())
                .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
        }
        .offset(y: -18)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(shell.menuOpen ? "Close" : "Quick add")
        .sensoryFeedback(.impact(weight: .light), trigger: shell.menuOpen)
    }
}
