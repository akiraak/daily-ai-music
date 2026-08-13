import SwiftUI

/// 参照曲の管理(アーティスト一覧)。登録済みアーティスト(GET /api/artists)を並べ、
/// 選ぶと曲一覧(有効/無効の管理)へ push する。右上の + で追加シート
/// (アーティスト名 / 曲名の 2 経路を統合した iTunes 検索)を開く。
/// 案 1 ではタブのルート(prominentTitle = true)、案 2 では生成タブから push される。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct ArtistsView: View {
    /// タブのルートとして表示するとき true(大タイトルにする)。push 時は inline
    var prominentTitle = false

    @State private var artists: [Artist] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showsAddSheet = false
    /// 削除確認中のアーティスト(曲もまとめて消えるため確認する)
    @State private var pendingDeletion: Artist?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("生成のもとにする曲(参照曲)を管理します。有効にした曲がおまかせ生成の候補になり、「曲を選んで生成」でも選べます。取り込んだ曲は最初は無効なので、曲一覧で使いたい曲を有効にしてください。")
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
        .navigationTitle("参照曲")
        .navigationBarTitleDisplayMode(prominentTitle ? .large : .inline)
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
            AddReferenceSheet { await load() }
        }
        .confirmationDialog(
            pendingDeletion.map { "「\($0.displayName)」と取り込んだ曲を削除しますか?" } ?? "",
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
                        Text(artist.displayName)
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

/// 参照曲の追加シート。アーティスト名 / 曲名の 2 経路を 1 つの検索 UI に統合する
/// (Web 管理画面の「登録」パネルと同じ切替式)。
/// - アーティスト名: 候補から選ぶと、その人の曲(最大 200 曲)を取り込む
/// - 曲名: 候補から選ぶと、その曲とアーティストをまとめて登録する(選んだ 1 曲は自動で有効)。
///   ここは管理が目的の入口なので生成には進まない(生成まで一気に進むのは
///   「曲を選んで生成」内の曲名検索 = SongSearchView)
/// どちらも日本語で検索できる(表示名は JP ストアの表記 = nameJa ?? name)が、
/// 別名義・カバーも候補に混ざるため、必ず候補から選ばせて取り違えを防ぐ
private struct AddReferenceSheet: View {
    /// 登録が成功したら呼ぶ(一覧の再読み込み)
    let onRegistered: () async -> Void

    private enum Mode: String, CaseIterable {
        case artist, song
        var label: String { self == .artist ? "アーティスト名" : "曲名" }
        var placeholder: String {
            self == .artist ? "アーティスト名(例: 米津玄師)" : "曲名(例: Lemon / 夜に駆ける)"
        }
        var hint: String {
            switch self {
            case .artist:
                "候補から選ぶと、その人の曲(最大 200 曲)を iTunes から取り込みます。表示名は Apple Music(日本)の表記になります。"
            case .song:
                "候補から選ぶと、その曲とアーティスト(最大 200 曲)をまとめて登録し、選んだ曲だけ有効にします。アーティスト名を足すと精度が上がります(例: 米津玄師 Lemon)。"
            }
        }
    }

    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .artist
    @State private var term = ""
    @State private var artistCandidates: [ArtistCandidate] = []
    @State private var songCandidates: [SongCandidate] = []
    @State private var isSearching = false
    @State private var isRegistering = false
    @State private var message: String?
    @State private var isError = false
    @FocusState private var termFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Picker("検索対象", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.top, 14)
                    .accessibilityIdentifier("artists.add.mode")

                    HStack(spacing: 8) {
                        TextField(mode.placeholder, text: $term)
                            .font(.subheadline)
                            .autocorrectionDisabled()
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
                    .padding(.top, 12)

                    Text(mode.hint)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)

                    if let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(isError ? .red : .secondary)
                            .padding(.top, 14)
                    }
                    if isSearching || isRegistering {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.top, 20)
                    }

                    switch mode {
                    case .artist:
                        ForEach(artistCandidates) { candidate in
                            Divider()
                            candidateRow(
                                title: candidate.displayName, subtitle: candidate.subtitle
                            ) { await registerArtist(candidate) }
                        }
                        if !artistCandidates.isEmpty { Divider() }
                    case .song:
                        ForEach(songCandidates) { candidate in
                            Divider()
                            candidateRow(
                                title: candidate.title, subtitle: candidate.subtitle
                            ) { await registerSong(candidate) }
                        }
                        if !songCandidates.isEmpty { Divider() }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("参照曲を追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
        .onAppear { termFocused = true }
        .onChange(of: mode) {
            // 経路を切り替えたら前の候補・メッセージを消す(候補の混在を防ぐ)
            artistCandidates = []
            songCandidates = []
            message = nil
        }
    }

    private func candidateRow(
        title: String, subtitle: String?, register: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await register() }
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .multilineTextAlignment(.leading)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                            .multilineTextAlignment(.leading)
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
        .disabled(isRegistering)
        .accessibilityIdentifier("artists.add.candidate")
    }

    private func search() async {
        let keyword = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else { return }
        termFocused = false
        isSearching = true
        defer { isSearching = false }
        artistCandidates = []
        songCandidates = []
        message = nil
        do {
            let encoded = keyword.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? keyword
            let found: Bool
            switch mode {
            case .artist:
                artistCandidates = try await BackendAPI.getJSON(
                    ArtistSearchResponse.self, path: "/api/artists/search?term=\(encoded)"
                ).candidates
                found = !artistCandidates.isEmpty
            case .song:
                songCandidates = try await BackendAPI.getJSON(
                    SongSearchResponse.self, path: "/api/artist-songs/search?term=\(encoded)"
                ).candidates
                found = !songCandidates.isEmpty
            }
            message = found
                ? "登録する\(mode == .artist ? "アーティスト" : "曲")を選んでください。"
                : "「\(keyword)」に一致する\(mode == .artist ? "アーティスト" : "曲")が見つかりません。"
            isError = false
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }

    private func registerArtist(_ candidate: ArtistCandidate) async {
        isRegistering = true
        defer { isRegistering = false }
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
            message = "「\(response.artist.displayName)」を登録し、曲を \(response.added) 件取り込みました(すべて無効の状態です)。"
            dismiss()
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }

    private func registerSong(_ candidate: SongCandidate) async {
        isRegistering = true
        defer { isRegistering = false }
        message = "登録しています…(iTunes から曲を取り込みます)"
        isError = false
        do {
            // 未登録アーティストは最大 200 曲を取り込むためサーバー側の処理がやや長い
            let response = try await BackendAPI.postJSON(
                CreateArtistSongResponse.self,
                path: "/api/artist-songs",
                body: CreateArtistSongRequest(itunesTrackId: candidate.itunesTrackId),
                timeout: 60
            )
            await onRegistered()
            message = "「\(response.artist.displayName)」の「\(response.song.title)」を登録して有効にしました。"
            dismiss()
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }
}
