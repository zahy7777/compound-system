import SwiftUI
import WatchKit

private enum WatchPage: String, CaseIterable, Identifiable {
    case running = "运行"
    case todo = "待办"
    var id: Self { self }
}

private enum ItemMode { case result, running, todo }

private enum DraftTarget: Sendable {
    case todo
    case loop
    case loopItem(id: String, name: String)

    var title: String {
        switch self {
        case .todo: "新建待办"
        case .loop: "新建闭环"
        case .loopItem(_, let name): "在「\(name)」中新建待办"
        }
    }

    func command(_ text: String) -> WatchCommand {
        switch self {
        case .todo: .createTodo(text)
        case .loop: .createLoop(text)
        case .loopItem(let id, _): .createLoopItem(text, loopID: id)
        }
    }
}

private struct DraftRequest: Identifiable {
    let id = UUID()
    let target: DraftTarget
}

private enum DeleteRequest: Identifiable {
    case item(WatchItem)
    case loop(WatchGroup)

    var id: String {
        switch self {
        case .item(let item): "item-\(item.id)"
        case .loop(let group): "loop-\(group.id)"
        }
    }
}

struct WatchContentView: View {
    @ObservedObject var session: WatchSession
    @State private var page: WatchPage = .running
    @State private var draftRequest: DraftRequest?
    @State private var deleteRequest: DeleteRequest?
    @State private var templatesPresented = false

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
                        .frame(maxHeight: .infinity)
                    }
                    if page == .todo { todoToolbar }
                } else {
                    connectionPlaceholder
                }
            }
        }
        .onAppear { session.activate() }
        .task {
            while !Task.isCancelled {
                session.refresh()
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    switchPage(for: value.translation)
                }
        )
        .sheet(item: $draftRequest) { request in
            SpeechInputCard(title: request.target.title) { text in
                session.perform(request.target.command(text))
            }
        }
        .sheet(isPresented: $templatesPresented) {
            TemplatePicker(templates: session.snapshot?.templates ?? []) { template in
                session.perform(.useTemplate(template.id))
            }
        }
        .alert(item: $deleteRequest) { request in
            switch request {
            case .item(let item):
                Alert(
                    title: Text("删除这条待办？"),
                    message: Text(item.title),
                    primaryButton: .destructive(Text("删除")) {
                        session.perform(.item("delete-item", id: item.id), busyID: item.id)
                    },
                    secondaryButton: .cancel(Text("取消"))
                )
            case .loop(let group):
                Alert(
                    title: Text("删除闭环「\(group.name)」？"),
                    message: Text("将同时删除其中 \(group.items.count) 条待办。"),
                    primaryButton: .destructive(Text("全部删除")) {
                        session.perform(.deleteLoop(group.id), busyID: group.id)
                    },
                    secondaryButton: .cancel(Text("取消"))
                )
            }
        }
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

    private func switchPage(for translation: CGSize) {
        guard abs(translation.width) > 35,
              abs(translation.width) > abs(translation.height) * 1.4 else { return }
        let next: WatchPage = translation.width < 0 ? .todo : .running
        guard next != page else { return }
        withAnimation(.easeOut(duration: 0.18)) { page = next }
    }

    private var todoToolbar: some View {
        HStack(spacing: 5) {
            pageAction("新建待办", symbol: "plus", color: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                draftRequest = DraftRequest(target: .todo)
            }
            pageAction("新建闭环", symbol: "folder.badge.plus", color: Color(red: 0.34, green: 0.22, blue: 0.92)) {
                draftRequest = DraftRequest(target: .loop)
            }
            pageAction("从模板创建", symbol: "square.stack.3d.up.fill", color: Color(red: 0.96, green: 0.48, blue: 0.12)) {
                templatesPresented = true
            }
        }
        .disabled(session.busyItemID != nil)
    }

    private func pageAction(_ title: String, symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: symbol).font(.system(size: 13, weight: .bold))
                Text(title).font(.system(size: 8, weight: .bold)).lineLimit(1)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
            .background(color, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
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
        let activeResults = snapshot.resultTimers.filter { $0.timerState == "running" }
        let activeTasks = snapshot.running.direct.filter { $0.timerState == "running" }
            + snapshot.running.loops.flatMap(\.items).filter { $0.timerState == "running" }
        let remainingResults = snapshot.resultTimers.filter { $0.timerState != "running" }
        let remainingArea = withoutActiveTimer(snapshot.running)

        if !activeResults.isEmpty || !activeTasks.isEmpty {
            sectionTitle("正在计时", symbol: "timer")
            ForEach(activeResults) { itemCard($0, mode: .result, snapshot: snapshot, at: date) }
            ForEach(activeTasks) { itemCard($0, mode: .running, snapshot: snapshot, at: date) }
        }
        if !remainingResults.isEmpty {
            sectionTitle("结果计时", symbol: "timer")
            ForEach(remainingResults) { itemCard($0, mode: .result, snapshot: snapshot, at: date) }
        }
        if !remainingArea.direct.isEmpty || !remainingArea.loops.isEmpty {
            area(remainingArea, mode: .running, empty: "暂无运行中的小事", snapshot: snapshot, at: date)
        } else if activeResults.isEmpty && activeTasks.isEmpty && remainingResults.isEmpty {
            area(remainingArea, mode: .running, empty: "暂无运行中的小事", snapshot: snapshot, at: date)
        }
    }

    private func withoutActiveTimer(_ area: WatchArea) -> WatchArea {
        let direct = area.direct.filter { $0.timerState != "running" }
        let loops = area.loops.compactMap { group -> WatchGroup? in
            let items = group.items.filter { $0.timerState != "running" }
            return items.isEmpty ? nil : WatchGroup(id: group.id, name: group.name, items: items)
        }
        return WatchArea(direct: direct, loops: loops)
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
                if mode == .todo { todoLoopTitle(group) }
                else { sectionTitle(group.name, symbol: "arrow.trianglehead.2.clockwise", count: group.items.count) }
                ForEach(group.items) { itemCard($0, mode: mode, snapshot: snapshot, at: date) }
            }
        }
    }

    private func todoLoopTitle(_ group: WatchGroup) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.trianglehead.2.clockwise")
                .font(.caption2).foregroundStyle(.purple)
            Text(group.name)
                .font(.caption.weight(.semibold)).foregroundStyle(Color.indigo).lineLimit(1)
            Text("\(group.items.count)")
                .font(.caption2).foregroundStyle(Color.indigo.opacity(0.55))
            Spacer(minLength: 2)
            groupButton(symbol: "plus", color: Color(red: 0.03, green: 0.58, blue: 0.78)) {
                draftRequest = DraftRequest(target: .loopItem(id: group.id, name: group.name))
            }
            groupButton(symbol: "trash.fill", color: Color(red: 0.94, green: 0.25, blue: 0.34)) {
                deleteRequest = .loop(group)
            }
        }
        .padding(.top, 5).padding(.horizontal, 3)
        .disabled(session.busyItemID != nil)
    }

    private func groupButton(symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 27, height: 27)
                .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
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
            HStack(spacing: 6) {
                compactButton("运行", symbol: "play.fill", tint: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                    session.perform("run", item: item)
                }
                compactButton("删除", symbol: "trash.fill", tint: Color(red: 0.94, green: 0.25, blue: 0.34)) {
                    deleteRequest = .item(item)
                }
            }
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
        .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).tint(tint).controlSize(.mini)
        .disabled(session.busyItemID != nil)
    }

    private func duration(_ item: WatchItem, snapshot: WatchSnapshot, at date: Date) -> String {
        var milliseconds = item.elapsedMs
        if item.timerState == "running" { milliseconds += max(0, date.timeIntervalSince1970 - snapshot.generatedAt) * 1000 }
        let seconds = Int(milliseconds / 1000)
        return String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    }
}

private struct SpeechInputCard: View {
    let title: String
    let submit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "waveform.badge.mic")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Color(red: 0.42, green: 0.25, blue: 0.92))
                Text(title)
                    .font(.headline).multilineTextAlignment(.center)
                Button(action: dictate) {
                    Text(text.isEmpty ? "点击开始语音录入" : text)
                        .font(text.isEmpty ? .footnote : .body)
                        .foregroundStyle(text.isEmpty ? Color.indigo.opacity(0.65) : Color(red: 0.16, green: 0.12, blue: 0.30))
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                        .padding(9)
                        .background(Color.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.purple.opacity(0.32)))
                }
                .buttonStyle(.plain)
                HStack(spacing: 7) {
                    cardButton("取消", symbol: "xmark", color: Color(red: 0.38, green: 0.42, blue: 0.55)) {
                        dismiss()
                    }
                    cardButton("确定", symbol: "checkmark", color: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !value.isEmpty else { return }
                        submit(value)
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(8)
        }
        .containerBackground(
            LinearGradient(
                colors: [Color(red: 0.93, green: 0.86, blue: 1), Color(red: 0.78, green: 0.94, blue: 1)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ),
            for: .navigation
        )
        .task {
            try? await Task.sleep(for: .milliseconds(250))
            if text.isEmpty { dictate() }
        }
    }

    private func cardButton(_ title: String, symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(color, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    @MainActor
    private func dictate() {
        guard let controller = WKApplication.shared().visibleInterfaceController else { return }
        controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { results in
            guard let value = results?.first as? String else { return }
            Task { @MainActor in text = value }
        }
    }
}

private struct TemplatePicker: View {
    let templates: [WatchTemplate]
    let select: (WatchTemplate) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("从模板创建闭环").font(.headline)
                if templates.isEmpty {
                    Text("当前没有闭环模板")
                        .font(.footnote).foregroundStyle(.secondary).padding(.top, 18)
                } else {
                    ForEach(templates) { template in
                        Button {
                            select(template)
                            dismiss()
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: "square.stack.3d.up.fill")
                                    .foregroundStyle(.white)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(template.name).font(.body.weight(.semibold)).lineLimit(1)
                                    Text("\(template.itemCount) 条待办").font(.caption2).opacity(0.82)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption.weight(.bold))
                            }
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(Color(red: 0.96, green: 0.48, blue: 0.12), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button("取消") { dismiss() }
                    .buttonStyle(.bordered).tint(Color.indigo)
            }
            .padding(8)
        }
    }
}
