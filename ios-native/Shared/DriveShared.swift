import Foundation
import CoreLocation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

// Shared by the app (Drive mode) and the widget extension (Live Activity and Nearby widget).

/// One thing coming up on the road.
struct DriveStop: Codable, Hashable {
    enum Kind: String, Codable { case camp, fuel, sight, tonight }
    var kind: Kind
    var name: String
    var meters: Double      // along the planned route when there is one, otherwise straight line
    var label: String       // "Free camp", "Diesel · 24 hr", "Must-see"
    var emoji: String?      // must-sees have their own
    var lat: Double
    var lon: Double
}

/// What the Lock Screen, Dynamic Island and CarPlay show while Drive mode is on.
struct DriveState: Codable, Hashable {
    var camp: DriveStop?
    var fuel: DriveStop?
    var sight: DriveStop?
    var tonight: DriveStop?
    var onRoute: Bool = false
    var updated: Date = Date()

    var isEmpty: Bool { camp == nil && fuel == nil && sight == nil && tonight == nil }
}

#if canImport(ActivityKit) && os(iOS)
struct DriveAttributes: ActivityAttributes {
    typealias ContentState = DriveState
    var title: String   // "Bundaberg to Cairns", or "Drive mode" without a planned trip
}
#endif

enum DriveFormat {
    /// 800 m, 4.2 km, 37 km
    static func distance(_ m: Double) -> String {
        if m < 950 { return "\(max(100, Int((m / 100).rounded()) * 100)) m" }
        if m < 9950 { return String(format: "%.1f km", m / 1000) }
        return "\(Int((m / 1000).rounded())) km"
    }
    /// Just the number for tight spots (Dynamic Island): 800m, 4.2, 37
    static func short(_ m: Double) -> String {
        if m < 950 { return "\(max(100, Int((m / 100).rounded()) * 100))m" }
        if m < 9950 { return String(format: "%.1f", m / 1000) }
        return "\(Int((m / 1000).rounded()))"
    }
    static func campLabel(_ kind: String) -> String {
        switch kind {
        case "f": return "Free camp"
        case "s": return "Rest area"
        case "c": return "Caravan park"
        case "p": return "Paid camp"
        case "r": return "RV stop"
        default: return "Camp"
        }
    }
    static func fuelLabel(_ flags: String) -> String {
        var bits: [String] = []
        if flags.contains("D") { bits.append("Diesel") }
        if flags.contains("L") { bits.append("LPG") }
        if flags.contains("A") { bits.append("AdBlue") }
        if flags.contains("2") { bits.append("24 hr") }
        return bits.isEmpty ? "Fuel" : bits.prefix(2).joined(separator: " · ")
    }
}

/// The bundled place list (drive-places.json, built by tools/build_drive_places.py from the camp database).
final class DrivePlaces {
    struct Place {
        let lat: Double
        let lon: Double
        let name: String
        let kind: String    // camps: f s c p r u; fuel: flags; sights: emoji
        let note: String    // camps: amenities; sights: blurb
        let rank: Int       // sights: 1 to 3
    }
    enum Category: String, CaseIterable { case camps, fuel, sights }

    static let shared = DrivePlaces()
    private(set) var camps: [Place] = []
    private(set) var fuel: [Place] = []
    private(set) var sights: [Place] = []
    private(set) var built = ""
    private static let cell = 0.25
    private var grids: [Category: [Int: [Int]]] = [:]
    private let lock = NSLock()
    private var loaded = false

    /// Reads drive-places.json from the app (or widget) bundle, or from a file in tests
    func load(from file: URL? = nil) {
        lock.lock(); defer { lock.unlock() }
        guard !loaded else { return }
        loaded = true
        guard let url = file ?? Bundle.main.url(forResource: "drive-places", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        built = root["built"] as? String ?? ""
        func rows(_ key: String) -> [[Any]] { root[key] as? [[Any]] ?? [] }
        func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }
        camps = rows("camps").compactMap { r in r.count >= 4 ? Place(lat: num(r[0]), lon: num(r[1]), name: r[2] as? String ?? "Camp", kind: r[3] as? String ?? "u", note: r.count > 4 ? (r[4] as? String ?? "") : "", rank: 0) : nil }
        fuel = rows("fuel").compactMap { r in r.count >= 3 ? Place(lat: num(r[0]), lon: num(r[1]), name: r[2] as? String ?? "Fuel", kind: r.count > 3 ? (r[3] as? String ?? "") : "", note: "", rank: 0) : nil }
        sights = rows("sights").compactMap { r in r.count >= 6 ? Place(lat: num(r[0]), lon: num(r[1]), name: r[2] as? String ?? "", kind: r[3] as? String ?? "⭐️", note: r[4] as? String ?? "", rank: Int(num(r[5]))) : nil }
        for (cat, list) in [(Category.camps, camps), (.fuel, fuel), (.sights, sights)] {
            var g: [Int: [Int]] = [:]
            for (i, p) in list.enumerated() { g[Self.key(p.lat, p.lon), default: []].append(i) }
            grids[cat] = g
        }
    }

    func list(_ c: Category) -> [Place] { c == .camps ? camps : c == .fuel ? fuel : sights }

    private static func key(_ lat: Double, _ lon: Double) -> Int {
        Int(floor(lat / cell)) * 10_000 + Int(floor(lon / cell))
    }

    /// Indexes of places within `radius` metres (rough box first, exact distance after).
    func near(_ c: Category, lat: Double, lon: Double, radius: Double) -> [(index: Int, meters: Double)] {
        load()
        guard let g = grids[c] else { return [] }
        let list = self.list(c)
        let dLat = radius / 111_000, dLon = radius / (111_000 * max(0.2, cos(lat * .pi / 180)))
        var out: [(Int, Double)] = []
        let a0 = Int(floor((lat - dLat) / Self.cell)), a1 = Int(floor((lat + dLat) / Self.cell))
        let o0 = Int(floor((lon - dLon) / Self.cell)), o1 = Int(floor((lon + dLon) / Self.cell))
        for a in a0...a1 { for o in o0...o1 {
            for i in g[a * 10_000 + o] ?? [] {
                let p = list[i]
                guard abs(p.lat - lat) <= dLat, abs(p.lon - lon) <= dLon else { continue }
                let m = Geo.meters(lat, lon, p.lat, p.lon)
                if m <= radius { out.append((i, m)) }
            }
        } }
        return out.sorted { $0.1 < $1.1 }
    }
}

enum Geo {
    static func meters(_ la1: Double, _ lo1: Double, _ la2: Double, _ lo2: Double) -> Double {
        let r = 6_371_000.0, p1 = la1 * .pi / 180, p2 = la2 * .pi / 180
        let dp = (la2 - la1) * .pi / 180, dl = (lo2 - lo1) * .pi / 180
        let h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * asin(min(1, sqrt(h)))
    }
    /// Compass bearing from one point to another, 0 to 360
    static func bearing(_ la1: Double, _ lo1: Double, _ la2: Double, _ lo2: Double) -> Double {
        let p1 = la1 * .pi / 180, p2 = la2 * .pi / 180, dl = (lo2 - lo1) * .pi / 180
        let y = sin(dl) * cos(p2), x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
    static func angle(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return d > 180 ? 360 - d : d
    }
}
