import SwiftUI

/// 再生中インジケータ。アプリアイコン下部と同じ「芝生風イコライザ」モチーフの 5 本バー。
/// 案A ミニマルでは静止表示(アニメーションは Phase 7 の遊び要素で検討)
struct EqualizerBars: View {
    var height: CGFloat = 15

    private static let levels: [CGFloat] = [0.38, 0.8, 0.55, 1.0, 0.3]

    var body: some View {
        HStack(alignment: .bottom, spacing: height / 6) {
            ForEach(Self.levels.indices, id: \.self) { index in
                Capsule()
                    .fill(Color.appAccent)
                    .frame(width: height / 5, height: height * Self.levels[index])
            }
        }
        .frame(height: height, alignment: .bottom)
    }
}
