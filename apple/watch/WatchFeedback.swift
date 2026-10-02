import SwiftUI
import WatchKit

enum WatchFeedbackKind: Equatable {
    case start
    case pause
    case archive
    case create
    case delete
    case failure

    init(action: String, succeeded: Bool) {
        guard succeeded else {
            self = .failure
            return
        }
        switch action {
        case "run", "resume": self = .start
        case "pause": self = .pause
        case "archive": self = .archive
        case "delete-item", "delete-loop": self = .delete
        case "create-todo", "create-loop", "create-loop-item", "use-template": self = .create
        default: self = .create
        }
    }

    var haptic: WKHapticType {
        switch self {
        case .start: .start
        case .pause: .stop
        case .archive, .create: .success
        case .delete: .directionDown
        case .failure: .failure
        }
    }

    var title: String {
        switch self {
        case .start: "开跑！"
        case .pause: "稳住"
        case .archive: "漂亮收官！"
        case .create: "创建成功！"
        case .delete: "已删除"
        case .failure: "操作失败"
        }
    }

    var symbol: String {
        switch self {
        case .start: "bolt.fill"
        case .pause: "pause.fill"
        case .archive: "checkmark.seal.fill"
        case .create: "sparkles"
        case .delete: "trash.fill"
        case .failure: "xmark.octagon.fill"
        }
    }

    var colors: [Color] {
        switch self {
        case .start: [Color.green, Color.cyan, Color.blue]
        case .pause: [Color.indigo, Color.purple, Color.blue]
        case .archive: [Color.yellow, Color.orange, Color.pink]
        case .create: [Color.pink, Color.purple, Color.cyan]
        case .delete: [Color.red, Color.orange, Color.pink]
        case .failure: [Color.red, Color.purple, Color.black]
        }
    }
}

struct WatchFeedbackEvent: Identifiable, Equatable {
    let id = UUID()
    let kind: WatchFeedbackKind
    let targetID: String

    init(action: String, succeeded: Bool, targetID: String) {
        kind = WatchFeedbackKind(action: action, succeeded: succeeded)
        self.targetID = targetID
    }
}

struct WatchRewardBurst: View {
    let event: WatchFeedbackEvent
    @State private var exploded = false
    @State private var visible = true

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [event.kind.colors[0].opacity(0.72), event.kind.colors[1].opacity(0.3), .clear],
                center: .center,
                startRadius: 2,
                endRadius: 110
            )
            .scaleEffect(exploded ? 1.35 : 0.08)

            Circle()
                .stroke(event.kind.colors[1].opacity(0.9), lineWidth: 4)
                .frame(width: 82, height: 82)
                .scaleEffect(exploded ? 1.8 : 0.15)
                .opacity(exploded ? 0 : 1)

            ForEach(0..<12, id: \.self) { index in
                particle(index)
            }

            VStack(spacing: 5) {
                Image(systemName: event.kind.symbol)
                    .font(.system(size: 34, weight: .black))
                    .foregroundStyle(.white)
                    .symbolRenderingMode(.monochrome)
                    .shadow(color: event.kind.colors[0], radius: 8)
                Text(event.kind.title)
                    .font(.headline.weight(.black))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.35), radius: 3, y: 2)
            }
            .scaleEffect(exploded ? 1 : 0.15)
            .rotationEffect(.degrees(exploded ? 0 : -18))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(event.kind.colors[2].opacity(exploded ? 0.2 : 0.55))
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(false)
        .onAppear {
            WKInterfaceDevice.current().play(event.kind.haptic)
            withAnimation(.spring(response: 0.19, dampingFraction: 0.56)) {
                exploded = true
            }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(360))
                withAnimation(.easeOut(duration: 0.11)) { visible = false }
            }
        }
    }

    private func particle(_ index: Int) -> some View {
        let angle = Double(index) * .pi * 2 / 12
        let distance = CGFloat(54 + (index % 3) * 10)
        return Image(systemName: index.isMultiple(of: 2) ? "sparkle" : "circle.fill")
            .font(.system(size: index.isMultiple(of: 2) ? 12 : 6, weight: .bold))
            .foregroundStyle(event.kind.colors[index % event.kind.colors.count])
            .offset(
                x: exploded ? CGFloat(cos(angle)) * distance : 0,
                y: exploded ? CGFloat(sin(angle)) * distance : 0
            )
            .scaleEffect(exploded ? 1 : 0.1)
            .opacity(exploded ? 0 : 1)
    }
}

struct WatchActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.68 : 1)
            .rotationEffect(.degrees(configuration.isPressed ? -8 : 0))
            .brightness(configuration.isPressed ? 0.18 : 0)
            .animation(.spring(response: 0.22, dampingFraction: 0.46), value: configuration.isPressed)
    }
}
