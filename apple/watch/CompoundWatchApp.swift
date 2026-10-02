import SwiftUI

@main
struct CompoundWatchApp: App {
    @StateObject private var session = WatchSession()

    var body: some Scene {
        WindowGroup {
            WatchContentView(session: session)
        }
    }
}
