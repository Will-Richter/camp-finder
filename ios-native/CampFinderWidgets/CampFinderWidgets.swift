import WidgetKit
import SwiftUI
import ActivityKit
import AppIntents
import CoreLocation

@main
struct CampFinderWidgets: WidgetBundle {
    var body: some Widget {
        NearbyWidget()
        DriveLiveActivity()
    }
}

// MARK: - Drive mode Live Activity (Lock Screen, Dynamic Island, CarPlay Dashboard, Apple Watch)

struct DriveLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DriveAttributes.self) { context in
            DriveActivityView(context: context)
                .activityBackgroundTint(Brand.sign)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "campfinder://drive"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.tonight.map { "Tonight: \($0.name)" } ?? context.attributes.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    DriveIslandExpandedBottom(state: context.state).padding(.top, 2)
                }
            } compactLeading: {
                DriveIslandTag(stop: context.state.camp, kind: .camp)
            } compactTrailing: {
                DriveIslandTag(stop: context.state.fuel, kind: .fuel)
            } minimal: {
                Image(systemName: "tent.fill").foregroundStyle(Brand.free)
            }
            .widgetURL(URL(string: "campfinder://drive"))
            .keylineTint(Brand.free)
        }
        .supplementalActivityFamilies([.small])
    }
}

struct DriveActivityView: View {
    @Environment(\.activityFamily) private var family
    let context: ActivityViewContext<DriveAttributes>
    var body: some View {
        Group {
            switch family {
            case .small:
                DriveSmallView(state: context.state).padding(10)
            default:
                DriveLockScreenView(title: context.attributes.title, state: context.state)
            }
        }
        .opacity(context.isStale ? 0.6 : 1)
    }
}

// MARK: - Nearby widget: the closest camps, fuel or must-sees, with buttons to switch (works in CarPlay too)

struct NearbyEntry: TimelineEntry {
    let date: Date
    let kind: NearbyKind
    let items: [NearbyItem]
    let status: NearbyStatus

    static let sample = NearbyEntry(date: Date(), kind: .camps, items: [
        NearbyItem(name: "Gin Gin Rest Area", label: "Rest area", meters: 1_200, emoji: nil),
        NearbyItem(name: "Gin Gin Showgrounds", label: "Caravan park", meters: 1_900, emoji: nil),
        NearbyItem(name: "Lake Monduran Holiday Park", label: "Caravan park", meters: 16_000, emoji: nil),
    ], status: .ok)
}

struct NearbyKindIntent: AppIntent {
    static var title: LocalizedStringResource = "Show nearby places"
    static var isDiscoverable = false
    @Parameter(title: "Kind") var kind: String
    init() { kind = NearbyKind.camps.rawValue }
    init(_ k: NearbyKind) { kind = k.rawValue }
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(kind, forKey: "nearby.kind")
        return .result()
    }
}

struct NearbyProvider: TimelineProvider {
    func placeholder(in context: Context) -> NearbyEntry { .sample }
    func getSnapshot(in context: Context, completion: @escaping (NearbyEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        Task { completion(await Self.entry()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NearbyEntry>) -> Void) {
        Task {
            let e = await Self.entry()
            completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }

    static func entry() async -> NearbyEntry {
        let kind = NearbyKind(rawValue: UserDefaults.standard.string(forKey: "nearby.kind") ?? "") ?? .camps
        let d = UserDefaults.standard
        var loc = await WidgetLocation.current()
        if let l = loc {
            d.set([l.coordinate.latitude, l.coordinate.longitude], forKey: "nearby.last")
        } else if let a = d.array(forKey: "nearby.last") as? [Double], a.count == 2 {
            loc = CLLocation(latitude: a[0], longitude: a[1])
        }
        guard let here = loc else { return NearbyEntry(date: Date(), kind: kind, items: [], status: .noLocation) }
        let items = Nearby.items(kind, lat: here.coordinate.latitude, lon: here.coordinate.longitude)
        return NearbyEntry(date: Date(), kind: kind, items: items, status: items.isEmpty ? .empty : .ok)
    }
}

enum Nearby {
    static func items(_ kind: NearbyKind, lat: Double, lon: Double) -> [NearbyItem] {
        let P = DrivePlaces.shared
        switch kind {
        case .camps:
            // free camps and rest areas count as a bit closer than paid ones (it's Camp Finder: Free Camps AU)
            let near = P.near(.camps, lat: lat, lon: lon, radius: 80_000)
            let ranked = near.sorted { a, b in
                let fa = ["f", "s"].contains(P.camps[a.index].kind), fb = ["f", "s"].contains(P.camps[b.index].kind)
                return a.meters * (fa ? 0.6 : 1) < b.meters * (fb ? 0.6 : 1)
            }
            return ranked.prefix(3).map { n in
                let p = P.camps[n.index]
                return NearbyItem(name: p.name, label: DriveFormat.campLabel(p.kind), meters: n.meters, emoji: nil)
            }
        case .fuel:
            return P.near(.fuel, lat: lat, lon: lon, radius: 80_000).prefix(3).map { n in
                let p = P.fuel[n.index]
                return NearbyItem(name: p.name, label: DriveFormat.fuelLabel(p.kind), meters: n.meters, emoji: nil)
            }
        case .sights:
            let near = P.near(.sights, lat: lat, lon: lon, radius: 200_000)
            let ranked = near.sorted { a, b in
                a.meters / Double(1 + P.sights[a.index].rank) < b.meters / Double(1 + P.sights[b.index].rank)
            }
            // the best three nearby (bigger must-sees count from further away), closest first
            return ranked.prefix(3).sorted { $0.meters < $1.meters }.map { n in
                let p = P.sights[n.index]
                return NearbyItem(name: p.name, label: "Must-see", meters: n.meters, emoji: p.kind)
            }
        }
    }
}

/// One location fix for the widget, using the app's location permission (NSWidgetWantsLocation)
final class WidgetLocation: NSObject, CLLocationManagerDelegate {
    private static var busy: [WidgetLocation] = []
    private let manager = CLLocationManager()
    private var done: ((CLLocation?) -> Void)?

    static func current() async -> CLLocation? {
        await withCheckedContinuation { (cont: CheckedContinuation<CLLocation?, Never>) in
            DispatchQueue.main.async {
                let w = WidgetLocation()
                busy.append(w)
                w.fetch { loc in
                    busy.removeAll { $0 === w }
                    cont.resume(returning: loc)
                }
            }
        }
    }

    private func fetch(_ d: @escaping (CLLocation?) -> Void) {
        done = d
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        guard manager.isAuthorizedForWidgetUpdates else { finish(manager.location); return }
        if let l = manager.location, -l.timestamp.timeIntervalSinceNow < 120 { finish(l); return }
        manager.requestLocation()
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.finish(self?.manager.location) }
    }
    private func finish(_ l: CLLocation?) {
        guard let d = done else { return }
        done = nil
        d(l)
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) { finish(locations.last) }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(manager.location) }
}

struct NearbyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Nearby", provider: NearbyProvider()) { entry in
            NearbyWidgetView(entry: entry)
                .containerBackground(for: .widget) { Brand.signGradient }
        }
        .configurationDisplayName("Near me")
        .description("The closest free camps, fuel and must-sees. Add it to CarPlay too.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct NearbyWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearbyEntry
    var body: some View {
        NearbyCard(kind: entry.kind, items: entry.items, status: entry.status, large: family == .systemMedium) {
            ForEach(NearbyKind.allCases, id: \.self) { k in
                Button(intent: NearbyKindIntent(k)) { NearbyTab(kind: k, selected: k == entry.kind) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(k.title)
            }
        }
        .widgetURL(URL(string: "campfinder://nearby?kind=\(entry.kind.rawValue)"))
    }
}
