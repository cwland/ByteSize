import ByteSizeKit
import SwiftUI

/// The day's entries by meal. Tap to edit the amount; swipe right to Copy, left to Move or Delete (with Undo).
struct FoodLogView: View {
    let log: FoodLogModel
    let days: DayStore
    let units: Units
    @Environment(\.palette) private var palette
    @State private var editing: LogEntry?
    @State private var moving: MoveRequest?
    @State private var pickingDay = false

    struct MoveRequest: Identifiable {
        let entry: LogEntry
        let copy: Bool
        var id: String { "\(entry.id)-\(copy)" }
    }

    var body: some View {
        List {
            Section { header }
                .listRowBackground(Color.clear)
            if log.sections.isEmpty, days.day != nil {
                Section {
                    Text("Nothing logged yet — tap + to track food")
                        .foregroundStyle(palette.color("subtle"))
                }
            }
            ForEach(log.sections) { section in
                Section {
                    ForEach(section.entries) { entry in
                        EntryRow(entry: entry, units: units)
                            .contentShape(Rectangle())
                            .onTapGesture { editing = entry }
                            .swipeActions(edge: .leading) {
                                Button { moving = MoveRequest(entry: entry, copy: true) } label: { Label("Copy", systemImage: "doc.on.doc") }
                                    .tint(palette.color("link"))
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { Task { await log.delete(entry) } } label: { Label("Delete", systemImage: "trash") }
                                Button { moving = MoveRequest(entry: entry, copy: false) } label: { Label("Move", systemImage: "arrow.right.circle") }
                                    .tint(palette.color("primary"))
                            }
                    }
                } header: {
                    HStack {
                        Text(section.meal.title)
                        Spacer()
                        if let totals = section.totals, section.meal != .supplements {
                            Text("\(Int(totals.calories.rounded())) cal")
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.color("page").ignoresSafeArea())
        .refreshable { await days.reload() }
        .sheet(item: $editing) { entry in EditEntrySheet(entry: entry, units: units, log: log) }
        .sheet(item: $moving) { req in MoveCopySheet(entry: req.entry, copy: req.copy, log: log, today: days.today) }
        .sheet(isPresented: $pickingDay) { DayPickerSheet(days: days) }
        .overlay(alignment: .bottom) {
            VStack(spacing: 8) {
                if let message = log.message {
                    MessageBanner(text: message) { log.clearMessage() }
                }
                if let undo = log.undo {
                    UndoToast(offer: undo, log: log)
                }
            }
            .padding(.bottom, 8)
        }
    }

    private var header: some View {
        HStack {
            Button { Task { await days.select(DayMath.add(-1, to: days.selected)) } } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous day")
            Spacer()
            Button { pickingDay = true } label: {
                VStack(spacing: 2) {
                    Text(days.isToday ? "Today" : DayText.long(days.selected)).font(.headline).foregroundStyle(palette.color("ink"))
                    if let day = days.day {
                        let cal = day.totals["calories"]
                        Text(day.targets.map { "\(Int(cal.rounded())) cal · " + budget(calories: cal, range: $0.calories).text } ?? "\(Int(cal.rounded())) cal")
                            .font(.caption).foregroundStyle(palette.color("subtle"))
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Choose a day")
            Spacer()
            Button { Task { await days.select(DayMath.add(1, to: days.selected)) } } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next day")
        }
        .font(.title3)
        .foregroundStyle(palette.color("primary"))
        .buttonStyle(.borderless)
    }
}

struct EntryRow: View {
    let entry: LogEntry
    let units: Units
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            Text(entry.icon).font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(entry.name).font(.body).foregroundStyle(palette.color("ink")).lineLimit(1)
                    if entry.aiEstimated {
                        Text("AI").font(.caption2.bold()).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(palette.color("brand-subtle"), in: Capsule())
                            .foregroundStyle(palette.color("brand"))
                            .accessibilityLabel("AI estimated")
                    }
                }
                Text([entry.brand, entry.amountText(units: units)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(palette.color("subtle")).lineLimit(1)
            }
            Spacer()
            if !entry.isWater {
                Text("\(Int(entry.calories.rounded()))").font(.subheadline.weight(.semibold)).foregroundStyle(palette.color("ink"))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Deleted Greek yogurt · Undo" for 5 seconds.
struct UndoToast: View {
    let offer: UndoOffer
    let log: FoodLogModel
    @Environment(\.palette) private var palette

    var body: some View {
        HStack {
            Text("Deleted \(offer.name)").lineLimit(1)
            Spacer()
            Button("Undo") { Task { await log.undoDelete() } }
                .fontWeight(.semibold)
                .foregroundStyle(palette.color("primary"))
        }
        .padding(14)
        .foregroundStyle(palette.color("ink"))
        .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.color("line")))
        .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
        .padding(.horizontal)
        .task(id: offer.entryId) {
            try? await Task.sleep(for: .seconds(5))
            if log.undo == offer { log.dismissUndo() }
        }
    }
}

struct DayPickerSheet: View {
    let days: DayStore
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            DatePicker("Day", selection: $date, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                .padding()
                .navigationTitle("Choose a day")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Go") {
                            Task { await days.select(DayText.day(date)) }
                            dismiss()
                        }
                    }
                }
                .onAppear { date = DayText.date(days.selected) }
        }
        .presentationDetents([.medium, .large])
    }
}
