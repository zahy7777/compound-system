import Foundation
import WidgetKit

struct ComplicationTask: Codable, Equatable {
    let id: String
    let title: String
    let elapsedMs: Double
    let timerState: String
    let generatedAt: TimeInterval
}

enum ComplicationStore {
    static let suite = "group.com.haisong.compound"
    private static let key = "complication.task"

    static func read() -> ComplicationTask? {
        guard let data = UserDefaults(suiteName: suite)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(ComplicationTask.self, from: data)
    }

    static func update(snapshot: WatchSnapshot) {
        let runningItems = snapshot.resultTimers + snapshot.running.direct + snapshot.running.loops.flatMap(\.items)
        let pausedItems = snapshot.running.direct + snapshot.running.loops.flatMap(\.items)
        let item = runningItems.first(where: { $0.timerState == "running" })
            ?? pausedItems.first(where: { $0.timerState == "paused" })
        let value = item.map { ComplicationTask(id: $0.id, title: $0.title, elapsedMs: $0.elapsedMs, timerState: $0.timerState, generatedAt: snapshot.generatedAt) }
        let defaults = UserDefaults(suiteName: suite)
        if let value, let data = try? JSONEncoder().encode(value) { defaults?.set(data, forKey: key) }
        else { defaults?.removeObject(forKey: key) }
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func clear() {
        UserDefaults(suiteName: suite)?.removeObject(forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
