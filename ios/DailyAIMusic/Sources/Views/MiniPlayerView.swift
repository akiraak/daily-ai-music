import SwiftUI

/// 楽曲一覧の下部に出す再生バー(再生/一時停止・シーク)
struct MiniPlayerView: View {
    @ObservedObject private var player = PlayerService.shared

    var body: some View {
        if let track = player.currentTrack {
            VStack(spacing: 6) {
                HStack(spacing: 12) {
                    Text(track.title)
                        .font(.subheadline)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        player.togglePlayPause()
                    } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                            // Color.primary 固定(階層 .primary はボタン内でティント色になるため)
                            .foregroundStyle(Color.primary)
                    }
                    .accessibilityIdentifier(player.isPlaying ? "miniplayer.pause" : "miniplayer.play")
                }
                HStack(spacing: 8) {
                    Text(formatDuration(player.currentTime))
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Slider(
                        value: Binding(
                            get: { min(player.currentTime, track.duration) },
                            set: { player.seek(to: $0) }
                        ),
                        in: 0...max(track.duration, 1)
                    )
                    Text(formatDuration(track.duration))
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.appBackground)
            .overlay(alignment: .top) { Divider() }
        }
    }
}
