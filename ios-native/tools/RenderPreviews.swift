// Draws the Drive mode Live Activity and the Nearby widget to PNGs (macOS, for checking the design in CI).
// swiftc -parse-as-library Shared/DriveShared.swift Shared/DriveViews.swift tools/RenderPreviews.swift -o render && ./render out
import SwiftUI
import AppKit

@main
struct RenderPreviews {
    @MainActor static func main() {
        let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "previews"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        let full = DriveState(
            camp: DriveStop(kind: .camp, name: "Gin Gin Rest Area", meters: 12_400, label: "Rest area", emoji: nil, lat: 0, lon: 0),
            fuel: DriveStop(kind: .fuel, name: "Puma", meters: 4_200, label: "Fuel", emoji: nil, lat: 0, lon: 0),
            sight: DriveStop(kind: .sight, name: "Mon Repos Turtles", meters: 28_000, label: "Must-see", emoji: "🐢", lat: 0, lon: 0),
            tonight: DriveStop(kind: .tonight, name: "Lake Wuruma Campground", meters: 142_000, label: "Tonight's camp", emoji: nil, lat: 0, lon: 0),
            onRoute: true)
        let noTonight = DriveState(camp: full.camp, fuel: full.fuel, sight: DriveStop(kind: .sight, name: "Bundaberg Rum Distillery", meters: 800, label: "Must-see", emoji: "🥃", lat: 0, lon: 0))

        func sign<V: View>(_ v: V, _ w: CGFloat) -> some View {
            v.frame(width: w).background(Brand.sign).clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        save(sign(DriveLockScreenView(title: "Bundaberg to Cairns", state: full), 370), "lockscreen", dir)
        save(sign(DriveLockScreenView(title: "Drive mode", state: noTonight), 370), "lockscreen-no-plan", dir)
        save(sign(DriveLockScreenView(title: "Drive mode", state: DriveState()), 370), "lockscreen-empty", dir)
        save(DriveSmallView(state: full).padding(10).frame(width: 230, height: 96).background(Brand.sign).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous)), "carplay-dashboard", dir)
        save(VStack(spacing: 10) {
            Text("Tonight: Lake Wuruma Campground").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
            DriveIslandExpandedBottom(state: full)
        }.padding(.horizontal, 18).padding(.vertical, 14).frame(width: 370).background(Color.black).clipShape(RoundedRectangle(cornerRadius: 40, style: .continuous)), "dynamic-island-expanded", dir)
        save(HStack(spacing: 0) { DriveIslandTag(stop: full.camp, kind: .camp); Spacer(minLength: 0); Color.black.frame(width: 120); Spacer(minLength: 0); DriveIslandTag(stop: full.fuel, kind: .fuel) }
            .padding(.horizontal, 14).frame(width: 250, height: 36).background(Capsule().fill(.black)), "dynamic-island-compact", dir)

        let camps = [NearbyItem(name: "Gin Gin Rest Area", label: "Rest area", meters: 1_200, emoji: nil),
                     NearbyItem(name: "Gin Gin Showgrounds", label: "Caravan park", meters: 1_900, emoji: nil),
                     NearbyItem(name: "Lake Monduran Holiday Park", label: "Caravan park", meters: 16_000, emoji: nil)]
        func widget(_ kind: NearbyKind, _ items: [NearbyItem], large: Bool, status: NearbyStatus = .ok) -> some View {
            NearbyCard(kind: kind, items: items, status: status, large: large) {
                ForEach(NearbyKind.allCases, id: \.self) { k in NearbyTab(kind: k, selected: k == kind) }
            }
            .padding(16)
            .frame(width: large ? 338 : 158, height: 158)
            .background(Brand.signGradient)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        save(widget(.camps, camps, large: false), "widget-small-camps", dir)
        save(widget(.fuel, [NearbyItem(name: "Puma", label: "Fuel", meters: 1_400, emoji: nil), NearbyItem(name: "Liberty", label: "Fuel", meters: 1_900, emoji: nil)], large: false), "widget-small-fuel", dir)
        save(widget(.camps, camps, large: true), "widget-medium-camps", dir)
        save(widget(.sights, [NearbyItem(name: "Mon Repos Turtles", label: "Must-see", meters: 52_000, emoji: "🐢"), NearbyItem(name: "Bundaberg Rum Distillery", label: "Must-see", meters: 47_000, emoji: "🥃")], large: true), "widget-medium-sights", dir)
        save(widget(.camps, [], large: false, status: .noLocation), "widget-small-nolocation", dir)
        print("rendered to \(dir)")
    }

    @MainActor static func save<V: View>(_ view: V, _ name: String, _ dir: String) {
        let r = ImageRenderer(content: view.environment(\.colorScheme, .dark))
        r.scale = 3
        guard let cg = r.cgImage else { print("could not render \(name)"); return }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let png = rep.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
}
