import ByteSizeKit
import SwiftUI

extension Color {
    /// A web-theme hex color ("#5aa83c"); unreadable values show as magenta so they're easy to spot.
    init(hex: String) {
        let c = rgba(hex: hex) ?? (1, 0, 1, 1)
        self.init(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: c.a)
    }
}

extension Palette {
    /// A theme token as a SwiftUI color: `palette.color("primary")`.
    func color(_ token: String) -> Color { Color(hex: self[token]) }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Theme.palette(Theme.defaultTheme, dark: true)
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

/// Applies a ByteSize theme: picks the light or dark palette (following the device for `.system`)
/// and sets the matching color scheme.
private struct ByteSizeTheme: ViewModifier {
    let id: ThemeID
    let mode: ColorMode
    @Environment(\.colorScheme) private var deviceScheme

    func body(content: Content) -> some View {
        let dark = mode == .dark || (mode == .system && deviceScheme == .dark)
        let palette = Theme.palette(id, dark: dark)
        content
            .environment(\.palette, palette)
            .tint(palette.color("primary"))
            .preferredColorScheme(mode == .system ? nil : (dark ? .dark : .light))
    }
}

extension View {
    func byteSizeTheme(id: ThemeID, mode: ColorMode) -> some View {
        modifier(ByteSizeTheme(id: id, mode: mode))
    }
}
