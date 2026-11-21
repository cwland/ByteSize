import ByteSizeKit
import SwiftUI

/// Track Food: type to search (or a barcode's digits). With the field empty (L2, SPEC-10): Same as yesterday,
/// Favorites and Recently tracked for the meal, each with a + that logs it at once; tapping a row opens the wheels.
struct TrackFoodSheet: View {
    @Bindable var model: TrackFoodModel
    /// The source chips and the Sources row (open or closed), remembered for this sign-in.
    @Bindable var sources: SourceFilter
    /// The hub (SPEC-08): Photo, Scan and Describe open inside Track Food, in its meal.
    let scan: ScanModel
    @Bindable var estimate: EstimateModel
    let units: Units
    let close: () -> Void
    @State private var picked: Food?
    @State private var hub: QuickAction?
    /// Our own field, not .searchable: the bar then holds only the title and Close, built from the first frame.
    @FocusState private var searchFocused: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            searchField
            hubButtons
            sourcesRow
            if let logged = model.lastLogged {
                Label("Logged \(logged)", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(palette.color("success"))
                    .accessibilityIdentifier("loggedToast")
            }
            if model.query.trimmingCharacters(in: .whitespaces).count < 2 {
                if let message = model.message {
                    Text(message).foregroundStyle(palette.color("error")).accessibilityIdentifier("trackMessage")
                }
                yesterdaySection
                foodSection("Favorites", model.favorites, quick: true)
                foodSection("Recently tracked", model.recent, quick: true)
                if model.yesterday.isEmpty, model.favorites.isEmpty, model.recent.isEmpty {
                    Text("Foods you log show up here.").foregroundStyle(palette.color("subtle"))
                }
            } else {
                if model.searching { HStack { Spacer(); ProgressView(); Spacer() } }
                if let message = model.message {
                    Text(message).foregroundStyle(palette.color("subtle")).accessibilityIdentifier("trackMessage")
                }
                if let found = model.found {
                    let view = sources.view(of: found)
                    ForEach(view.errors, id: \.source) { error in
                        Label(error.message, systemImage: "exclamationmark.triangle").foregroundStyle(palette.color("subtle"))
                    }
                    if let hint = view.hint { hintRow(hint) }
                    ForEach(view.groups) { group in foodSection(group.label, group.foods) }
                }
            }
        }
        .listSectionSpacing(8)
        .onAppear { searchFocused = true }
        .task { await model.load() }
        .task(id: model.query) {
            // A short pause so each keystroke doesn't send a search
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.search()
        }
        .onChange(of: model.meal) { Task { await model.load() } }
        .onChange(of: picked) { _, now in
            if now != nil { model.clearMessage() } // an old error isn't about the food being opened
            if now == nil, model.lastLogged != nil { searchFocused = true } // back from logging: ready to type the next
        }
        .navigationDestination(item: $hub) { action in hubScreen(action) }
        // One meal for the whole hub: Photo and Describe use Track Food's, and a change there comes back
        .onChange(of: hub) { _, now in if now == .photo || now == .describe { estimate.meal = model.meal } }
        .onChange(of: estimate.meal) { _, meal in if hub != nil { model.meal = meal } }
        // Pushed, not a sheet: iOS won't open a sheet over an active search
        .navigationDestination(item: $picked) { food in
            // SPEC-16: after logging, back to an empty search for the next food (Close leaves)
            FoodPortionView(food: food, meal: model.meal, pushed: true, message: model.message, favorites: model) { food, portion in
                await model.log(food, portion: portion)
            }
        }
    }

    private var searchField: some View {
        Section {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(palette.color("subtle"))
                TextField("Search foods or type a barcode", text: $model.query)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .accessibilityIdentifier("trackSearch")
                if !model.query.isEmpty {
                    Button { model.query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .foregroundStyle(palette.color("subtle"))
                        .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 12))
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .listRowBackground(Color.clear)
        }
    }

    private var hubButtons: some View {
        Section {
            HStack(spacing: 8) {
                ForEach([QuickAction.photo, .scan, .describe]) { action in
                    Button { hub = action } label: {
                        VStack(spacing: 4) {
                            Image(systemName: action.systemImage).font(.title3)
                            Text(action == .photo ? "Photo" : action == .scan ? "Scan" : "Describe").font(.caption.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(palette.color("primary"))
                        .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(action.title)
                    .accessibilityIdentifier("hub-\(action.rawValue)")
                }
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
            .listRowBackground(Color.clear)
        }
    }

    /// "› Show results from · 4 of 6" with the meal on the right; open, the source chips.
    private var sourcesRow: some View {
        Section {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.snappy) { sources.open.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .rotationEffect(.degrees(sources.open ? 90 : 0))
                        Text(sources.summary(for: model.found).uppercased())
                            .font(.footnote.weight(.semibold))
                            .lineLimit(1)
                    }
                    .foregroundStyle(palette.color("subtle"))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sourcesToggle")
                .accessibilityValue(sources.open ? "open" : "closed")
                Picker("Meal", selection: $model.meal) {
                    ForEach(Meal.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(palette.color("ink"))
                .accessibilityLabel("Meal")
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 0))
            .listRowBackground(Color.clear)
            if sources.open, let found = model.found {
                let chips = sources.view(of: found).chips
                if !chips.isEmpty {
                    FlowLayout(spacing: 8) {
                        ForEach(chips) { chip in chipButton(chip) }
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
                }
            }
        }
    }

    private func chipButton(_ chip: SourceChip) -> some View {
        Button { sources.toggle(chip.source) } label: {
            HStack(spacing: 4) {
                if chip.failed { Image(systemName: "exclamationmark.circle.fill").font(.caption2) }
                Text("\(chip.source.label) \(chip.count)").font(.footnote.weight(.semibold))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .foregroundStyle(chip.on ? palette.color("on-primary") : palette.color("subtle"))
            .background(chip.on ? palette.color("primary") : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(chip.on ? Color.clear : palette.color("strong")))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("\(chip.source.label) \(chip.count)\(chip.failed ? ", couldn't be searched" : "")")
        .accessibilityValue(chip.on ? "on" : "off")
        .accessibilityIdentifier("source-\(chip.source.rawValue)")
    }

    /// The sources on found nothing; one that's off did: one tap turns it on.
    private func hintRow(_ hint: SourceHint) -> some View {
        let where_ = hint.names.isEmpty ? "Every source is off" : "Nothing in \(hint.names.formatted(.list(type: .and)))"
        return Button { sources.toggle(hint.more.source) } label: {
            Text("\(where_) — \(hint.more.source.label) has \(hint.more.count). Show them")
                .foregroundStyle(palette.color("link"))
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("sourceHint")
    }

    /// Back to the search with "Logged …" (Photo, Describe); Scan stays on its camera (SPEC-16).
    @ViewBuilder
    private func hubScreen(_ action: QuickAction) -> some View {
        let back: (String) -> Void = { name in
            hub = nil
            Task { await model.loggedElsewhere(name) }
        }
        Group {
            switch action {
            case .scan: ScanSheet(model: scan, track: model, close: { hub = nil })
            case .photo: PhotoSheet(model: estimate, track: model, onLogged: back)
            case .describe: DescribeSheet(model: estimate, onLogged: back)
            case .track: EmptyView()
            }
        }
        .navigationTitle(action.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Close", action: close) } } // leaves the whole sheet
    }

    /// Yesterday's entries in this meal, exactly as logged: + copies one, Log all copies them all.
    @ViewBuilder
    private var yesterdaySection: some View {
        if !model.yesterday.isEmpty {
            Section {
                ForEach(model.yesterday) { item in
                    HStack {
                        Button {
                            if let food = item.food, food.isLoggable { picked = food }
                        } label: {
                            FoodRow(icon: item.entry.icon, name: item.entry.name, brand: item.entry.brand,
                                    detail: "\(item.entry.amountText(units: units)) · \(Int(item.entry.calories.rounded())) cal")
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("food-\(item.entry.name)")
                        quickAdd(item.entry.name) { await model.copyYesterday(item) }
                    }
                }
            } header: {
                HStack {
                    Text("Same as yesterday")
                    Spacer()
                    Button("Log all") { Task { if await model.logAllYesterday() { Haptics.logged() } } }
                        .font(.subheadline.bold())
                        .textCase(nil)
                        .accessibilityLabel("Log all of yesterday's \(model.meal.title)")
                        .accessibilityIdentifier("logAllYesterday")
                }
            }
        }
    }

    /// The + on a quick row: logs it now (at its last amount, or yesterday's entry as it was).
    private func quickAdd(_ name: String, _ log: @escaping () async -> Bool) -> some View {
        Button {
            Task { if await log() { Haptics.logged() } }
        } label: {
            Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(palette.color("primary"))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Log \(name)")
        .accessibilityIdentifier("quickAdd-\(name)")
    }

    @ViewBuilder
    private func foodSection(_ title: String, _ foods: [Food], quick: Bool = false) -> some View {
        if !foods.isEmpty {
            Section(title) {
                ForEach(foods, id: \.ref) { food in
                    HStack {
                        Button {
                            guard food.isLoggable else { return }
                            picked = food
                        } label: {
                            FoodRow(food: food)
                        }
                        .buttonStyle(.plain)
                        .disabled(!food.isLoggable)
                        .accessibilityIdentifier("food-\(food.name)")
                        if quick, food.isLoggable {
                            quickAdd(food.name) { await model.quickLog(food) }
                        }
                    }
                }
            }
        }
    }
}

/// Chips that wrap onto the next line when the row is full.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].items.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].items.isEmpty { rows.append(Row()) }
            var row = rows[rows.count - 1]
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
