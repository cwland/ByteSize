import ByteSizeKit
import Foundation

/// Everything the signed-in tabs share for one login: the selected day, the Dashboard and the Food Log,
/// set up with the account's timezone and units.
@MainActor
final class TodayModels {
    let api: APIClient
    let days: DayStore
    let dashboard: DashboardModel
    let log: FoodLogModel
    let goals: GoalsModel
    let units: Units

    init(api: APIClient, user: User) {
        self.api = api
        let units = Units(user.units)
        let zone = user.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        let days = DayStore(api: api, timeZone: zone)
        let dashboard = DashboardModel(api: api, dayStore: days, units: units)
        self.units = units
        self.days = days
        self.dashboard = dashboard
        log = FoodLogModel(api: api, dayStore: days)
        // A weigh-in logged or deleted on the Goals tab also updates the Dashboard's weight card
        goals = GoalsModel(api: api, dayStore: days, units: units) { await dashboard.reloadWeight() }
    }

    func load() async {
        await dashboard.load() // settings first: the week start for the strip
        await days.reload()
    }
}
