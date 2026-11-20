import Foundation
import Observation

/// The iPhone Dashboard: which widgets show and in what order (saved to the account), edit mode, and the
/// data and quick actions for the Water, Weight, Shot tracking and Badges widgets. The day itself is the DayStore's.
@MainActor
@Observable
public final class DashboardModel {
    public private(set) var widgets: [DashboardWidget] = DashboardWidget.allCases
    public private(set) var editing = false
    public private(set) var waterButtonsMl: [Int] = [237, 473]
    public private(set) var weight: WeightView?
    public private(set) var glp1: Glp1View?
    public private(set) var glp1On = false
    public private(set) var badges: [BadgeItem] = []
    public private(set) var message: String?
    public let units: Units

    private let api: APIClient
    private let dayStore: DayStore
    private var beforeEditing: [DashboardWidget] = []

    /// How far back the Weight widget looks for the change since the last weigh-in.
    static let weightDays = 90
    static let maxBadges = 4

    public init(api: APIClient, dayStore: DayStore, units: Units) {
        self.api = api
        self.dayStore = dayStore
        self.units = units
    }

    /// Widgets not on the Dashboard (the "Add widget" drawer).
    public var hidden: [DashboardWidget] { DashboardWidget.allCases.filter { !widgets.contains($0) } }

    public func load() async {
        async let settings = try? api.send(BodyAPI.settings())
        async let layout = try? api.send(BodyAPI.layout())
        async let badgeList = try? api.send(BodyAPI.badges())
        let (me, saved, earned) = await (settings, layout, badgeList)
        if let me {
            waterButtonsMl = me.waterButtonsMl
            glp1On = me.glp1On
            dayStore.weekStart = me.weekStart
        }
        if let columns = saved?.layout?.columns {
            widgets = columns.first.map { $0.compactMap(DashboardWidget.init(rawValue:)) } ?? []
        } else {
            widgets = DashboardWidget.allCases.filter { $0 != .shots || glp1On }
        }
        badges = Self.recentBadges(earned?.badges ?? [])
        await loadWeight()
        if glp1On { await loadGlp1() }
    }

    // MARK: - Edit mode

    public func startEditing() {
        beforeEditing = widgets
        editing = true
    }

    /// Same meaning as SwiftUI's onMove: `destination` is the index before the move.
    public func move(from source: IndexSet, to destination: Int) {
        let moving = source.map { widgets[$0] }
        let before = source.filter { $0 < destination }.count
        for index in source.reversed() { widgets.remove(at: index) }
        widgets.insert(contentsOf: moving, at: Swift.min(destination - before, widgets.count))
    }
    public func remove(_ widget: DashboardWidget) { widgets.removeAll { $0 == widget } }
    public func add(_ widget: DashboardWidget) { if !widgets.contains(widget) { widgets.append(widget) } }

    public func finishEditing() async {
        editing = false
        do {
            _ = try await api.send(BodyAPI.saveLayout(widgets.map(\.rawValue)))
            message = nil
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    public func cancelEditing() {
        widgets = beforeEditing
        editing = false
    }

    // MARK: - Quick actions

    /// Water for the day being looked at.
    public func addWater(ml: Int) async {
        do {
            _ = try await api.send(LogAPI.water(ml: ml, day: dayStore.selected))
            message = nil
        } catch {
            message = (error as? APIError)?.message ?? error.localizedDescription
        }
        await dayStore.reload()
    }

    /// A weigh-in for the day being looked at, typed in the account's units.
    public func logWeight(display: Double) async throws {
        _ = try await api.send(BodyAPI.saveWeight(day: dayStore.selected, kg: units.kg(fromDisplay: display)))
        await loadWeight()
    }

    /// Today's shot (shots are logged for today, whichever day is on screen).
    /// The account's today (a shot defaults to it).
    public var today: String { dayStore.today }

    /// SPEC-11: the shot as the form has it (dose, date, site, notes).
    public func logShot(_ form: ShotForm) async throws {
        let dose = form.sentDose
        _ = try await api.send(BodyAPI.logShot(day: form.day, site: form.site, doseMg: dose?.mg, doseUnit: dose?.unit, note: form.note))
        await loadGlp1()
    }

    public func clearMessage() { message = nil }

    // MARK: - private

    private func loadWeight() async {
        weight = try? await api.send(BodyAPI.weight(from: DayMath.add(-Self.weightDays, to: dayStore.today)))
    }

    private func loadGlp1() async {
        glp1 = try? await api.send(BodyAPI.glp1())
    }

    static func recentBadges(_ all: [BadgeItem]) -> [BadgeItem] {
        Array(all.filter { $0.earnedOn != nil }.sorted { ($0.earnedOn ?? "") > ($1.earnedOn ?? "") }.prefix(maxBadges))
    }
}
