import SwiftUI

/// 歌詞の English/日本語 切替セグメント(案A ミニマル: 選択中はアクセント色の下線)。
/// 楽曲詳細とフルプレイヤーの歌詞画面で共用
struct LyricsSegment: View {
    @Binding var showsJapanese: Bool
    /// アクセシビリティ ID の接頭辞(例: "detail" → detail.lyrics.en / detail.lyrics.ja)
    var identifierPrefix = "detail"

    var body: some View {
        HStack(spacing: 0) {
            segmentButton("English", isJapanese: false)
            segmentButton("日本語", isJapanese: true)
        }
    }

    private func segmentButton(_ label: String, isJapanese: Bool) -> some View {
        let isSelected = showsJapanese == isJapanese
        return Button {
            showsJapanese = isJapanese
        } label: {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .overlay(alignment: .bottom) {
                    if isSelected {
                        Rectangle().fill(Color.appAccent).frame(height: 2)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(isJapanese ? "\(identifierPrefix).lyrics.ja" : "\(identifierPrefix).lyrics.en")
    }
}
