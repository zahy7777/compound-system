import SwiftUI
import WebKit

@MainActor
final class CompoundWebViewModel: ObservableObject {
    @Published private(set) var loadingError: String?
    @Published private(set) var environment = AppConfiguration.savedEnvironment
    @Published var credentialsPresented = false
    @Published private(set) var credentialError: String?
    @Published private(set) var watchAuthorizationStatus = "Watch 未授权"
    @Published private(set) var theme = WatchThemeStore.phone
    fileprivate weak var webView: WKWebView?
    private let credentials = CredentialStore()
    private var provisioningTask: Task<Void, Never>?

    init() {
        PhoneWatchSession.shared.update(theme: theme)
    }

    func load() {
        loadingError = nil
        webView?.load(URLRequest(url: environment.url))
        provisionWatch()
    }

    private func provisionWatch() {
        provisioningTask?.cancel()
        let selected = environment
        guard let password = credentials.password(for: selected) else {
            watchAuthorizationStatus = "Watch 未授权"
            return
        }
        watchAuthorizationStatus = "Watch 授权中…"
        provisioningTask = Task {
            do {
                let credential = try await WatchProvisioner.provision(environment: selected, password: password)
                guard !Task.isCancelled, environment == selected else { return }
                PhoneWatchSession.shared.update(credential: credential)
                watchAuthorizationStatus = "Watch 已授权"
            } catch {
                guard !Task.isCancelled, environment == selected else { return }
                watchAuthorizationStatus = "Watch 未授权：\(error.localizedDescription)"
            }
        }
    }

    func switchEnvironment(to next: AppEnvironment) {
        guard next != environment else { return }
        environment = next
        AppConfiguration.savedEnvironment = next
        PhoneWatchSession.shared.clearSnapshot()
        load()
    }

    func switchTheme(to next: WatchThemeID) {
        guard next != theme else { return }
        theme = next
        WatchThemeStore.phone = next
        PhoneWatchSession.shared.update(theme: next)
    }

    func editCredentials() {
        credentialError = nil
        credentialsPresented = true
    }

    func hasCredential(for environment: AppEnvironment) -> Bool {
        credentials.password(for: environment) != nil
    }

    func saveCredentials(dev: String, prod: String) -> Bool {
        credentialError = nil
        guard !dev.isEmpty || hasCredential(for: .dev), !prod.isEmpty || hasCredential(for: .prod) else {
            credentialError = "请保存 dev 和 prod 两个密码"
            return false
        }
        do {
            if !dev.isEmpty { try credentials.save(dev, for: .dev) }
            if !prod.isEmpty { try credentials.save(prod, for: .prod) }
            credentialsPresented = false
            load()
            return true
        } catch {
            credentialError = error.localizedDescription
            return false
        }
    }

    func reloadWhenActive() {
        guard let webView else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('focus'))")
    }

    fileprivate func failed(_ error: Error) {
        loadingError = error.localizedDescription
    }

    fileprivate func loaded() {
        loadingError = nil
    }

    fileprivate func performWatchAction(_ action: String, itemID: String) async throws -> WatchSnapshot {
        guard let webView else { throw WatchActionError.webViewUnavailable }
        guard let value = try await webView.callAsyncJavaScript(
            "return await window.compoundWatch.perform(action, itemID)",
            arguments: ["action": action, "itemID": itemID],
            contentWorld: .page
        ) else { throw WatchActionError.invalidResponse }
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else {
            throw WatchActionError.invalidResponse
        }
        return snapshot
    }

    fileprivate func loginFromKeychain(environmentName: String) async {
        guard environmentName.lowercased() == environment.rawValue else { return }
        guard let password = credentials.password(for: environment) else {
            credentialError = "请先保存 \(environment.label) 密码"
            credentialsPresented = true
            return
        }
        do {
            guard let webView else { throw WatchActionError.webViewUnavailable }
            _ = try await webView.callAsyncJavaScript(
                "return await window.compoundNativeLogin(password)",
                arguments: ["password": password],
                contentWorld: .page
            )
            credentialError = nil
        } catch {
            credentialError = "\(environment.label) 自动登录失败，请重新保存密码"
            credentialsPresented = true
        }
    }
}

struct CompoundWebView: UIViewRepresentable {
    @ObservedObject var model: CompoundWebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: Coordinator.watchSnapshotHandler)
        configuration.userContentController.add(context.coordinator, name: Coordinator.accessHandler)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        model.webView = webView
        PhoneWatchSession.shared.setActionHandler { [weak model] action, itemID in
            guard let model else { throw WatchActionError.webViewUnavailable }
            return try await model.performWatchAction(action, itemID: itemID)
        }
        model.load()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.watchSnapshotHandler)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.accessHandler)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let watchSnapshotHandler = "compoundWatchSnapshot"
        static let accessHandler = "compoundAccess"
        private let model: CompoundWebViewModel

        init(model: CompoundWebViewModel) {
            self.model = model
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.securityOrigin.protocol == "https",
                  message.frameInfo.securityOrigin.host == "songring.nat100.top" else { return }
            if message.name == Self.accessHandler,
               let body = message.body as? [String: Any],
               let type = body["type"] as? String {
                if type == "loginRequired", let environment = body["environment"] as? String {
                    Task { @MainActor in await model.loginFromKeychain(environmentName: environment) }
                } else if type == "watchCredential",
                          let token = body["token"] as? String,
                          let expiresAt = (body["expiresAt"] as? NSNumber)?.doubleValue,
                          let environment = body["environment"] as? String,
                          let base = body["baseURL"] as? String,
                          let baseURL = URL(string: base),
                          baseURL.scheme == "https", baseURL.host == "songring.nat100.top",
                          baseURL.path == "/compound/\(environment)/" {
                    let credential = WatchCredential(token: token, expiresAt: expiresAt, environment: environment.uppercased(), baseURL: baseURL)
                    Task { @MainActor in PhoneWatchSession.shared.update(credential: credential) }
                }
                return
            }
            guard message.name == Self.watchSnapshotHandler,
                  JSONSerialization.isValidJSONObject(message.body),
                  let data = try? JSONSerialization.data(withJSONObject: message.body),
                  let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
            Task { @MainActor in PhoneWatchSession.shared.update(snapshot: snapshot) }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.targetFrame?.isMainFrame != false,
                  let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            switch NavigationPolicy.decide(url) {
            case .allowInsideApp:
                decisionHandler(.allow)
            case .openInSafari:
                decisionHandler(.cancel)
                UIApplication.shared.open(url)
            case .cancel:
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.loaded()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            model.failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            model.failed(error)
        }

        @available(iOS 15.0, *)
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            let trustedOrigin = origin.protocol == "https" && origin.host == "songring.nat100.top"
            decisionHandler(trustedOrigin && type == .microphone ? .prompt : .deny)
        }
    }
}

private enum WatchActionError: LocalizedError {
    case webViewUnavailable
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .webViewUnavailable: return "请先在 iPhone 打开 Compound"
        case .invalidResponse: return "iPhone 返回的数据无法读取"
        }
    }
}
