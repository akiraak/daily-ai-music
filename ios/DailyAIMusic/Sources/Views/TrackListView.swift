import SwiftUI

struct TrackListView: View {
    @ObservedObject private var player = PlayerService.shared
    @State private var tracks: [Track] = []
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Group {
                if let errorMessage, tracks.isEmpty {
                    ContentUnavailableView {
                        Label("読み込みエラー", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再読み込み") { Task { await load() } }
                    }
                } else if tracks.isEmpty && !isLoading {
                    ContentUnavailableView(
                        "楽曲がまだありません",
                        systemImage: "music.note",
                        description: Text("生成タブから曲を作れます")
                    )
                } else {
                    List(tracks) { track in
                        Button {
                            player.play(track)
                        } label: {
                            TrackRow(track: track, isCurrent: player.currentTrack?.id == track.id)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("track.row")
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("楽曲")
            .refreshable { await load() }
            .task { await load() }
            .safeAreaInset(edge: .bottom) {
                if player.currentTrack != nil {
                    MiniPlayerView()
                }
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            tracks = try await BackendAPI.getJSON(TracksResponse.self, path: "/api/tracks").tracks
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TrackRow: View {
    let track: Track
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            CoverImageView(path: track.imageUrl)
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                Text(track.title)
                    .font(.body)
                    .fontWeight(isCurrent ? .semibold : .regular)
                    .lineLimit(2)
                Text("\(formatDuration(track.duration)) · \(track.createdAt.formatted(.dateTime.month().day().hour().minute()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if isCurrent {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundStyle(.tint)
            }
        }
    }
}

func formatDuration(_ seconds: Double) -> String {
    let s = Int(seconds.rounded())
    return String(format: "%d:%02d", s / 60, s % 60)
}
