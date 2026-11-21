import XCTest

/// Runs the app against its built-in stub server (launch argument -UITestStubServer): no real server needed.
/// Set TEST_RUNNER_SHOTS_DIR to a folder to also save screenshots there.
final class SmokeUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-UITestStubServer"]
        app.launch()
    }

    func testSignInTabsMenuProfileSignOut() {
        shot("1-sign-in")
        signIn(password: "pw")
        XCTAssertTrue(app.buttons["Dashboard"].waitForExistence(timeout: 5))
        dismissSavePassword(timeout: 6)

        for tab in ["Dashboard", "Food Log", "Goals", "My Foods", "Quick add"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 5), "missing \(tab)")
        }
        shot("2-dashboard")

        // Closed: the quick actions aren't on screen (or read by VoiceOver)
        XCTAssertFalse(app.buttons["Track Food"].exists)
        app.buttons["Quick add"].tap()
        if !app.buttons["Track Food"].waitForExistence(timeout: 3) {
            // the Save Password prompt can show up late and take the tap
            dismissSavePassword(timeout: 2)
            app.buttons["Quick add"].tap()
        }
        for action in ["Track Food", "Scan Food", "Photo", "Describe Food"] {
            XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 3), "missing \(action)")
            XCTAssertTrue(app.buttons[action].isHittable, "\(action) can't be tapped")
        }
        sleep(1)
        shot("3-quick-add")
        app.buttons["Close"].firstMatch.tap()

        app.buttons["Profile"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Account and goals are set up in the ByteSize web app."].waitForExistence(timeout: 5))
        shot("4-profile")
        app.buttons["Sign out"].firstMatch.tap()
        let confirm = app.sheets.buttons["Sign out"].exists ? app.sheets.buttons["Sign out"] : app.buttons.matching(identifier: "Sign out").element(boundBy: 1)
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        confirm.tap()

        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 5), "back on sign-in")
    }

    func testWrongPassword() {
        signIn(password: "wrong")
        let error = app.staticTexts["signInError"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertEqual(error.label, "Wrong username or password")
    }

    private func signIn(password: String) {
        let server = app.textFields["serverField"]
        XCTAssertTrue(server.waitForExistence(timeout: 5))
        server.tap()
        server.typeText("stub.test")
        // A freshly booted simulator can show the keyboard's own first-run tip, which has a Continue too: tap until
        // the sign-in form moves on
        let username = app.textFields["usernameField"]
        for _ in 0..<3 where !username.exists {
            app.buttons["Continue"].firstMatch.tap()
            _ = username.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(username.waitForExistence(timeout: 5))
        username.tap()
        username.typeText("cory")
        // UI-test runs use a plain field for the password (no Save Password prompt)
        let pass = app.textFields["passwordField"].exists ? app.textFields["passwordField"] : app.secureTextFields["passwordField"]
        pass.tap()
        pass.typeText(password)
        app.buttons["Sign in"].tap()
    }

    /// iOS offers to save the password after signing in; say Not Now so it doesn't swallow the next tap.
    private func dismissSavePassword(timeout: TimeInterval) {
        let sources = [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")]
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for source in sources where source.buttons["Not Now"].exists {
                source.buttons["Not Now"].tap()
                return
            }
            usleep(250_000)
        } while Date() < deadline
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"], !dir.isEmpty {
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    // MARK: - Round 2: Dashboard and Food Log (stub day: 1138 cal of 1500–2000, 500 ml water)

    /// Polls `condition` for up to `timeout` seconds.
    private func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            usleep(200_000)
        }
        return condition()
    }

    private func signedIn() {
        signIn(password: "pw")
        XCTAssertTrue(app.buttons["Dashboard"].waitForExistence(timeout: 5))
        dismissSavePassword(timeout: 6)
    }

    func testDashboardShowsToday() {
        signedIn()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        let water = app.staticTexts["waterTotal"]
        XCTAssertTrue(water.waitForExistence(timeout: 3))
        XCTAssertEqual(water.label, "17 fl oz")
        shot("5-dashboard")
        app.buttons["Add 8 fl oz of water"].tap()
        XCTAssertTrue(waitUntil { water.label == "25 fl oz" }, "water went up by 8 fl oz")
        app.swipeUp()
        shot("6-dashboard-lower")
    }

    func testFoodLogSwipeDeleteAndUndo() {
        signedIn()
        app.buttons["Food Log"].tap()
        let yogurt = app.staticTexts["Greek yogurt"]
        XCTAssertTrue(yogurt.waitForExistence(timeout: 5))
        shot("7-food-log")
        app.cells.containing(.staticText, identifier: "Greek yogurt").firstMatch.swipeLeft()
        XCTAssertTrue(app.buttons["Move"].waitForExistence(timeout: 3))
        shot("8-swipe-actions")
        app.buttons["Delete"].tap()
        let undo = app.buttons["Undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3))
        XCTAssertTrue(undo.isHittable, "the Undo toast sits above the tab bar")
        XCTAssertFalse(app.staticTexts["Greek yogurt"].exists)
        shot("9-undo")
        undo.tap()
        XCTAssertTrue(app.staticTexts["Greek yogurt"].waitForExistence(timeout: 5))
    }

    func testEditEntryAmount() {
        signedIn()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.staticTexts["Greek yogurt"].waitForExistence(timeout: 5))
        app.staticTexts["Greek yogurt"].tap()
        XCTAssertTrue(app.navigationBars["Edit"].waitForExistence(timeout: 3))
        // L1: three wheels — whole | fraction | unit — starting at the entry's 2 × 1 cup
        let wheels = app.pickerWheels
        XCTAssertTrue(wheels.element(boundBy: 0).waitForExistence(timeout: 3))
        wheels.element(boundBy: 1).adjust(toPickerWheelValue: "½")
        XCTAssertTrue(waitUntil { self.app.staticTexts["previewCalories"].label == "About 325 calories" }, "2½ × 130")
        shot("10-edit-entry")
        app.buttons["saveEntry"].tap()
        // the row reads as one combined label ("Greek yogurt, Fage · 2½ × 1 cup, 325")
        let edited = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "2½ × 1 cup")).firstMatch
        XCTAssertTrue(edited.waitForExistence(timeout: 5))
    }

    func testEditDashboardLayout() {
        signedIn()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 3))
        let badges = app.descendants(matching: .any).matching(identifier: "edit-badges").firstMatch
        XCTAssertTrue(badges.waitForExistence(timeout: 3))
        shot("11-dashboard-edit")
        // edit mode shows a red ⊖ before each row: tap it (left of the row's label), then Delete
        // (the ⊖ sits about 30 pt left of the row's icon)
        badges.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5)).withOffset(CGVector(dx: -30, dy: 0)).tap()
        let delete = app.buttons["Delete"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 3))
        delete.tap()
        let gone = app.descendants(matching: .any).matching(identifier: "edit-badges").firstMatch
        XCTAssertTrue(waitUntil(timeout: 3) { !gone.exists }, "the Badges row leaves the list")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["362 to go"].waitForExistence(timeout: 5))
        app.swipeUp()
        app.swipeUp()
        XCTAssertFalse(app.staticTexts["Badges"].exists, "the Badges card is gone")
    }

    // MARK: - Round 3: logging food (the stub knows "Banana", barcode 0012345678905, and estimates "2 eggs and toast")

    private func openAction(_ title: String) {
        app.buttons["Quick add"].tap()
        if !app.buttons[title].waitForExistence(timeout: 3) {
            dismissSavePassword(timeout: 2)
            app.buttons["Quick add"].tap()
        }
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 3))
        app.buttons[title].tap()
    }

    func testTrackFoodSearchAndLog() {
        signedIn()
        openAction("Track Food")
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        shot("7-track-food")
        search.tap()
        search.typeText("banana")
        let row = app.buttons["food-Banana"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let log = app.buttons["logButton"]
        if !log.waitForExistence(timeout: 5) {
            shot("8-after-tap")
            if let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
                try? app.debugDescription.write(toFile: dir + "/8-after-tap.txt", atomically: true, encoding: .utf8)
            }
        }
        XCTAssertTrue(log.exists)
        XCTAssertEqual(app.staticTexts["previewCalories"].label, "About 105 calories", "the calorie preview, at the top")
        shot("8-portion")
        log.tap()
        // SPEC-16: back to the search for the next food; Close leaves
        XCTAssertTrue(app.descendants(matching: .any)["loggedToast"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["logButton"].exists)
        XCTAssertTrue(app.textFields["trackSearch"].waitForExistence(timeout: 5))
        closeSheet()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(reveal(app.staticTexts["Banana"]).waitForExistence(timeout: 5), "late in the day it's in Snacks, below the fold")
    }

    /// Close on a sheet that stays open after logging; a tap during the pop back to the search can be lost.
    private func closeSheet() {
        let close = app.navigationBars.buttons["Close"].firstMatch
        for _ in 0..<3 where close.exists {
            if close.isHittable { close.tap() }
            if waitUntil(timeout: 2, { !close.exists }) { return }
        }
        XCTAssertFalse(close.exists, "the sheet didn't close")
    }

    /// Search inside an open Track Food sheet and open a result's amount screen.
    private func trackSearchHere(_ text: String, pick name: String) {
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(text)
        let row = app.buttons["food-\(name)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.buttons["logButton"].waitForExistence(timeout: 5))
    }

    private func trackSearch(_ text: String, pick name: String) {
        openAction("Track Food")
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText(text)
        let row = app.buttons["food-\(name)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.buttons["logButton"].waitForExistence(timeout: 5))
    }

    // MARK: - Track Food top: tools by the search, collapsible sources

    func testCloseIsThereFromTheStartAndTheSearchKeepsItsWidth() {
        signedIn()
        openAction("Track Food")
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars.buttons["Close"].firstMatch.exists, "Close is built with the screen")
        let width = search.frame.width
        shot("tf-1-open")
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertEqual(search.frame.width, width, accuracy: 0.5, "the search never shrinks after the screen is up")
    }

    /// The mockup (option B): slim Photo · Scan · Describe buttons, snug under the search, the search snug under the title.
    func testTrackFoodTopIsSnugLikeTheMockup() {
        signedIn()
        openAction("Track Food")
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        let photo = app.buttons["hub-photo"]
        XCTAssertTrue(photo.waitForExistence(timeout: 3))
        let bar = app.navigationBars["Track Food"]
        shot("tf-3-snug")
        XCTAssertLessThanOrEqual(photo.frame.height, 48, "slim buttons, icon beside the word")
        // the text field sits inside a 44 pt box (~11 pt above and below it)
        XCTAssertLessThanOrEqual(photo.frame.minY - search.frame.maxY, 24, "the tools sit right under the search")
        XCTAssertLessThanOrEqual(search.frame.minY - bar.frame.maxY, 28, "the search sits right under the title")
        XCTAssertEqual(photo.frame.minY, app.buttons["hub-describe"].frame.minY, accuracy: 1, "one row")
    }

    func testSourceChipsFilterTheResults() {
        signedIn()
        openAction("Track Food")
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("banana")
        XCTAssertTrue(app.buttons["food-Banana"].waitForExistence(timeout: 5), "USDA is on")
        XCTAssertFalse(app.buttons["food-Banana chips"].exists, "Basic is off by default")
        XCTAssertFalse(app.buttons["sourceHint"].exists, "USDA found one")
        let toggle = app.buttons["sourcesToggle"]
        XCTAssertTrue(toggle.label.contains("2 OF 3"), toggle.label)
        toggle.tap()
        let basic = app.buttons["source-basic"]
        XCTAssertTrue(basic.waitForExistence(timeout: 3))
        shot("tf-2-sources-open")
        basic.tap()
        XCTAssertTrue(app.buttons["food-Banana chips"].waitForExistence(timeout: 3))
        app.buttons["source-usda"].tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["food-Banana"].exists })
        XCTAssertTrue(app.buttons["food-Banana chips"].exists)
    }

    func testSourcesRowRemembersOpen() {
        signedIn()
        openAction("Track Food")
        let toggle = app.buttons["sourcesToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        XCTAssertEqual(toggle.value as? String, "closed", "starts collapsed")
        toggle.tap()
        XCTAssertTrue(waitUntil { toggle.value as? String == "open" })
        closeSheet()
        openAction("Track Food")
        XCTAssertTrue(app.buttons["sourcesToggle"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["sourcesToggle"].value as? String, "open")
    }

    func testTrackPrunesBySix() {
        signedIn()
        trackSearch("prunes", pick: "Prunes")
        let wheels = app.pickerWheels
        wheels.element(boundBy: 2).adjust(toPickerWheelValue: "1 prune")
        wheels.element(boundBy: 0).adjust(toPickerWheelValue: "6")
        XCTAssertTrue(waitUntil { self.app.staticTexts["previewCalories"].label == "About 180 calories" }, "6 of a 5-prune 150-cal serving")
        shot("12-prunes-wheel")
        app.buttons["logButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["loggedToast"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["trackSearch"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { !self.app.buttons["logButton"].exists })
        closeSheet()
        app.buttons["Food Log"].tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "6 × 1 prune")).firstMatch
        XCTAssertTrue(reveal(row).waitForExistence(timeout: 5))
    }

    func testTrackFoodStaysOpenForTheNext() {
        signedIn()
        trackSearch("banana", pick: "Banana")
        app.buttons["logButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["loggedToast"].waitForExistence(timeout: 5))
        // the second food, without leaving the search
        let search = app.textFields["trackSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { !self.app.buttons["logButton"].exists })
        search.tap()
        search.typeText("prunes")
        let prunes = app.buttons["food-Prunes"]
        XCTAssertTrue(prunes.waitForExistence(timeout: 5))
        prunes.tap()
        XCTAssertTrue(app.buttons["logButton"].waitForExistence(timeout: 5))
        app.buttons["logButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Logged Prunes")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { !self.app.buttons["logButton"].exists })
        closeSheet()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(reveal(app.staticTexts["Banana"]).waitForExistence(timeout: 5))
        XCTAssertTrue(reveal(app.staticTexts["Prunes"]).waitForExistence(timeout: 5))
    }

    // MARK: - L2: meals always there with Add; quick foods one tap away; the bookmark

    private func label(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", text)).firstMatch
    }

    /// Scrolls up until the element is on screen and tappable (lists only build the rows they show).
    private func reveal(_ element: XCUIElement) -> XCUIElement {
        for _ in 0..<5 where !(element.exists && element.isHittable) {
            app.swipeUp()
        }
        return element
    }

    private func openDinnerFromTheFoodLog() {
        app.buttons["Food Log"].tap()
        let add = app.buttons["addTo-dinner"]
        XCTAssertTrue(add.waitForExistence(timeout: 5), "an empty meal still shows, with its Add")
        add.tap()
        XCTAssertTrue(app.textFields["trackSearch"].waitForExistence(timeout: 5))
    }

    func testEmptyMealsHaveAddAndOpenInThatMeal() {
        signedIn()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.buttons["addTo-dinner"].waitForExistence(timeout: 5))
        XCTAssertFalse(label("Nothing logged yet — tap + to track food").exists)
        shot("15-food-log-add")
        app.buttons["addTo-dinner"].tap()
        let meal = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Dinner")).firstMatch
        XCTAssertTrue(meal.waitForExistence(timeout: 5), "Track Food opens in Dinner")
    }

    func testPlusLogsFromSameAsYesterdayAndLogAll() {
        signedIn()
        openDinnerFromTheFoodLog()
        XCTAssertTrue(label("Same as yesterday").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["quickAdd-Pasta"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["quickAdd-Plate estimate"].exists)
        shot("16-quick-sections")
        app.buttons["quickAdd-Pasta"].tap()
        XCTAssertTrue(label("Logged Pasta").waitForExistence(timeout: 5))
        app.buttons["logAllYesterday"].tap()
        XCTAssertTrue(label("Logged 2 foods").waitForExistence(timeout: 5))
        closeSheet()
        // The Food Log's header (strip and summary) is taller now: Dinner's rows may be below the fold
        XCTAssertTrue(app.staticTexts["Pasta"].waitForExistence(timeout: 5) || reveal(app.staticTexts["Pasta"]).exists)
        XCTAssertTrue(reveal(app.staticTexts["Plate estimate"]).exists)
    }

    func testBookmarkMakesAFavorite() {
        signedIn()
        trackSearch("prunes", pick: "Prunes")
        let bookmark = app.buttons["bookmark"]
        XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
        XCTAssertEqual(bookmark.label, "Add to Favorites")
        bookmark.tap()
        XCTAssertTrue(waitUntil { bookmark.label == "Remove from Favorites" })
        shot("17-bookmark")
        app.navigationBars.buttons.element(boundBy: 0).tap() // Back to the search
        let clear = app.buttons["Clear search"]
        if clear.waitForExistence(timeout: 3) { clear.tap() }
        XCTAssertTrue(label("Favorites").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["quickAdd-Prunes"].waitForExistence(timeout: 5))
    }

    func testAFailedQuickLogSaysSo() {
        signedIn()
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.buttons["addTo-lunch"].waitForExistence(timeout: 5))
        app.buttons["addTo-lunch"].tap()
        XCTAssertTrue(app.buttons["quickAdd-Broken bar"].waitForExistence(timeout: 5))
        app.buttons["quickAdd-Broken bar"].firstMatch.tap()
        XCTAssertTrue(label("That entry can't be copied").waitForExistence(timeout: 5), "the error shows on the quick screen")
    }

    func testAMealChosenInsideDescribeComesBackToTheSearch() {
        signedIn()
        openDinnerFromTheFoodLog()
        let field = app.textFields["describeField"]
        let describe = app.buttons["hub-describe"]
        XCTAssertTrue(describe.waitForExistence(timeout: 5))
        for _ in 0..<2 where !field.exists { // a tap while the sheet is still rising can be lost
            if describe.isHittable { describe.tap() }
            _ = field.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(field.waitForExistence(timeout: 2))
        field.typeText("2 eggs and toast")
        app.buttons["estimateButton"].tap()
        XCTAssertTrue(app.buttons["logAll"].waitForExistence(timeout: 5))
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Meal")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 3))
        picker.tap()
        app.buttons["Snacks"].firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Snacks")).firstMatch.waitForExistence(timeout: 3))
        // Back (not Close): the Describe Food bar has both, and other bars sit behind the sheet
        app.navigationBars["Describe Food"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["hub-describe"].waitForExistence(timeout: 5), "back on the search, sheet still open")
        let meal = app.descendants(matching: .any)["trackMeal"]
        let inSnacks = waitUntil { meal.exists && (meal.label.contains("Snacks") || (meal.value as? String ?? "").contains("Snacks")) }
        if !inSnacks, let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"] {
            try? app.debugDescription.write(toFile: dir + "/meal-tree.txt", atomically: true, encoding: .utf8)
        }
        XCTAssertTrue(inSnacks, "the search is in Snacks now")
        XCTAssertTrue(reveal(app.buttons["quickAdd-Banana"]).waitForExistence(timeout: 5))
        app.buttons["quickAdd-Banana"].tap()
        XCTAssertTrue(label("Logged Banana").waitForExistence(timeout: 5))
        closeSheet()
        XCTAssertTrue(app.buttons["addTo-breakfast"].waitForExistence(timeout: 5))
        let banana = reveal(app.staticTexts["Banana"]) // Snacks is below the fold
        XCTAssertTrue(banana.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(banana.frame.minY, app.buttons["addTo-dinner"].frame.minY, "under Snacks, after Dinner")
    }

    // MARK: - L2: Track Food is the hub for Photo, Scan and Describe; the (+) menu doesn't overlap

    func testHubOpensScanInsideTrackFoodAndBack() {
        signedIn()
        openAction("Track Food")
        XCTAssertTrue(app.buttons["hub-scan"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["hub-photo"].exists)
        XCTAssertTrue(app.buttons["hub-describe"].exists)
        shot("18-hub")
        app.buttons["hub-scan"].tap()
        XCTAssertTrue(app.textFields["barcodeField"].waitForExistence(timeout: 5) || app.otherElements["scanner"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap() // Back
        XCTAssertTrue(app.textFields["trackSearch"].waitForExistence(timeout: 5), "back on the search, the sheet still open")
        XCTAssertTrue(app.buttons["hub-scan"].exists)
    }

    func testDescribeInTheHubLogsIntoTheChosenMealAndComesBack() {
        signedIn()
        openDinnerFromTheFoodLog()
        app.buttons["hub-describe"].tap()
        let field = app.textFields["describeField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("2 eggs and toast")
        app.buttons["estimateButton"].tap()
        XCTAssertTrue(app.buttons["logAll"].waitForExistence(timeout: 5))
        app.buttons["logAll"].tap()
        XCTAssertTrue(label("Logged 2 foods").waitForExistence(timeout: 5), "back on the search")
        XCTAssertTrue(app.textFields["trackSearch"].waitForExistence(timeout: 5))
        closeSheet()
        XCTAssertTrue(app.staticTexts["Egg"].waitForExistence(timeout: 5))
        let dinner = reveal(app.buttons["addTo-dinner"]) // below the fold under the taller header
        XCTAssertTrue(dinner.exists)
        XCTAssertLessThan(app.staticTexts["Egg"].frame.minY, dinner.frame.minY, "logged under Dinner, above its Add")
        XCTAssertGreaterThan(app.staticTexts["Egg"].frame.minY, app.buttons["addTo-lunch"].frame.minY)
    }

    func testQuickAddMenuButtonsDontOverlap() {
        signedIn()
        app.buttons["Quick add"].tap()
        let titles = ["Track Food", "Scan Food", "Photo", "Describe Food"]
        XCTAssertTrue(app.buttons["Describe Food"].waitForExistence(timeout: 3))
        sleep(1) // the fan-out animation
        shot("3-quick-add")
        let frames = titles.map { app.buttons[$0].frame }
        for i in frames.indices {
            for j in frames.indices where j > i {
                XCTAssertFalse(frames[i].intersects(frames[j]), "\(titles[i]) overlaps \(titles[j])")
            }
        }
    }

    // MARK: - Today polish: the day strip, the month calendar, the Food Log summary

    private func dayString(_ offset: Int) -> String {
        let d = Calendar.current.date(byAdding: .day, value: offset, to: Date())!
        let p = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", p.year!, p.month!, p.day!)
    }

    func testStripSelectsADayAndTheCalendarJumps() {
        signedIn()
        app.buttons["Food Log"].tap()
        let header = app.buttons["dayHeader"]
        XCTAssertTrue(header.waitForExistence(timeout: 5))
        XCTAssertEqual(header.label, "Today")
        let yesterday = app.buttons["day-\(dayString(-1))"]
        XCTAssertTrue(yesterday.waitForExistence(timeout: 5))
        yesterday.tap()
        XCTAssertTrue(waitUntil { header.label != "Today" }, "the header shows the chosen day")
        shot("21-strip")
        header.tap()
        XCTAssertTrue(app.datePickers["dayCalendar"].waitForExistence(timeout: 5))
        shot("22-calendar")
        app.buttons["todayInCalendar"].tap()
        XCTAssertTrue(waitUntil { header.label == "Today" })
    }

    func testNoArrowsRemain() {
        signedIn()
        XCTAssertTrue(app.buttons["dayHeader"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Previous week"].exists)
        XCTAssertFalse(app.buttons["Next week"].exists)
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.buttons["dayHeader"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Previous day"].exists)
        XCTAssertFalse(app.buttons["Next day"].exists)
    }

    func testFoodLogSummaryShowsWhatsLeft() {
        signedIn()
        app.buttons["Food Log"].tap()
        let summary = app.descendants(matching: .any)["logSummary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 5))
        XCTAssertTrue(summary.label.contains("1,138 eaten"), summary.label)
        XCTAssertTrue(summary.label.contains("862 left"), summary.label)
        shot("23-log-summary")
    }

    func testTomorrowCanBeChosenToPreLog() {
        signedIn()
        app.buttons["Food Log"].tap()
        let tomorrow = app.buttons["day-\(dayString(1))"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        XCTAssertTrue(tomorrow.isEnabled)
        tomorrow.tap()
        XCTAssertTrue(waitUntil { self.app.buttons["dayHeader"].label != "Today" }, "the header shows tomorrow")
        XCTAssertFalse(app.buttons["day-\(dayString(8))"].exists && app.buttons["day-\(dayString(8))"].isEnabled)
        shot("35-tomorrow")
        openDinnerFromTheFoodLog()
        trackSearchHere("banana", pick: "Banana")
        app.buttons["logButton"].tap()
        closeSheet()
        XCTAssertTrue(waitUntil { self.reveal(self.label("Banana")).exists }, "logged on tomorrow")
    }

    func testFutureDayDisablesWaterWeightAndShot() {
        signedIn()
        let tomorrow = app.buttons["day-\(dayString(1))"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        let hint = app.staticTexts.matching(identifier: "futureHint").firstMatch
        XCTAssertTrue(hint.waitForExistence(timeout: 5))
        XCTAssertEqual(hint.label, "That day hasn't happened yet")
        let water = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Add ")).firstMatch
        XCTAssertTrue(water.exists)
        XCTAssertFalse(water.isEnabled)
        XCTAssertFalse(reveal(app.buttons["Log weight"]).isEnabled)
        XCTAssertFalse(reveal(app.buttons["Log shot"]).isEnabled)
    }

    func testAFailedDayShowsWhyInTheFoodLog() {
        signedIn()
        app.buttons["Food Log"].tap()
        let chip = app.buttons["day-\(dayString(-3))"]
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        chip.tap()
        XCTAssertTrue(label("ByteSize didn't answer").waitForExistence(timeout: 5), "not a silently empty day")
        XCTAssertTrue(app.buttons["retryDay"].exists)
    }

    func testOverviewExpandsToDailyTotals() {
        signedIn()
        let chevron = app.buttons["overviewChevron"]
        XCTAssertTrue(chevron.waitForExistence(timeout: 5))
        if chevron.label == "Hide daily totals" { chevron.tap() } // the open state is remembered between launches
        XCTAssertTrue(waitUntil { chevron.label == "Show daily totals" })
        XCTAssertFalse(app.staticTexts["Carbs"].exists, "collapsed: no carbs and fat row")
        chevron.tap()
        let sugar = app.staticTexts["Sugar"] // only in the daily totals
        XCTAssertTrue(sugar.waitForExistence(timeout: 3))
        for name in ["Calories", "Carbs", "Fat", "Sodium"] {
            XCTAssertTrue(app.staticTexts[name].exists, "\(name) in the daily totals")
        }
        shot("24-overview-expanded")
        XCTAssertEqual(chevron.label, "Hide daily totals")
        chevron.tap()
        XCTAssertTrue(waitUntil { !sugar.exists })
    }

    func testLogShotWithDoseDateAndNote() {
        signedIn()
        let log = reveal(app.buttons["Log shot"])
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        log.tap()
        let dose = app.buttons["shotDose"]
        XCTAssertTrue(dose.waitForExistence(timeout: 5))
        XCTAssertTrue(app.datePickers["shotDate"].exists)
        dose.tap()
        app.buttons["7.5 mg"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["currentDoseNote"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["currentDoseNote"].label, "This becomes your current dose")
        let note = app.textFields["shotNote"].exists ? app.textFields["shotNote"] : app.textViews["shotNote"]
        note.tap()
        note.typeText("left side sore")
        shot("25-log-shot")
        app.buttons["saveShot"].tap()
        let last = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "7.5 mg")).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 5), "the card's Last: line shows the new dose")
    }

    func testSettingsDivider() {
        signedIn()
        app.buttons["Profile"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Theme")).firstMatch.waitForExistence(timeout: 5))
        shot("26-settings") // checked by eye: the separator between Theme and Appearance spans the row
    }

    func testBigAmountAsks() {
        signedIn()
        trackSearch("banana", pick: "Banana")
        app.pickerWheels.element(boundBy: 0).adjust(toPickerWheelValue: "20")
        app.buttons["logButton"].tap()
        let ask = app.alerts["That's a lot — log 2,100 cal of Banana?"]
        XCTAssertTrue(ask.waitForExistence(timeout: 5))
        shot("13-big-amount")
        ask.buttons["Change"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["loggedToast"].exists, "nothing logged")
        XCTAssertTrue(app.buttons["logButton"].exists, "still choosing")
    }

    func testScanReturnsToTheCamera() {
        signedIn()
        openAction("Scan Food")
        let field = app.textFields["barcodeField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("0012345678905")
        app.buttons["lookUpBarcode"].tap()
        let log = app.buttons["logButton"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        log.tap()
        // SPEC-16: back to the scanner for the next barcode
        XCTAssertTrue(app.descendants(matching: .any)["loggedToast"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["barcodeField"].exists)
        shot("14-scan-again")
    }

    func testTypedBarcodeNotFoundOffersLabel() {
        signedIn()
        openAction("Scan Food")
        // The simulator has no camera: say so, and offer typing
        XCTAssertTrue(app.staticTexts["Camera isn't available — type the barcode instead"].waitForExistence(timeout: 5))
        let field = app.textFields["barcodeField"]
        field.tap()
        field.typeText("0099999999999")
        app.buttons["lookUpBarcode"].tap()
        XCTAssertTrue(app.staticTexts["We don't know this barcode yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose a photo of the label"].exists, "the label can be read instead")
        shot("9-scan-unknown")
    }

    func testDescribeLogsItems() {
        signedIn()
        openAction("Describe Food")
        let field = app.textFields["describeField"].exists ? app.textFields["describeField"] : app.textViews["describeField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("2 eggs and toast")
        app.buttons["estimateButton"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["item-Egg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["item-Toast"].exists)
        XCTAssertTrue(app.staticTexts["2 × 1 large egg · ≈ 144 cal"].exists)
        shot("10-describe")
        app.buttons["logAll"].tap()
        XCTAssertTrue(waitUntil { !self.app.buttons["logAll"].exists }, "the sheet closes")
        app.buttons["Food Log"].tap()
        XCTAssertTrue(app.buttons["addTo-breakfast"].waitForExistence(timeout: 5))
        XCTAssertTrue(reveal(app.staticTexts["Egg"]).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Toast"].exists)
        // Each log row reads as one element: "Egg, AI estimated, …"
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Egg' AND label CONTAINS 'AI estimated'")).firstMatch.exists, "marked AI")
        shot("11-log-with-ai")
    }

    // MARK: - I4 Goals

    private func openGoals() {
        app.buttons["Goals"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["goalsTargets"].waitForExistence(timeout: 5))
    }

    private func logWeightOnGoals(_ text: String) {
        let button = reveal(app.buttons["logWeight"])
        button.tap()
        let field = app.textFields["weightField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let current = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + text)
        app.buttons["saveWeight"].tap()
        XCTAssertTrue(waitUntil { !field.exists }, "the sheet closes after saving")
    }

    func testGoalsShowTargetsGoalsAndChart() {
        signedIn()
        openGoals()
        XCTAssertTrue(label("Goals and targets are managed in the ByteSize web app.").exists)
        let goal = app.descendants(matching: .any)["goal-1"]
        XCTAssertTrue(goal.waitForExistence(timeout: 5))
        XCTAssertTrue(goal.label.contains("3 of 5 days this week"), goal.label)
        XCTAssertTrue(reveal(app.descendants(matching: .any)["weightChart"]).exists)
        app.buttons["range-All"].tap()
        shot("31-goals")
    }

    func testLogWeightAddsToHistory() {
        signedIn()
        openGoals()
        logWeightOnGoals("180")
        let row = reveal(app.descendants(matching: .any)["history-\(dayString(0))"])
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.contains("180.0 lb"), row.label)
    }

    func testSwipeDeletesAWeighIn() {
        signedIn()
        openGoals()
        let oldest = app.descendants(matching: .any)["history-\(dayString(-60))"]
        for _ in 0..<6 where !(oldest.exists && oldest.isHittable) { app.swipeUp() }
        XCTAssertTrue(oldest.exists)
        oldest.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(waitUntil { !oldest.exists }, "the weigh-in is gone")
    }

    func testADashboardWeighInShowsOnGoals() {
        signedIn()
        openGoals() // loaded once before the weigh-in
        app.buttons["Dashboard"].tap()
        reveal(app.buttons["Log weight"]).tap()
        let field = app.textFields["Weight"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let current = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + "177")
        app.buttons["Save"].tap()
        XCTAssertTrue(waitUntil { !field.exists })
        openGoals()
        let row = reveal(app.descendants(matching: .any)["history-\(dayString(0))"])
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { row.label.contains("177.0 lb") }, row.label)
    }

    func testLogWeightUsesTodayEvenWhenTomorrowIsPicked() {
        signedIn()
        app.buttons["Food Log"].tap()
        let tomorrow = app.buttons["day-\(dayString(1))"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        openGoals()
        reveal(app.buttons["logWeight"]).tap()
        XCTAssertTrue(app.textFields["weightField"].waitForExistence(timeout: 5))
        shot("32-log-weight")
        app.buttons["Cancel"].tap()
        logWeightOnGoals("179")
        let row = reveal(app.descendants(matching: .any)["history-\(dayString(0))"])
        XCTAssertTrue(row.waitForExistence(timeout: 5), "saved on today, not the picked day")
        XCTAssertFalse(app.descendants(matching: .any)["history-\(dayString(1))"].exists)
    }

    // MARK: - I4 My Foods

    private func openMyFoods() {
        app.buttons["My Foods"].tap()
        XCTAssertTrue(app.buttons["filter-all"].waitForExistence(timeout: 5))
    }

    private func foodLogShows(_ name: String) -> Bool {
        app.buttons["Food Log"].tap()
        let entry = label(name)
        return waitUntil { self.reveal(entry).exists }
    }

    func testMyFoodsFiltersAndLogsARecipe() {
        signedIn()
        openMyFoods()
        app.buttons["filter-recipes"].tap()
        let chili = app.buttons["myFood-203"]
        XCTAssertTrue(chili.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { !self.app.buttons["myFood-201"].exists }, "only recipes")
        shot("33-my-foods")
        chili.tap()
        let log = app.buttons["logButton"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        log.tap()
        XCTAssertTrue(app.buttons["filter-all"].waitForExistence(timeout: 5), "back on the list after logging")
        XCTAssertTrue(foodLogShows("Chili"))
    }

    func testQuickMealLeavesOneOut() {
        signedIn()
        openMyFoods()
        app.buttons["filter-meals"].tap()
        let meal = app.buttons["myFood-204"]
        XCTAssertTrue(meal.waitForExistence(timeout: 5))
        meal.tap()
        let toast = app.buttons["mealItem-1"]
        XCTAssertTrue(toast.waitForExistence(timeout: 5))
        toast.tap()
        shot("34-quick-meal")
        app.buttons["logMeal"].tap()
        XCTAssertTrue(app.buttons["filter-all"].waitForExistence(timeout: 5), "back on the list after logging")
        XCTAssertTrue(foodLogShows("Coffee"))
        XCTAssertTrue(label("Eggs").exists)
        XCTAssertFalse(label("Toast").exists)
    }

    func testMyEditsShowsOnlyCorrections() {
        signedIn()
        openMyFoods()
        app.buttons["filter-edits"].tap()
        XCTAssertTrue(app.buttons["myFood-202"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil { !self.app.buttons["myFood-201"].exists && !self.app.buttons["myFood-203"].exists })
    }

    func testSearchFindsAFood() {
        signedIn()
        openMyFoods()
        let search = app.textFields["myFoodsSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("oat")
        XCTAssertTrue(waitUntil { self.app.buttons["myFood-201"].exists && !self.app.buttons["myFood-203"].exists })
    }

    // MARK: - I5 Apple Health

    func testHealthSwitchSyncsAWeighIn() {
        app.terminate()
        app.launchArguments.append("-UITestFakeHealth")
        app.launch()
        signedIn()
        app.buttons["Profile"].firstMatch.tap()
        let weight = app.switches["health-weight"]
        XCTAssertTrue(reveal(weight).waitForExistence(timeout: 5))
        weight.switches.firstMatch.tap()
        let status = app.descendants(matching: .any)["healthStatus"]
        XCTAssertTrue(waitUntil(timeout: 8) { status.exists && status.label.contains("1 weigh-in") }, status.exists ? status.label : "no status")
        shot("41-health")
        app.buttons["Done"].tap()
        XCTAssertTrue(waitUntil(timeout: 8) { self.label("176.4 lb").exists }, "the Dashboard weight card shows the Health weigh-in")
    }

    func testTheDayStripSitsTheSameOnDashboardAndFoodLog() {
        signedIn()
        let header = app.buttons["dayHeader"]
        let chip = app.buttons["day-\(dayString(0))"]
        XCTAssertTrue(header.waitForExistence(timeout: 5))
        let onDashboard = (header.frame, chip.frame)
        app.buttons["Food Log"].tap()
        XCTAssertTrue(header.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil(timeout: 3) { chip.exists })
        shot("42-strip-food-log")
        XCTAssertEqual(header.frame.minY, onDashboard.0.minY, accuracy: 1, "the header doesn't drop between tabs")
        XCTAssertEqual(chip.frame.minY, onDashboard.1.minY, accuracy: 1)
        XCTAssertEqual(chip.frame.height, onDashboard.1.height, accuracy: 1)
        XCTAssertEqual(header.frame.midX, onDashboard.0.midX, accuracy: 1)
    }

    /// Every day chip on screen is whole: none cut off at the strip's edges (on the Dashboard, the Food Log, and after a swipe).
    private func assertWholeChips(_ place: String) {
        let row = app.scrollViews["dayStripRow"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let bounds = row.frame
        var whole = 0
        for offset in -12...12 {
            let chip = app.buttons["day-\(dayString(offset))"]
            guard chip.exists else { continue }
            let f = chip.frame
            guard f.maxX > bounds.minX + 0.5, f.minX < bounds.maxX - 0.5 else { continue } // off screen (any sliver counts as shown)
            XCTAssertGreaterThanOrEqual(f.minX, bounds.minX - 0.5, "\(place): day \(offset) is cut off on the left")
            XCTAssertLessThanOrEqual(f.maxX, bounds.maxX + 0.5, "\(place): day \(offset) is cut off on the right")
            whole += 1
        }
        XCTAssertEqual(whole, 7, "\(place): seven whole days show")
    }

    func testTheDayStripNeverCutsADayOff() {
        signedIn()
        assertWholeChips("Dashboard")
        app.scrollViews["dayStripRow"].swipeRight()
        sleep(1)
        assertWholeChips("Dashboard after a swipe")
        app.buttons["Food Log"].tap()
        assertWholeChips("Food Log")
    }
}
