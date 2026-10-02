import SwiftUI

@main
struct CompoundApp: App {
    init() {
        PhoneWatchSession.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
