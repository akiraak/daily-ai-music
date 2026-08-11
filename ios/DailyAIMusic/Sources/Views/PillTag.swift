import SwiftUI

/// ピルを 1 行に収まる分だけ並べるレイアウト(折り返し・圧縮はせず、収まらないピルは表示しない)。
/// HStack + frame + clipped では fixedSize の子が提案幅を超えたとき frame ごと広がって
/// クリップが効かないため、Layout で明示的に切り詰める
struct SingleLinePillLayout: Layout {
    var spacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var width: CGFloat = 0
        var height: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let next = width + (width > 0 ? spacing : 0) + size.width
            if next > maxWidth { break }
            width = next
            height = max(height, size.height)
        }
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX + 0.5 {
                // 収まらないピルは画面外へ(Layout に「置かない」手段は無い)
                subview.place(at: CGPoint(x: 100_000, y: 100_000), proposal: .zero)
                continue
            }
            subview.place(
                at: CGPoint(x: x, y: bounds.midY - size.height / 2),
                proposal: ProposedViewSize(size)
            )
            x += size.width + spacing
        }
    }
}

/// ピルを複数行に折り返して並べるレイアウト(楽曲詳細のリアルワード用)
struct WrappingPillLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var width: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width
            width = max(width, x)
            x += spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX + 0.5 {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// リアルワードのピルタグ。案A ミニマルに沿い枠線のみの控えめ表示
/// (通常はヘアライン枠+secondary 文字、強調時は AccentDeep)
struct PillTag: View {
    let text: String
    var emphasized = false

    var body: some View {
        Text(text)
            .font(.caption2)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(emphasized ? Color.accentDeep : Color.secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .overlay(
                Capsule().strokeBorder(
                    emphasized ? Color.accentDeep : Color(.separator),
                    lineWidth: 1
                )
            )
    }
}
