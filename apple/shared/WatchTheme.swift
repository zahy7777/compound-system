import SwiftUI

enum WatchThemeID: String, CaseIterable, Codable, Identifiable, Sendable {
    case defaultTheme = "default"
    case phantom

    var id: Self { self }

    var label: String {
        switch self {
        case .defaultTheme: "默认"
        case .phantom: "幻影"
        }
    }
}

enum WatchThemeStore {
    private static let key = "watch.theme"
    private static let suite = "group.com.haisong.compound"

    static var phone: WatchThemeID {
        get { read(from: .standard) }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: key) }
    }

    static var watch: WatchThemeID {
        get { read(from: UserDefaults(suiteName: suite)) }
        set { UserDefaults(suiteName: suite)?.set(newValue.rawValue, forKey: key) }
    }

    private static func read(from defaults: UserDefaults?) -> WatchThemeID {
        WatchThemeID(rawValue: defaults?.string(forKey: key) ?? "") ?? .defaultTheme
    }
}

struct WatchThemePalette {
    let id: WatchThemeID

    var primaryText: Color {
        id == .phantom ? Color(red: 0.05, green: 0.04, blue: 0.04) : Color(red: 0.16, green: 0.12, blue: 0.30)
    }

    var secondaryText: Color {
        id == .phantom ? Color(red: 0.95, green: 0.12, blue: 0.14) : Color.indigo.opacity(0.82)
    }

    var play: Color { id == .phantom ? Color(red: 1, green: 0.82, blue: 0.08) : Color(red: 0.02, green: 0.65, blue: 0.43) }
    var pause: Color { id == .phantom ? Color(red: 0.74, green: 0.20, blue: 0.94) : Color(red: 0.45, green: 0.28, blue: 0.92) }
    var archive: Color { id == .phantom ? Color(red: 0.94, green: 0.04, blue: 0.08) : Color(red: 0.96, green: 0.45, blue: 0.42) }
    var delete: Color { id == .phantom ? Color(red: 0.08, green: 0.06, blue: 0.07) : Color(red: 0.94, green: 0.25, blue: 0.34) }
    var add: Color { id == .phantom ? Color(red: 0.05, green: 0.70, blue: 0.80) : Color(red: 0.03, green: 0.58, blue: 0.78) }
    var template: Color { id == .phantom ? Color(red: 0.96, green: 0.08, blue: 0.14) : Color(red: 0.96, green: 0.48, blue: 0.12) }

    func artwork(for stableID: String) -> (symbol: String, color: Color) {
        let symbols = ["flame.fill", "bolt.fill", "gamecontroller.fill", "tram.fill", "camera.fill", "music.note", "book.fill"]
        let colors: [Color] = [.yellow, .cyan, .purple, .red, .orange, .pink, .mint]
        let index = stableID.utf8.reduce(0) { ($0 &* 31 &+ Int($1)) % symbols.count }
        return (symbols[index], colors[index])
    }
}

extension WatchThemeID {
    var palette: WatchThemePalette { WatchThemePalette(id: self) }
}

struct PhantomPanel: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 7, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + 3))
        path.addLine(to: CGPoint(x: rect.maxX - 6, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - 4))
        path.closeSubpath()
        return path
    }
}
