import Foundation

/// Works out what's coming up for Drive mode: the next camp, servo and must-see ahead, tonight's camp,
/// and when to give a heads-up. Plain Swift (no location or UI frameworks) so tools/DriveEngineTest.swift
/// can drive it along a route in CI.
struct DriveEngine {
    struct Options: Codable {
        var title = "Drive mode"
        var route: [[Double]] = []      // [lon, lat], the planned route
        var nights: [Spot] = []         // planned camps, in order
        var lastFuel: [FuelGap] = []    // the last servo before a long gap
        var sights = true               // heads-ups
        var camps = true
        var fuel = true
        var freeFirst = true            // the next free camp or rest area rather than the next caravan park
    }
    struct Spot: Codable { var name: String; var lat: Double; var lon: Double }
    struct FuelGap: Codable { var name: String; var lat: Double; var lon: Double; var gapKm: Int; var next: String }
    struct Ahead { var index: Int; var along: Double; var off: Double; var name: String }
    struct Alert: Equatable { var title: String; var body: String }

    let places: DrivePlaces
    private(set) var opts: Options
    private(set) var route: Route?
    private var along: [DrivePlaces.Category: [Ahead]] = [:]
    private var nights: [Ahead] = []
    private var hint = 0
    /// Direction of travel in degrees (-1 until you're moving)
    var course: Double = -1
    /// Heads-ups already given on this drive (kept across app restarts)
    var alerted = Set<String>()
    var lastAlert = Date.distantPast

    init(places: DrivePlaces, opts: Options, alerted: Set<String> = []) {
        self.places = places
        self.opts = opts
        self.alerted = alerted
        prepare()
    }

    mutating func update(_ o: Options) { opts = o; prepare() }

    /// Places beside the planned route, in the order you reach them
    private mutating func prepare() {
        along = [:]; nights = []; hint = 0
        route = opts.route.count > 1 ? Route(opts.route.map { ($0[1], $0[0]) }) : nil
        guard let r = route else { return }
        let corridor: [DrivePlaces.Category: Double] = [.camps: 3000, .fuel: 1200, .sights: 6000]
        for cat in DrivePlaces.Category.allCases {
            var out: [Ahead] = []
            for (i, p) in places.list(cat).enumerated() where r.box(contains: p.lat, p.lon, pad: 0.07) {
                if let pr = r.project(p.lat, p.lon, maxOff: corridor[cat]!) { out.append(Ahead(index: i, along: pr.along, off: pr.off, name: p.name)) }
            }
            along[cat] = out.sorted { $0.along < $1.along }
        }
        nights = opts.nights.compactMap { n in r.project(n.lat, n.lon, maxOff: 20000).map { Ahead(index: -1, along: $0.along, off: $0.off, name: n.name) } }
    }

    private func isFree(_ p: DrivePlaces.Place) -> Bool { p.kind == "f" || p.kind == "s" }

    /// What's coming up from here
    mutating func state(lat: Double, lon: Double) -> DriveState {
        var st = DriveState()
        var you: Double? = nil
        if let r = route, let pr = r.locate(lat, lon, hint: &hint), pr.off < 5000 { you = pr.along }

        if let you {
            st.onRoute = true
            func next(_ cat: DrivePlaces.Category, within: Double, freeFirst: Bool = false) -> (DrivePlaces.Place, Double)? {
                let list = places.list(cat)
                let ahead = (along[cat] ?? []).filter { $0.along > you + 150 && $0.along - you < within }
                if freeFirst, let a = ahead.first(where: { isFree(list[$0.index]) }) { return (list[a.index], a.along - you + a.off) }
                return ahead.first.map { (list[$0.index], $0.along - you + $0.off) }
            }
            if let r = next(.camps, within: 120_000, freeFirst: opts.freeFirst) { st.camp = stop(.camp, r.0, r.1) }
            if let r = next(.fuel, within: 150_000) { st.fuel = stop(.fuel, r.0, r.1) }
            if let r = next(.sights, within: 150_000) { st.sight = stop(.sight, r.0, r.1) }
            if let n = nights.first(where: { $0.along > you - 300 }) {
                st.tonight = DriveStop(kind: .tonight, name: n.name, meters: max(0, n.along - you), label: "Tonight's camp", emoji: nil, lat: 0, lon: 0)
            }
        } else {
            // no planned route, or well off it: what's ahead in the direction you're driving
            func next(_ cat: DrivePlaces.Category, radius: Double, freeFirst: Bool = false) -> (DrivePlaces.Place, Double)? {
                let list = places.list(cat)
                let near = places.near(cat, lat: lat, lon: lon, radius: radius).filter { n in
                    guard course >= 0 else { return true }
                    let p = list[n.index]
                    return n.meters >= 400 && Geo.angle(Geo.bearing(lat, lon, p.lat, p.lon), course) < 40
                }
                if freeFirst, let a = near.first(where: { isFree(list[$0.index]) }) { return (list[a.index], a.meters) }
                return near.first.map { (list[$0.index], $0.meters) }
            }
            if let r = next(.camps, radius: 60_000, freeFirst: opts.freeFirst) { st.camp = stop(.camp, r.0, r.1) }
            if let r = next(.fuel, radius: 60_000) { st.fuel = stop(.fuel, r.0, r.1) }
            if let r = next(.sights, radius: 100_000) { st.sight = stop(.sight, r.0, r.1) }
            if let n = opts.nights.first(where: { !alerted.contains("arrived:\($0.name)") }) {
                let m = Geo.meters(lat, lon, n.lat, n.lon)
                if m < 300 { alerted.insert("arrived:\(n.name)") }
                st.tonight = DriveStop(kind: .tonight, name: n.name, meters: m, label: "Tonight's camp", emoji: nil, lat: n.lat, lon: n.lon)
            }
        }
        return st
    }

    private func stop(_ kind: DriveStop.Kind, _ p: DrivePlaces.Place, _ m: Double) -> DriveStop {
        switch kind {
        case .camp: return DriveStop(kind: .camp, name: p.name, meters: m, label: DriveFormat.campLabel(p.kind), emoji: nil, lat: p.lat, lon: p.lon)
        case .fuel: return DriveStop(kind: .fuel, name: p.name, meters: m, label: DriveFormat.fuelLabel(p.kind), emoji: nil, lat: p.lat, lon: p.lon)
        default: return DriveStop(kind: .sight, name: p.name, meters: m, label: "Must-see", emoji: p.kind, lat: p.lat, lon: p.lon)
        }
    }

    /// A heads-up to show now, if any (one at a time, at least 90 seconds apart, each only once per drive)
    mutating func alert(for st: DriveState, lat: Double, lon: Double, now: Date = Date()) -> Alert? {
        guard now.timeIntervalSince(lastAlert) > 90 else { return nil }
        var out: Alert? = nil
        if opts.sights, let s = st.sight, s.meters < 4000, !alerted.contains("sight:\(s.name)") {
            alerted.insert("sight:\(s.name)")
            let blurb = places.sights.first(where: { $0.name == s.name })?.note ?? ""
            out = Alert(title: "Check out \(s.name)", body: "\(DriveFormat.distance(s.meters)) ahead\(blurb.isEmpty ? "" : " · \(blurb)")")
        }
        if out == nil, opts.fuel {
            for f in opts.lastFuel where !alerted.contains("fuel:\(f.lat),\(f.lon)") && Geo.meters(lat, lon, f.lat, f.lon) < 3000 {
                alerted.insert("fuel:\(f.lat),\(f.lon)")
                out = Alert(title: "Last fuel for \(f.gapKm) km", body: "\(f.name) is the last fuel\(f.next.isEmpty ? "" : " before \(f.next)"). Top up here.")
                break
            }
        }
        if out == nil, opts.camps, let t = st.tonight, t.meters < 5000, t.meters > 300, !alerted.contains("tonight:\(t.name)") {
            alerted.insert("tonight:\(t.name)")
            out = Alert(title: "Tonight's camp in \(DriveFormat.distance(t.meters))", body: t.name)
        }
        // one nudge in the afternoon about a free camp coming up, when no camp is planned for tonight
        if out == nil, opts.camps, st.tonight == nil, let c = st.camp, c.label == "Free camp", c.meters < 20000,
           (15..<18).contains(Calendar.current.component(.hour, from: now)) {
            let day = ISO8601DateFormatter.string(from: now, timeZone: .current, formatOptions: [.withFullDate])
            if !alerted.contains("afternoon:\(day)") {
                alerted.insert("afternoon:\(day)")
                out = Alert(title: "Free camp in \(DriveFormat.distance(c.meters))", body: "\(c.name). Worth a look before it gets dark.")
            }
        }
        if out != nil { lastAlert = now }
        return out
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
            // a segment goes in every cell it passes near (long straight segments cross many cells)
            let a0 = Int(floor((min(lat[i], lat[i + 1]) - 0.07) / Self.cell)), a1 = Int(floor((max(lat[i], lat[i + 1]) + 0.07) / Self.cell))
            let o0 = Int(floor((min(lon[i], lon[i + 1]) - 0.07) / Self.cell)), o1 = Int(floor((max(lon[i], lon[i + 1]) + 0.07) / Self.cell))
            for a in a0...a1 { for o in o0...o1 { grid[a * 100_000 + o, default: []].append(i) } }
        }
    }

    var total: Double { cum.last ?? 0 }

    func box(contains la: Double, _ lo: Double, pad: Double) -> Bool { la >= s - pad && la <= n + pad && lo >= w - pad && lo <= e + pad }

    /// Distance from a point to segment i, and how far along the route its closest point is
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

    /// Where you are along the route. Prefers segments at or after where you were last, so a return trip
    /// on the same road counts the right way and you never jump backwards.
    func locate(_ la: Double, _ lo: Double, hint: inout Int) -> (along: Double, off: Double)? {
        let k = Int(floor(la / Self.cell)) * 100_000 + Int(floor(lo / Self.cell))
        var best: (i: Int, along: Double, off: Double, score: Double)? = nil
        for i in grid[k] ?? [] {
            let r = onSegment(i, la, lo)
            let score = r.off + (i < hint - 3 ? 3000.0 : 0)
            if best == nil || score < best!.score { best = (i, r.along, r.off, score) }
        }
        guard let b = best else { return nil }
        hint = max(hint, b.i)
        return (b.along, b.off)
    }
}
