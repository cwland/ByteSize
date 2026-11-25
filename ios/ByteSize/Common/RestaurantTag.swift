import SwiftUI

/// A restaurant's name as a teal tag with a fork (2026-11-25 §3, Option B): the same look as the web app's.
/// Teal, not the theme's orange (that's for things to tap), readable in light and dark.
struct RestaurantTag: View {
    let brand: String
    @Environment(\.colorScheme) private var scheme

    static func color(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#3cc8b4") : Color(hex: "#07645b")
    }

    var body: some View {
        let teal = Self.color(scheme)
        HStack(spacing: 3) {
            Image(systemName: "fork.knife").font(.system(size: 9, weight: .bold)).accessibilityHidden(true)
            Text(brand).lineLimit(1)
        }
        .font(.caption2.bold())
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .foregroundStyle(teal)
        .background(teal.opacity(0.15), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Restaurant: \(brand)")
    }
}

/// The line under a food's name: "Daisy · 2 × 1 tbsp", or a restaurant's tag then "· 2 × 1 serving".
struct BrandLine: View {
    let brand: String?
    let restaurant: Bool
    let detail: String
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 4) {
            if let brand, restaurant {
                RestaurantTag(brand: brand)
                if !detail.isEmpty { Text("· \(detail)").lineLimit(1) }
            } else {
                Text([brand, detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")).lineLimit(1)
            }
        }
        .font(.caption)
        .foregroundStyle(palette.color("subtle"))
    }
}

/// Long-press › "Treat <brand> as a restaurant" or "<brand> is not a restaurant" (nothing without a brand).
struct RestaurantMenu: View {
    let brand: String?
    let restaurant: Bool
    let mark: (String, Bool) -> Void

    var body: some View {
        if let brand {
            if restaurant {
                Button { mark(brand, false) } label: { Label("\(brand) is not a restaurant", systemImage: "fork.knife.circle") }
            } else {
                Button { mark(brand, true) } label: { Label("Treat \(brand) as a restaurant", systemImage: "fork.knife") }
            }
        }
    }
}
