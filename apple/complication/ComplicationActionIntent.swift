import AppIntents
import Foundation

struct ComplicationActionIntent: AppIntent {
    static let title: LocalizedStringResource = "更新 Compound 小事"
    static let description = IntentDescription("直接连接 Compound 执行计时或归档动作。")

    @Parameter(title: "动作") var action: String
    @Parameter(title: "小事") var itemID: String

    init() {}
    init(action: String, itemID: String) { self.action = action; self.itemID = itemID }

    func perform() async throws -> some IntentResult {
        _ = try await WatchDirectClient.perform(.item(action, id: itemID))
        return .result()
    }
}
