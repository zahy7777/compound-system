import SwiftUI
import WidgetKit

private struct CompoundEntry: TimelineEntry {
    let date: Date
    let task: ComplicationTask?
    let feedback: ComplicationFeedback?

    var presentationID: String {
        if let feedback { return feedback.id }
        guard let task else { return "empty" }
        return "\(task.id):\(task.timerState)"
    }
}

private final class TimelineReply: @unchecked Sendable {
    let send: (Timeline<CompoundEntry>) -> Void
    init(_ send: @escaping (Timeline<CompoundEntry>) -> Void) { self.send = send }
}

private struct CompoundProvider: TimelineProvider {
    func placeholder(in context: Context) -> CompoundEntry {
        CompoundEntry(date: .now, task: nil, feedback: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (CompoundEntry) -> Void) {
        let now = Date.now
        completion(CompoundEntry(date: now, task: ComplicationStore.read(), feedback: ComplicationStore.feedback(at: now)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CompoundEntry>) -> Void) {
        let reply = TimelineReply(completion)
        Task {
            let now = Date.now
            if let feedback = ComplicationStore.feedback(at: now) {
                let task = ComplicationStore.read()
                reply.send(Timeline(
                    entries: [
                        CompoundEntry(date: now, task: task, feedback: feedback),
                        CompoundEntry(date: feedback.expiresAt, task: task, feedback: nil),
                    ],
                    policy: .after(now.addingTimeInterval(15 * 60))
                ))
                return
            }
            _ = try? await WatchDirectClient.snapshot()
            let refreshedAt = Date.now
            let task = ComplicationStore.read()
            reply.send(Timeline(
                entries: [CompoundEntry(date: refreshedAt, task: task, feedback: nil)],
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
                HStack(spacing: 4) {
                    Button(intent: ComplicationActionIntent(action: task.timerState == "running" ? "pause" : "resume", itemID: task.id)) {
                        Image(systemName: task.timerState == "running" ? "pause.fill" : "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 32, height: 32)
                            .background(task.timerState == "running" ? Color(red: 0.34, green: 0.22, blue: 0.92) : Color(red: 0.02, green: 0.65, blue: 0.43), in: Circle())
                            .overlay(Circle().stroke(.white.opacity(0.95), lineWidth: 1.5))
                            .shadow(color: task.timerState == "running" ? .purple.opacity(0.8) : .green.opacity(0.8), radius: 5)
                    }
                    .buttonStyle(.plain)
                    Text(task.title)
                        .font(.system(size: 22, weight: .black, design: .rounded))
                        .foregroundStyle(Color(red: 0.18, green: 0.03, blue: 0.42))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .contentTransition(.opacity)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        .shadow(color: .white.opacity(0.9), radius: 2)
                    Button(intent: ComplicationActionIntent(action: "archive", itemID: task.id)) {
                        Image(systemName: "archivebox.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(Color(red: 0.94, green: 0.25, blue: 0.34), in: Circle())
                            .overlay(Circle().stroke(.white.opacity(0.95), lineWidth: 1.5))
                            .shadow(color: .red.opacity(0.72), radius: 5)
                    }
                    .buttonStyle(.plain)
                }
                .invalidatableContent()
                .transition(.opacity)
            } else {
                mark
                    .transition(.opacity)
            }
        }
        .id(entry.presentationID)
        .animation(.spring(response: 0.064, dampingFraction: 0.55), value: entry.presentationID)
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
            Circle().fill(.white.opacity(0.82))
            Image(systemName: "sparkles")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color(red: 0.45, green: 0.28, blue: 0.92))
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
                    LinearGradient(
                        colors: entry.feedback?.colors ?? [Color(red: 0.90, green: 0.82, blue: 1), Color(red: 0.72, green: 0.94, blue: 1), Color(red: 1, green: 0.80, blue: 0.91)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
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
