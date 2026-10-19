import SwiftUI

@main
struct CampFinderApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
                #if DEBUG
                .overlay(alignment: .bottom) { DebugOverlay() }
                #endif
                .background(Color(red: 0.055, green: 0.353, blue: 0.243))
        }
    }
}

#if DEBUG
struct DebugOverlay: View {
    @ObservedObject var log = DebugLog.shared
    var body: some View {
        if !log.lines.isEmpty {
            Text(log.lines.joined(separator: "\n"))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.white)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.black.opacity(0.75))
                .allowsHitTesting(false)
                .padding(.bottom, 90)
        }
    }
}
#endif
