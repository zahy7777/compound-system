import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var webView = CompoundWebViewModel()

    var body: some View {
        ZStack {
            CompoundWebView(model: webView)
                .ignoresSafeArea(.container, edges: [.bottom])

            if let message = webView.loadingError {
                VStack(spacing: 16) {
                    Text("无法打开 Compound")
                        .font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("重试", action: webView.load)
                        .buttonStyle(.borderedProminent)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                webView.reloadWhenActive()
            }
        }
    }
}
