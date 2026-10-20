import SwiftUI

@main
struct CampFinderApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
                .background(Color(red: 0.055, green: 0.353, blue: 0.243))
                // Sign-in links from the email (campfinder://auth#access_token=...) open the app here
                .onOpenURL { url in AuthLinks.shared.receive(url) }
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
