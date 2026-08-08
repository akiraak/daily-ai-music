import SwiftUI

/// 👍/👎 のトグル評価ボタン(一覧行と楽曲詳細で共用。管理画面と同じトグル仕様)。
/// タップで評価 API を呼び、更新後の Track を onRated で親へ返す
struct RatingButtons: View {
    let track: Track
    /// アクセシビリティ ID の接頭辞(例: "track" → track.rate.up / track.rate.down)
    var identifierPrefix = "track"
    /// 楽曲詳細では大きめに表示する
    var large = false
    let onRated: (Track) -> Void

    @State private var isRating = false

    var body: some View {
        HStack(spacing: large ? 12 : 7) {
            button(value: 1, symbol: "hand.thumbsup", identifier: "\(identifierPrefix).rate.up")
            button(value: -1, symbol: "hand.thumbsdown", identifier: "\(identifierPrefix).rate.down")
        }
    }

    private func button(value: Int, symbol: String, identifier: String) -> some View {
        let isActive = track.rating == value
        return Button {
            Task { await rate(value) }
        } label: {
            Image(systemName: isActive ? "\(symbol).fill" : symbol)
                .font(large ? .body : .footnote)
                // Color.secondary 固定(階層 .secondary はボタン内でティント由来の色になるため)
                .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.secondary))
                .frame(width: large ? 34 : 26, height: large ? 34 : 28)
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
