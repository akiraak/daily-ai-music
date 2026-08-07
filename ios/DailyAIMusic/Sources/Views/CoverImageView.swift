import SwiftUI

/// カバー画像(/api/images/* = X-API-Secret 必須)の表示。
/// AsyncImage はヘッダを付けられないため BackendAPI 経由で取得し、メモリキャッシュする
struct CoverImageView: View {
    /// API レスポンスの imageUrl(サーバーからの相対パス)。nil ならプレースホルダのみ表示
    let path: String?

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                Image(systemName: "music.note")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemGray5))
            }
        }
        .task(id: path) {
            image = await CoverImageCache.shared.image(forServerPath: path)
        }
    }
}

/// パス単位のメモリキャッシュ(一覧スクロールでの再取得防止)。取得失敗はプレースホルダのまま
@MainActor
final class CoverImageCache {
    static let shared = CoverImageCache()
    private let cache = NSCache<NSString, UIImage>()

    func image(forServerPath path: String?) async -> UIImage? {
        guard let path else { return nil }
        if let cached = cache.object(forKey: path as NSString) { return cached }
        guard let data = try? await BackendAPI.getData(path: path),
              let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: path as NSString)
        return image
    }
}
