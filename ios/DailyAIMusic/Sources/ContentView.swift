import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            TrackListView()
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
            GenerateView()
                .tabItem { Label("生成", systemImage: "waveform.badge.plus") }
            // 参照曲の管理(アーティスト一覧 → 曲一覧)。生成タブから分離した独立タブ
            // (案 1。docs/plans/generation-ui-restructure.md で 2026-08-12 決定)
            NavigationStack { ArtistsView(prominentTitle: true) }
                .tabItem { Label("参照曲", systemImage: "person.2") }
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
