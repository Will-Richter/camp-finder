import Foundation
import CoreLocation
import UIKit
import ActivityKit

/// Drive mode: while you drive, the next camp, servo and must-see ahead show on the Lock Screen, in the
/// Dynamic Island and on the CarPlay Dashboard (a Live Activity), with a heads-up ("Check out ...") as you
/// get close to a must-see, tonight's camp, a good free camp in the afternoon, or the last fuel before a long gap.
/// Live Activities and their alerts show in CarPlay for any app, so this needs no CarPlay approval from Apple.
final class DriveMode: NSObject, CLLocationManagerDelegate {
    static let shared = DriveMode()

    /// Events for the web page (state changes, links opened from the widget or Live Activity)
    var send: (([String: Any]) -> Void)?
    private(set) var isOn = false
    private var pendingOpen: [String: Any]?

    private let manager = CLLocationManager()
    private var opts = Options()
    private var route: Route?
    private var along: [DrivePlaces.Category: [Ahead]] = [:]   // places beside the planned route, in order
    private var nights: [Ahead] = []
    private var lastLoc: CLLocation?
    private var course: Double = -1
    private var routeHint = 0
    private var lastCompute = Date.distantPast
    private var lastPush = Date.distantPast
    private var pushed: DriveState?
    private var alerted = Set<String>()
    private var lastAlert = Date.distantPast
    private var movedAt = Date()
    private var movedFrom: CLLocation?
    private var activity: Any?          // Activity<DriveAttributes>, iOS 18+
    private var watchTask: Task<Void, Never>?

    struct Options: Codable {
        var title = "Drive mode"
        var route: [[Double]] = []      // [lon, lat]
        var nights: [Spot] = []         // planned camps, in order
        var lastFuel: [FuelGap] = []    // last servo before a long gap
        var sights = true
        var camps = true
        var fuel = true
        var freeFirst = true
    }
    struct Spot: Codable { var name: String; var lat: Double; var lon: Double }
    struct FuelGap: Codable { var name: String; var lat: Double; var lon: Double; var gapKm: Int; var next: String }
    struct Ahead { var index: Int; var along: Double; var off: Double; var name: String }

    var supported: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 40
        manager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: commands from the web page
    func handle(_ body: [String: Any]) -> Any {
        switch body["cmd"] as? String {
        case "status":
            var s = status()
            if let o = pendingOpen { s["open"] = o; pendingOpen = nil }
            return s
        case "start":
            let o = Self.options(from: body)
            return start(o)
        case "update":
            guard isOn else { return status() }
            opts = Self.options(from: body)
            save()
            prepare()
            compute(force: true)
            return status()
        case "stop":
            stop(reason: "Drive mode off")
            return status()
        default:
            return status()
        }
    }

    func status() -> [String: Any] {
        var s: [String: Any] = ["supported": supported, "on": isOn]
        if #available(iOS 18.0, *) { s["allowed"] = ActivityAuthorizationInfo().areActivitiesEnabled }
        return s
    }

    /// The Live Activity or the widget was tapped (campfinder://drive, campfinder://nearby?kind=fuel)
    func open(_ url: URL) {
        var e: [String: Any] = ["type": "open", "what": url.host ?? "drive"]
        if let k = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "kind" })?.value { e["kind"] = k }
        if let send { send(e) } else { pendingOpen = e }
    }

    private static func options(from body: [String: Any]) -> Options {
        var o = Options()
        if let t = body["title"] as? String, !t.isEmpty { o.title = String(t.prefix(60)) }
        o.route = ((body["route"] as? [[Any]]) ?? []).compactMap { p in
            guard p.count >= 2, let lo = (p[0] as? NSNumber)?.doubleValue, let la = (p[1] as? NSNumber)?.doubleValue else { return nil }
            return [lo, la]
        }
        o.nights = ((body["nights"] as? [[String: Any]]) ?? []).compactMap { n in
            guard let la = (n["lat"] as? NSNumber)?.doubleValue, let lo = (n["lon"] as? NSNumber)?.doubleValue else { return nil }
            return Spot(name: (n["name"] as? String) ?? "Tonight's camp", lat: la, lon: lo)
        }
        o.lastFuel = ((body["lastFuel"] as? [[String: Any]]) ?? []).compactMap { f in
            guard let la = (f["lat"] as? NSNumber)?.doubleValue, let lo = (f["lon"] as? NSNumber)?.doubleValue else { return nil }
            return FuelGap(name: (f["name"] as? String) ?? "This servo", lat: la, lon: lo, gapKm: (f["gapKm"] as? NSNumber)?.intValue ?? 0, next: (f["next"] as? String) ?? "")
        }
        if let a = body["alerts"] as? [String: Any] {
            o.sights = (a["sights"] as? Bool) ?? true
            o.camps = (a["camps"] as? Bool) ?? true
            o.fuel = (a["fuel"] as? Bool) ?? true
        }
        o.freeFirst = (body["freeFirst"] as? Bool) ?? true
        return o
    }

    // MARK: start and stop
    private func start(_ o: Options) -> [String: Any] {
        guard #available(iOS 18.0, *) else { return ["error": "Drive mode needs iOS 18 or later."] }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return ["error": "Live Activities are off for Camp Finder. Turn them on in Settings → Camp Finder → Live Activities."]
        }
        switch manager.authorizationStatus {
        case .denied, .restricted: return ["error": "Location is off for Camp Finder. Turn it on in Settings → Camp Finder → Location."]
        case .notDetermined: manager.requestWhenInUseAuthorization()
        default: break
        }
        opts = o
        if !isOn { alerted = Set(UserDefaults.standard.stringArray(forKey: "cf.drive.alerted") ?? []) }
        DrivePlaces.shared.load()
        prepare()
        isOn = true
        save()
        startActivity()
        startLocation()
        if let l = manager.location, -l.timestamp.timeIntervalSinceNow < 300 { lastLoc = l }
        compute(force: true)
        send?(["type": "state", "on": true])
        return status()
    }

    func stop(reason: String) {
        guard isOn else { return }
        isOn = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        watchTask?.cancel(); watchTask = nil
        if #available(iOS 18.0, *), let a = activity as? Activity<DriveAttributes> {
            let final = pushed ?? DriveState()
            Task { await a.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: .immediate) }
        }
        activity = nil
        pushed = nil
        UserDefaults.standard.removeObject(forKey: "cf.drive.opts")
        UserDefaults.standard.removeObject(forKey: "cf.drive.alerted")
        send?(["type": "state", "on": false, "reason": reason])
    }

    /// After the app was closed by iOS: pick up a Live Activity that is still showing
    func resume() {
        guard #available(iOS 18.0, *), !isOn,
              let data = UserDefaults.standard.data(forKey: "cf.drive.opts"),
              let o = try? JSONDecoder().decode(Options.self, from: data) else { return }
        guard let a = Activity<DriveAttributes>.activities.first(where: { $0.activityState == .active }) else {
            UserDefaults.standard.removeObject(forKey: "cf.drive.opts"); return
        }
        opts = o
        alerted = Set(UserDefaults.standard.stringArray(forKey: "cf.drive.alerted") ?? [])
        DrivePlaces.shared.load()
        prepare()
        isOn = true
        activity = a
        watch(a)
        startLocation()
    }

    private func save() {
        if let d = try? JSONEncoder().encode(opts) { UserDefaults.standard.set(d, forKey: "cf.drive.opts") }
    }

    private func startLocation() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        movedAt = Date(); movedFrom = nil
    }

    @available(iOS 18.0, *)
    private func startActivity() {
        // one Drive mode card at a time
        for a in Activity<DriveAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
        do {
            let a = try Activity.request(attributes: DriveAttributes(title: opts.title),
                                         content: ActivityContent(state: DriveState(), staleDate: Date().addingTimeInterval(600)),
                                         pushType: nil)
            activity = a
            watch(a)
        } catch {
            cfLog("drive: live activity failed \(error)")
        }
    }

    @available(iOS 18.0, *)
    private func watch(_ a: Activity<DriveAttributes>) {
        watchTask?.cancel()
        watchTask = Task { [weak self] in
            for await s in a.activityStateUpdates {
                if s == .dismissed || s == .ended {
                    await MainActor.run { self?.stop(reason: "The Drive mode card was closed") }
                    return
                }
            }
        }
    }

    // MARK: the planned route: places beside it, in the order you reach them
    private func prepare() {
        along = [:]; nights = []; routeHint = 0
        route = opts.route.count > 1 ? Route(opts.route.map { ($0[1], $0[0]) }) : nil
        guard let r = route else { return }
        let P = DrivePlaces.shared
        let corridor: [DrivePlaces.Category: Double] = [.camps: 3000, .fuel: 1200, .sights: 6000]
        for cat in DrivePlaces.Category.allCases {
            let list = P.list(cat)
            var out: [Ahead] = []
            for (i, p) in list.enumerated() where r.box(contains: p.lat, p.lon, pad: 0.07) {
                if let pr = r.project(p.lat, p.lon, maxOff: corridor[cat]!) { out.append(Ahead(index: i, along: pr.along, off: pr.off, name: p.name)) }
            }
            along[cat] = out.sorted { $0.along < $1.along }
        }
        nights = opts.nights.compactMap { n in r.project(n.lat, n.lon, maxOff: 20000).map { Ahead(index: -1, along: $0.along, off: $0.off, name: n.name) } }
    }

    // MARK: location
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if isOn, [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) { startLocation() }
    }
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) { if isOn { manager.startUpdatingLocation() } }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isOn, let loc = locations.last(where: { $0.horizontalAccuracy > 0 && $0.horizontalAccuracy < 200 }) else { return }
        if loc.course >= 0 && loc.speed > 3 { course = loc.course }
        lastLoc = loc
        // parked for 45 minutes (at camp for the night): Drive mode switches itself off to save battery
        if let f = movedFrom, loc.distance(from: f) < 300 {
            if Date().timeIntervalSince(movedAt) > 45 * 60 { stop(reason: "Parked for a while, so Drive mode switched off"); return }
        } else { movedFrom = loc; movedAt = Date() }
        compute(force: false)
    }

    // MARK: what's coming up
    private func compute(force: Bool) {
        guard isOn, let loc = lastLoc else { return }
        if !force && Date().timeIntervalSince(lastCompute) < 4 { return }
        lastCompute = Date()
        let P = DrivePlaces.shared
        var st = DriveState()
        var you: Double? = nil
        if let r = route, let pr = r.locate(loc.coordinate.latitude, loc.coordinate.longitude, hint: &routeHint), pr.off < 5000 { you = pr.along }

        if let you {
            st.onRoute = true
            func next(_ cat: DrivePlaces.Category, within: Double, prefer: ((DrivePlaces.Place) -> Bool)? = nil) -> (DrivePlaces.Place, Double)? {
                let list = P.list(cat)
                let ahead = (along[cat] ?? []).filter { $0.along > you + 150 && $0.along - you < within }
                if let prefer, let a = ahead.first(where: { prefer(list[$0.index]) }) { return (list[a.index], a.along - you + a.off) }
                return ahead.first.map { (list[$0.index], $0.along - you + $0.off) }
            }
            if let r = next(.camps, within: 120_000, prefer: opts.freeFirst ? { $0.kind == "f" || $0.kind == "s" } : nil) { st.camp = makeStop(.camp, r.0, r.1) }
            if let r = next(.fuel, within: 150_000) { st.fuel = makeStop(.fuel, r.0, r.1) }
            if let r = next(.sights, within: 150_000) { st.sight = makeStop(.sight, r.0, r.1) }
            if let n = nights.first(where: { $0.along > you - 300 }) {
                st.tonight = DriveStop(kind: .tonight, name: n.name, meters: max(0, n.along - you), label: "Tonight's camp", emoji: nil, lat: 0, lon: 0)
            }
        } else {
            // no planned route (or well off it): what's ahead in the direction you're driving
            let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
            func next(_ cat: DrivePlaces.Category, radius: Double, prefer: ((DrivePlaces.Place) -> Bool)? = nil) -> (DrivePlaces.Place, Double)? {
                let list = P.list(cat)
                let near = P.near(cat, lat: lat, lon: lon, radius: radius).filter { n in
                    guard course >= 0 else { return true }
                    let p = list[n.index]
                    return n.meters < 400 ? false : Geo.angle(Geo.bearing(lat, lon, p.lat, p.lon), course) < 40
                }
                if let prefer, let a = near.first(where: { prefer(list[$0.index]) }) { return (list[a.index], a.meters) }
                return near.first.map { (list[$0.index], $0.meters) }
            }
            if let r = next(.camps, radius: 60_000, prefer: opts.freeFirst ? { $0.kind == "f" || $0.kind == "s" } : nil) { st.camp = makeStop(.camp, r.0, r.1) }
            if let r = next(.fuel, radius: 60_000) { st.fuel = makeStop(.fuel, r.0, r.1) }
            if let r = next(.sights, radius: 100_000) { st.sight = makeStop(.sight, r.0, r.1) }
            if let n = opts.nights.first(where: { !alerted.contains("arrived:\($0.name)") }) {
                let m = Geo.meters(lat, lon, n.lat, n.lon)
                if m < 300 { mark("arrived:\(n.name)") }
                st.tonight = DriveStop(kind: .tonight, name: n.name, meters: m, label: "Tonight's camp", emoji: nil, lat: n.lat, lon: n.lon)
            }
        }
        checkAlerts(st, loc)
        push(st)
    }

    private func makeStop(_ kind: DriveStop.Kind, _ p: DrivePlaces.Place, _ m: Double) -> DriveStop {
        switch kind {
        case .camp: return DriveStop(kind: .camp, name: p.name, meters: m, label: DriveFormat.campLabel(p.kind), emoji: nil, lat: p.lat, lon: p.lon)
        case .fuel: return DriveStop(kind: .fuel, name: p.name, meters: m, label: DriveFormat.fuelLabel(p.kind), emoji: nil, lat: p.lat, lon: p.lon)
        default: return DriveStop(kind: .sight, name: p.name, meters: m, label: "Must-see", emoji: p.kind, lat: p.lat, lon: p.lon)
        }
    }

    // MARK: heads-ups (they pop up on the iPhone and at the bottom of the CarPlay screen)
    private func mark(_ key: String) {
        alerted.insert(key)
        UserDefaults.standard.set(Array(alerted), forKey: "cf.drive.alerted")
    }
    private var queuedAlert: (title: String, body: String)?

    private func checkAlerts(_ st: DriveState, _ loc: CLLocation) {
        guard Date().timeIntervalSince(lastAlert) > 90 else { return }
        if opts.sights, let s = st.sight, s.meters < 4000, !alerted.contains("sight:\(s.name)") {
            mark("sight:\(s.name)")
            let blurb = DrivePlaces.shared.sights.first(where: { $0.name == s.name })?.note ?? ""
            queuedAlert = ("Check out \(s.name)", "\(DriveFormat.distance(s.meters)) ahead\(blurb.isEmpty ? "" : " · \(blurb)")")
            return
        }
        if opts.fuel {
            for f in opts.lastFuel where !alerted.contains("fuel:\(f.lat),\(f.lon)") {
                if Geo.meters(loc.coordinate.latitude, loc.coordinate.longitude, f.lat, f.lon) < 3000 {
                    mark("fuel:\(f.lat),\(f.lon)")
                    queuedAlert = ("Last fuel for \(f.gapKm) km", "\(f.name) is the last fuel\(f.next.isEmpty ? "" : " before \(f.next)"). Top up here.")
                    return
                }
            }
        }
        if opts.camps, let t = st.tonight, t.meters < 5000, t.meters > 300, !alerted.contains("tonight:\(t.name)") {
            mark("tonight:\(t.name)")
            queuedAlert = ("Tonight's camp in \(DriveFormat.distance(t.meters))", t.name)
            return
        }
        // one nudge in the afternoon about a free camp coming up, when no camp is planned for tonight
        let hour = Calendar.current.component(.hour, from: Date())
        if opts.camps, st.tonight == nil, (15..<18).contains(hour), let c = st.camp, c.label == "Free camp", c.meters < 20000 {
            let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
            if !alerted.contains("afternoon:\(day)") {
                mark("afternoon:\(day)")
                queuedAlert = ("Free camp in \(DriveFormat.distance(c.meters))", "\(c.name). Worth a look before it gets dark.")
            }
        }
    }

    // MARK: Live Activity updates
    private func push(_ st: DriveState) {
        guard #available(iOS 18.0, *), let a = activity as? Activity<DriveAttributes> else { return }
        let alert = queuedAlert
        // only when something you can see changed, and not more than every 10 seconds (a minute at most between)
        let looks = { (s: DriveState?) -> String in
            guard let s else { return "" }
            return [s.camp, s.fuel, s.sight, s.tonight].map { $0.map { "\($0.name)|\(DriveFormat.distance($0.meters))" } ?? "-" }.joined(separator: "/")
        }
        let since = Date().timeIntervalSince(lastPush)
        guard alert != nil || (looks(st) != looks(pushed) && since > 10) || since > 60 else { return }
        var s = st
        s.updated = Date()
        pushed = s
        lastPush = Date()
        queuedAlert = nil
        let content = ActivityContent(state: s, staleDate: Date().addingTimeInterval(600))
        if alert != nil { lastAlert = Date() }
        Task {
            if let alert {
                await a.update(content, alertConfiguration: AlertConfiguration(title: "\(alert.title)", body: "\(alert.body)", sound: .default))
            } else {
                await a.update(content)
            }
        }
    }
}

/// A planned route as a line you can measure along.
struct Route {
    let lat: [Double], lon: [Double], cum: [Double]
    let s: Double, w: Double, n: Double, e: Double
    private var grid: [Int: [Int]] = [:]   // 0.1° cells -> segments
    private static let cell = 0.1

    init(_ pts: [(Double, Double)]) {
        lat = pts.map { $0.0 }; lon = pts.map { $0.1 }
        var c = [0.0]
        for i in 1..<pts.count { c.append(c[i - 1] + Geo.meters(lat[i - 1], lon[i - 1], lat[i], lon[i])) }
        cum = c
        s = lat.min() ?? 0; n = lat.max() ?? 0; w = lon.min() ?? 0; e = lon.max() ?? 0
        for i in 0..<(pts.count - 1) {
            let a0 = Int(floor((min(lat[i], lat[i + 1]) - 0.07) / Self.cell)), a1 = Int(floor((max(lat[i], lat[i + 1]) + 0.07) / Self.cell))
            let o0 = Int(floor((min(lon[i], lon[i + 1]) - 0.07) / Self.cell)), o1 = Int(floor((max(lon[i], lon[i + 1]) + 0.07) / Self.cell))
            for a in a0...a1 { for o in o0...o1 { grid[a * 100_000 + o, default: []].append(i) } }
        }
    }

    func box(contains la: Double, _ lo: Double, pad: Double) -> Bool { la >= s - pad && la <= n + pad && lo >= w - pad && lo <= e + pad }

    /// Distance from a point to segment i, and how far along the route the closest point is
    private func onSegment(_ i: Int, _ la: Double, _ lo: Double) -> (along: Double, off: Double) {
        let kx = 111_320 * cos(la * .pi / 180), ky = 110_540.0
        let ax = (lon[i] - lo) * kx, ay = (lat[i] - la) * ky
        let bx = (lon[i + 1] - lo) * kx, by = (lat[i + 1] - la) * ky
        let dx = bx - ax, dy = by - ay
        let len2 = dx * dx + dy * dy
        let t = len2 > 0 ? max(0, min(1, -(ax * dx + ay * dy) / len2)) : 0
        let px = ax + t * dx, py = ay + t * dy
        return (cum[i] + t * (cum[i + 1] - cum[i]), (px * px + py * py).squareRoot())
    }

    /// Where a place sits along the route, if it's within maxOff metres of it (the first pass if the route passes twice)
    func project(_ la: Double, _ lo: Double, maxOff: Double) -> (along: Double, off: Double)? {
        let k = Int(floor(la / Self.cell)) * 100_000 + Int(floor(lo / Self.cell))
        var best: (along: Double, off: Double)? = nil
        for i in grid[k] ?? [] {
            let r = onSegment(i, la, lo)
            guard r.off <= maxOff else { continue }
            if best == nil || r.off < best!.off - 50 || (abs(r.off - best!.off) <= 50 && r.along < best!.along) { best = r }
        }
        return best
    }

    /// Where you are along the route. Looks just ahead of the last position first, so a return trip on the same road counts the right way.
    func locate(_ la: Double, _ lo: Double, hint: inout Int) -> (along: Double, off: Double)? {
        let k = Int(floor(la / Self.cell)) * 100_000 + Int(floor(lo / Self.cell))
        let segs = grid[k] ?? []
        guard !segs.isEmpty else { return nil }
        var best: (i: Int, along: Double, off: Double, score: Double)? = nil
        for i in segs {
            let r = onSegment(i, la, lo)
            // prefer segments at or just after where you were; never jump far backwards
            let score = r.off + (i < hint - 3 ? 3000.0 : 0)
            if best == nil || score < best!.score { best = (i, r.along, r.off, score) }
        }
        guard let b = best else { return nil }
        hint = max(hint, b.i)
        return (b.along, b.off)
    }
}
