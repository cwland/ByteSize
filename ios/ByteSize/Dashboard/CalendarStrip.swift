import ByteSizeKit
import SwiftUI

/// The week around the selected day: tap a day to switch, arrows for other weeks. Logged days have a dot.
struct CalendarStrip: View {
    let days: DayStore
    @Environment(\.palette) private var palette

    var body: some View {
        Card {
            HStack {
                Button { Task { await days.shiftWeek(-1) } } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Previous week")
                Spacer()
                Text(DayText.long(days.selected))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.color("ink"))
                Spacer()
                Button { Task { await days.shiftWeek(1) } } label: { Image(systemName: "chevron.right") }
                    .accessibilityLabel("Next week")
            }
            .foregroundStyle(palette.color("primary"))
            HStack(spacing: 4) {
                ForEach(days.week(containing: days.selected), id: \.self) { day in
                    dayButton(day)
                }
            }
            if !days.isToday {
                Button("Back to today") { Task { await days.select(days.today) } }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(palette.color("link"))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func dayButton(_ day: String) -> some View {
        let selected = day == days.selected
        let today = day == days.today
        return Button { Task { await days.select(day) } } label: {
            VStack(spacing: 4) {
                Text(DayText.weekdayLetter(day)).font(.caption2)
                    .foregroundStyle(palette.color(selected ? "on-primary" : "muted"))
                Text(DayText.dayNumber(day)).font(.callout.weight(selected || today ? .bold : .regular))
                    .foregroundStyle(palette.color(selected ? "on-primary" : "ink"))
                Circle().fill(palette.color(selected ? "on-primary" : "brand"))
                    .frame(width: 5, height: 5)
                    .opacity(days.loggedDays.contains(day) ? 1 : 0)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(selected ? palette.color("primary") : .clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(today && !selected ? palette.color("primary") : .clear))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DayText.long(day) + (days.loggedDays.contains(day) ? ", logged" : ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
