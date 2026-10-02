import SwiftUI

private enum WatchPage: String, CaseIterable, Identifiable {
    case running = "运行"
    case todo = "待办"
    var id: Self { self }
}

struct WatchContentView: View {
    @ObservedObject var session: WatchSession
    @State private var page: WatchPage = .running

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                ForEach(WatchPage.allCases) { value in
                    Button(value.rawValue) { page = value }
                        .buttonStyle(.plain)
                        .font(.caption.weight(page == value ? .semibold : .regular))
                        .foregroundStyle(page == value ? Color.black : Color.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background(page == value ? Color.accentColor : Color.clear, in: Capsule())
                }
            }
            .padding(2)
            .background(.quaternary, in: Capsule())

            if let snapshot = session.snapshot {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    ScrollView {
                        if page == .running { running(snapshot, at: context.date) }
                        else { area(snapshot.todo, empty: "暂无待办小事", snapshot: snapshot, at: context.date) }
                    }
                }
            } else {
                VStack(spacing: 8) {
                    Text(session.status).multilineTextAlignment(.center)
                    Button("刷新") { session.refresh() }.disabled(session.refreshing)
                }
                .padding(.top, 12)
            }
        }
        .onAppear { session.activate() }
    }

    @ViewBuilder
    private func running(_ snapshot: WatchSnapshot, at date: Date) -> some View {
        if !snapshot.resultTimers.isEmpty {
            sectionTitle("结果计时")
            ForEach(snapshot.resultTimers) { timerRow($0, snapshot: snapshot, at: date, emphasized: true) }
        }
        area(snapshot.running, empty: "暂无运行中的小事", snapshot: snapshot, at: date)
    }

    @ViewBuilder
    private func area(_ area: WatchArea, empty: String, snapshot: WatchSnapshot, at date: Date) -> some View {
        if area.direct.isEmpty && area.loops.isEmpty {
            Text(empty).foregroundStyle(.secondary).padding(.top, 16)
        } else {
            if !area.direct.isEmpty {
                sectionTitle("无闭环")
                ForEach(area.direct) { timerRow($0, snapshot: snapshot, at: date) }
            }
            ForEach(area.loops) { group in
                sectionTitle(group.name, count: group.items.count)
                ForEach(group.items) { timerRow($0, snapshot: snapshot, at: date) }
            }
        }
    }

    private func sectionTitle(_ title: String, count: Int? = nil) -> some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            if let count { Text("\(count) 件").font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(.top, 8)
    }

    private func timerRow(_ item: WatchItem, snapshot: WatchSnapshot, at date: Date, emphasized: Bool = false) -> some View {
        HStack(spacing: 6) {
            if item.timerState == "running" { Circle().fill(.green).frame(width: 6, height: 6) }
            Text(item.title).lineLimit(2).font(emphasized ? .body.weight(.semibold) : .body)
            Spacer(minLength: 2)
            if item.timerState != "idle" {
                Text(duration(item, snapshot: snapshot, at: date)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private func duration(_ item: WatchItem, snapshot: WatchSnapshot, at date: Date) -> String {
        var milliseconds = item.elapsedMs
        if item.timerState == "running" {
            milliseconds += max(0, date.timeIntervalSince1970 - snapshot.generatedAt) * 1000
        }
        let seconds = Int(milliseconds / 1000)
        return String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    }
}
