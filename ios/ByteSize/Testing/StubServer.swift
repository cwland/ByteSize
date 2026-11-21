#if DEBUG
import ByteSizeKit
import Foundation

/// A pretend ByteSize server for UI tests (launch argument -UITestStubServer). Debug builds only.
/// Username "alex" with password "pw" signs in. Today has 1138 calories logged (362 to go of 1500–2000)
/// and 500 ml of water; the log can be edited, moved, deleted and restored in memory.
/// Logging (round 3): search finds "Banana" (also barcode 0012345678905; any other barcode is unknown),
/// "2 eggs and toast" is estimated as Egg ×2 and Toast, and a photo is read as that same plate.
final class StubServer: URLProtocol, @unchecked Sendable {
    static let launchArgument = "-UITestStubServer"

    static var isOn: Bool { CommandLine.arguments.contains(launchArgument) }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubServer.self]
        return URLSession(configuration: config)
    }

    /// Fresh, throwaway settings for each test run.
    static var defaults: UserDefaults {
        let name = "com.cwland.bytesize.uitests"
        UserDefaults().removePersistentDomain(forName: name)
        return UserDefaults(suiteName: name)!
    }

    private static let user = #"{"id":1,"username":"alex","displayName":"Alex","email":"alex@example.com","isAdmin":true,"theme":"avocado","colorMode":"dark","units":"imperial"}"#

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let raw = bodyData()
        let json = (try? JSONSerialization.jsonObject(with: raw) as? [String: Any]) ?? [:]
        let (status, body) = Self.data.answer(request, body: json, raw: String(decoding: raw, as: UTF8.self))
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: status == 204 ? [:] : ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    private func bodyData() -> Data {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
        }
        return data
    }

    // MARK: - The pretend data

    static let data = StubData()

    final class StubData: @unchecked Sendable {
        struct Entry {
            var id: Int
            var day: String
            var meal: String
            var name: String
            var brand: String?
            var icon: String
            var unit: String
            var quantity: Double
            var fraction: Double
            var serving: String
            var perUnit: [String: Double] // nutrients for 1 × serving (or 1 ml of water)
            var source: String
            var ai = false
            var ref: String? = nil // the food it came from ("cache:50"); nil for AI estimates and water

            var nutrients: [String: Double] { perUnit.mapValues { $0 * quantity * fraction } }

            var json: [String: Any] {
                [
                    "id": id, "day": day, "meal": meal, "name": name, "brand": brand as Any, "icon": icon, "servingIndex": 0,
                    "unit": unit, "quantity": quantity, "fraction": fraction,
                    "servings": [unit == "ml" ? ["label": "1 ml", "ml": 1] : ["label": serving]],
                    "nutrients": nutrients, "aiEstimated": ai, "source": source, "sourceRef": ref as Any,
                ]
            }
        }

        private let lock = NSLock()
        private var entries: [Entry]
        private var trash: [Int: Entry] = [:]
        private var nextId = 100
        private var layout: [String]?
        /// GLP-1 shots, newest first (Today polish: the Log shot sheet), and the current dose.
        private var shotLog: [(day: String, dose: Double, unit: String, site: String, note: String?)] = [("2026-11-13", 5, "mg", "abdomen_left", nil)]
        private var currentDose: Double = 5
        /// Bookmarked foods, newest first ("cache:42").
        private var favoriteRefs: [String] = []
        /// I4: weigh-ins (oldest first), kept as the Goals tab logs and deletes them.
        private var weighIns: [(day: String, kg: Double)] = [(StubData.offset(-60), 88.0), (StubData.offset(-7), 83.5), (StubData.offset(-1), 82.28)]

        /// I4: My Foods — (id, name, icon, foodKind, calories per serving, serving label).
        static let myFoods: [(id: Int, name: String, icon: String, kind: String, calories: Double, serving: String)] = [
            (201, "Oat bars", "🍪", "custom", 190, "1 bar"),
            (202, "Banana (mine)", "🍌", "override", 100, "1 medium"),
            (203, "Chili", "🍲", "recipe", 410, "1 bowl"),
            (204, "Usual breakfast", "🍳", "quick_meal", 229, "1 meal"),
        ]
        /// The quick meal's items: (name, icon, calories per serving, quantity).
        static let breakfastItems: [(name: String, icon: String, calories: Double, quantity: Double)] = [("Eggs", "🥚", 72, 2), ("Toast", "🍞", 80, 1), ("Coffee", "☕️", 5, 1)]

        private static func myFoodJSON(_ f: (id: Int, name: String, icon: String, kind: String, calories: Double, serving: String)) -> String {
            #"{"kind":"user_food","id":\#(f.id),"name":"\#(f.name)","brand":null,"icon":"\#(f.icon)","barcode":null,"servings":[{"label":"\#(f.serving)","grams":100}],"nutrients":{"calories":\#(f.calories)},"aiFields":[],"imageUrl":null,"override":\#(f.kind == "override"),"source":"mine","foodKind":"\#(f.kind)"}"#
        }

        static func offset(_ days: Int) -> String { day(Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()) }

        private func weightJSON() -> String {
            let list = weighIns.map { json(["day": $0.day, "weightKg": $0.kg, "trendKg": $0.kg + 0.3, "note": NSNull()]) }
            let first = weighIns.first.map { json(["day": $0.day, "weightKg": $0.kg]) } ?? "null"
            let last = weighIns.last.map { json(["day": $0.day, "weightKg": $0.kg]) } ?? "null"
            let lost = (weighIns.first?.kg).flatMap { f in weighIns.last.map { f - $0.kg - 0.3 } }
            return #"{"weighIns":[\#(list.joined(separator: ","))],"start":\#(first),"latest":\#(last),"trendKg":\#(weighIns.last.map { "\($0.kg + 0.3)" } ?? "null"),"goalKg":75,"lostKg":\#(lost.map { "\($0)" } ?? "null"),"goalDate":{"status":"ok","date":"\#(Self.offset(120))"}}"#
        }

        private static var goalsJSON: String {
            let week = #"{"start":"\#(offset(-2))","end":"\#(offset(4))","value":3,"target":5,"status":"open"}"#
            return #"{"active":[{"id":1,"type":"protein_days","name":"Protein most days","target":5,"period":"week","measure":null,"start":"\#(offset(-20))","end":"\#(offset(15))","progress":{"state":"active","current":\#(week),"hit":2,"done":2,"of":5,"needed":4,"startKg":null}},{"id":2,"type":"weight_by_date","name":"Down to 165","target":75,"period":"stretch","measure":null,"start":"\#(offset(-60))","end":"\#(offset(40))","progress":{"state":"active","current":null,"hit":0,"done":0,"of":1,"needed":1,"startKg":88.3}}],"past":[]}"#
        }

        static var today: String { day(Date()) }
        static var yesterday: String { day(Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()) }

        private static func day(_ date: Date) -> String {
            let p = Calendar.current.dateComponents([.year, .month, .day], from: date)
            return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
        }

        init() {
            let d = Self.today
            entries = [
                Entry(id: 11, day: d, meal: "breakfast", name: "Greek yogurt", brand: "Fage", icon: "🥣", unit: "serving", quantity: 2, fraction: 1, serving: "1 cup", perUnit: ["calories": 130, "protein_g": 18, "carbs_g": 6, "fat_g": 0], source: "cache"),
                Entry(id: 12, day: d, meal: "lunch", name: "Turkey sandwich", brand: nil, icon: "🥪", unit: "serving", quantity: 1, fraction: 1, serving: "1 sandwich", perUnit: ["calories": 520, "protein_g": 35, "carbs_g": 48, "fat_g": 18, "fiber_g": 6], source: "user_food"),
                Entry(id: 13, day: d, meal: "snacks", name: "Protein bar", brand: "Quest", icon: "🍫", unit: "serving", quantity: 1, fraction: 1, serving: "1 bar", perUnit: ["calories": 358, "protein_g": 30, "carbs_g": 22, "fat_g": 12, "fiber_g": 14], source: "cache"),
                Entry(id: 14, day: d, meal: "supplements", name: "Water", brand: nil, icon: "💧", unit: "ml", quantity: 500, fraction: 1, serving: "1 ml", perUnit: ["water_ml": 1], source: "water"),
                // L2: yesterday's dinner, for Same as yesterday (a food, and an AI estimate with no food behind it)
                Entry(id: 15, day: Self.yesterday, meal: "dinner", name: "Pasta", brand: nil, icon: "🍝", unit: "serving", quantity: 1, fraction: 1, serving: "1 cup", perUnit: ["calories": 220, "carbs_g": 43], source: "cache", ref: "cache:50"),
                Entry(id: 17, day: Self.yesterday, meal: "lunch", name: "Broken bar", brand: nil, icon: "🍫", unit: "serving", quantity: 1, fraction: 1, serving: "1 bar", perUnit: ["calories": 200], source: "ai", ai: true),
                Entry(id: 16, day: Self.yesterday, meal: "dinner", name: "Plate estimate", brand: nil, icon: "🍽️", unit: "serving", quantity: 1, fraction: 1, serving: "1 plate", perUnit: ["calories": 450], source: "ai", ai: true),
            ]
        }

        static let banana = #"{"kind":"cache","id":41,"name":"Banana","brand":null,"icon":"🍌","barcode":"0012345678905","servings":[{"label":"1 medium","grams":118},{"label":"100 g","grams":100}],"nutrients":{"calories":105,"protein_g":1.3,"carbs_g":27,"fiber_g":3.1},"aiFields":[],"imageUrl":null,"override":false,"source":"usda","foodKind":"custom"}"#
        static let prunes = #"{"kind":"cache","id":42,"name":"Prunes","brand":null,"icon":"🍇","barcode":null,"servings":[{"label":"5 prunes","grams":40},{"label":"1 prune","grams":8,"derived":true}],"nutrients":{"calories":150,"fiber_g":3},"aiFields":[],"imageUrl":null,"override":false,"source":"usda","foodKind":"custom"}"#
        static let pasta = #"{"kind":"cache","id":50,"name":"Pasta","brand":null,"icon":"🍝","barcode":null,"servings":[{"label":"1 cup","grams":140}],"nutrients":{"calories":220,"carbs_g":43},"aiFields":[],"imageUrl":null,"override":false,"source":"usda","foodKind":"custom","last":{"servingIndex":0,"unit":"serving","quantity":1,"fraction":1}}"#
        /// Only in Basic, which is off by default: shows once its chip is turned on.
        static let bananaChips = #"{"kind":"cache","id":43,"name":"Banana chips","brand":null,"icon":"🍌","barcode":null,"servings":[{"label":"1 oz","grams":28}],"nutrients":{"calories":147},"aiFields":[],"imageUrl":null,"override":false,"source":"basic","foodKind":"custom"}"#
        private static func food(_ ref: String) -> String? {
            ["cache:41": banana, "cache:42": prunes, "cache:50": pasta][ref]
        }
        static let egg = #"{"food":{"name":"Egg","brand":null,"category":"eggs","icon":"🥚","barcode":null,"servings":[{"label":"1 large egg","grams":50}],"nutrients":{"calories":72,"protein_g":6.3,"fat_g":4.8},"aiFields":["calories","protein_g","fat_g"],"source":"ai"},"servingIndex":0,"quantity":2}"#
        static let toast = #"{"food":{"name":"Toast","brand":null,"category":"bread","icon":"🍞","barcode":null,"servings":[{"label":"1 slice","grams":30}],"nutrients":{"calories":80,"carbs_g":15,"protein_g":3},"aiFields":["calories","carbs_g","protein_g"],"source":"ai"},"servingIndex":0,"quantity":1}"#

        func answer(_ req: URLRequest, body: [String: Any], raw: String = "") -> (Int, String) {
            lock.withLock { route(req.httpMethod ?? "GET", req.url?.path() ?? "", req.url?.query() ?? "", body, raw) }
        }

        private func json(_ value: Any) -> String {
            String(data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        }

        private func route(_ method: String, _ path: String, _ query: String, _ body: [String: Any], _ raw: String) -> (Int, String) {
            let parts = path.split(separator: "/").map(String.init) // ["api", …]
            switch (method, path) {
            case ("GET", "/api/health"): return (200, #"{"ok":true,"db":true,"version":"stub"}"#)
            case ("GET", "/api/auth/status"): return (200, #"{"setupRequired":false,"passwords":true,"forgotPassword":true,"oauth":{"label":"Authentik"}}"#)
            case ("POST", "/api/auth/login"):
                if body["username"] as? String == "alex", body["password"] as? String == "pw" {
                    return (200, #"{"token":"stub-token","user":\#(StubServer.user)}"#)
                }
                return (401, #"{"error":"Wrong username or password"}"#)
            case ("GET", "/api/auth/me"): return (200, #"{"user":\#(StubServer.user)}"#)
            case ("POST", "/api/auth/logout"): return (200, #"{"ok":true}"#)
            case ("GET", "/api/settings/me"): return (200, #"{"waterButtonsMl":[237,473],"weekStart":0,"glp1On":true}"#)
            case ("GET", "/api/layouts/ios"):
                return (200, layout.map { json(["layout": ["version": 1, "columns": [$0]]]) } ?? #"{"layout":null}"#)
            case ("PUT", "/api/layouts/ios"):
                layout = (body["columns"] as? [[String]])?.first ?? []
                return (200, json(["layout": ["version": 1, "columns": [layout ?? []]]]))
            case ("GET", "/api/weight"):
                return (200, weightJSON())
            case ("PUT", _) where path.hasPrefix("/api/steps/"):
                return (200, json(["day": String(path.dropFirst("/api/steps/".count)), "steps": body["steps"] as? Int ?? 0, "stepsSource": "health"]))
            case ("POST", "/api/workouts"):
                return (200, #"{"workout":null,"skipped":false}"#)
            case ("GET", "/api/goals"):
                return (200, Self.goalsJSON)
            case ("GET", "/api/targets"):
                return (200, #"{"targets":{"calories":{"min":1500,"max":2000},"protein_g":{"min":110,"max":130},"fiber_g":{"min":25,"max":35},"water_ml":{"min":2000,"max":3000}}}"#)
            case ("PUT", _) where path.hasPrefix("/api/weigh-ins/"):
                let day = String(path.dropFirst("/api/weigh-ins/".count))
                // I5: from Health it only fills an empty day
                if body["source"] as? String == "health", let have = weighIns.first(where: { $0.day == day }) {
                    return (200, json(["weighIn": ["day": day, "weightKg": have.kg, "note": NSNull()], "skipped": true]))
                }
                weighIns.removeAll { $0.day == day }
                weighIns.append((day, body["weightKg"] as? Double ?? 80))
                weighIns.sort { $0.day < $1.day }
                return (200, json(["weighIn": ["day": day, "weightKg": body["weightKg"] as? Double ?? 80, "note": NSNull()], "skipped": false]))
            case ("DELETE", _) where path.hasPrefix("/api/weigh-ins/"):
                let day = String(path.dropFirst("/api/weigh-ins/".count))
                weighIns.removeAll { $0.day == day }
                return (204, "")
            case ("GET", "/api/glp1"):
                let shots = shotLog.map { json(["day": $0.day, "medication": "Zepbound", "doseMg": $0.dose, "doseUnit": $0.unit, "site": $0.site, "note": $0.note as Any]) }
                let last = shots.first ?? "null"
                return (200, #"{"settings":{"medication":"Zepbound","doseMg":\#(currentDose),"doseUnit":"mg","injectionWeekday":2},"lastShot":\#(last),"nextDue":"2026-11-20","status":"upcoming","overdueDays":0,"suggestedSite":"abdomen_right","shots":[\#(shots.joined(separator: ","))],"medications":[{"name":"Zepbound","ingredient":"tirzepatide","doses":[2.5,5,7.5,10,12.5,15]},{"name":"Wegovy","ingredient":"semaglutide","doses":[0.25,0.5,1,1.7,2.4]}]}"#)
            case ("PUT", _) where path.hasPrefix("/api/glp1/shots/"):
                let day = String(path.dropFirst("/api/glp1/shots/".count))
                let dose = (body["doseMg"] as? Double) ?? currentDose
                shotLog.removeAll { $0.day == day }
                shotLog.append((day, dose, body["doseUnit"] as? String ?? "mg", body["site"] as? String ?? "abdomen_left", body["note"] as? String))
                shotLog.sort { $0.day > $1.day }
                if day == shotLog.first?.day { currentDose = dose }
                return (200, #"{"ok":true}"#)
            case ("GET", "/api/badges"):
                return (200, #"{"badges":[{"id":"first_weigh_in","earnedOn":"2026-11-02"},{"id":"lost_5","earnedOn":"2026-11-15"},{"id":"streak_7","earnedOn":"2026-11-10"}]}"#)
            case ("GET", "/api/days/logged"):
                return (200, json(["days": Array(Set(entries.map(\.day))).sorted()]))
            case ("GET", "/api/foods/search"):
                let q = query.lowercased()
                // USDA has the food; Basic (off by default) has Banana chips for "ban"
                let food = q.contains("ban") ? Self.banana : q.contains("prun") ? Self.prunes : ""
                let basic = q.contains("ban") ? Self.bananaChips : ""
                return (200, #"{"groups":[{"source":"basic","label":"Basic foods","foods":[\#(basic)]},{"source":"usda","label":"USDA","foods":[\#(food)]}],"errors":[],"searched":["mine","basic","usda"]}"#)
            case ("GET", "/api/foods/recent"): return (200, #"{"foods":[\#(Self.banana)]}"#)
            case ("GET", "/api/foods/frequent"): return (200, #"{"foods":[]}"#)
            case ("GET", "/api/foods/same-as-yesterday"):
                return (200, query.contains("meal=dinner") ? #"{"foods":[\#(Self.pasta)]}"# : #"{"foods":[]}"#)
            case ("GET", "/api/foods/favorites"):
                return (200, #"{"foods":[\#(favoriteRefs.compactMap(Self.food).joined(separator: ","))]}"#)
            case ("PUT", "/api/foods/favorites"):
                let food = body["food"] as? [String: Any] ?? [:]
                let ref = "\(food["kind"] as? String ?? ""):\(food["id"] as? Int ?? 0)"
                if !favoriteRefs.contains(ref) { favoriteRefs.insert(ref, at: 0) }
                return (200, json(["refs": favoriteRefs]))
            case ("DELETE", _) where path.hasPrefix("/api/foods/favorites/") && parts.count == 5:
                favoriteRefs.removeAll { $0 == "\(parts[3]):\(parts[4])" }
                return (200, json(["refs": favoriteRefs]))
            case ("POST", "/api/ai/estimate-items"):
                return (200, #"{"items":[\#(Self.egg),\#(Self.toast)],"assumed":false}"#)
            case ("POST", "/api/photos/analyze") where raw.contains(PhotoButtons.testBarcodePhoto):
                return (200, #"{"photoIds":["stub-photo"],"barcode":"0012345678905","food":\#(Self.banana),"errors":[],"labelReading":true}"#)
            case ("POST", "/api/photos/analyze"):
                return (200, #"{"photoIds":["stub-photo"],"plate":{"items":[\#(Self.egg),\#(Self.toast)]},"errors":[],"labelReading":true}"#)
            case ("POST", "/api/log/estimates"):
                var out: [[String: Any]] = []
                for item in body["items"] as? [[String: Any]] ?? [] {
                    nextId += 1
                    let per = (item["nutrients"] as? [String: Double]) ?? [:]
                    let serving = ((item["servings"] as? [[String: Any]])?.first?["label"] as? String) ?? "1 serving"
                    let e = Entry(id: nextId, day: body["day"] as? String ?? Self.today, meal: body["meal"] as? String ?? "snacks", name: item["name"] as? String ?? "Food", brand: nil, icon: item["icon"] as? String ?? "🍽️", unit: "serving", quantity: (item["quantity"] as? Double) ?? 1, fraction: 1, serving: serving, perUnit: per, source: "ai", ai: true)
                    entries.append(e)
                    out.append(e.json)
                }
                return (200, json(["entries": out]))
            case ("GET", "/api/my-foods"):
                let items = URLComponents(string: "x?\(query)")?.queryItems ?? []
                let q = (items.first { $0.name == "q" }?.value ?? "").lowercased()
                let kind = items.first { $0.name == "kind" }?.value ?? "all"
                let list = Self.myFoods.filter { f in
                    (q.isEmpty || f.name.lowercased().contains(q)) && (kind == "all" || (kind == "foods" && (f.kind == "custom" || f.kind == "override")) || (kind == "recipes" && f.kind == "recipe") || (kind == "meals" && f.kind == "quick_meal"))
                }
                return (200, #"{"foods":[\#(list.map(Self.myFoodJSON).joined(separator: ","))]}"#)
            case ("GET", "/api/my-foods/204"):
                let items = Self.breakfastItems.enumerated().map { i, it in
                    #"{"food":{"kind":"cache","id":\#(300 + i)},"foodKind":"custom","name":"\#(it.name)","brand":null,"icon":"\#(it.icon)","imageUrl":null,"servingIndex":0,"unit":"serving","quantity":\#(it.quantity),"fraction":1,"servings":[{"label":"1 serving","grams":50}],"perServing":{"calories":\#(it.calories)},"nutrients":{"calories":\#(it.calories * it.quantity)},"available":true}"#
                }
                let base = String(Self.myFoodJSON(Self.myFoods[3]).dropLast())
                return (200, #"{"food":\#(base),"notes":null,"items":[\#(items.joined(separator: ","))],"recipeServings":null,"servingGrams":null}}"#)
            case ("POST", "/api/log/meal"):
                let sent = body["items"] as? [[String: Any]] ?? []
                var out: [[String: Any]] = []
                for item in sent {
                    let id = ((item["food"] as? [String: Any])?["id"] as? Int ?? 300) - 300
                    guard Self.breakfastItems.indices.contains(id) else { continue }
                    let it = Self.breakfastItems[id]
                    nextId += 1
                    let e = Entry(id: nextId, day: body["day"] as? String ?? Self.today, meal: body["meal"] as? String ?? "breakfast", name: it.name, brand: nil, icon: it.icon, unit: "serving", quantity: (item["quantity"] as? Double) ?? 1, fraction: 1, serving: "1 serving", perUnit: ["calories": it.calories], source: "cache", ref: "quick:204")
                    entries.append(e)
                    out.append(e.json)
                }
                return (200, json(["entries": out, "combined": []]))
            case ("POST", "/api/log") where (body["food"] as? [String: Any])?["kind"] as? String == "user_food":
                let id = (body["food"] as? [String: Any])?["id"] as? Int ?? 0
                guard let f = Self.myFoods.first(where: { $0.id == id }) else { return (404, #"{"error":"Food not found"}"#) }
                nextId += 1
                let e = Entry(id: nextId, day: body["day"] as? String ?? Self.today, meal: body["meal"] as? String ?? "snacks", name: f.name, brand: nil, icon: f.icon, unit: "serving", quantity: (body["quantity"] as? Double) ?? 1, fraction: 1, serving: f.serving, perUnit: ["calories": f.calories], source: "user_food", ref: "user_food:\(id)")
                entries.append(e)
                return (200, json(["entry": e.json]))
            case ("POST", "/api/my-foods"):
                return (200, #"{"food":\#(Self.banana.replacingOccurrences(of: #""kind":"cache","id":41"#, with: #""kind":"user_food","id":9"#))}"#)
            case ("POST", "/api/log") where body["food"] != nil:
                nextId += 1
                // Banana (41) or Prunes (42; "1 prune" is a fifth of "5 prunes"), in the serving chosen
                let isPrunes = (body["food"] as? [String: Any])?["id"] as? Int == 42
                let idx = body["servingIndex"] as? Int ?? 0
                let (name, icon, serving, per): (String, String, String, [String: Double]) = isPrunes
                    ? ("Prunes", "🍇", idx == 1 ? "1 prune" : "5 prunes", ["calories": idx == 1 ? 30 : 150, "fiber_g": idx == 1 ? 0.6 : 3])
                    : ("Banana", "🍌", "1 medium", ["calories": 105, "protein_g": 1.3, "carbs_g": 27, "fiber_g": 3.1])
                let e = Entry(id: nextId, day: body["day"] as? String ?? Self.today, meal: body["meal"] as? String ?? "snacks", name: name, brand: nil, icon: icon, unit: "serving", quantity: (body["quantity"] as? Double) ?? 1, fraction: (body["fraction"] as? Double) ?? 1, serving: serving, perUnit: per, source: "cache")
                entries.append(e)
                return (200, json(["entry": e.json]))
            case ("POST", "/api/log"):
                let ml = (body["water_ml"] as? Double) ?? Double(body["water_ml"] as? Int ?? 0)
                nextId += 1
                let e = Entry(id: nextId, day: body["day"] as? String ?? Self.today, meal: "supplements", name: "Water", brand: nil, icon: "💧", unit: "ml", quantity: ml, fraction: 1, serving: "1 ml", perUnit: ["water_ml": 1], source: "water")
                entries.append(e)
                return (200, json(["entry": e.json]))
            case ("POST", "/api/log/move") where (body["ids"] as? [Int] ?? []).contains(17):
                return (400, #"{"error":"That entry can't be copied"}"#) // L2: a + that fails
            case ("POST", "/api/log/move"):
                let ids = body["ids"] as? [Int] ?? []
                let copy = body["copy"] as? Bool ?? false
                var out: [[String: Any]] = []
                for id in ids {
                    guard let i = entries.firstIndex(where: { $0.id == id }) else { return (404, #"{"error":"Entry not found"}"#) }
                    var e = entries[i]
                    e.day = body["day"] as? String ?? e.day
                    e.meal = body["meal"] as? String ?? e.meal
                    if copy {
                        nextId += 1
                        e.id = nextId
                        entries.append(e)
                    } else {
                        entries[i] = e
                    }
                    out.append(e.json)
                }
                return (200, json(["entries": out, "combined": []]))
            default: break
            }
            // /api/day/:d
            // Today polish: a day three days back that fails to load (the Food Log says so, with Retry)
            if method == "GET", parts.count == 3, parts[1] == "day", parts[2] == Self.day(Calendar.current.date(byAdding: .day, value: -3, to: Date()) ?? Date()) {
                return (500, #"{"error":"ByteSize didn't answer"}"#)
            }
            if method == "GET", parts.count == 3, parts[1] == "day" { return (200, json(dayView(parts[2]))) }
            // /api/log/:id and /api/log/:id/restore
            if parts.count >= 3, parts[1] == "log", let id = Int(parts[2]) {
                if method == "PATCH", let i = entries.firstIndex(where: { $0.id == id }) {
                    if let q = body["quantity"] as? Double { entries[i].quantity = q }
                    if let f = body["fraction"] as? Double { entries[i].fraction = f }
                    return (200, json(["entry": entries[i].json]))
                }
                if method == "DELETE", let i = entries.firstIndex(where: { $0.id == id }) {
                    trash[id] = entries.remove(at: i)
                    return (204, "")
                }
                if method == "POST", parts.count == 4, parts[3] == "restore" {
                    guard let e = trash.removeValue(forKey: id) else { return (404, #"{"error":"That's too late to undo"}"#) }
                    entries.append(e)
                    entries.sort { $0.id < $1.id }
                    return (200, json(["entry": e.json]))
                }
                return (404, #"{"error":"Entry not found"}"#)
            }
            // /api/foods/barcode/:code
            if method == "GET", parts.count == 4, parts[1] == "foods", parts[2] == "barcode" {
                let food = parts[3] == "0012345678905" ? Self.banana : "null"
                return (200, #"{"code":"\#(parts[3])","food":\#(food),"errors":[]}"#)
            }
            if method == "PUT", path.hasPrefix("/api/weigh-ins/") || path.hasPrefix("/api/glp1/shots/") { return (200, #"{"ok":true}"#) }
            return (404, #"{"error":"Not found"}"#)
        }

        private func dayView(_ day: String) -> [String: Any] {
            let mine = entries.filter { $0.day == day }
            func sum(_ list: [Entry]) -> [String: Double] {
                list.reduce(into: [:]) { acc, e in for (k, v) in e.nutrients { acc[k, default: 0] += v } }
            }
            let meals = ["breakfast", "lunch", "dinner", "snacks", "supplements"].reduce(into: [String: Any]()) { acc, m in
                let s = sum(mine.filter { $0.meal == m })
                acc[m] = ["calories": s["calories"] ?? 0, "protein_g": s["protein_g"] ?? 0, "carbs_g": s["carbs_g"] ?? 0, "fat_g": s["fat_g"] ?? 0, "fiber_g": s["fiber_g"] ?? 0]
            }
            return [
                "day": day, "entries": mine.map(\.json), "totals": sum(mine), "meals": meals,
                "targets": ["calories": ["min": 1500, "max": 2000], "protein_g": ["min": 110, "max": 130], "fiber_g": ["min": 25, "max": 35], "water_ml": ["min": 2000, "max": 3000]],
                "streak": 12,
            ]
        }
    }
}
#endif
