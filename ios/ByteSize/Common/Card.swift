import ByteSizeKit
import SwiftUI

/// The rounded card every widget sits in (container background, line border), as on the web.
struct Card<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.color("subtle"))
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.color("line")))
    }
}

/// A short message at the bottom of the screen (errors from the server, etc.).
struct MessageBanner: View {
    let text: String
    var onClose: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack {
            Text(text).font(.subheadline)
            Spacer()
            Button(action: onClose) { Image(systemName: "xmark") }
                .accessibilityLabel("Dismiss")
        }
        .foregroundStyle(palette.color("ink"))
        .padding(12)
        .background(palette.color("error-subtle"), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
}

enum DayText {
    /// "Thursday, Nov 19"
    static func long(_ day: String) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("EEEEMMMd")
        return f.string(from: DayMath.noon(day))
    }

    /// "Nov 19"
    static func short(_ day: String) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f.string(from: DayMath.noon(day))
    }

    /// "T" for Thursday
    static func weekdayLetter(_ day: String) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEEE"
        return f.string(from: DayMath.noon(day))
    }

    static func dayNumber(_ day: String) -> String { String(Int(day.suffix(2)) ?? 0) }

    /// A day string ↔ a Date for DatePicker (noon UTC, shown in UTC).
    static func date(_ day: String) -> Date { DayMath.noon(day) }
    static func day(_ date: Date) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        let p = c.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }
}

/// Shot site ids from the server, in words.
enum ShotSite {
    static let all = ["abdomen_left", "abdomen_right", "thigh_left", "thigh_right", "arm_left", "arm_right"]

    static func name(_ id: String) -> String {
        let parts = id.split(separator: "_")
        guard parts.count == 2 else { return id }
        let place = ["abdomen": "Abdomen", "thigh": "Thigh", "arm": "Upper arm"][String(parts[0])] ?? String(parts[0])
        return "\(place) · \(parts[1])"
    }
}
