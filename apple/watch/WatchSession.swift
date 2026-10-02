import Foundation
import WatchConnectivity
import WidgetKit

@MainActor
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var status = "正在连接 iPhone…"
    @Published private(set) var updatedAt: Date?
    @Published private(set) var refreshing = false
    @Published private(set) var snapshot: WatchSnapshot?
    @Published private(set) var busyItemID: String?
    @Published private(set) var actionError: String?
    @Published private(set) var feedbackEvent: WatchFeedbackEvent?
    @Published private(set) var theme = WatchThemeStore.watch

    func activate() {
        WidgetCenter.shared.reloadTimelines(ofKind: "CompoundComplication")
        guard WCSession.isSupported() else {
            status = "此设备不支持连接"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func refresh() {
        guard !refreshing, busyItemID == nil else { return }
        refreshing = true
        Task {
            do {
                let value = try await WatchDirectClient.snapshot()
                snapshot = value
                updatedAt = .now
                status = "已直连服务器"
                actionError = nil
                refreshing = false
            } catch {
                status = error.localizedDescription
                actionError = error.localizedDescription
                refreshing = false
            }
        }
    }

    func perform(_ action: String, item: WatchItem) {
        perform(.item(action, id: item.id), busyID: item.id)
    }

    func perform(_ command: WatchCommand, busyID: String = "page") {
        busyItemID = busyID
        actionError = nil
        let action = command.action
        Task {
            do {
                let value = try await WatchDirectClient.perform(command)
                snapshot = value
                updatedAt = .now
                status = "已更新"
                busyItemID = nil
                publishFeedback(action: action, succeeded: true, targetID: busyID)
            } catch {
                status = error.localizedDescription
                actionError = error.localizedDescription
                busyItemID = nil
                publishFeedback(action: action, succeeded: false, targetID: busyID)
            }
        }
    }

    private func publishFeedback(action: String, succeeded: Bool, targetID: String) {
        let event = WatchFeedbackEvent(action: action, succeeded: succeeded, targetID: targetID)
        feedbackEvent = event
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard self?.feedbackEvent?.id == event.id else { return }
            self?.feedbackEvent = nil
        }
    }

    private func requestCredential() {
        status = "Watch 未获得服务器授权，请在 iPhone 打开 Compound"
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(
            [WatchMessage.command: WatchMessage.requestCredential],
            replyHandler: { @Sendable [weak self] reply in
                guard let data = reply[WatchMessage.credential] as? Data,
                      let credential = try? JSONDecoder().decode(WatchCredential.self, from: data) else { return }
                ComplicationStore.save(credential: credential)
                Task { @MainActor [weak self] in self?.refresh() }
            },
            errorHandler: nil
        )
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let message = error?.localizedDescription
        Task { @MainActor [weak self] in
            if let message {
                self?.status = message
            } else if activationState == .activated {
                if ComplicationStore.credential() != nil {
                    self?.refresh()
                } else {
                    self?.requestCredential()
                }
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor [weak self] in
            if reachable {
                if ComplicationStore.credential() != nil { self?.refresh() }
                else { self?.requestCredential() }
            } else {
                if ComplicationStore.credential() == nil {
                    self?.status = "Watch 未获得服务器授权，请在 iPhone 打开 Compound"
                }
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receiveTheme(message)
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
        receiveTheme(applicationContext)
        receiveCredential(applicationContext)
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        receiveTheme(userInfo)
        receiveCredential(userInfo)
    }

    nonisolated private func receiveTheme(_ message: [String: Any]) {
        guard let rawValue = message[WatchMessage.theme] as? String,
              let theme = WatchThemeID(rawValue: rawValue) else { return }
        WatchThemeStore.watch = theme
        WidgetCenter.shared.reloadAllTimelines()
        Task { @MainActor [weak self] in self?.theme = theme }
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
