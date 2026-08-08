import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            TrackListView()
                .tabItem { Label("ライブラリ", systemImage: "music.note.list") }
            GenerateView()
                .tabItem { Label("生成", systemImage: "waveform.badge.plus") }
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
