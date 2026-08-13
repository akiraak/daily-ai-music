import SwiftUI

struct ContentView: View {
    /// タブ構成の比較用(案 1 = 参照曲を独立タブに / 案 2 = 3 タブのまま)。
    /// 設定画面で切り替えて実機で見比べる。構成が決まったら削除する
    @AppStorage(AppSettingsKeys.uiVariant) private var uiVariant = UIVariant.default

    var body: some View {
        TabView {
            TrackListView()
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
            GenerateView()
                .tabItem { Label("生成", systemImage: "waveform.badge.plus") }
            if uiVariant == UIVariant.fourTabs {
                // 案 1: 参照曲の管理(アーティスト一覧 → 曲一覧)を独立タブに
                NavigationStack { ArtistsView(prominentTitle: true) }
                    .tabItem { Label("参照曲", systemImage: "person.2") }
            }
            SettingsView()
                .tabItem { Label("設定", systemImage: "gearshape") }
        }
        // コントロール既定ティント。アセットカタログのグローバルアクセントに任せず明示する
        .tint(.appAccent)
    }
}

#Preview {
    ContentView()
}
