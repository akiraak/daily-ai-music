import SwiftUI

/// 生成タブ。3 つの入口を同じ形の行で同格に並べる —
/// おまかせ(daily = POST /api/daily/run。AI がアーティストと曲を選ぶ)/
/// アーティストでおまかせ(人がアーティストを選び、曲はサーバーが選ぶ)/
/// 曲から生成(人が曲まで選ぶ)。押すとすぐ生成に進む行は sparkles、選ぶ画面が開く行は
/// chevron を右端に出す。参照曲の管理(登録・有効/無効)は参照曲タブに分離してある。
/// 残クレジット(GET /api/credits)はナビゲーションバー右のピルに表示。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準
struct GenerateView: View {
    // おまかせ生成
    @State private var isRunningDaily = false
    @State private var dailyError: String?
    @State private var showsDailyConfirm = false

    // 進行状況・クレジット
    @State private var tasks: [GenerationTask] = []
    @State private var tracksByTaskId: [Int: Track] = [:]
    @State private var credits: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    dailyRow
                    Divider()
                    artistPickerRow
                    Divider()
                    songPickerRow
                    Divider()
                    if let dailyError {
                        Text(dailyError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding(.vertical, 10)
                        Divider()
                    }
                    paramsRow
                    Divider()
                    progressSection
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .navigationTitle("生成")
            .confirmationDialog(
                "おまかせで 1 曲生成しますか?",
                isPresented: $showsDailyConfirm,
                titleVisibility: .visible
            ) {
                Button("生成する") { Task { await runDaily() } }
                Button("キャンセル", role: .cancel) {}
            } message: {
                Text("登録した曲から AI がアーティストと曲を選び、その曲調と今日のニュースから新曲をつくります。")
            }
            .toolbar {
                if let credits {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text("\(credits) クレジット")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.accentDeep)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(Color.appAccent.opacity(0.18)))
                            .accessibilityIdentifier("generate.credits")
                    }
                }
            }
            .task { await pollWhileVisible() }
        }
    }

    // MARK: - 生成の入口(3 経路を同じ形の行で並べる)

    /// 行の共通形: 丸地アイコン + 太字タイトル + 説明 + 右端の合図
    /// (すぐ生成に進む行は sparkles、選ぶ画面が開く行は chevron)
    private func entryLabel(
        icon: String, title: String, subtitle: String,
        @ViewBuilder trailing: () -> some View
    ) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(Color.appAccent.opacity(0.18))
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.accentDeep)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.bold))
                    .foregroundStyle(Color.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .contentShape(Rectangle())
        .padding(.vertical, 16)
    }

    /// 選ぶ画面へ push する行(アーティストでおまかせ・曲から生成)
    private func entryLink(
        icon: String, title: String, subtitle: String, identifier: String,
        @ViewBuilder destination: () -> some View
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            entryLabel(icon: icon, title: title, subtitle: subtitle) {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    /// おまかせ(daily)。行タップ → 確認ダイアログ → 実行(誤タップで課金しないように)
    private var dailyRow: some View {
        Button {
            showsDailyConfirm = true
        } label: {
            entryLabel(
                icon: "sparkles", title: "おまかせ",
                subtitle: "アーティストと曲を AI が選んでつくる"
            ) {
                if isRunningDaily {
                    ProgressView()
                } else {
                    Image(systemName: "sparkles")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.accentDeep)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(isRunningDaily)
        .accessibilityIdentifier("generate.daily")
    }

    private var artistPickerRow: some View {
        entryLink(
            icon: "music.mic", title: "アーティストでおまかせ",
            subtitle: "アーティストを選ぶと、その人の曲から AI が選ぶ",
            identifier: "generate.artistPicker"
        ) { ArtistPickerView() }
    }

    private var songPickerRow: some View {
        entryLink(
            icon: "music.note", title: "曲から生成",
            subtitle: "参照曲を 1 曲選んでつくる",
            identifier: "generate.songPicker"
        ) { SongPickerView() }
    }

    private func runDaily() async {
        isRunningDaily = true
        defer { isRunningDaily = false }
        do {
            // サーバーは受付だけ済ませて即座に返す(LLM 生成 → Suno 送信はバックグラウンド)。
            // 以降の進行は下の進行中カード(「曲を考えています…」)が引き継ぐ
            _ = try await BackendAPI.postJSON(DailyRunResponse.self, path: "/api/daily/run")
            dailyError = nil
            await loadTasks()
            await loadCredits()
        } catch {
            dailyError = error.localizedDescription
        }
    }

    // MARK: - 生成パラメータ(読み取り専用画面へ push)

    /// おまかせ生成が LLM に注入する入力の一覧へ。カスタム生成トグルと同じ行スタイルだが、
    /// こちらは push 遷移のため chevron は回転させない
    private var paramsRow: some View {
        NavigationLink {
            GenerationParamsView()
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("生成パラメータ")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                    Text("おまかせ生成に使われる入力")
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 13)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("generate.params")
    }

    // MARK: - 進行状況

    /// 進行中すべて+1 時間以内の失敗(Web 管理画面と同条件)+今日完了した分(最大 5 件)
    private var visibleTasks: [GenerationTask] {
        let oneHourAgo = Date().addingTimeInterval(-3600)
        let active = tasks.filter(\.isActive)
        let failed = tasks.filter { $0.status == "FAILED" && $0.updatedAt > oneHourAgo }
        let doneToday = tasks
            .filter { $0.status == "COMPLETE" && Calendar.current.isDateInToday($0.updatedAt) }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(5)
        return active + failed + doneToday
    }

    @ViewBuilder
    private var progressSection: some View {
        if !visibleTasks.isEmpty {
            Text("進行状況")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.secondary)
                .padding(.top, 18)
                .padding(.bottom, 2)
            ForEach(visibleTasks) { task in
                taskRow(task)
                Divider()
            }
        }
    }

    @ViewBuilder
    private func taskRow(_ task: GenerationTask) -> some View {
        HStack(spacing: 12) {
            if task.isActive {
                ProgressView()
                VStack(alignment: .leading, spacing: 1) {
                    Text(task.statusLabel)
                        .font(.footnote.weight(.semibold))
                    Text("\(task.modeLabel) · \(Self.timeFormatter.string(from: task.createdAt)) 開始")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            } else if task.status == "COMPLETE" {
                ZStack {
                    Circle().fill(Color.appAccent.opacity(0.18))
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.heavy))
                        .foregroundStyle(Color.accentDeep)
                }
                .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tracksByTaskId[task.id]?.title ?? task.title ?? task.prompt)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                    Text(doneLabel(for: task))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let track = tracksByTaskId[task.id] {
                    CoverImageView(path: track.imageUrl)
                        .frame(width: 40, height: 40)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            } else {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(.red)
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(task.statusLabel) · \(task.modeLabel)")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                    if let error = task.error {
                        Text(error)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 10)
    }

    private func doneLabel(for task: GenerationTask) -> String {
        "今日 \(Self.timeFormatter.string(from: task.updatedAt)) 完了"
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "H:mm"
        return formatter
    }()

    // MARK: - 読み込み・ポーリング

    /// タブ表示中は 5 秒間隔でタスク一覧を更新する(.task がタブ離脱時にキャンセルする)。
    /// ジョブ完了を検知したら完了行のカバー用に楽曲一覧とクレジットも読み直す
    private func pollWhileVisible() async {
        await loadTasks()
        await loadTracks()
        await loadCredits()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            let hadActive = Set(tasks.filter(\.isActive).map(\.id))
            await loadTasks()
            let stillActive = Set(tasks.filter(\.isActive).map(\.id))
            if !hadActive.subtracting(stillActive).isEmpty {
                await loadTracks()
                await loadCredits()
            }
        }
    }

    private func loadTasks() async {
        do {
            tasks = try await BackendAPI.getJSON(TasksResponse.self, path: "/api/tasks").tasks
        } catch {
            // ポーリングの失敗は画面を壊さない(操作時のエラーは各ボタン側で表示する)
        }
    }

    private func loadTracks() async {
        guard let tracks = try? await BackendAPI.getJSON(TracksResponse.self, path: "/api/tracks").tracks else { return }
        tracksByTaskId = Dictionary(tracks.map { ($0.taskId, $0) }, uniquingKeysWith: { first, _ in first })
    }

    private func loadCredits() async {
        credits = (try? await BackendAPI.getJSON(CreditsResponse.self, path: "/api/credits"))?.credits
    }
}
