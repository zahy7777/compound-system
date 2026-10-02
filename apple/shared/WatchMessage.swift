import Foundation

struct WatchCredential: Codable, Equatable {
    let token: String
    let expiresAt: TimeInterval
    let environment: String
    let baseURL: URL

    var isUsable: Bool { expiresAt > Date().timeIntervalSince1970 + 60 }
}

enum WatchMessage {
    static let command = "command"
    static let refresh = "refresh"
    static let perform = "perform"
    static let requestCredential = "requestCredential"
    static let action = "action"
    static let itemID = "itemID"
    static let succeeded = "succeeded"
    static let invalidated = "invalidated"
    static let status = "status"
    static let updatedAt = "updatedAt"
    static let snapshot = "snapshot"
    static let credential = "credential"

    static func connectedSnapshot(date: Date = .now) -> [String: Any] {
        [status: "iPhone 已连接", updatedAt: date.timeIntervalSince1970]
    }
}
