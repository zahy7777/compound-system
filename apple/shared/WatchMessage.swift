import Foundation

enum WatchMessage {
    static let command = "command"
    static let refresh = "refresh"
    static let perform = "perform"
    static let action = "action"
    static let itemID = "itemID"
    static let succeeded = "succeeded"
    static let status = "status"
    static let updatedAt = "updatedAt"
    static let snapshot = "snapshot"

    static func connectedSnapshot(date: Date = .now) -> [String: Any] {
        [status: "iPhone 已连接", updatedAt: date.timeIntervalSince1970]
    }
}
