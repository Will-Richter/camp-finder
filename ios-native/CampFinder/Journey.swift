import Foundation
import CoreLocation
import UserNotifications
import UIKit

/// Records a journey in the background with low battery use, keeps a shared live-location link
/// up to date, and sends a "good free camp nearby" alert in the afternoon.
final class JourneyRecorder: NSObject, CLLocationManagerDelegate {
    static let shared = JourneyRecorder()

    private let manager = CLLocationManager()
    private(set) var journeyId: String?
    private var lastSaved: CLLocation?
    private var lastShared = Date.distantPast
    private var share: [String: String]?          // url, key, id, secret (Supabase trip_shares)
    private var campAlerts: [[String: Any]] = []  // name, lat, lon, why
    private var alertedDay = ""
    private var fuelAlerts: [[String: Any]] = []  // name, lat, lon, gapKm, next: last fuel before a long stretch
    private var fuelDone = Set<String>()

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters  // GPS isn't needed for a trip log
        manager.distanceFilter = 150
        manager.pausesLocationUpdatesAutomatically = true
        if let id = UserDefaults.standard.string(forKey: "cf.journey.id") {
            journeyId = id
            share = UserDefaults.standard.dictionary(forKey: "cf.journey.share") as? [String: String]
            campAlerts = (UserDefaults.standard.array(forKey: "cf.journey.alerts") as? [[String: Any]]) ?? []
            fuelAlerts = (UserDefaults.standard.array(forKey: "cf.journey.fuel") as? [[String: Any]]) ?? []
            fuelDone = Set((UserDefaults.standard.array(forKey: "cf.journey.fuelDone") as? [String]) ?? [])
            start(resume: true)
        }
    }

    private var folder: URL {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("journeys", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }
    private func file(_ id: String) -> URL { folder.appendingPathComponent("\(id).csv") }

    // MARK: commands from the web app
    func handle(_ body: [String: Any]) -> Any? {
        switch body["cmd"] as? String {
        case "start":
            guard let id = body["id"] as? String else { return nil }
            journeyId = id
            share = body["share"] as? [String: String]
            campAlerts = (body["camps"] as? [[String: Any]]) ?? []
            fuelAlerts = (body["fuel"] as? [[String: Any]]) ?? []
            fuelDone = []
            UserDefaults.standard.set(fuelAlerts, forKey: "cf.journey.fuel")
            UserDefaults.standard.set([String](), forKey: "cf.journey.fuelDone")
            UserDefaults.standard.set(id, forKey: "cf.journey.id")
            UserDefaults.standard.set(share, forKey: "cf.journey.share")
            UserDefaults.standard.set(campAlerts, forKey: "cf.journey.alerts")
            if (body["notify"] as? Bool) ?? false {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
            }
            start(resume: false)
            return true
        case "share":
            share = body["share"] as? [String: String]
            UserDefaults.standard.set(share, forKey: "cf.journey.share")
            return true
        case "stop":
            manager.stopUpdatingLocation()
            manager.allowsBackgroundLocationUpdates = false
            journeyId = nil; share = nil; campAlerts = []; fuelAlerts = []; fuelDone = []
            for k in ["cf.journey.id", "cf.journey.share", "cf.journey.alerts", "cf.journey.fuel", "cf.journey.fuelDone"] { UserDefaults.standard.removeObject(forKey: k) }
            return true
        case "points":
            guard let id = body["id"] as? String, let text = try? String(contentsOf: file(id), encoding: .utf8) else { return [] }
            let from = (body["from"] as? Int) ?? 0
            let rows = text.split(separator: "\n")
            return rows.dropFirst(min(from, rows.count)).compactMap { line -> [Double]? in
                let p = line.split(separator: ",").compactMap { Double($0) }
                return p.count == 3 ? p : nil
            }
        case "status":
            return ["active": journeyId != nil, "id": journeyId ?? ""]
        default:
            return nil
        }
    }

    private func start(resume: Bool) {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: return
        default: break
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if journeyId != nil, [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) {
            manager.allowsBackgroundLocationUpdates = true
            manager.startUpdatingLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let id = journeyId else { return }
        for loc in locations where loc.horizontalAccuracy > 0 && loc.horizontalAccuracy < 500 {
            if let last = lastSaved, loc.distance(from: last) < 120 { continue }
            lastSaved = loc
            let line = String(format: "%.0f,%.5f,%.5f\n", loc.timestamp.timeIntervalSince1970, loc.coordinate.latitude, loc.coordinate.longitude)
            if let h = try? FileHandle(forWritingTo: file(id)) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
            else { try? line.write(to: file(id), atomically: true, encoding: .utf8) }
        }
        guard let loc = locations.last else { return }
        if Date().timeIntervalSince(lastShared) > 300 { lastShared = Date(); pushShare(loc) }
        checkCampAlert(loc)
        checkFuelAlert(loc)
    }

    // "Last fuel for 280 km": a heads-up as you reach the last servo before a long stretch.
    // The app shows its own banner when it's open, so this only fires in the background.
    private func checkFuelAlert(_ loc: CLLocation) {
        guard !fuelAlerts.isEmpty else { return }
        for f in fuelAlerts {
            guard let lat = f["lat"] as? Double, let lon = f["lon"] as? Double else { continue }
            let key = String(format: "%.4f,%.4f", lat, lon)
            guard !fuelDone.contains(key), loc.distance(from: CLLocation(latitude: lat, longitude: lon)) < 3000 else { continue }
            fuelDone.insert(key)
            UserDefaults.standard.set(Array(fuelDone), forKey: "cf.journey.fuelDone")
            DispatchQueue.main.async {
                guard UIApplication.shared.applicationState != .active else { return }
                let gap = (f["gapKm"] as? Int) ?? Int((f["gapKm"] as? Double) ?? 0)
                let content = UNMutableNotificationContent()
                content.title = "⛽ Last fuel for \(gap) km"
                let next = (f["next"] as? String) ?? ""
                content.body = "\((f["name"] as? String) ?? "This servo") is the last fuel\(next.isEmpty ? "" : " before \(next)"). Top up here."
                content.sound = .default
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "fuel-\(key)", content: content, trigger: nil))
            }
            return
        }
    }

    // Live location for family: Supabase RPC update_share
    private func pushShare(_ loc: CLLocation) {
        guard let s = share, let base = s["url"], let key = s["key"], let id = s["id"], let secret = s["secret"],
              let url = URL(string: "\(base)/rest/v1/rpc/update_share") else { return }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["p_id": id, "p_secret": secret, "p_lat": loc.coordinate.latitude, "p_lon": loc.coordinate.longitude,
                                   "p_speed": max(0, loc.speed), "p_heading": max(0, loc.course), "p_tonight": NSNull(), "p_ended": false]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }

    // Between 3 and 5 pm, one nudge a day about a well-rated free camp ahead
    private func checkCampAlert(_ loc: CLLocation) {
        let cal = Calendar.current, hour = cal.component(.hour, from: Date())
        guard hour >= 15 && hour < 17, !campAlerts.isEmpty else { return }
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        guard day != alertedDay else { return }
        let near = campAlerts.compactMap { c -> (String, String, Double)? in
            guard let lat = c["lat"] as? Double, let lon = c["lon"] as? Double, let name = c["name"] as? String else { return nil }
            let d = loc.distance(from: CLLocation(latitude: lat, longitude: lon))
            return d < 30000 ? (name, (c["why"] as? String) ?? "Free camp", d) : nil
        }.min { $0.2 < $1.2 }
        guard let n = near else { return }
        alertedDay = day
        let content = UNMutableNotificationContent()
        content.title = "Free camp \(Int(n.2 / 1000)) km away"
        content.body = "\(n.0): \(n.1). Worth a look before it gets dark."
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "camp-\(day)", content: content, trigger: nil))
    }
}
