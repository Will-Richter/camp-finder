import SwiftUI

// Looks for the Live Activity (Lock Screen, Dynamic Island, CarPlay Dashboard) and the Nearby widget.
// Plain SwiftUI with plain data, so tools/render_previews.swift can draw them to pictures for checking.
// Styled like an Australian highway guide sign: sign green, white lettering, warning-sign yellow.

enum Brand {
    static let sign = Color(red: 0.055, green: 0.353, blue: 0.243)       // #0E5A3E
    static let signDeep = Color(red: 0.035, green: 0.255, blue: 0.173)   // darker edge of the sign
    static let gold = Color(red: 0.961, green: 0.773, blue: 0.094)       // #F5C518
    static let free = Color(red: 0.49, green: 0.88, blue: 0.62)
    static let signGradient = LinearGradient(colors: [sign, signDeep], startPoint: .top, endPoint: .bottom)
}

extension DriveStop.Kind {
    var symbol: String {
        switch self {
        case .camp: return "tent.fill"
        case .fuel: return "fuelpump.fill"
        case .sight: return "binoculars.fill"
        case .tonight: return "moon.stars.fill"
        }
    }
}

/// The white symbol panel at the start of a sign row
struct SignIcon: View {
    let kind: DriveStop.Kind
    var emoji: String? = nil
    var size: CGFloat = 30
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
            .fill(.white)
            .frame(width: size, height: size)
            .overlay {
                if kind == .sight, let e = emoji, !e.isEmpty {
                    Text(e).font(.system(size: size * 0.56))
                } else {
                    Image(systemName: kind.symbol)
                        .font(.system(size: size * 0.5, weight: .bold))
                        .foregroundStyle(Brand.sign)
                }
            }
    }
}

/// One line of the sign: symbol, place, what it is, distance
struct DriveRow: View {
    let stop: DriveStop
    var compact = false
    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            SignIcon(kind: stop.kind, emoji: stop.emoji, size: compact ? 24 : 30)
            VStack(alignment: .leading, spacing: 0) {
                Text(stop.name)
                    .font(.system(size: compact ? 13.5 : 15, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(stop.label)
                    .font(.system(size: compact ? 11 : 12, weight: .semibold))
                    .foregroundStyle(stop.kind == .sight ? Brand.gold : .white.opacity(0.72))
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(DriveFormat.distance(stop.meters))
                .font(.system(size: compact ? 17 : 20, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
        }
    }
}

/// Lock Screen and notification banner
struct DriveLockScreenView: View {
    let title: String
    let state: DriveState
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Image(systemName: "car.side.fill").font(.system(size: 11, weight: .bold))
                Text("COMING UP").font(.system(size: 11, weight: .heavy)).tracking(1.2)
                Spacer(minLength: 4)
                if let t = state.tonight {
                    Image(systemName: "moon.stars.fill").font(.system(size: 10, weight: .bold)).foregroundStyle(Brand.gold)
                    Text("Tonight \(t.name) · \(DriveFormat.distance(t.meters))")
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(Brand.gold)
                        .lineLimit(1)
                } else {
                    Text(title).font(.system(size: 11.5, weight: .semibold)).lineLimit(1).opacity(0.75)
                }
            }
            .foregroundStyle(.white.opacity(0.85))
            if state.isEmpty || (state.camp == nil && state.fuel == nil && state.sight == nil) {
                Text("Watching the road ahead for camps, fuel and must-sees")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.vertical, 6)
            } else {
                VStack(spacing: 8) {
                    if let s = state.camp { DriveRow(stop: s) }
                    if let s = state.fuel { DriveRow(stop: s) }
                    if let s = state.sight { DriveRow(stop: s) }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// CarPlay Dashboard and Apple Watch Smart Stack (the "small" activity family)
struct DriveSmallView: View {
    let state: DriveState
    var body: some View {
        let stops = [state.camp, state.fuel, state.sight].compactMap { $0 }
        VStack(alignment: .leading, spacing: 5) {
            if stops.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "car.side.fill").font(.system(size: 13, weight: .bold))
                    Text("Watching the road ahead").font(.system(size: 13, weight: .semibold)).lineLimit(2)
                }
                .foregroundStyle(.white)
            }
            ForEach(stops, id: \.self) { s in
                HStack(spacing: 6) {
                    Image(systemName: s.kind.symbol)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(s.kind == .sight ? Brand.gold : .white)
                        .frame(width: 16)
                    Text(DriveFormat.distance(s.meters))
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .fixedSize()
                    Text(s.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Dynamic Island pieces
struct DriveIslandTag: View {
    let stop: DriveStop?
    let kind: DriveStop.Kind
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: kind.symbol)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(kind == .fuel ? Brand.gold : Brand.free)
            if let s = stop {
                Text(DriveFormat.short(s.meters))
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            }
        }
    }
}

struct DriveIslandExpandedBottom: View {
    let state: DriveState
    var body: some View {
        VStack(spacing: 7) {
            if let s = state.camp { DriveRow(stop: s, compact: true) }
            if let s = state.fuel { DriveRow(stop: s, compact: true) }
            if let s = state.sight { DriveRow(stop: s, compact: true) }
            if state.camp == nil && state.fuel == nil && state.sight == nil {
                Text("Watching the road ahead for camps, fuel and must-sees")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
            }
        }
    }
}

// MARK: Nearby widget (Home Screen, StandBy and CarPlay)

struct NearbyItem: Hashable {
    var name: String
    var label: String
    var meters: Double
    var emoji: String?
}

enum NearbyKind: String, CaseIterable {
    case camps, fuel, sights
    var title: String { self == .camps ? "Camps" : self == .fuel ? "Fuel" : "Must-sees" }
    var stopKind: DriveStop.Kind { self == .camps ? .camp : self == .fuel ? .fuel : .sight }
}

enum NearbyStatus { case ok, noLocation, empty }

/// The three category buttons (the widget passes real buttons; previews pass plain ones)
struct NearbyTab: View {
    let kind: NearbyKind
    let selected: Bool
    var body: some View {
        Image(systemName: kind.stopKind.symbol)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(selected ? Brand.sign : .white)
            .frame(maxWidth: .infinity, minHeight: 26)
            .background(Capsule().fill(selected ? Color.white : Color.white.opacity(0.14)))
    }
}

struct NearbyCard<Tabs: View>: View {
    let kind: NearbyKind
    let items: [NearbyItem]
    let status: NearbyStatus
    let large: Bool
    let tabs: Tabs
    init(kind: NearbyKind, items: [NearbyItem], status: NearbyStatus, large: Bool, @ViewBuilder tabs: () -> Tabs) {
        self.kind = kind; self.items = items; self.status = status; self.large = large; self.tabs = tabs()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: large ? 8 : 7) {
            HStack(spacing: 5) { tabs }
            switch status {
            case .noLocation:
                Spacer(minLength: 0)
                Text("Open Camp Finder once and allow location to see what's near you")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                Spacer(minLength: 0)
            case .empty:
                Spacer(minLength: 0)
                Text("No \(kind.title.lowercased()) within 80 km").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                Spacer(minLength: 0)
            case .ok:
                ForEach(Array(items.prefix(large ? 3 : 2).enumerated()), id: \.offset) { i, it in
                    if large {
                        DriveRow(stop: DriveStop(kind: kind.stopKind, name: it.name, meters: it.meters, label: it.label, emoji: it.emoji, lat: 0, lon: 0), compact: true)
                    } else {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.name)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            HStack(spacing: 4) {
                                Text(DriveFormat.distance(it.meters))
                                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(i == 0 ? Brand.gold : .white)
                                Text(it.label).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}
