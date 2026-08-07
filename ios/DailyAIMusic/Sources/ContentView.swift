import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            TrackListView()
                .tabItem { Label("楽曲", systemImage: "music.note.list") }
            GenerateView()
                .tabItem { Label("生成", systemImage: "waveform.badge.plus") }
            SettingsView()
                .tabItem { Label("設定", systemImage: "gearshape") }
        }
    }
}

#Preview {
    ContentView()
}
