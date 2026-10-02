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
    @StateObject private var todoFoldState = TodoFoldState()
    @StateObject private var featuredTimerState = FeaturedTimerState()
    @State private var page: WatchPage = .running
    @State private var draftRequest: DraftRequest?
    @State private var deleteRequest: DeleteRequest?
    @State private var templatesPresented = false

    var body: some View {
        ZStack {
            themeBackground
            if let request = draftRequest {
                SpeechInputCard(
                    theme: session.theme,
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
                                        area(snapshot.todo, mode: .todo, empty: "待办已清空")
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
        .onChange(of: session.snapshot) { _, snapshot in
            if let snapshot { featuredTimerState.reconcile(snapshot) }
        }
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
            TemplatePicker(theme: session.theme, templates: session.snapshot?.templates ?? []) { template in
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
        .overlay {
            if let event = session.feedbackEvent {
                WatchRewardBurst(event: event, theme: session.theme)
                    .id(event.id)
                    .ignoresSafeArea()
            }
        }
    }

    @ViewBuilder
    private var themeBackground: some View {
        if session.theme == .phantom {
            LinearGradient(
                colors: [Color(red: 0.03, green: 0.025, blue: 0.03), .black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        } else {
            dreamyBackground
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
        WKInterfaceDevice.current().play(.click)
        withAnimation(.easeOut(duration: 0.18)) { page = next }
    }

    private var todoToolbar: some View {
        HStack(spacing: 8) {
            squareButton("新建待办", symbol: "plus", color: session.theme.palette.play) {
                draftRequest = DraftRequest(target: .todo)
            }
            squareButton("新建闭环", symbol: "folder.badge.plus", color: session.theme.palette.pause) {
                draftRequest = DraftRequest(target: .loop)
            }
            squareButton("从模板创建", symbol: "square.stack.3d.up.fill", color: session.theme.palette.template) {
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
                .foregroundStyle(session.theme == .phantom && color == session.theme.palette.play ? Color.black : Color.white)
                .frame(width: 27, height: 27)
                .background {
                    RoundedRectangle(cornerRadius: session.theme == .phantom ? 5 : 8, style: .continuous)
                        .fill(color)
                        .overlay {
                            if session.theme == .phantom {
                                RoundedRectangle(cornerRadius: 5).stroke(Color.black, lineWidth: 1.4)
                            }
                        }
                }
        }
        .buttonStyle(WatchActionButtonStyle())
        .accessibilityLabel(title)
        .disabled(session.busyItemID != nil)
    }

    private var connectionPlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "iphone.and.arrow.forward").font(.title2).foregroundStyle(session.theme.palette.secondaryText)
            Text(session.status).font(.footnote).foregroundStyle(session.theme.palette.secondaryText).multilineTextAlignment(.center)
            Button("刷新") { session.refresh() }
                .buttonStyle(.borderedProminent).controlSize(.small).disabled(session.refreshing)
        }
        .padding(.top, 18)
    }

    @ViewBuilder
    private func running(_ snapshot: WatchSnapshot, at date: Date) -> some View {
        let featured = featuredTimerState.item(in: snapshot)
        let featuredID = featured?.id
        let featuredMode: ItemMode = featured.map { item in
            snapshot.resultTimers.contains(where: { $0.id == item.id }) ? .result : .running
        } ?? .running
        let remainingResults = snapshot.resultTimers.filter { $0.id != featuredID }
        let remainingArea = excluding(snapshot.running, itemID: featuredID)

        if let featured {
            activeTimerRow(featured, mode: featuredMode, snapshot: snapshot, at: date)
        }
        if !remainingResults.isEmpty {
            taskGroupCard("结果计时", items: remainingResults, mode: .result)
        }
        if !remainingArea.direct.isEmpty || !remainingArea.loops.isEmpty {
            area(remainingArea, mode: .running, empty: "暂无运行中的小事")
        } else if featured == nil && remainingResults.isEmpty {
            area(remainingArea, mode: .running, empty: "暂无运行中的小事")
        }
    }

    private func excluding(_ area: WatchArea, itemID: String?) -> WatchArea {
        let direct = area.direct.filter { $0.id != itemID }
        let loops = area.loops.compactMap { group -> WatchGroup? in
            let items = group.items.filter { $0.id != itemID }
            return items.isEmpty ? nil : WatchGroup(id: group.id, name: group.name, items: items)
        }
        return WatchArea(direct: direct, loops: loops)
    }

    @ViewBuilder
    private func area(_ area: WatchArea, mode: ItemMode, empty: String) -> some View {
        if area.direct.isEmpty && area.loops.isEmpty {
            VStack(spacing: 5) {
                Image(systemName: "checkmark.circle").font(.title2).foregroundStyle(Color(red: 0.08, green: 0.62, blue: 0.48))
                Text(empty).font(.footnote).foregroundStyle(Color.indigo.opacity(0.72))
            }
            .padding(.top, 6)
        } else {
            if !area.direct.isEmpty {
                ForEach(area.direct) { regularTaskRow($0, mode: mode) }
            }
            ForEach(area.loops) { group in
                taskGroupCard(group.name, items: group.items, mode: mode, group: group)
            }
        }
    }

    private func taskGroupCard(
        _ title: String,
        items: [WatchItem],
        mode: ItemMode,
        group: WatchGroup? = nil
    ) -> some View {
        let compact = mode != .todo
        let cornerRadius: CGFloat = compact ? 10 : 15
        let collapsed = mode == .todo && group.map { todoFoldState.contains($0.id) } == true
        return VStack(spacing: compact ? 2 : 4) {
            if compact {
                Text(title)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(session.theme == .phantom ? Color.black : session.theme.palette.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity)
                    .frame(height: session.theme == .phantom ? 18 : 15)
                    .background { groupHeaderSurface(stableID: group?.id ?? title) }
            } else {
                HStack(spacing: 4) {
                    if let group {
                        Button {
                            WKInterfaceDevice.current().play(.click)
                            withAnimation(.spring(response: 0.24, dampingFraction: 0.72)) {
                                todoFoldState.toggle(group.id)
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                                    .font(.system(size: 9, weight: .black))
                                Text(title)
                                    .font(.caption.weight(.bold))
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Text("\(items.count)")
                                    .font(.system(size: 9, weight: .bold, design: .rounded))
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Color.indigo.opacity(0.12), in: Capsule())
                            }
                            .foregroundStyle(session.theme == .phantom ? Color.black : session.theme.palette.secondaryText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(collapsed ? "展开闭环 \(title)" : "折叠闭环 \(title)")
                        squareButton("新增待办", symbol: "plus", color: session.theme.palette.add) {
                            draftRequest = DraftRequest(target: .loopItem(id: group.id))
                        }
                        squareButton("删除闭环", symbol: "trash.fill", color: session.theme.palette.delete) {
                            deleteRequest = .loop(group)
                        }
                    } else {
                        Text(title)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(session.theme.palette.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .frame(height: 27)
                .background { groupHeaderSurface(stableID: group?.id ?? title) }
            }

            if !collapsed {
                ForEach(items) { regularTaskRow($0, mode: mode) }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, compact ? 3 : 5)
        .padding(.vertical, compact ? 2 : 5)
        .background { groupSurface(cornerRadius: cornerRadius) }
        .animation(.spring(response: 0.24, dampingFraction: 0.72), value: collapsed)
    }

    @ViewBuilder
    private func groupHeaderSurface(stableID: String) -> some View {
        if session.theme == .phantom {
            Image(PhantomArt.tab(for: stableID))
                .resizable()
                .scaledToFill()
                .overlay(Color.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }

    @ViewBuilder
    private func groupSurface(cornerRadius: CGFloat) -> some View {
        if session.theme == .phantom {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.black.opacity(0.88))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Color.white.opacity(0.20), lineWidth: 1))
        } else {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(LinearGradient(
                    colors: [Color.white.opacity(0.62), Color.purple.opacity(0.14)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Color.white.opacity(0.82)))
                .shadow(color: Color.purple.opacity(0.13), radius: cornerRadius > 10 ? 6 : 3, y: 2)
        }
    }

    private func regularTaskRow(_ item: WatchItem, mode: ItemMode) -> some View {
        HStack(spacing: 4) {
            if session.theme == .phantom {
                Image(PhantomArt.task(for: item.id))
                    .resizable()
                    .scaledToFill()
                    .frame(width: 29, height: 27)
                    .clipped()
                    .overlay(Rectangle().stroke(Color.black, lineWidth: 1.2))
            }
            Text(item.title)
                .font(.footnote.weight(session.theme == .phantom || mode == .result ? .bold : .regular))
                .foregroundStyle(session.theme.palette.primaryText)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            taskActions(item, mode: mode)
        }
        .padding(4)
        .background { taskSurface(mode: mode) }
        .scaleEffect(session.busyItemID == item.id ? 0.92 : 1)
        .rotationEffect(.degrees(session.busyItemID == item.id ? -1.5 : 0))
        .opacity(session.busyItemID == item.id ? 0.72 : 1)
        .animation(.spring(response: 0.28, dampingFraction: 0.54), value: session.busyItemID == item.id)
    }

    @ViewBuilder
    private func taskSurface(mode: ItemMode) -> some View {
        if session.theme == .phantom {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(mode == .result ? Color(red: 1, green: 0.82, blue: 0.08) : Color(red: 0.98, green: 0.95, blue: 0.86))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.black, lineWidth: 1.5))
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(cardBackground(active: false, mode: mode))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.88)))
        }
    }

    private func activeTimerRow(_ item: WatchItem, mode: ItemMode, snapshot: WatchSnapshot, at date: Date) -> some View {
        let isRunning = item.timerState == "running"
        return HStack(spacing: 5) {
            timerActionButton(
                isRunning ? "暂停" : "继续",
                symbol: isRunning ? "pause.fill" : "play.fill",
                color: isRunning ? session.theme.palette.pause : session.theme.palette.play
            ) {
                session.perform(isRunning ? "pause" : "resume", item: item)
            }

            VStack(spacing: 0) {
                Text(duration(item, snapshot: snapshot, at: date))
                    .font(.system(size: 22, weight: .black, design: .rounded).monospacedDigit())
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .center)
                Text(item.title)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, minHeight: 48, maxHeight: 48, alignment: .center)

            timerActionButton(
                "归档",
                symbol: "archivebox.fill",
                color: session.theme.palette.archive
            ) {
                session.perform("archive", item: item)
            }
        }
        .frame(height: 48)
        .padding(3)
        .background { activeTimerSurface(mode: mode) }
        .scaleEffect(session.busyItemID == item.id ? 0.92 : 1)
        .rotationEffect(.degrees(session.busyItemID == item.id ? -1.5 : 0))
        .opacity(session.busyItemID == item.id ? 0.72 : 1)
        .animation(.spring(response: 0.28, dampingFraction: 0.54), value: session.busyItemID == item.id)
    }

    @ViewBuilder
    private func activeTimerSurface(mode: ItemMode) -> some View {
        if session.theme == .phantom {
            Image(PhantomArt.timer)
                .resizable()
                .scaledToFill()
                .overlay(Color.black.opacity(0.36))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.red, lineWidth: 1.5))
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(cardBackground(active: true, mode: mode))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.88)))
                .shadow(color: Color.cyan.opacity(0.48), radius: 7, y: 2)
        }
    }

    private func timerActionButton(
        _ title: String,
        symbol: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 34, height: 48)
                .background {
                    if session.theme == .phantom {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(color)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.black, lineWidth: 1.5))
                    } else {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(color)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.92), lineWidth: 1.5))
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(WatchActionButtonStyle())
        .frame(width: 34, height: 48)
        .accessibilityLabel(title)
        .disabled(session.busyItemID != nil)
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

    @ViewBuilder
    private func taskActions(_ item: WatchItem, mode: ItemMode) -> some View {
        if mode == .todo {
            squareButton("运行", symbol: "play.fill", color: session.theme.palette.play) {
                session.perform("run", item: item)
            }
            squareButton("删除", symbol: "trash.fill", color: session.theme.palette.delete) {
                deleteRequest = .item(item)
            }
        } else {
            squareButton("继续", symbol: "play.fill", color: session.theme.palette.play) {
                session.perform("resume", item: item)
            }
            squareButton("归档", symbol: "archivebox.fill", color: session.theme.palette.archive) {
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
    let theme: WatchThemeID
    let submit: (String) -> Void
    let cancel: () -> Void
    @State private var inputPresented = false
    @State private var inputError: String?

    var body: some View {
        Button(action: presentSystemInput) {
            ZStack {
                if theme == .phantom {
                    Image(PhantomArt.voice)
                        .resizable()
                        .scaledToFill()
                } else {
                    LinearGradient(
                        colors: [
                            Color(red: 0.34, green: 0.20, blue: 0.88),
                            Color(red: 0.88, green: 0.24, blue: 0.64),
                            Color(red: 0.10, green: 0.72, blue: 0.80)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
                if let inputError {
                    Text(inputError)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(12)
                } else if theme != .phantom {
                    Image(systemName: "waveform.badge.mic")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.92))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(250))
            presentSystemInput()
        }
    }

    @MainActor
    private func presentSystemInput() {
        guard !inputPresented else { return }
        guard let controller = WKApplication.shared().visibleInterfaceController
                ?? WKApplication.shared().rootInterfaceController else {
            inputError = "无法打开系统输入，请点击重试"
            WKInterfaceDevice.current().play(.failure)
            return
        }
        inputPresented = true
        inputError = nil
        WKInterfaceDevice.current().play(.start)
        controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { results in
            Task { @MainActor in
                inputPresented = false
                guard let rawValue = results?.first as? String else {
                    WKInterfaceDevice.current().play(.stop)
                    cancel()
                    return
                }
                let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else {
                    WKInterfaceDevice.current().play(.stop)
                    cancel()
                    return
                }
                submit(value)
            }
        }
    }
}

private struct TemplatePicker: View {
    let theme: WatchThemeID
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
                            .background {
                                if theme == .phantom {
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .fill(theme.palette.template)
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.black, lineWidth: 2))
                                } else {
                                    RoundedRectangle(cornerRadius: 12).fill(theme.palette.template)
                                }
                            }
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
