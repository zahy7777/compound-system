import Foundation

struct WatchItem: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let elapsedMs: Double
    let timerState: String
}

struct WatchGroup: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let items: [WatchItem]
}

struct WatchArea: Codable, Equatable {
    let direct: [WatchItem]
    let loops: [WatchGroup]
}

struct WatchSnapshot: Codable, Equatable {
    let generatedAt: TimeInterval
    let resultTimers: [WatchItem]
    let running: WatchArea
    let todo: WatchArea
}
