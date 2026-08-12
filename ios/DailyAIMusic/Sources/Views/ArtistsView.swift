import SwiftUI

/// アーティスト一覧。登録済みアーティスト(GET /api/artists)を並べ、選ぶと曲一覧へ push する。
/// 右上の + で追加シート(iTunes 検索 → 候補から選んで登録)を開く。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct ArtistsView: View {
    @State private var artists: [Artist] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showsAddSheet = false
    /// 削除確認中のアーティスト(曲もまとめて消えるため確認する)
    @State private var pendingDeletion: Artist?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("好きなアーティストの曲を選ぶと、その曲の音楽的な特徴に似た新曲を AI がつくります(原曲の歌詞は使いません)。取り込んだ曲は無効の状態なので、曲一覧で使いたい曲を有効にしてください。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
                    .padding(.bottom, 6)

                // エラーは一覧を隠さず上に出す(削除・再取得の一時的な失敗で一覧が消えないように)
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
                } else if artists.isEmpty && errorMessage == nil {
                    Text("まだアーティストが登録されていません。右上の + から追加してください。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 24)
                } else {
                    ForEach(artists) { artist in
                        Divider()
                        artistRow(artist)
                    }
                    Divider()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .navigationTitle("アーティスト")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsAddSheet = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityIdentifier("artists.add")
            }
        }
        .sheet(isPresented: $showsAddSheet) {
            AddArtistSheet { await load() }
        }
        .confirmationDialog(
            pendingDeletion.map { "「\($0.name)」と取り込んだ曲を削除しますか?" } ?? "",
            isPresented: .init(get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("削除", role: .destructive) {
                if let artist = pendingDeletion {
                    Task { await delete(artist) }
                }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("生成済みの曲は残ります。")
        }
        .task { await load() }
        .refreshable { await load() }
    }

    /// 行タップで曲一覧へ。再取得・削除は行末のメニューから(List を使わない画面構成のため
    /// swipeActions は効かない)
    private func artistRow(_ artist: Artist) -> some View {
        HStack(spacing: 8) {
            NavigationLink {
                // 曲の有効/無効が変わったら一覧を取り直す(この画面は .task の 1 回読みなので、
                // 戻ってきたときに「有効 N / 全 M 曲」が古いままになる)
                ArtistSongsView(artist: artist) { Task { await load() } }
            } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(artist.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.primary)
                        // 参照曲の候補になる曲数 / 取り込んだ全曲数
                        Text([artist.genre, "有効 \(artist.enabledSongs) / 全 \(artist.songCount) 曲"]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("artists.row")

            Menu {
                Button("曲を再取得") { Task { await refresh(artist) } }
                Button("削除", role: .destructive) { pendingDeletion = artist }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .accessibilityIdentifier("artists.row.menu")
        }
        .padding(.vertical, 13)
    }

    private func load() async {
        do {
            artists = try await BackendAPI.getJSON(ArtistsResponse.self, path: "/api/artists").artists
            errorMessage = nil
        } catch {
            // 旧サーバー(エンドポイント未実装)や接続断でも画面内のエラー表示に留める
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    /// 新譜の取り込み(差分のみ追加)
    private func refresh(_ artist: Artist) async {
        do {
            _ = try await BackendAPI.postJSON(
                CreateArtistResponse.self, path: "/api/artists/\(artist.id)/refresh", timeout: 60
            )
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ artist: Artist) async {
        do {
            try await BackendAPI.delete(path: "/api/artists/\(artist.id)")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// アーティスト追加シート。検索語 → iTunes の候補一覧 → 選んで登録(曲の取り込みまでサーバーが行う)。
/// 日本語で検索してもヒットするが、登録名は iTunes の表記(ローマ字のことが多い)になり
/// 別名義も候補に混ざるため、必ず候補から選ばせて取り違えを防ぐ
private struct AddArtistSheet: View {
    /// 登録が成功したら呼ぶ(一覧の再読み込み)
    let onRegistered: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var term = ""
    @State private var candidates: [ArtistCandidate] = []
    @State private var isSearching = false
    @State private var registeringId: Int?
    @State private var message: String?
    @State private var isError = false
    @FocusState private var termFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        TextField("アーティスト名", text: $term)
                            .font(.subheadline)
                            .focused($termFocused)
                            .submitLabel(.search)
                            .onSubmit { Task { await search() } }
                            .padding(10)
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                            .accessibilityIdentifier("artists.add.term")
                        Button("検索") { Task { await search() } }
                            .font(.subheadline.weight(.bold))
                            .tint(.accentDeep)
                            .disabled(term.trimmingCharacters(in: .whitespaces).isEmpty || isSearching)
                            .accessibilityIdentifier("artists.add.search")
                    }
                    .padding(.top, 14)

                    Text("日本語でも検索できます。登録名は iTunes の表記(ローマ字のことが多い)になります。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)

                    if let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(isError ? .red : .secondary)
                            .padding(.top, 14)
                    }
                    if isSearching || registeringId != nil {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.top, 20)
                    }

                    ForEach(candidates) { candidate in
                        Divider()
                        candidateRow(candidate)
                    }
                    if !candidates.isEmpty { Divider() }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .navigationTitle("アーティストを追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
        .onAppear { termFocused = true }
    }

    private func candidateRow(_ candidate: ArtistCandidate) -> some View {
        Button {
            Task { await register(candidate) }
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(candidate.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                    if let genre = candidate.genre {
                        Text(genre)
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                    }
                }
                Spacer(minLength: 8)
                Text("登録")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.accentDeep)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 13)
        }
        .buttonStyle(.plain)
        .disabled(registeringId != nil)
        .accessibilityIdentifier("artists.add.candidate")
    }

    private func search() async {
        let keyword = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else { return }
        termFocused = false
        isSearching = true
        defer { isSearching = false }
        candidates = []
        message = nil
        do {
            let encoded = keyword.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? keyword
            candidates = try await BackendAPI.getJSON(
                ArtistSearchResponse.self, path: "/api/artists/search?term=\(encoded)"
            ).candidates
            if candidates.isEmpty {
                message = "「\(keyword)」に一致するアーティストが見つかりません。"
                isError = false
            } else {
                message = "登録するアーティストを選んでください。"
                isError = false
            }
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }

    private func register(_ candidate: ArtistCandidate) async {
        registeringId = candidate.itunesArtistId
        defer { registeringId = nil }
        message = "登録しています…(iTunes から曲を取り込みます)"
        isError = false
        do {
            // iTunes から最大 200 曲を取り込むためサーバー側の処理がやや長い
            let response = try await BackendAPI.postJSON(
                CreateArtistResponse.self,
                path: "/api/artists",
                body: CreateArtistRequest(name: candidate.name, itunesArtistId: candidate.itunesArtistId),
                timeout: 60
            )
            await onRegistered()
            message = "「\(response.artist.name)」を登録し、曲を \(response.added) 件取り込みました(すべて無効の状態です)。"
            dismiss()
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }
}
