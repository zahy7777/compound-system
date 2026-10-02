import Foundation

enum NavigationDecision: Equatable {
    case allowInsideApp
    case openInSafari
    case cancel
}

enum NavigationPolicy {
    private static let host = "songring.nat100.top"
    private static let appRoots = ["/compound/dev", "/compound/prod"]

    static func decide(_ url: URL) -> NavigationDecision {
        guard url.scheme?.lowercased() == "https" else { return .cancel }
        if url.host?.lowercased() == host,
           appRoots.contains(where: { url.path == $0 || url.path.hasPrefix($0 + "/") }) {
            return .allowInsideApp
        }
        return .openInSafari
    }
}
