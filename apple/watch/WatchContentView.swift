import SwiftUI

struct WatchContentView: View {
    @ObservedObject var session: WatchSession

    var body: some View {
        VStack(spacing: 10) {
            Text("Compound")
                .font(.headline)
            Text(session.status)
                .font(.body)
                .multilineTextAlignment(.center)
            if let updatedAt = session.updatedAt {
                Text(updatedAt, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button("刷新") {
                session.refresh()
            }
            .disabled(session.refreshing)
        }
        .padding()
        .onAppear {
            session.activate()
        }
    }
}
