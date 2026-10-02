import SwiftUI

@MainActor
final class FeaturedTimerState: ObservableObject {
    @Published private(set) var itemID: String?

    private let defaults: UserDefaults
    private let key = "running.featured-timer-id"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        itemID = defaults.string(forKey: key)
    }

    func item(in snapshot: WatchSnapshot) -> WatchItem? {
        let items = allItems(in: snapshot)
        return items.first(where: { $0.timerState == "running" })
            ?? itemID.flatMap { id in items.first(where: { $0.id == id }) }
    }

    func reconcile(_ snapshot: WatchSnapshot) {
        let items = allItems(in: snapshot)
        if let running = items.first(where: { $0.timerState == "running" }) {
            save(running.id)
        } else if let itemID, !items.contains(where: { $0.id == itemID }) {
            save(nil)
        }
    }

    private func allItems(in snapshot: WatchSnapshot) -> [WatchItem] {
        snapshot.resultTimers + snapshot.running.direct + snapshot.running.loops.flatMap(\.items)
    }

    private func save(_ id: String?) {
        guard id != itemID else { return }
        itemID = id
        if let id { defaults.set(id, forKey: key) }
        else { defaults.removeObject(forKey: key) }
    }
}
