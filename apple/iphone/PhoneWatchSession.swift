import WatchConnectivity

private final class WatchReply: @unchecked Sendable {
    let send: ([String: Any]) -> Void
    init(_ send: @escaping ([String: Any]) -> Void) { self.send = send }
}

@MainActor
final class PhoneWatchSession: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchSession()
    private var latestSnapshot: WatchSnapshot?

    func update(snapshot: WatchSnapshot) {
        latestSnapshot = snapshot
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
        guard message[WatchMessage.command] as? String == WatchMessage.refresh else {
            replyHandler([WatchMessage.status: "不支持的请求"])
            return
        }
        let replyHandler = WatchReply(replyHandler)
        Task { @MainActor [weak self] in
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
