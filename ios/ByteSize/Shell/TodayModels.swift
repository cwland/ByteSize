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
    let myFoods: MyFoodsModel
    let health: HealthSync
    /// Track Food's source chips and Sources row, remembered for this sign-in.
    let sources: SourceFilter
    let units: Units
    /// Profile › Settings: units, week start, date format, meal times
    let accountSettings: AccountSettingsModel
    let userId: Int
    /// The account these were made for: a changed one (units saved in Profile) makes fresh models.
    let user: User

    /// `account`: the server and user, so Health switches belong to this sign-in.
    init(api: APIClient, user: User, account: String, session: SessionStore) {
        self.api = api
        userId = user.id
        self.user = user
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
        myFoods = MyFoodsModel(api: api, dayStore: days)
        health = HealthSync(api: api, dayStore: days, store: Self.healthStore, defaults: Self.appDefaults, account: account)
        sources = SourceFilter(defaults: Self.appDefaults, account: account)
        accountSettings = AccountSettingsModel(api: api, dayStore: days, session: session)
    }

    private static var healthStore: HealthStore {
        #if DEBUG
        if UITestHealthStore.isOn { return UITestHealthStore() }
        #endif
        return HealthKitStore.shared
    }

    /// Health switches and Track Food sources; a fresh suite under the UI tests.
    private static var appDefaults: UserDefaults {
        #if DEBUG
        if StubServer.isOn { return UserDefaults(suiteName: "com.cwland.bytesize.uitests") ?? .standard }
        #endif
        return .standard
    }

    /// Health first (it may add a weigh-in), then the Dashboard's weight.
    func syncHealth() async {
        guard health.anyOn else { return }
        await health.syncNow()
        await dashboard.reloadWeight()
    }

    func load() async {
        await dashboard.load() // settings first: the week start for the strip
        await days.reload()
    }
}
