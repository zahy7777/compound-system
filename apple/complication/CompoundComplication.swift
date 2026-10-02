import SwiftUI
import WidgetKit

private struct CompoundEntry: TimelineEntry {
    let date: Date
    let task: ComplicationTask?
    let feedback: ComplicationFeedback?
    let theme: WatchThemeID

    var presentationID: String {
        if let feedback { return "\(theme.rawValue):\(feedback.id)" }
        guard let task else { return "empty" }
        return "\(theme.rawValue):\(task.id):\(task.timerState)"
    }
}

private final class TimelineReply: @unchecked Sendable {
    let send: (Timeline<CompoundEntry>) -> Void
    init(_ send: @escaping (Timeline<CompoundEntry>) -> Void) { self.send = send }
}

private struct CompoundProvider: TimelineProvider {
    func placeholder(in context: Context) -> CompoundEntry {
        CompoundEntry(date: .now, task: nil, feedback: nil, theme: .defaultTheme)
    }

    func getSnapshot(in context: Context, completion: @escaping (CompoundEntry) -> Void) {
        let now = Date.now
        completion(CompoundEntry(date: now, task: ComplicationStore.read(), feedback: ComplicationStore.feedback(at: now), theme: WatchThemeStore.watch))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CompoundEntry>) -> Void) {
        let reply = TimelineReply(completion)
        Task {
            let now = Date.now
            if let feedback = ComplicationStore.feedback(at: now) {
                let task = ComplicationStore.read()
                reply.send(Timeline(
                    entries: [
                        CompoundEntry(date: now, task: task, feedback: feedback, theme: WatchThemeStore.watch),
                        CompoundEntry(date: feedback.expiresAt, task: task, feedback: nil, theme: WatchThemeStore.watch),
                    ],
                    policy: .after(now.addingTimeInterval(15 * 60))
                ))
                return
            }
            _ = try? await WatchDirectClient.snapshot()
            let refreshedAt = Date.now
            let task = ComplicationStore.read()
            reply.send(Timeline(
                entries: [CompoundEntry(date: refreshedAt, task: task, feedback: nil, theme: WatchThemeStore.watch)],
                policy: .after(refreshedAt.addingTimeInterval(15 * 60))
            ))
        }
    }
}

private struct CompoundComplicationView: View {
    let entry: CompoundEntry

    var body: some View {
        ZStack {
            if let feedback = entry.feedback {
                feedbackView(feedback)
                    .transition(.scale(scale: 0.45).combined(with: .opacity))
            } else if let task = entry.task {
                taskView(task)
                .transition(.opacity)
            } else {
                mark
                    .transition(.opacity)
            }
        }
        .id(entry.presentationID)
        .animation(.spring(response: 0.064, dampingFraction: 0.55), value: entry.presentationID)
    }

    private func taskView(_ task: ComplicationTask) -> some View {
        HStack(spacing: 5) {
            actionButton(
                action: task.timerState == "running" ? "pause" : "resume",
                itemID: task.id,
                symbol: task.timerState == "running" ? "pause.fill" : "play.fill",
                title: task.timerState == "running" ? "暂停" : "继续",
                color: task.timerState == "running" ? entry.theme.palette.pause : entry.theme.palette.play
            )

            VStack(spacing: 0) {
                timerText(task)
                    .font(.system(size: 22, weight: .black, design: .rounded).monospacedDigit())
                    .foregroundStyle(entry.theme == .phantom ? Color(red: 1, green: 0.82, blue: 0.08) : Color(red: 0.18, green: 0.03, blue: 0.42))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .contentTransition(.numericText())
                    .shadow(color: entry.theme == .phantom ? Color.red : .white.opacity(0.95), radius: 2)
                Text(task.title)
                    .font(.system(size: 10, weight: entry.theme == .phantom ? .black : .bold, design: .rounded))
                    .foregroundStyle(entry.theme == .phantom ? Color.white : Color(red: 0.28, green: 0.10, blue: 0.48))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .contentTransition(.opacity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            .invalidatableContent()

            actionButton(
                action: "archive",
                itemID: task.id,
                symbol: "archivebox.fill",
                title: "归档",
                color: entry.theme.palette.archive
            )
        }
    }

    private func actionButton(
        action: String,
        itemID: String,
        symbol: String,
        title: String,
        color: Color
    ) -> some View {
        Button(intent: ComplicationActionIntent(action: action, itemID: itemID)) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .black))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 36, maxWidth: 36, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: entry.theme == .phantom ? 7 : 11, style: .continuous)
                        .fill(color)
                        .overlay(RoundedRectangle(cornerRadius: entry.theme == .phantom ? 7 : 11).stroke(.white.opacity(0.96), lineWidth: 1.5))
                }
                .shadow(color: color.opacity(0.78), radius: 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(minWidth: 36, maxWidth: 36, maxHeight: .infinity)
        .accessibilityLabel(title)
    }

    @ViewBuilder
    private func timerText(_ task: ComplicationTask) -> some View {
        if task.timerState == "running" {
            Text(
                timerInterval: Date(timeIntervalSince1970: task.generatedAt - task.elapsedMs / 1000)...Date.distantFuture,
                countsDown: false,
                showsHours: task.elapsedMs >= 3_600_000
            )
        } else {
            Text(formatElapsed(task.elapsedMs))
        }
    }

    private func formatElapsed(_ milliseconds: Double) -> String {
        let seconds = Int(milliseconds / 1000)
        let hours = seconds / 3600
        let minutes = seconds / 60 % 60
        let remainingSeconds = seconds % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds) }
        return String(format: "%02d:%02d", minutes, remainingSeconds)
    }

    private func feedbackView(_ feedback: ComplicationFeedback) -> some View {
        HStack(spacing: 8) {
            ZStack {
                Circle()
                    .stroke(feedback.colors[1].opacity(0.9), lineWidth: 2)
                    .frame(width: 39, height: 39)
                Image(systemName: "sparkle")
                    .font(.system(size: 8, weight: .black))
                    .foregroundStyle(feedback.colors[1])
                    .offset(x: 17, y: -14)
                Image(systemName: feedback.symbol)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(.white)
                    .shadow(color: feedback.colors[0], radius: 6)
                    .contentTransition(.symbolEffect(.replace))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(feedback.title)
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .lineLimit(1)
                Text(feedback.succeeded ? "已同步" : (feedback.message ?? "请打开 App 查看"))
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                    .opacity(0.88)
            }
            .foregroundStyle(.white)
            Spacer(minLength: 0)
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(feedback.colors[2])
        }
        .padding(.horizontal, 7)
    }

    private var mark: some View {
        ZStack {
            Circle().fill(entry.theme == .phantom ? Color.red : .white.opacity(0.82))
            Image(systemName: "sparkles")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(entry.theme == .phantom ? Color.yellow : Color(red: 0.45, green: 0.28, blue: 0.92))
        }
    }
}

@main
struct CompoundComplication: Widget {
    let kind = "CompoundComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CompoundProvider()) { entry in
            CompoundComplicationView(entry: entry)
                .containerBackground(for: .widget) {
                    if entry.theme == .phantom && entry.feedback == nil {
                        GeometryReader { geometry in
                            Image("phantom-complication-wallpaper")
                                .resizable()
                                .scaledToFill()
                                .frame(width: geometry.size.width, height: geometry.size.height)
                                .clipped()
                        }
                    } else {
                        LinearGradient(
                            colors: entry.feedback?.colors ?? [Color(red: 0.90, green: 0.82, blue: 1), Color(red: 0.72, green: 0.94, blue: 1), Color(red: 1, green: 0.80, blue: 0.91)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    }
                }
        }
        .configurationDisplayName("Compound")
        .description("从表盘快速打开 Compound。")
        .supportedFamilies([.accessoryRectangular])
    }
}

private extension ComplicationFeedback {
    var title: String {
        guard succeeded else { return "操作失败" }
        return switch action {
        case "run", "resume": "开跑！"
        case "pause": "稳住"
        case "archive": "漂亮收官！"
        default: "完成！"
        }
    }

    var symbol: String {
        guard succeeded else { return "xmark.octagon.fill" }
        return switch action {
        case "run", "resume": "bolt.fill"
        case "pause": "pause.fill"
        case "archive": "checkmark.seal.fill"
        default: "sparkles"
        }
    }

    var colors: [Color] {
        guard succeeded else { return [.red, .purple, .black] }
        return switch action {
        case "run", "resume": [.green, .cyan, .blue]
        case "pause": [.indigo, .purple, .blue]
        case "archive": [.orange, .pink, .yellow]
        default: [.pink, .purple, .cyan]
        }
    }
}
