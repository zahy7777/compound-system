import AppIntents
import Foundation
import WatchConnectivity

struct ComplicationActionIntent: AppIntent {
    static let title: LocalizedStringResource = "更新 Compound 小事"
    static let description = IntentDescription("通过配对的 iPhone 执行计时或归档动作。")

    @Parameter(title: "动作") var action: String
    @Parameter(title: "小事") var itemID: String

    init() {}
    init(action: String, itemID: String) { self.action = action; self.itemID = itemID }

    func perform() async throws -> some IntentResult {
        if let data = try await ComplicationMessenger.shared.perform(action: action, itemID: itemID),
           let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
            ComplicationStore.update(snapshot: snapshot)
        }
        return .result()
    }
}

private final class ComplicationMessenger: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = ComplicationMessenger()

    func perform(action: String, itemID: String) async throws -> Data? {
        guard WCSession.isSupported() else { throw ComplicationIntentError.unavailable }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated {
            session.activate()
            for _ in 0..<20 where session.activationState != .activated {
                try await Task.sleep(for: .milliseconds(100))
            }
        }
        guard session.activationState == .activated, session.isReachable else { throw ComplicationIntentError.unreachable }
        return try await withCheckedThrowingContinuation { continuation in
            session.sendMessage(
                [WatchMessage.command: WatchMessage.perform, WatchMessage.action: action, WatchMessage.itemID: itemID],
                replyHandler: { reply in
                    let succeeded = reply[WatchMessage.succeeded] as? Bool == true
                    let data = reply[WatchMessage.snapshot] as? Data
                    let message = reply[WatchMessage.status] as? String
                    if succeeded { continuation.resume(returning: data) }
                    else { continuation.resume(throwing: ComplicationIntentError.rejected(message)) }
                },
                errorHandler: { continuation.resume(throwing: $0) }
            )
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
}

private enum ComplicationIntentError: LocalizedError {
    case unavailable
    case unreachable
    case rejected(String?)

    var errorDescription: String? {
        switch self {
        case .unavailable: "此手表不支持 iPhone 连接"
        case .unreachable: "请先在 iPhone 打开 Compound"
        case .rejected(let message): message ?? "操作失败"
        }
    }
}
