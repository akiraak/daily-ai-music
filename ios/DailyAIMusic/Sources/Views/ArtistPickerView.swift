import SwiftUI

/// アーティストでおまかせ(POST /api/generate { artistId })。有効な参照曲を持つアーティストから
/// 1 人選ぶと、曲はサーバーが LRU で選んで「その曲に似た新曲」を生成する。
/// 生成の進行状況は生成タブに出るため、開始したらこの画面は閉じて戻る。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct ArtistPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var artists: [Artist] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pendingArtist: Artist?
    @State private var isGenerating = false

    /// 有効な参照曲を持つアーティストだけを出す(0 件の人を選んでも 409 になるだけなので)
    private var pickableArtists: [Artist] {
        artists.filter { $0.enabledSongs > 0 }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("アーティストを選ぶと、その人の有効な参照曲から AI が 1 曲選び、似た新曲をつくります(原曲の歌詞は使いません)。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
                    .padding(.bottom, 6)

                if isGenerating {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("生成を開始しています…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 14)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.vertical, 10)
                }
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                } else if pickableArtists.isEmpty && errorMessage == nil {
                    Text("有効な参照曲を持つアーティストがいません。参照曲タブで曲を登録して有効にしてください。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 14)
                } else {
                    ForEach(pickableArtists) { artist in
                        Divider()
                        artistRow(artist)
                    }
                    if !pickableArtists.isEmpty { Divider() }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .navigationTitle("アーティストでおまかせ")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            pendingArtist.map { "「\($0.displayName)」でおまかせ生成しますか?" } ?? "",
            isPresented: .init(get: { pendingArtist != nil }, set: { if !$0 { pendingArtist = nil } }),
            titleVisibility: .visible
        ) {
            Button("生成する") {
                if let artist = pendingArtist {
                    Task { await generate(artist) }
                }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("この人の有効な参照曲から AI が 1 曲選び、その曲の音楽的な特徴を参考に新しい曲をつくります。")
        }
        .task { await load() }
    }

    private func artistRow(_ artist: Artist) -> some View {
        Button {
            pendingArtist = artist
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(artist.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                    Text([artist.genre, "有効 \(artist.enabledSongs) 曲"]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "sparkles")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.accentDeep)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 13)
        }
        .buttonStyle(.plain)
        .disabled(isGenerating)
        .accessibilityIdentifier("artistPicker.row")
    }

    private func load() async {
        do {
            artists = try await BackendAPI.getJSON(ArtistsResponse.self, path: "/api/artists").artists
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func generate(_ artist: Artist) async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            // サーバーは受付だけ済ませてすぐ返す(LLM の生成はサーバー側で続く)ので待ち時間は短い
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(prompt: "", instrumental: false, artistId: artist.id)
            )
            // 進行状況は生成タブに出るので、開始したら戻る
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
