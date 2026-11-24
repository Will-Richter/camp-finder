import Foundation
import CoreLocation
import UIKit
import ActivityKit

/// Drive mode: while you drive, the next camp, servo and must-see ahead show on the Lock Screen, in the
/// Dynamic Island and on the CarPlay Dashboard (a Live Activity), with a heads-up ("Check out ...") as you
/// get close to a must-see, tonight's camp, a good free camp in the afternoon, or the last fuel before a long gap.
/// Live Activities and their alerts show in CarPlay for any app, so this needs no CarPlay approval from Apple.
/// What's coming up is worked out by DriveEngine (Shared/DriveEngine.swift); this class runs location and the card.
final class DriveMode: NSObject, CLLocationManagerDelegate {
    static let shared = DriveMode()

    /// Events for the web page (state changes, links opened from the widget or Live Activity)
    var send: (([String: Any]) -> Void)?
    private(set) var isOn = false
    private var pendingOpen: [String: Any]?

    private let manager = CLLocationManager()
    private var engine: DriveEngine?
    private var lastLoc: CLLocation?
    private var lastCompute = Date.distantPast
    private var lastPush = Date.distantPast
    private var pushed: DriveState?
    private var queuedAlert: DriveEngine.Alert?
    private var movedAt = Date()
    private var movedFrom: CLLocation?
    private var activity: Any?          // Activity<DriveAttributes>, iOS 18+
    private var watchTask: Task<Void, Never>?

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
            return start(Self.options(from: body))
        case "update":
            guard isOn, engine != nil else { return status() }
            engine?.update(Self.options(from: body))
            save()
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

    private static func options(from body: [String: Any]) -> DriveEngine.Options {
        var o = DriveEngine.Options()
        func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
        if let t = body["title"] as? String, !t.isEmpty { o.title = String(t.prefix(60)) }
        o.route = ((body["route"] as? [[Any]]) ?? []).compactMap { p in
            guard p.count >= 2, let lo = num(p[0]), let la = num(p[1]) else { return nil }
            return [lo, la]
        }
        o.nights = ((body["nights"] as? [[String: Any]]) ?? []).compactMap { n in
            guard let la = num(n["lat"]), let lo = num(n["lon"]) else { return nil }
            return DriveEngine.Spot(name: (n["name"] as? String) ?? "Tonight's camp", lat: la, lon: lo)
        }
        o.lastFuel = ((body["lastFuel"] as? [[String: Any]]) ?? []).compactMap { f in
            guard let la = num(f["lat"]), let lo = num(f["lon"]) else { return nil }
            return DriveEngine.FuelGap(name: (f["name"] as? String) ?? "This servo", lat: la, lon: lo,
                                       gapKm: Int(num(f["gapKm"]) ?? 0), next: (f["next"] as? String) ?? "")
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
    private func start(_ o: DriveEngine.Options) -> [String: Any] {
        guard #available(iOS 18.0, *) else { return ["error": "Drive mode needs iOS 18 or later."] }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return ["error": "Live Activities are off for Camp Finder. Turn them on in Settings → Camp Finder → Live Activities."]
        }
        switch manager.authorizationStatus {
        case .denied, .restricted: return ["error": "Location is off for Camp Finder. Turn it on in Settings → Camp Finder → Location."]
        case .notDetermined: manager.requestWhenInUseAuthorization()
        default: break
        }
        DrivePlaces.shared.load()
        let kept = isOn ? (engine?.alerted ?? []) : Set(UserDefaults.standard.stringArray(forKey: "cf.drive.alerted") ?? [])
        engine = DriveEngine(places: DrivePlaces.shared, opts: o, alerted: kept)
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
        engine = nil
        UserDefaults.standard.removeObject(forKey: "cf.drive.opts")
        UserDefaults.standard.removeObject(forKey: "cf.drive.alerted")
        send?(["type": "state", "on": false, "reason": reason])
    }

    /// After iOS closed the app: pick up the Drive mode card if it's still showing
    func resume() {
        guard #available(iOS 18.0, *), !isOn,
              let data = UserDefaults.standard.data(forKey: "cf.drive.opts"),
              let o = try? JSONDecoder().decode(DriveEngine.Options.self, from: data) else { return }
        guard let a = Activity<DriveAttributes>.activities.first(where: { $0.activityState == .active }) else {
            UserDefaults.standard.removeObject(forKey: "cf.drive.opts"); return
        }
        DrivePlaces.shared.load()
        engine = DriveEngine(places: DrivePlaces.shared, opts: o, alerted: Set(UserDefaults.standard.stringArray(forKey: "cf.drive.alerted") ?? []))
        isOn = true
        activity = a
        watch(a)
        startLocation()
    }

    private func save() {
        guard let e = engine else { return }
        if let d = try? JSONEncoder().encode(e.opts) { UserDefaults.standard.set(d, forKey: "cf.drive.opts") }
        UserDefaults.standard.set(Array(e.alerted), forKey: "cf.drive.alerted")
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
            let a = try Activity.request(attributes: DriveAttributes(title: engine?.opts.title ?? "Drive mode"),
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

    // MARK: location
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if isOn, [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) { startLocation() }
    }
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) { if isOn { manager.startUpdatingLocation() } }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isOn, let loc = locations.last(where: { $0.horizontalAccuracy > 0 && $0.horizontalAccuracy < 200 }) else { return }
        if loc.course >= 0 && loc.speed > 3 { engine?.course = loc.course }
        lastLoc = loc
        // parked for 45 minutes (at camp for the night): Drive mode switches itself off to save battery
        if let f = movedFrom, loc.distance(from: f) < 300 {
            if Date().timeIntervalSince(movedAt) > 45 * 60 { stop(reason: "Parked for a while, so Drive mode switched off"); return }
        } else { movedFrom = loc; movedAt = Date() }
        compute(force: false)
    }

    // MARK: what's coming up, and the card
    private func compute(force: Bool) {
        guard isOn, engine != nil, let loc = lastLoc else { return }
        if !force && Date().timeIntervalSince(lastCompute) < 4 { return }
        lastCompute = Date()
        let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
        guard let st = engine?.state(lat: lat, lon: lon) else { return }
        if let a = engine?.alert(for: st, lat: lat, lon: lon) {
            queuedAlert = a
            UserDefaults.standard.set(Array(engine?.alerted ?? []), forKey: "cf.drive.alerted")
        }
        push(st)
    }

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
        Task {
            if let alert {
                await a.update(content, alertConfiguration: AlertConfiguration(title: "\(alert.title)", body: "\(alert.body)", sound: .default))
            } else {
                await a.update(content)
            }
        }
    }
}
