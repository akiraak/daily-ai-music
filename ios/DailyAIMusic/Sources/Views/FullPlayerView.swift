import SwiftUI

/// フルプレイヤー(シート)。大カバー・シークバー・前後の曲・再生/停止・歌詞への導線。
/// 表示対象は常に PlayerService.currentTrack(自動送りで曲が替わっても追従する)。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準
struct FullPlayerView: View {
    @ObservedObject private var player = PlayerService.shared

    var body: some View {
        NavigationStack {
            Group {
                if let track = player.currentTrack {
                    playerContent(for: track)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.appBackground)
            .toolbar(.hidden, for: .navigationBar)
        }
        .presentationDragIndicator(.visible)
    }

    private func playerContent(for track: Track) -> some View {
        VStack(spacing: 0) {
            CoverImageView(path: track.imageUrl)
                .frame(width: 300, height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .shadow(color: .black.opacity(0.2), radius: 16, y: 12)
                .padding(.top, 34)

            Text(track.title)
                .font(.title3.weight(.heavy))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .padding(.top, 24)
                .accessibilityIdentifier("player.title")

            if let styleJa = track.styleJa {
                Text(styleJa)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.top, 3)
            }

            seekBar(for: track)
                .padding(.top, 24)

            HStack(spacing: 46) {
                skipButton(
                    symbol: "backward.fill",
                    identifier: "player.prev",
                    disabled: false,
                    action: player.playPrevious
                )
                playPauseButton
                skipButton(
                    symbol: "forward.fill",
                    identifier: "player.next",
                    disabled: player.nextTrack == nil,
                    action: player.playNext
                )
            }
            .padding(.top, 20)

            if track.lyrics != nil || track.lyricsJa != nil {
                lyricsLink(for: track)
                    .padding(.top, 22)
            }

            Spacer(minLength: 12)
        }
        .padding(.horizontal, 28)
    }

    private func seekBar(for track: Track) -> some View {
        VStack(spacing: 2) {
            Slider(
                value: Binding(
                    get: { min(player.currentTime, track.duration) },
                    set: { player.seek(to: $0) }
                ),
                in: 0...max(track.duration, 1)
            )
            .tint(.appAccent)
            .accessibilityIdentifier("player.seek")
            HStack {
                Text(formatDuration(player.currentTime))
                Spacer()
                Text("-" + formatDuration(max(0, track.duration - player.currentTime)))
            }
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(.secondary)
        }
    }

    private var playPauseButton: some View {
        Button {
            player.togglePlayPause()
        } label: {
            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 42))
                // Color.primary 固定(階層 .primary はボタン内でティント色になるため)
                .foregroundStyle(Color.primary)
                .frame(width: 70, height: 70)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(player.isPlaying ? "player.pause" : "player.play")
    }

    private func skipButton(
        symbol: String, identifier: String, disabled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 26))
                .foregroundStyle(disabled ? Color.secondary : Color.primary)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.borderless)
        .disabled(disabled)
        .accessibilityIdentifier(identifier)
    }

    private func lyricsLink(for track: Track) -> some View {
        NavigationLink {
            PlayerLyricsView(track: track)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "music.note.list")
                    .font(.system(size: 13, weight: .bold))
                Text("歌詞")
                    .font(.footnote.weight(.bold))
            }
            .foregroundStyle(Color.accentDeep)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("player.lyrics")
    }
}

/// フルプレイヤー内の歌詞画面(English/日本語 切替は楽曲詳細と共通のセグメント)
private struct PlayerLyricsView: View {
    let track: Track
    @State private var showsJapanese: Bool

    init(track: Track) {
        self.track = track
        _showsJapanese = State(initialValue: track.lyricsJa != nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if track.lyrics != nil && track.lyricsJa != nil {
                    LyricsSegment(showsJapanese: $showsJapanese, identifierPrefix: "player")
                }
                if let text = showsJapanese ? track.lyricsJa : track.lyrics {
                    Text(text)
                        .font(.footnote)
                        .lineSpacing(4)
                        .padding(.top, 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .navigationTitle(track.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
