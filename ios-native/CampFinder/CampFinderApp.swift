import SwiftUI

@main
struct CampFinderApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
                .background(Color(red: 0.055, green: 0.353, blue: 0.243))
        }
    }
}
