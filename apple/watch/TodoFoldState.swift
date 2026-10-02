import SwiftUI

@MainActor
final class TodoFoldState: ObservableObject {
    @Published private(set) var collapsedIDs: Set<String>

    private let defaults: UserDefaults
    private let key = "todo.collapsed-loop-ids"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        collapsedIDs = Set(defaults.stringArray(forKey: key) ?? [])
    }

    func contains(_ id: String) -> Bool {
        collapsedIDs.contains(id)
    }

    func toggle(_ id: String) {
        if collapsedIDs.contains(id) {
            collapsedIDs.remove(id)
        } else {
            collapsedIDs.insert(id)
        }
        defaults.set(collapsedIDs.sorted(), forKey: key)
    }
}
