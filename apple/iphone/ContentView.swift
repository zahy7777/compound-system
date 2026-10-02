import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var webView = CompoundWebViewModel()

    var body: some View {
        ZStack {
            CompoundWebView(model: webView)

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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            EnvironmentBar(model: webView)
        }
        .sheet(isPresented: $webView.credentialsPresented) {
            CredentialSheet(model: webView)
                .presentationDetents([.medium])
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                webView.reloadWhenActive()
            }
        }
    }
}

private struct EnvironmentBar: View {
    @ObservedObject var model: CompoundWebViewModel

    var body: some View {
        HStack(spacing: 6) {
            ForEach(AppEnvironment.allCases) { environment in
                Button(environment.label) { model.switchEnvironment(to: environment) }
                    .buttonStyle(.plain)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(model.environment == environment ? Color.white : Color.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(model.environment == environment ? Color.indigo : Color.clear, in: Capsule())
            }
            Spacer()
            Button(action: model.editCredentials) {
                Image(systemName: "key.fill")
                    .font(.caption)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.indigo)
            .accessibilityLabel("管理环境密码")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.ultraThinMaterial)
    }
}

private struct CredentialSheet: View {
    @ObservedObject var model: CompoundWebViewModel
    @State private var dev = ""
    @State private var prod = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("环境密码 · 保存到 iPhone 钥匙串") {
                    SecureField(model.hasCredential(for: .dev) ? "DEV 已保存；留空则不修改" : "输入 DEV 密码", text: $dev)
                        .textContentType(.password)
                    SecureField(model.hasCredential(for: .prod) ? "PROD 已保存；留空则不修改" : "输入 PROD 密码", text: $prod)
                        .textContentType(.password)
                }
                if let error = model.credentialError {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                Text("密码仅保存在本机 Keychain，不会发送给 Watch 或写入工程。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("Compound 环境")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { model.credentialsPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { _ = model.saveCredentials(dev: dev, prod: prod) }
                }
            }
        }
    }
}
