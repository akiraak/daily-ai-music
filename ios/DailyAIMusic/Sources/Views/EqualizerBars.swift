import SwiftUI

/// 再生中インジケータ。アプリアイコン下部と同じ「芝生風イコライザ」モチーフの 5 本バー。
/// `animating` で揺れ(再生中)と静止を切り替える(Phase 7 の遊び要素)
struct EqualizerBars: View {
    var height: CGFloat = 15
    var animating: Bool = false

    /// 静止時の高さ(アイコンの芝生シルエットに合わせた凸凹)
    private static let levels: [CGFloat] = [0.38, 0.8, 0.55, 1.0, 0.3]
    /// 揺れの中心(クリップしないよう中央寄りに圧縮した levels)
    private static let centers: [CGFloat] = levels.map { 0.3 + $0 * 0.42 }
    /// バーごとに周期(rad/s)・位相をずらし、機械的な同期揺れを避ける
    private static let speeds: [Double] = [4.1, 5.6, 3.4, 4.8, 6.3]
    private static let phases: [Double] = [0.0, 1.7, 3.1, 4.4, 0.9]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !animating)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: height / 6) {
                ForEach(Self.levels.indices, id: \.self) { index in
                    Capsule()
                        .fill(Color.appAccent)
                        .frame(width: height / 5, height: height * level(index, at: time))
                }
            }
            .frame(height: height, alignment: .bottom)
        }
    }

    private func level(_ index: Int, at time: Double) -> CGFloat {
        guard animating else { return Self.levels[index] }
        let wave = sin(time * Self.speeds[index] + Self.phases[index])
        return Self.centers[index] + CGFloat(wave) * 0.26
    }
}
