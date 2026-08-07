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
                        TrackRow(
                            track: track,
                            isCurrent: player.currentTrack?.id == track.id,
                            onPlay: { player.play(track) },
                            onRated: { updated in
                                if let index = tracks.firstIndex(where: { $0.id == updated.id }) {
                                    tracks[index] = updated
                                }
                            }
                        )
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

/// 一覧の 1 行。行本体のタップで再生、右端の 👍/👎 は独立したトグルボタン(管理画面と同じ仕様)
private struct TrackRow: View {
    let track: Track
    let isCurrent: Bool
    let onPlay: () -> Void
    let onRated: (Track) -> Void

    @State private var isRating = false

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onPlay) {
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
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("track.row")

            ratingButton(value: 1, symbol: "hand.thumbsup", identifier: "track.rate.up")
            ratingButton(value: -1, symbol: "hand.thumbsdown", identifier: "track.rate.down")
        }
    }

    private func ratingButton(value: Int, symbol: String, identifier: String) -> some View {
        let isActive = track.rating == value
        return Button {
            Task { await rate(value) }
        } label: {
            Image(systemName: isActive ? "\(symbol).fill" : symbol)
                .font(.title3)
                .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 32, height: 44)
        }
        .buttonStyle(.borderless)
        .disabled(isRating)
        .accessibilityIdentifier(identifier)
        .accessibilityValue(isActive ? "on" : "off")
    }

    private func rate(_ value: Int) async {
        isRating = true
        defer { isRating = false }
        do {
            let request = RatingRequest(rating: track.rating == value ? nil : value)
            let response = try await BackendAPI.postJSON(
                RatingResponse.self,
                path: "/api/tracks/\(track.id)/rating",
                body: request
            )
            onRated(response.track)
        } catch {
            // 通信・HTTP エラーは BackendAPI がログ済み。表示は変えず次のタップで再試行できる
        }
    }
}

func formatDuration(_ seconds: Double) -> String {
    let s = Int(seconds.rounded())
    return String(format: "%d:%02d", s / 60, s % 60)
}
