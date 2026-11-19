import ByteSizeKit
import SwiftUI

/// The (+) menu: the screen blurs and dims, and the quick actions spring out in an arc above the (+).
/// Tapping the backdrop (or the ×) closes it.
struct RadialMenu: View {
    let shell: ShellModel
    @Environment(\.palette) private var palette

    private let radius: Double = 120
    private let buttonSize: CGFloat = 60

    var body: some View {
        ZStack(alignment: .bottom) {
            if shell.menuOpen {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .overlay(Color.black.opacity(0.35))
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { shell.closeMenu() } }
                    .accessibilityLabel("Close quick add")
                    .accessibilityAddTraits(.isButton)
                    .transition(.opacity)
            }
            let offsets = radialOffsets(count: QuickAction.allCases.count, radius: radius, spreadDegrees: 130)
            ForEach(Array(QuickAction.allCases.enumerated()), id: \.element) { index, action in
                actionButton(action)
                    .accessibilityHidden(!shell.menuOpen)
                    .offset(x: shell.menuOpen ? offsets[index].x : 0, y: shell.menuOpen ? offsets[index].y : 0)
                    .scaleEffect(shell.menuOpen ? 1 : 0.3)
                    .opacity(shell.menuOpen ? 1 : 0)
                    .animation(.spring(response: 0.35, dampingFraction: 0.7).delay(shell.menuOpen ? Double(index) * 0.03 : 0), value: shell.menuOpen)
                    // center of the raised (+): half its size above the bar's middle
                    .padding(.bottom, TabBar.height / 2 + 18 - buttonSize / 2 + 8)
            }
        }
        .allowsHitTesting(shell.menuOpen)
    }

    private func actionButton(_ action: QuickAction) -> some View {
        Button {
            shell.choose(action)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(palette.color("primary"))
                    .frame(width: buttonSize, height: buttonSize)
                    .background(palette.color("container"), in: Circle())
                    .overlay(Circle().stroke(palette.color("line")))
                    .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
                Text(action.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .fixedSize()
            }
        }
        .accessibilityLabel(action.title)
    }
}
