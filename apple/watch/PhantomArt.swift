import Foundation

enum PhantomArt {
    static let timer = "phantom-timer"
    static let voice = "phantom-voice"

    private static let tasks = [
        "phantom-task-flower",
        "phantom-task-laptop",
        "phantom-task-train",
        "phantom-task-running",
        "phantom-task-reading",
        "phantom-task-travel",
    ]

    private static let tabs = [
        "phantom-tab-red",
        "phantom-tab-violet",
        "phantom-tab-cyan",
        "phantom-tab-yellow",
    ]

    static func task(for stableID: String) -> String {
        tasks[stableIndex(stableID, count: tasks.count)]
    }

    static func tab(for stableID: String) -> String {
        tabs[stableIndex(stableID, count: tabs.count)]
    }

    static func feedback(for kind: WatchFeedbackKind) -> String {
        switch kind {
        case .start: "phantom-feedback-start"
        case .pause: "phantom-feedback-pause"
        case .archive: "phantom-feedback-archive"
        case .create: "phantom-feedback-create"
        case .delete: "phantom-feedback-delete"
        case .failure: "phantom-feedback-failure"
        }
    }

    private static func stableIndex(_ value: String, count: Int) -> Int {
        value.utf8.reduce(0) { ($0 &* 31 &+ Int($1)) % count }
    }
}
