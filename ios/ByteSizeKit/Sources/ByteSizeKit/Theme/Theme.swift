import Foundation

/// The six web-app color themes (ids match the server's `users.theme`).
public enum ThemeID: String, CaseIterable, Identifiable, Sendable {
    case avocado, fresh, harbor
    case terracottaSage = "terracotta-sage"
    case slateRose = "slate-rose"
    case midnightCoral = "midnight-coral"

    public var id: String { rawValue }
}

/// Light, dark or follow the device (the server's `users.colorMode`).
public enum ColorMode: String, CaseIterable, Identifiable, Sendable {
    case light, dark, system
    public var id: String { rawValue }
}

/// One theme's colors in one mode, as hex strings keyed by the web's token names (`page`, `ink`, `primary`…).
public struct Palette: Sendable, Equatable {
    let colors: [String: String]

    public subscript(_ token: String) -> String { colors[token] ?? colors["ink"] ?? "#000000" }
    public func has(_ token: String) -> Bool { !(colors[token] ?? "").isEmpty }
}

public enum Theme {
    public static let defaultTheme = ThemeID(rawValue: ThemeTokens.defaultTheme) ?? .avocado
    public static let defaultMode = ColorMode(rawValue: ThemeTokens.defaultMode) ?? .dark

    public static func palette(_ id: ThemeID, dark: Bool) -> Palette {
        let set = ThemeTokens.all[id.rawValue] ?? ThemeTokens.all[defaultTheme.rawValue]!
        return Palette(colors: dark ? set.dark : set.light)
    }

    public static func name(_ id: ThemeID) -> String { ThemeTokens.all[id.rawValue]?.name ?? id.rawValue }
}

/// "#rgb", "#rrggbb" or "#rrggbbaa" → components from 0 to 1; anything else → nil.
public func rgba(hex: String) -> (r: Double, g: Double, b: Double, a: Double)? {
    var s = hex.trimmingCharacters(in: .whitespaces)
    guard s.hasPrefix("#") else { return nil }
    s.removeFirst()
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
    let bytes = s.count == 8 ? value : (value << 8) | 0xff
    func part(_ shift: UInt64) -> Double { Double((bytes >> shift) & 0xff) / 255 }
    return (part(24), part(16), part(8), part(0))
}
