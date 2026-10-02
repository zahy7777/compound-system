import Foundation

enum NavigationDecision: Equatable {
    case allowInsideApp
    case openInSafari
    case cancel
}

enum NavigationPolicy {
    private static let host = "songring.nat100.top"
    private static let pathPrefix = "/compound/dev/"

    static func decide(_ url: URL) -> NavigationDecision {
        guard url.scheme?.lowercased() == "https" else { return .cancel }
        if url.host?.lowercased() == host,
           url.path == "/compound/dev" || url.path.hasPrefix(pathPrefix) {
            return .allowInsideApp
        }
        return .openInSafari
    }
}
