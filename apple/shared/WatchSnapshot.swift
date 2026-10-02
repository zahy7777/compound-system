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

struct WatchTemplate: Codable, Identifiable, Equatable {
    let id: Int
    let name: String
    let itemCount: Int
}

struct WatchSnapshot: Codable, Equatable {
    let environment: String
    let generatedAt: TimeInterval
    let resultTimers: [WatchItem]
    let running: WatchArea
    let todo: WatchArea
    let templates: [WatchTemplate]

    private enum CodingKeys: String, CodingKey {
        case environment, generatedAt, resultTimers, running, todo, templates
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        environment = try values.decode(String.self, forKey: .environment)
        generatedAt = try values.decode(TimeInterval.self, forKey: .generatedAt)
        resultTimers = try values.decode([WatchItem].self, forKey: .resultTimers)
        running = try values.decode(WatchArea.self, forKey: .running)
        todo = try values.decode(WatchArea.self, forKey: .todo)
        templates = try values.decodeIfPresent([WatchTemplate].self, forKey: .templates) ?? []
    }
}

struct WatchCommand: Encodable, Sendable {
    let action: String
    var itemID: String?
    var loopID: String?
    var templateID: Int?
    var text: String?
    var name: String?

    static func item(_ action: String, id: String) -> Self {
        Self(action: action, itemID: id)
    }

    static func createTodo(_ text: String) -> Self {
        Self(action: "create-todo", text: text)
    }

    static func createLoop(_ name: String) -> Self {
        Self(action: "create-loop", name: name)
    }

    static func createLoopItem(_ text: String, loopID: String) -> Self {
        Self(action: "create-loop-item", loopID: loopID, text: text)
    }

    static func deleteLoop(_ loopID: String) -> Self {
        Self(action: "delete-loop", loopID: loopID)
    }

    static func useTemplate(_ templateID: Int) -> Self {
        Self(action: "use-template", templateID: templateID)
    }
}
