import SwiftUI

@main
struct CampFinderApp: App {
    init() {
        _ = JourneyRecorder.shared   // resumes a journey that was running
        DriveMode.shared.resume()    // and Drive mode, if its Lock Screen / CarPlay card is still showing
    }

    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
                .background(Color(red: 0.055, green: 0.353, blue: 0.243))
                // Sign-in links from the email (campfinder://auth#access_token=...) open the app here,
                // and so do taps on the Drive mode card (campfinder://drive) and the widget (campfinder://nearby)
                .onOpenURL { url in
                    if url.scheme == "campfinder", url.host == "drive" || url.host == "nearby" { DriveMode.shared.open(url) }
                    else { AuthLinks.shared.receive(url) }
                }
        }
    }
}

/// Holds a sign-in link until the web app is ready for it.
final class AuthLinks {
    static let shared = AuthLinks()
    var pending: URL?
    var deliver: ((URL) -> Void)?
    func receive(_ url: URL) {
        guard url.scheme == "campfinder" else { return }
        if let d = deliver { d(url) } else { pending = url }
    }
}
