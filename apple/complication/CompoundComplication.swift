import SwiftUI
import WidgetKit

private struct CompoundEntry: TimelineEntry {
    let date: Date
    let task: ComplicationTask?
}

private final class TimelineReply: @unchecked Sendable {
    let send: (Timeline<CompoundEntry>) -> Void
    init(_ send: @escaping (Timeline<CompoundEntry>) -> Void) { self.send = send }
}

private struct CompoundProvider: TimelineProvider {
    func placeholder(in context: Context) -> CompoundEntry { CompoundEntry(date: .now, task: nil) }
    func getSnapshot(in context: Context, completion: @escaping (CompoundEntry) -> Void) { completion(CompoundEntry(date: .now, task: ComplicationStore.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CompoundEntry>) -> Void) {
        let reply = TimelineReply(completion)
        Task {
            _ = try? await WatchDirectClient.snapshot()
            reply.send(Timeline(entries: [CompoundEntry(date: .now, task: ComplicationStore.read())], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
}

private struct CompoundComplicationView: View {
    let entry: CompoundEntry

    var body: some View {
        if let task = entry.task {
            HStack(spacing: 4) {
                Button(intent: ComplicationActionIntent(action: task.timerState == "running" ? "pause" : "resume", itemID: task.id)) {
                    Image(systemName: task.timerState == "running" ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 32, height: 32)
                        .background(.white.opacity(0.38), in: Circle())
                }
                .buttonStyle(.plain)
                Text(task.title)
                    .font(.caption.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity)
                Button(intent: ComplicationActionIntent(action: "archive", itemID: task.id)) {
                    Image(systemName: "archivebox.fill")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 32, height: 32)
                        .background(.white.opacity(0.38), in: Circle())
                }
                .buttonStyle(.plain)
            }
        } else {
            mark
        }
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
                        colors: [Color(red: 0.90, green: 0.82, blue: 1), Color(red: 0.72, green: 0.94, blue: 1), Color(red: 1, green: 0.80, blue: 0.91)],
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
