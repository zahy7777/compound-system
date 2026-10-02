import SwiftUI
import WatchKit

private enum WatchPage { case running, todo }

private enum ItemMode { case result, running, todo }

private enum DraftTarget: Sendable {
    case todo
    case loop
    case loopItem(id: String)

    func command(_ text: String) -> WatchCommand {
        switch self {
        case .todo: .createTodo(text)
        case .loop: .createLoop(text)
        case .loopItem(let id): .createLoopItem(text, loopID: id)
        }
    }
}

private struct DraftRequest {
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
            if let request = draftRequest {
                SpeechInputCard(
                    submit: { text in
                        session.perform(request.target.command(text))
                        draftRequest = nil
                    },
                    cancel: { draftRequest = nil }
                )
            } else {
                VStack(spacing: 2) {
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
                                VStack(spacing: 4) {
                                    if page == .running { running(snapshot, at: context.date) }
                                    else {
                                        area(snapshot.todo, mode: .todo, empty: "待办已清空", snapshot: snapshot, at: context.date)
                                        todoToolbar
                                    }
                                }
                                .padding(.top, 24)
                            }
                            .contentMargins(.vertical, 0, for: .scrollContent)
                            .scrollIndicators(.hidden)
                            .ignoresSafeArea(.container, edges: .top)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else {
                        connectionPlaceholder
                    }
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

    private func switchPage(for translation: CGSize) {
        guard draftRequest == nil,
              abs(translation.width) > 35,
              abs(translation.width) > abs(translation.height) * 1.4 else { return }
        let next: WatchPage = translation.width < 0 ? .todo : .running
        guard next != page else { return }
        withAnimation(.easeOut(duration: 0.18)) { page = next }
    }

    private var todoToolbar: some View {
        HStack(spacing: 8) {
            squareButton("新建待办", symbol: "plus", color: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                draftRequest = DraftRequest(target: .todo)
            }
            squareButton("新建闭环", symbol: "folder.badge.plus", color: Color(red: 0.34, green: 0.22, blue: 0.92)) {
                draftRequest = DraftRequest(target: .loop)
            }
            squareButton("从模板创建", symbol: "square.stack.3d.up.fill", color: Color(red: 0.96, green: 0.48, blue: 0.12)) {
                templatesPresented = true
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .disabled(session.busyItemID != nil)
    }

    private func squareButton(_ title: String, symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 27, height: 27)
                .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .disabled(session.busyItemID != nil)
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
            ForEach(activeResults) { taskRow($0, mode: .result, snapshot: snapshot, at: date) }
            ForEach(activeTasks) { taskRow($0, mode: .running, snapshot: snapshot, at: date) }
        }
        if !remainingResults.isEmpty {
            taskGroupCard("结果计时", items: remainingResults, mode: .result, snapshot: snapshot, at: date)
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
            VStack(spacing: 5) {
                Image(systemName: "checkmark.circle").font(.title2).foregroundStyle(Color(red: 0.08, green: 0.62, blue: 0.48))
                Text(empty).font(.footnote).foregroundStyle(Color.indigo.opacity(0.72))
            }
            .padding(.top, 6)
        } else {
            if !area.direct.isEmpty {
                taskGroupCard("无闭环", items: area.direct, mode: mode, snapshot: snapshot, at: date)
            }
            ForEach(area.loops) { group in
                taskGroupCard(group.name, items: group.items, mode: mode, snapshot: snapshot, at: date, group: group)
            }
        }
    }

    private func taskGroupCard(
        _ title: String,
        items: [WatchItem],
        mode: ItemMode,
        snapshot: WatchSnapshot,
        at date: Date,
        group: WatchGroup? = nil
    ) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.indigo)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if mode == .todo, let group {
                    squareButton("新增待办", symbol: "plus", color: Color(red: 0.03, green: 0.58, blue: 0.78)) {
                        draftRequest = DraftRequest(target: .loopItem(id: group.id))
                    }
                    squareButton("删除闭环", symbol: "trash.fill", color: Color(red: 0.94, green: 0.25, blue: 0.34)) {
                        deleteRequest = .loop(group)
                    }
                }
            }
            .frame(height: 27)

            ForEach(items) { taskRow($0, mode: mode, snapshot: snapshot, at: date) }
        }
        .padding(5)
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.62), Color.purple.opacity(0.14)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 15, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.white.opacity(0.82)))
        .shadow(color: Color.purple.opacity(0.13), radius: 6, y: 2)
    }

    private func taskRow(_ item: WatchItem, mode: ItemMode, snapshot: WatchSnapshot, at date: Date) -> some View {
        let active = item.timerState == "running"
        return HStack(spacing: 4) {
            if active {
                Text(duration(item, snapshot: snapshot, at: date))
                    .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(.white)
                    .fixedSize()
            }
            Text(item.title)
                .font(.footnote.weight(mode == .result || active ? .semibold : .regular))
                .foregroundStyle(active ? Color.white.opacity(0.95) : Color(red: 0.16, green: 0.12, blue: 0.30))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            taskActions(item, mode: mode)
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(cardBackground(active: active, mode: mode))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.88)))
                .shadow(color: active ? Color.cyan.opacity(0.48) : Color.clear, radius: 7, y: 2)
        )
        .opacity(session.busyItemID == item.id ? 0.55 : 1)
    }

    private func cardBackground(active: Bool, mode: ItemMode) -> LinearGradient {
        if active {
            return LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.72, blue: 0.62),
                    Color(red: 0.16, green: 0.48, blue: 0.96),
                    Color(red: 0.68, green: 0.24, blue: 0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        let color = mode == .result
            ? Color(red: 0.90, green: 0.87, blue: 1).opacity(0.9)
            : Color.white.opacity(0.72)
        return LinearGradient(colors: [color, color], startPoint: .top, endPoint: .bottom)
    }

    @ViewBuilder private func taskActions(_ item: WatchItem, mode: ItemMode) -> some View {
        if mode == .todo {
            squareButton("运行", symbol: "play.fill", color: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                session.perform("run", item: item)
            }
            squareButton("删除", symbol: "trash.fill", color: Color(red: 0.94, green: 0.25, blue: 0.34)) {
                deleteRequest = .item(item)
            }
        } else {
            squareButton(
                item.timerState == "running" ? "暂停" : "继续",
                symbol: item.timerState == "running" ? "pause.fill" : "play.fill",
                color: item.timerState == "running" ? Color(red: 0.45, green: 0.28, blue: 0.92) : Color(red: 0.02, green: 0.65, blue: 0.43)
            ) {
                session.perform(item.timerState == "running" ? "pause" : "resume", item: item)
            }
            squareButton("归档", symbol: "archivebox.fill", color: Color(red: 0.96, green: 0.45, blue: 0.42)) {
                session.perform("archive", item: item)
            }
        }
    }

    private func duration(_ item: WatchItem, snapshot: WatchSnapshot, at date: Date) -> String {
        var milliseconds = item.elapsedMs
        if item.timerState == "running" { milliseconds += max(0, date.timeIntervalSince1970 - snapshot.generatedAt) * 1000 }
        let seconds = Int(milliseconds / 1000)
        let hours = seconds / 3600
        let minutes = seconds / 60 % 60
        let remainingSeconds = seconds % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds) }
        return String(format: "%02d:%02d", minutes, remainingSeconds)
    }
}

private struct SpeechInputCard: View {
    let submit: (String) -> Void
    let cancel: () -> Void
    @State private var text = ""
    @State private var inputPresented = false
    @State private var inputError: String?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.34, green: 0.20, blue: 0.88),
                    Color(red: 0.88, green: 0.24, blue: 0.64),
                    Color(red: 0.10, green: 0.72, blue: 0.80)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 7) {
                Button(action: presentSystemInput) {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.16))
                            .frame(width: 120, height: 120)
                            .blur(radius: 12)
                        if text.isEmpty {
                            Image(systemName: "waveform.badge.mic")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.92))
                        } else {
                            Text(text)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.white)
                                .multilineTextAlignment(.leading)
                                .lineLimit(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle())

                if let inputError {
                    Text(inputError)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 7) {
                    cardButton("取消", symbol: "xmark", color: Color(red: 0.26, green: 0.29, blue: 0.45)) {
                        cancel()
                    }
                    cardButton("确定", symbol: "checkmark", color: Color(red: 0.02, green: 0.65, blue: 0.43)) {
                        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !value.isEmpty else { return }
                        submit(value)
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(8)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(250))
            presentSystemInput()
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
    private func presentSystemInput() {
        guard !inputPresented else { return }
        guard let controller = WKApplication.shared().visibleInterfaceController
                ?? WKApplication.shared().rootInterfaceController else {
            inputError = "无法打开系统输入，请点击重试"
            return
        }
        inputPresented = true
        inputError = nil
        controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { results in
            Task { @MainActor in
                inputPresented = false
                guard let value = results?.first as? String else { return }
                text = value
            }
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
