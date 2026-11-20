import SwiftUI

/// Stands in for screens built in later rounds.
struct PlaceholderScreen: View {
    let title: String
    let systemImage: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 44))
                .foregroundStyle(palette.color("muted"))
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(palette.color("ink"))
            Text("Coming in the next update")
                .font(.subheadline)
                .foregroundStyle(palette.color("subtle"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.color("page").ignoresSafeArea())
    }
}
