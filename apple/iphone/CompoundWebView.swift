import SwiftUI
import WebKit

@MainActor
final class CompoundWebViewModel: ObservableObject {
    @Published private(set) var loadingError: String?
    fileprivate weak var webView: WKWebView?

    func load() {
        loadingError = nil
        webView?.load(URLRequest(url: AppConfiguration.startURL))
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

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        model.webView = webView
        model.load()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.watchSnapshotHandler)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let watchSnapshotHandler = "compoundWatchSnapshot"
        private let model: CompoundWebViewModel

        init(model: CompoundWebViewModel) {
            self.model = model
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.watchSnapshotHandler,
                  JSONSerialization.isValidJSONObject(message.body),
                  let data = try? JSONSerialization.data(withJSONObject: message.body),
                  let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
            Task { @MainActor in PhoneWatchSession.shared.update(snapshot: snapshot) }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
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
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            let trustedOrigin = origin.protocol == "https" && origin.host == "songring.nat100.top"
            decisionHandler(trustedOrigin && type == .microphone ? .prompt : .deny)
        }
    }
}
