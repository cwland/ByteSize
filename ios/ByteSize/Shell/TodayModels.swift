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
    let units: Units

    init(api: APIClient, user: User) {
        self.api = api
        units = Units(user.units)
        let zone = user.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        days = DayStore(api: api, timeZone: zone)
        dashboard = DashboardModel(api: api, dayStore: days, units: units)
        log = FoodLogModel(api: api, dayStore: days)
    }

    func load() async {
        await dashboard.load() // settings first: the week start for the strip
        await days.reload()
    }
}
