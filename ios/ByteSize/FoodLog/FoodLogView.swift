import ByteSizeKit
import SwiftUI

/// The day's entries by meal. Tap to edit the amount; swipe right to Copy, left to Move or Delete (with Undo).
struct FoodLogView: View {
    let log: FoodLogModel
    let days: DayStore
    let units: Units
    /// A meal's Add (SPEC-07): opens Track Food in that meal.
    var add: (Meal) -> Void = { _ in }
    @Environment(\.palette) private var palette
    @State private var editing: LogEntry?
    @State private var moving: MoveRequest?

    struct MoveRequest: Identifiable {
        let entry: LogEntry
        let copy: Bool
        var id: String { "\(entry.id)-\(copy)" }
    }

    var body: some View {
        List {
            // The Dashboard's strip card, in the same place (16 pt in, 16 pt down) and scrolling away the same way,
            // so switching tabs doesn't move it
            Section { Card { DayStrip(days: days) } }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            if let day = days.day {
                Section { summaryBar(logSummary(day)) }
                    .listRowBackground(Color.clear)
            }
            ForEach(log.sections) { section in
                Section {
                    ForEach(section.entries) { entry in
                        EntryRow(entry: entry, units: units)
                            .contentShape(Rectangle())
                            .onTapGesture { editing = entry }
                            .contextMenu {
                                RestaurantMenu(brand: entry.brand, restaurant: entry.isRestaurant) { _, on in
                                    Task { await log.markRestaurant(entry, on) }
                                }
                            }
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
                    if section.meal.addable {
                        Button { add(section.meal) } label: {
                            Label("Add to \(section.meal.title)", systemImage: "plus.circle.fill")
                                .foregroundStyle(palette.color("primary"))
                        }
                        .accessibilityIdentifier("addTo-\(section.meal.rawValue)")
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
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .contentMargins(.top, 16, for: .scrollContent)
        .listSectionSpacing(12)
        // SPEC-04: changing day animates rather than flashing (the previous day stays until the new one is in)
        .animation(.easeInOut(duration: 0.2), value: days.dayIsFor)
        .background(palette.color("page").ignoresSafeArea())
        .refreshable { await days.reload() }
        .sheet(item: $editing) { entry in EditEntrySheet(entry: entry, units: units, log: log) }
        .sheet(item: $moving) { req in MoveCopySheet(entry: req.entry, copy: req.copy, log: log, today: days.today) }
        // In the safe area's inset (not an overlay), so the toast sits above the tab bar instead of under it
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                // A day that didn't load says why (it isn't an empty day), with Retry
                if let error = days.error {
                    HStack {
                        Text(error).font(.subheadline)
                        Spacer()
                        Button("Retry") { Task { await days.reload() } }
                            .font(.subheadline.weight(.semibold))
                            .accessibilityIdentifier("retryDay")
                    }
                    .foregroundStyle(palette.color("ink"))
                    .padding(12)
                    .background(palette.color("error-subtle"), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal)
                }
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

    /// SPEC-06: what's eaten, what's left, protein and fiber against their minimums.
    private func summaryBar(_ s: LogSummary) -> some View {
        VStack(spacing: 4) {
            HStack {
                Text(s.eaten).font(.subheadline.weight(.semibold)).foregroundStyle(palette.color("ink"))
                Spacer()
                if let left = s.left {
                    Text(left).font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.color(left.hasPrefix("over") ? "error" : "success"))
                }
            }
            if let protein = s.protein, let fiber = s.fiber {
                HStack {
                    Text(protein)
                    Spacer()
                    Text(fiber)
                }
                .font(.caption)
                .foregroundStyle(palette.color("subtle"))
            }
        }
        .monospacedDigit()
        .contentTransition(.numericText())
        .padding(12)
        .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("logSummary")
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
                BrandLine(brand: entry.brand, restaurant: entry.isRestaurant, detail: entry.amountText(units: units))
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

