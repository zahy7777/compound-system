import SwiftUI

private enum WatchPage: String, CaseIterable, Identifiable {
    case running = "运行"
    case todo = "待办"
    var id: Self { self }
}

private enum ItemMode { case result, running, todo }

struct WatchContentView: View {
    @ObservedObject var session: WatchSession
    @State private var page: WatchPage = .running

    var body: some View {
        ZStack {
            dreamyBackground
            VStack(spacing: 7) {
                pagePicker
                if let error = session.actionError {
                    Text(error)
                        .font(.caption2).foregroundStyle(Color(red: 0.62, green: 0.08, blue: 0.25))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .frame(maxWidth: .infinity)
                        .background(Color.white.opacity(0.72), in: Capsule())
                }
                if let snapshot = session.snapshot {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        ScrollView {
                            VStack(spacing: 8) {
                                if page == .running { running(snapshot, at: context.date) }
                                else { area(snapshot.todo, mode: .todo, empty: "待办已清空", snapshot: snapshot, at: context.date) }
                            }
                            .padding(.bottom, 8)
                        }
                    }
                } else {
                    connectionPlaceholder
                }
            }
        }
        .onAppear { session.activate() }
    }

    private var dreamyBackground: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.93, green: 0.86, blue: 1), Color(red: 0.78, green: 0.94, blue: 1), Color(red: 1, green: 0.86, blue: 0.94)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle().fill(Color.white.opacity(0.65)).frame(width: 105).blur(radius: 18).offset(x: 72, y: -82)
            Circle().fill(Color.pink.opacity(0.25)).frame(width: 92).blur(radius: 22).offset(x: -78, y: 92)
        }
        .ignoresSafeArea()
    }

    private var pagePicker: some View {
        HStack(spacing: 3) {
            ForEach(WatchPage.allCases) { value in
                pageButton(value)
            }
            if let environment = session.snapshot?.environment {
                Text(environment)
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.indigo.opacity(0.7))
                    .padding(.horizontal, 5)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.58), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.8)))
    }

    private func pageButton(_ value: WatchPage) -> some View {
        let selected = page == value
        return Button(value.rawValue) { withAnimation(.easeOut(duration: 0.18)) { page = value } }
            .buttonStyle(.plain)
            .font(.caption.weight(.semibold))
            .foregroundStyle(selected ? Color.white : Color.indigo.opacity(0.72))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(selected ? Color(red: 0.46, green: 0.32, blue: 0.92) : Color.clear, in: Capsule())
    }

    private var connectionPlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "iphone.and.arrow.forward").font(.title2).foregroundStyle(.purple)
            Text(session.status).font(.footnote).foregroundStyle(Color.indigo).multilineTextAlignment(.center)
            Button("刷新") { session.refresh() }
                .buttonStyle(.borderedProminent).controlSize(.small).disabled(session.refreshing)
        }
        .padding(.top, 18)
    }

    @ViewBuilder
    private func running(_ snapshot: WatchSnapshot, at date: Date) -> some View {
        if !snapshot.resultTimers.isEmpty {
            sectionTitle("结果计时", symbol: "timer")
            ForEach(snapshot.resultTimers) { itemCard($0, mode: .result, snapshot: snapshot, at: date) }
        }
        area(snapshot.running, mode: .running, empty: "暂无运行中的小事", snapshot: snapshot, at: date)
    }

    @ViewBuilder
    private func area(_ area: WatchArea, mode: ItemMode, empty: String, snapshot: WatchSnapshot, at date: Date) -> some View {
        if area.direct.isEmpty && area.loops.isEmpty {
            VStack(spacing: 7) {
                Image(systemName: "checkmark.circle").font(.title2).foregroundStyle(Color(red: 0.08, green: 0.62, blue: 0.48))
                Text(empty).font(.footnote).foregroundStyle(Color.indigo.opacity(0.72))
            }
            .padding(.top, 18)
        } else {
            if !area.direct.isEmpty {
                sectionTitle("无闭环", symbol: "circle.dashed")
                ForEach(area.direct) { itemCard($0, mode: mode, snapshot: snapshot, at: date) }
            }
            ForEach(area.loops) { group in
                sectionTitle(group.name, symbol: "arrow.trianglehead.2.clockwise", count: group.items.count)
                ForEach(group.items) { itemCard($0, mode: mode, snapshot: snapshot, at: date) }
            }
        }
    }

    private func sectionTitle(_ title: String, symbol: String, count: Int? = nil) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.caption2).foregroundStyle(.purple)
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(Color.indigo).lineLimit(1)
            Spacer()
            if let count { Text("\(count) 件").font(.caption2).foregroundStyle(Color.indigo.opacity(0.55)) }
        }
        .padding(.top, 5).padding(.horizontal, 3)
    }

    private func itemCard(_ item: WatchItem, mode: ItemMode, snapshot: WatchSnapshot, at date: Date) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(item.title)
                .font(mode == .result ? .body.weight(.semibold) : .body)
                .foregroundStyle(Color(red: 0.16, green: 0.12, blue: 0.30))
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 5) {
                Circle().fill(item.timerState == "running" ? Color(red: 0.04, green: 0.68, blue: 0.49) : Color.indigo.opacity(0.4)).frame(width: 6, height: 6)
                Text(item.timerState == "running" ? "计时中" : item.timerState == "paused" ? "已暂停" : "未计时")
                    .font(.caption2).foregroundStyle(Color.indigo.opacity(0.62))
                Spacer()
                Text(duration(item, snapshot: snapshot, at: date))
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(item.timerState == "running" ? Color(red: 0.02, green: 0.52, blue: 0.38) : Color.indigo.opacity(0.62))
            }
            actionRow(item, mode: mode)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(mode == .result ? Color(red: 0.90, green: 0.87, blue: 1).opacity(0.9) : Color.white.opacity(0.72))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.9)))
                .shadow(color: Color.purple.opacity(0.15), radius: 7, y: 3)
        )
        .opacity(session.busyItemID == item.id ? 0.55 : 1)
    }

    @ViewBuilder
    private func actionRow(_ item: WatchItem, mode: ItemMode) -> some View {
        if mode == .todo {
            compactButton("运行", symbol: "play.fill", tint: Color(red: 0.10, green: 0.68, blue: 0.55)) { session.perform("run", item: item) }
        } else {
            HStack(spacing: 6) {
                compactButton(item.timerState == "running" ? "暂停" : "继续", symbol: item.timerState == "running" ? "pause.fill" : "play.fill", tint: Color(red: 0.42, green: 0.31, blue: 0.90)) {
                    session.perform(item.timerState == "running" ? "pause" : "resume", item: item)
                }
                compactButton("归档", symbol: "archivebox.fill", tint: Color(red: 0.96, green: 0.45, blue: 0.42)) { session.perform("archive", item: item) }
            }
        }
    }

    private func compactButton(_ title: String, symbol: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.caption2.weight(.semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(tint).controlSize(.mini)
        .disabled(session.busyItemID != nil)
    }

    private func duration(_ item: WatchItem, snapshot: WatchSnapshot, at date: Date) -> String {
        var milliseconds = item.elapsedMs
        if item.timerState == "running" { milliseconds += max(0, date.timeIntervalSince1970 - snapshot.generatedAt) * 1000 }
        let seconds = Int(milliseconds / 1000)
        return String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    }
}
