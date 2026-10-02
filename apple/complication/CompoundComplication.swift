import SwiftUI
import WidgetKit

private struct CompoundEntry: TimelineEntry {
    let date: Date
    let task: ComplicationTask?
}

private struct CompoundProvider: TimelineProvider {
    func placeholder(in context: Context) -> CompoundEntry { CompoundEntry(date: .now, task: nil) }
    func getSnapshot(in context: Context, completion: @escaping (CompoundEntry) -> Void) { completion(CompoundEntry(date: .now, task: ComplicationStore.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CompoundEntry>) -> Void) {
        completion(Timeline(entries: [CompoundEntry(date: .now, task: ComplicationStore.read())], policy: .never))
    }
}

private struct CompoundComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CompoundEntry

    var body: some View {
        if let task = entry.task {
            HStack(spacing: 7) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title).font(.caption2.weight(.semibold)).lineLimit(1)
                    timer(task)
                }
                Spacer(minLength: 2)
                HStack(spacing: 4) {
                    Button(intent: ComplicationActionIntent(action: task.timerState == "running" ? "pause" : "resume", itemID: task.id)) {
                        Image(systemName: task.timerState == "running" ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.plain)
                    Button(intent: ComplicationActionIntent(action: "archive", itemID: task.id)) {
                        Image(systemName: "archivebox.fill")
                    }
                    .buttonStyle(.plain)
                }
            }
        } else {
            mark
        }
    }

    @ViewBuilder
    private func timer(_ task: ComplicationTask) -> some View {
        if task.timerState == "running" {
            Text(Date(timeIntervalSince1970: task.generatedAt - task.elapsedMs / 1000), style: .timer)
                .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
        } else {
            Text(format(task.elapsedMs)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
        }
    }

    private func format(_ milliseconds: Double) -> String {
        let seconds = Int(milliseconds / 1000)
        return String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
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
