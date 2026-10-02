import Foundation
import WatchConnectivity

@MainActor
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var status = "正在连接 iPhone…"
    @Published private(set) var updatedAt: Date?
    @Published private(set) var refreshing = false
    @Published private(set) var snapshot: WatchSnapshot?

    func activate() {
        guard WCSession.isSupported() else {
            status = "此设备不支持连接"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func refresh() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            status = "请在 iPhone 打开 Compound"
            return
        }
        refreshing = true
        session.sendMessage(
            [WatchMessage.command: WatchMessage.refresh],
            replyHandler: { @Sendable [weak self] reply in
                let status = reply[WatchMessage.status] as? String ?? "响应格式错误"
                let timestamp = reply[WatchMessage.updatedAt] as? TimeInterval
                let snapshot = (reply[WatchMessage.snapshot] as? Data).flatMap { try? JSONDecoder().decode(WatchSnapshot.self, from: $0) }
                Task { @MainActor [weak self] in
                    self?.status = status
                    if let timestamp {
                        self?.updatedAt = Date(timeIntervalSince1970: timestamp)
                    }
                    if let snapshot { self?.snapshot = snapshot }
                    self?.refreshing = false
                }
            },
            errorHandler: { @Sendable [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.status = "iPhone 暂时不可达"
                    self?.refreshing = false
                }
            }
        )
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let message = error?.localizedDescription
        let reachable = session.isReachable
        Task { @MainActor [weak self] in
            if let message {
                self?.status = message
            } else if activationState == .activated {
                if reachable {
                    self?.refresh()
                } else {
                    self?.status = "请在 iPhone 打开 Compound"
                }
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor [weak self] in
            if reachable {
                self?.refresh()
            } else {
                self?.status = "iPhone 暂时不可达"
            }
        }
    }
}
