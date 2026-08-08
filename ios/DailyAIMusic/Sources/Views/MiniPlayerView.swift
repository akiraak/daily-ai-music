import SwiftUI

/// 楽曲一覧の下部に出す再生バー(カバー・タイトル/スタイル・再生中イコライザ・再生/一時停止・次の曲)。
/// 本体タップでフルプレイヤー(シート)を開く。レイアウトは案A ミニマル基準
struct MiniPlayerView: View {
    @ObservedObject private var player = PlayerService.shared
    /// 評価 API の結果を一覧へ反映するコールバック(フルプレイヤーへ引き継ぐ)
    let onRated: (Track) -> Void

    @State private var showsFullPlayer = false

    var body: some View {
        if let track = player.currentTrack {
            HStack(spacing: 10) {
                Button {
                    showsFullPlayer = true
                } label: {
                    HStack(spacing: 10) {
                        CoverImageView(path: track.imageUrl)
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(track.title)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.primary)
                                .lineLimit(1)
                            if let styleJa = track.styleJa {
                                Text(styleJa)
                                    .font(.caption2)
                                    .foregroundStyle(Color.secondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        if player.isPlaying {
                            EqualizerBars(height: 15, animating: true)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("miniplayer.open")

                Button {
                    player.togglePlayPause()
                } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 20))
                        // Color.primary 固定(階層 .primary はボタン内でティント色になるため)
                        .foregroundStyle(Color.primary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier(player.isPlaying ? "miniplayer.pause" : "miniplayer.play")

                Button {
                    player.playNext()
                } label: {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(player.nextTrack == nil ? Color.secondary : Color.primary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.borderless)
                .disabled(player.nextTrack == nil)
                .accessibilityIdentifier("miniplayer.next")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.appBackground)
            .overlay(alignment: .top) { Divider() }
            .sheet(isPresented: $showsFullPlayer) {
                FullPlayerView(onRated: onRated)
            }
        }
    }
}
