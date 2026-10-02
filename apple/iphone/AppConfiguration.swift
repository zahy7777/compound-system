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
