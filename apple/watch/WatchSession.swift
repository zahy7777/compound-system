import Foundation
import WatchConnectivity

@MainActor
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var status = "正在连接 iPhone…"
    @Published private(set) var updatedAt: Date?
    @Published private(set) var refreshing = false
    @Published private(set) var snapshot: WatchSnapshot?
    @Published private(set) var busyItemID: String?
    @Published private(set) var actionError: String?

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
        refreshing = true
        Task {
            do {
                let value = try await WatchDirectClient.snapshot()
                snapshot = value
                updatedAt = .now
                status = "已直连服务器"
                refreshing = false
            } catch WatchDirectError.notProvisioned {
                refreshThroughPhone()
            } catch {
                status = error.localizedDescription
                refreshing = false
            }
        }
    }

    private func refreshThroughPhone() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            status = "请在 iPhone 打开 Compound 完成手表授权"
            refreshing = false
            return
        }
        session.sendMessage(
            [WatchMessage.command: WatchMessage.refresh],
            replyHandler: { @Sendable [weak self] reply in
                let status = reply[WatchMessage.status] as? String ?? "响应格式错误"
                let timestamp = reply[WatchMessage.updatedAt] as? TimeInterval
                let snapshot = (reply[WatchMessage.snapshot] as? Data).flatMap { try? JSONDecoder().decode(WatchSnapshot.self, from: $0) }
                let invalidated = reply[WatchMessage.invalidated] as? Bool ?? false
                Task { @MainActor [weak self] in
                    self?.status = status
                    if let timestamp {
                        self?.updatedAt = Date(timeIntervalSince1970: timestamp)
                    }
                    if let snapshot { self?.snapshot = snapshot; ComplicationStore.update(snapshot: snapshot) }
                    if invalidated { self?.snapshot = nil; ComplicationStore.clear() }
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

    func perform(_ action: String, item: WatchItem) {
        busyItemID = item.id
        actionError = nil
        Task {
            do {
                let value = try await WatchDirectClient.perform(action: action, itemID: item.id)
                snapshot = value
                updatedAt = .now
                status = "已更新"
                busyItemID = nil
            } catch WatchDirectError.notProvisioned {
                performThroughPhone(action, item: item)
            } catch {
                status = error.localizedDescription
                actionError = error.localizedDescription
                busyItemID = nil
            }
        }
    }

    private func performThroughPhone(_ action: String, item: WatchItem) {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            status = "请在 iPhone 打开 Compound 完成手表授权"
            actionError = status
            busyItemID = nil
            return
        }
        session.sendMessage(
            [WatchMessage.command: WatchMessage.perform, WatchMessage.action: action, WatchMessage.itemID: item.id],
            replyHandler: { @Sendable [weak self] reply in
                let succeeded = reply[WatchMessage.succeeded] as? Bool ?? false
                let status = reply[WatchMessage.status] as? String ?? "响应格式错误"
                let snapshot = (reply[WatchMessage.snapshot] as? Data).flatMap { try? JSONDecoder().decode(WatchSnapshot.self, from: $0) }
                Task { @MainActor [weak self] in
                    self?.status = succeeded ? "已更新" : status
                    self?.actionError = succeeded ? nil : status
                    if let snapshot { self?.snapshot = snapshot; ComplicationStore.update(snapshot: snapshot) }
                    self?.busyItemID = nil
                }
            },
            errorHandler: { @Sendable [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.status = "iPhone 暂时不可达"
                    self?.actionError = "iPhone 暂时不可达"
                    self?.busyItemID = nil
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

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let data = message[WatchMessage.credential] as? Data,
           let credential = try? JSONDecoder().decode(WatchCredential.self, from: data) {
            ComplicationStore.save(credential: credential)
            Task { @MainActor [weak self] in self?.refresh() }
            return
        }
        guard message[WatchMessage.invalidated] as? Bool == true else { return }
        Task { @MainActor [weak self] in
            self?.snapshot = nil
            ComplicationStore.clear()
            ComplicationStore.clearCredential()
            self?.status = "iPhone 正在切换环境…"
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        receiveCredential(applicationContext)
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        receiveCredential(userInfo)
    }

    nonisolated private func receiveCredential(_ message: [String: Any]) {
        if message[WatchMessage.invalidated] as? Bool == true {
            ComplicationStore.clear()
            ComplicationStore.clearCredential()
            Task { @MainActor [weak self] in
                self?.snapshot = nil
                self?.status = "请在 iPhone 打开目标环境完成手表授权"
            }
            return
        }
        guard let data = message[WatchMessage.credential] as? Data,
              let credential = try? JSONDecoder().decode(WatchCredential.self, from: data) else { return }
        ComplicationStore.save(credential: credential)
        Task { @MainActor [weak self] in self?.refresh() }
    }
}
