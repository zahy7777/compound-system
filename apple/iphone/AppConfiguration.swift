import Foundation
import Security

enum AppEnvironment: String, CaseIterable, Identifiable {
    case dev
    case prod

    var id: Self { self }
    var label: String { rawValue.uppercased() }
    var url: URL {
        switch self {
        case .dev: URL(string: "https://songring.nat100.top/compound/dev/?presentation=mobile")!
        case .prod: URL(string: "https://songring.nat100.top/compound/prod/")!
        }
    }
    var baseURL: URL {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.query = nil
        components.fragment = nil
        return components.url!
    }
}

enum AppConfiguration {
    static let environmentKey = "compound.environment"
    static var savedEnvironment: AppEnvironment {
        get { AppEnvironment(rawValue: UserDefaults.standard.string(forKey: environmentKey) ?? "dev") ?? .dev }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: environmentKey) }
    }
}

struct CredentialStore {
    private let service = "com.haisong.compound.environment-password"

    func password(for environment: AppEnvironment) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: environment.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ password: String, for environment: AppEnvironment) throws {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: environment.rawValue,
        ]
        SecItemDelete(key as CFDictionary)
        var value = key
        value[kSecValueData as String] = Data(password.utf8)
        value[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(value as CFDictionary, nil)
        guard status == errSecSuccess else { throw CredentialError.keychain(status) }
    }
}

enum CredentialError: LocalizedError {
    case keychain(OSStatus)
    var errorDescription: String? { "无法保存到 iPhone 钥匙串" }
}

enum WatchProvisioner {
    private struct LoginResponse: Decodable { let csrf: String }
    private struct TokenResponse: Decodable {
        let token: String
        let expiresAt: TimeInterval
        let environment: String
    }
    private struct ErrorResponse: Decodable { let error: String }

    static func provision(environment: AppEnvironment, password: String) async throws -> WatchCredential {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        let loginURL = URL(string: "access/login", relativeTo: environment.url)!.absoluteURL
        var loginRequest = URLRequest(url: loginURL)
        loginRequest.httpMethod = "POST"
        loginRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        loginRequest.httpBody = try JSONSerialization.data(withJSONObject: ["password": password])
        let (loginData, loginResponse) = try await session.data(for: loginRequest)
        guard let loginHTTP = loginResponse as? HTTPURLResponse, (200..<300).contains(loginHTTP.statusCode) else {
            throw WatchProvisioningError.server(message(from: loginData) ?? "登录失败")
        }
        let login = try JSONDecoder().decode(LoginResponse.self, from: loginData)

        let tokenURL = URL(string: "access/watch-token", relativeTo: environment.url)!.absoluteURL
        var tokenRequest = URLRequest(url: tokenURL)
        tokenRequest.httpMethod = "POST"
        tokenRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        tokenRequest.setValue(login.csrf, forHTTPHeaderField: "X-CSRF-Token")
        let (tokenData, tokenResponse) = try await session.data(for: tokenRequest)
        guard let tokenHTTP = tokenResponse as? HTTPURLResponse, (200..<300).contains(tokenHTTP.statusCode) else {
            throw WatchProvisioningError.server(message(from: tokenData) ?? "令牌签发失败")
        }
        let value = try JSONDecoder().decode(TokenResponse.self, from: tokenData)
        return WatchCredential(token: value.token, expiresAt: value.expiresAt,
                               environment: value.environment.uppercased(), baseURL: environment.baseURL)
    }

    private static func message(from data: Data) -> String? {
        try? JSONDecoder().decode(ErrorResponse.self, from: data).error
    }
}

private enum WatchProvisioningError: LocalizedError {
    case server(String)
    var errorDescription: String? {
        switch self { case .server(let message): message }
    }
}
