import ByteSizeKit
import SwiftUI

/// The day strip (SPEC-03), shared by the Dashboard and the Food Log: the chosen day as a header (tap: a month
/// calendar), and a row of days that scrolls and snaps one day at a time, the chosen one centred. A year back to a
/// week ahead; days after today are shown, not chosen. Logged days have a dot.
struct DayStrip: View {
    let days: DayStore
    @Environment(\.palette) private var palette
    @State private var position: String?
    @State private var pickingDay = false

    var body: some View {
        VStack(spacing: 8) {
            Button { pickingDay = true } label: {
                HStack(spacing: 4) {
                    Text(days.isToday ? "Today" : DayText.long(days.selected)).font(.headline)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
                .foregroundStyle(palette.color("ink"))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(days.isToday ? "Today" : DayText.long(days.selected))
            .accessibilityHint("Opens a month calendar")
            .accessibilityIdentifier("dayHeader")

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 4) {
                    ForEach(days.stripDays, id: \.self) { chip($0) }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $position, anchor: .center)
            .frame(height: 60)
            .onAppear { position = days.selected }
            .onChange(of: days.selected) { _, day in withAnimation(.easeInOut(duration: 0.2)) { position = day } }
            .onChange(of: position) { _, day in
                if let day { Task { await days.loadLogged(around: day) } }
            }
        }
        .sheet(isPresented: $pickingDay) { DayPickerSheet(days: days) }
    }

    private func chip(_ day: String) -> some View {
        let selected = day == days.selected
        let today = day == days.today
        let choosable = days.canSelect(day)
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
            .frame(width: 44, height: 56)
            .background(selected ? palette.color("primary") : .clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(today && !selected ? palette.color("primary") : .clear))
            .opacity(choosable ? 1 : 0.35)
        }
        .buttonStyle(.plain)
        .disabled(!choosable)
        .accessibilityLabel(DayText.long(day) + (days.loggedDays.contains(day) ? ", logged" : ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("day-\(day)")
    }
}

/// The month calendar behind the strip's header: any day from a year back to today.
struct DayPickerSheet: View {
    let days: DayStore
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    private var range: ClosedRange<Date> {
        DayText.date(DayMath.add(-365, to: days.today))...DayText.date(days.today)
    }

    var body: some View {
        NavigationStack {
            VStack {
                DatePicker("Day", selection: $date, in: range, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    .accessibilityIdentifier("dayCalendar")
                Button("Today") { pick(days.today) }
                    .accessibilityIdentifier("todayInCalendar")
            }
            .padding()
            .navigationTitle("Choose a day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { date = DayText.date(days.selected) }
            // Picking a date selects it (and the strip scrolls there)
            .onChange(of: date) { _, new in
                let day = DayText.day(new)
                if day != days.selected { pick(day) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func pick(_ day: String) {
        Task { await days.select(day) }
        dismiss()
    }
}
