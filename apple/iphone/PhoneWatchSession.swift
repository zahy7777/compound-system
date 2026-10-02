import WatchConnectivity

private final class WatchReply: @unchecked Sendable {
    let send: ([String: Any]) -> Void
    init(_ send: @escaping ([String: Any]) -> Void) { self.send = send }
}

@MainActor
final class PhoneWatchSession: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchSession()
    private var latestSnapshot: WatchSnapshot?
    private var actionHandler: ((String, String) async throws -> WatchSnapshot)?

    func update(snapshot: WatchSnapshot) {
        latestSnapshot = snapshot
    }

    func setActionHandler(_ handler: @escaping (String, String) async throws -> WatchSnapshot) {
        actionHandler = handler
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard let command = message[WatchMessage.command] as? String else {
            replyHandler([WatchMessage.status: "不支持的请求"])
            return
        }
        let action = message[WatchMessage.action] as? String
        let itemID = message[WatchMessage.itemID] as? String
        let replyHandler = WatchReply(replyHandler)
        Task { @MainActor [weak self] in
            if command == WatchMessage.perform {
                guard let action,
                      let itemID,
                      let handler = self?.actionHandler else {
                    replyHandler.send([WatchMessage.status: "请先在 iPhone 打开 Compound", WatchMessage.succeeded: false])
                    return
                }
                do {
                    let snapshot = try await handler(action, itemID)
                    self?.latestSnapshot = snapshot
                    var reply = WatchMessage.connectedSnapshot()
                    reply[WatchMessage.succeeded] = true
                    reply[WatchMessage.snapshot] = try JSONEncoder().encode(snapshot)
                    replyHandler.send(reply)
                } catch {
                    replyHandler.send([WatchMessage.status: error.localizedDescription, WatchMessage.succeeded: false])
                }
                return
            }
            guard command == WatchMessage.refresh else {
                replyHandler.send([WatchMessage.status: "不支持的请求"])
                return
            }
            var reply = WatchMessage.connectedSnapshot()
            if let snapshot = self?.latestSnapshot, let data = try? JSONEncoder().encode(snapshot) {
                reply[WatchMessage.snapshot] = data
            } else {
                reply[WatchMessage.status] = "请先在 iPhone 打开 Compound"
            }
            replyHandler.send(reply)
        }
    }
}
