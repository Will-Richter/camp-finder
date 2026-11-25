// Drives the Drive mode engine along a road near Bundaberg and checks what it shows and when it speaks up.
// swiftc -parse-as-library Shared/DriveShared.swift Shared/DriveEngine.swift tools/DriveEngineTest.swift -o /tmp/drivetest
// /tmp/drivetest Shared/drive-places.json
import Foundation

@main
struct DriveEngineTest {
    static var failures = 0
    static func check(_ ok: Bool, _ what: String) {
        print(ok ? "  ok   \(what)" : "  FAIL \(what)")
        if !ok { failures += 1 }
    }

    /// Points every `step` metres along straight lines between the given stops
    static func line(_ stops: [(Double, Double)], step: Double = 200) -> [(Double, Double)] {
        var out: [(Double, Double)] = []
        for i in 0..<(stops.count - 1) {
            let a = stops[i], b = stops[i + 1]
            let n = max(1, Int(Geo.meters(a.0, a.1, b.0, b.1) / step))
            for k in 0..<n { let t = Double(k) / Double(n); out.append((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)) }
        }
        out.append(stops.last!)
        return out
    }

    static func main() {
        let file = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Shared/drive-places.json"
        let places = DrivePlaces.shared
        places.load(from: URL(fileURLWithPath: file))
        print("places: \(places.camps.count) camps, \(places.fuel.count) servos, \(places.sights.count) must-sees")
        check(places.camps.count > 5000 && places.fuel.count > 5000 && places.sights.count > 150, "place list loaded")

        // Bargara -> past Mon Repos -> Bundaberg (past the rum distillery) -> Gin Gin -> towards Monto
        let stops: [(Double, Double)] = [(-24.8180, 152.4560), (-24.8060, 152.4300), (-24.8540, 152.3700), (-24.8660, 152.3480),
                                         (-24.9300, 152.1500), (-24.9910, 151.9560), (-24.9000, 151.7500), (-24.8600, 151.4000)]
        let road = line(stops)
        var o = DriveEngine.Options()
        o.title = "Bargara to Monto"
        o.route = road.map { [$0.1, $0.0] }
        o.nights = [DriveEngine.Spot(name: "Gin Gin Rest Area", lat: -24.9747, lon: 151.9461)]
        o.lastFuel = [DriveEngine.FuelGap(name: "Puma Gin Gin", lat: -24.9825, lon: 151.9506, gapKm: 180, next: "Monto")]
        var e = DriveEngine(places: places, opts: o)
        check(e.route != nil && (e.route!.total / 1000) > 100, "route built: \(Int((e.route?.total ?? 0) / 1000)) km")

        var now = Date(timeIntervalSince1970: 1_790_000_000)   // a morning, so no afternoon free-camp nudge
        var alerts: [String] = []
        var lastFuelName = "", lastFuelM = Double.infinity, fuelWentUp = 0
        var onRoute = true
        print("\nkm   camp | fuel | must-see | tonight")
        for (i, p) in road.enumerated() where i % 2 == 0 {   // every 400 m
            let st = e.state(lat: p.0, lon: p.1)
            onRoute = onRoute && st.onRoute
            if let f = st.fuel {
                let key = "\(f.lat),\(f.lon)"
                if key == lastFuelName && f.meters > lastFuelM + 50 { fuelWentUp += 1 }
                lastFuelName = key; lastFuelM = f.meters
            }
            if let a = e.alert(for: st, lat: p.0, lon: p.1, now: now) { alerts.append(a.title); print("     >> \(a.title): \(a.body)") }
            if i % 25 == 0 {
                func s(_ x: DriveStop?) -> String { x.map { "\($0.name) \(DriveFormat.distance($0.meters))" } ?? "-" }
                print(String(format: "%3.0f", Double(i) * 0.2), " \(s(st.camp)) | \(s(st.fuel)) | \(s(st.sight)) | \(s(st.tonight))")
            }
            now += 16   // about 90 km/h
        }
        print("")
        check(onRoute, "stayed on the planned route the whole way")
        check(alerts.contains { $0.contains("Mon Repos") }, "spoke up about Mon Repos")
        check(alerts.contains { $0.contains("Bundaberg Rum") }, "spoke up about the rum distillery")
        check(alerts.contains { $0.hasPrefix("Tonight's camp") }, "said tonight's camp was close")
        check(alerts.contains { $0.hasPrefix("Last fuel") }, "gave the last-fuel warning")
        check(Set(alerts).count == alerts.count, "never repeated a heads-up")
        check(fuelWentUp == 0, "distance to the next servo only ever counted down")

        // Heads-ups are at least 90 seconds apart
        var e2 = DriveEngine(places: places, opts: o)
        let st0 = e2.state(lat: stops[0].0, lon: stops[0].1)
        let first = e2.alert(for: st0, lat: stops[0].0, lon: stops[0].1, now: now)
        let soon = e2.alert(for: e2.state(lat: -24.8540, lon: 152.3700), lat: -24.8540, lon: 152.3700, now: now + 30)
        check(first != nil && soon == nil, "waits 90 seconds between heads-ups")

        // No planned route: looks ahead in the direction you're driving (west out of Bundaberg)
        var free = DriveEngine(places: places, opts: DriveEngine.Options())
        free.course = 250
        let st = free.state(lat: -24.8660, lon: 152.3480)
        check(!st.onRoute && st.camp != nil && st.fuel != nil, "without a route it still finds a camp and fuel ahead")
        if let c = st.camp, let pl = places.camps.first(where: { $0.name == c.name }) {
            let b = Geo.bearing(-24.8660, 152.3480, pl.lat, pl.lon)
            check(Geo.angle(b, 250) < 30, "the camp it shows is in front (bearing \(Int(b))°)")
        }
        if let f = st.fuel, let pl = places.fuel.first(where: { $0.name == f.name }) {
            let b = Geo.bearing(-24.8660, 152.3480, pl.lat, pl.lon)
            check(Geo.angle(b, 250) < 30, "the servo it shows is in front, not behind (bearing \(Int(b))°)")
        }
        // Not moving yet and no route: nothing "ahead" until it knows which way you're going
        var parked = DriveEngine(places: places, opts: DriveEngine.Options())
        let still = parked.state(lat: -24.8660, lon: 152.3480)
        check(still.camp == nil && still.fuel == nil && still.sight == nil, "standing still with no route it shows nothing behind you")
        print("  no route, heading west: camp \(st.camp?.name ?? "-") \(st.camp.map { DriveFormat.distance($0.meters) } ?? ""), fuel \(st.fuel?.name ?? "-"), must-see \(st.sight?.name ?? "-")")

        // Well off the planned route: falls back to looking ahead
        let off = e.state(lat: -25.3, lon: 152.0)
        check(!off.onRoute, "10+ km off the route it stops using the route")

        print(failures == 0 ? "\nall good" : "\n\(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
