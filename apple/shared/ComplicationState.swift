import Foundation
import WidgetKit

struct ComplicationTask: Codable, Equatable {
    let id: String
    let title: String
    let elapsedMs: Double
    let timerState: String
    let generatedAt: TimeInterval
}

struct ComplicationFeedback: Codable, Equatable {
    static let duration: TimeInterval = 1

    let id: String
    let action: String
    let succeeded: Bool
    let message: String?
    let createdAt: TimeInterval

    var expiresAt: Date { Date(timeIntervalSince1970: createdAt + Self.duration) }

    func isVisible(at date: Date) -> Bool {
        date.timeIntervalSince1970 < createdAt + Self.duration
    }
}

enum ComplicationStore {
    static let suite = "group.com.haisong.compound"
    private static let key = "complication.task"
    private static let feedbackKey = "complication.feedback"
    private static let credentialKey = "watch.credential"

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
        UserDefaults(suiteName: suite)?.removeObject(forKey: feedbackKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func feedback(at date: Date) -> ComplicationFeedback? {
        guard let data = UserDefaults(suiteName: suite)?.data(forKey: feedbackKey),
              let value = try? JSONDecoder().decode(ComplicationFeedback.self, from: data),
              value.isVisible(at: date) else { return nil }
        return value
    }

    static func saveFeedback(action: String, succeeded: Bool, message: String? = nil) {
        let value = ComplicationFeedback(
            id: UUID().uuidString,
            action: action,
            succeeded: succeeded,
            message: message,
            createdAt: Date.now.timeIntervalSince1970
        )
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults(suiteName: suite)?.set(data, forKey: feedbackKey)
    }

    static func credential() -> WatchCredential? {
        guard let data = UserDefaults(suiteName: suite)?.data(forKey: credentialKey),
              let value = try? JSONDecoder().decode(WatchCredential.self, from: data), value.isUsable else { return nil }
        return value
    }

    static func save(credential: WatchCredential) {
        guard let data = try? JSONEncoder().encode(credential) else { return }
        UserDefaults(suiteName: suite)?.set(data, forKey: credentialKey)
    }

    static func clearCredential() {
        UserDefaults(suiteName: suite)?.removeObject(forKey: credentialKey)
    }
}

enum WatchDirectClient {
    static func snapshot() async throws -> WatchSnapshot {
        try await request(path: "watch/snapshot", method: "GET", body: nil)
    }

    static func perform(_ command: WatchCommand) async throws -> WatchSnapshot {
        let body = try JSONEncoder().encode(command)
        return try await request(path: "watch/action", method: "POST", body: body)
    }

    private static func request(path: String, method: String, body: Data?) async throws -> WatchSnapshot {
        guard let credential = ComplicationStore.credential(),
              let url = URL(string: path, relativeTo: credential.baseURL)?.absoluteURL else {
            throw WatchDirectError.notProvisioned
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 15
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw WatchDirectError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw WatchDirectError.rejected(message)
        }
        guard let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { throw WatchDirectError.invalidResponse }
        ComplicationStore.update(snapshot: snapshot)
        return snapshot
    }
}

enum WatchDirectError: LocalizedError {
    case notProvisioned
    case invalidResponse
    case rejected(String?)

    var errorDescription: String? {
        switch self {
        case .notProvisioned: "请在 iPhone 打开 Compound 完成手表授权"
        case .invalidResponse: "服务器返回的数据无法读取"
        case .rejected(let message): message ?? "服务器拒绝了操作"
        }
    }
}
