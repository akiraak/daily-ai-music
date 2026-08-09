import SwiftUI

/// 生成タブ。管理画面と同じく daily フロー(おまかせ生成 = POST /api/daily/run)を主役にし、
/// 自由テキストのカスタム生成(POST /api/generate)は折りたたみで残す。
/// 残クレジット(GET /api/credits)はナビゲーションバー右のピルに表示。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準
struct GenerateView: View {
    // おまかせ生成
    @State private var isRunningDaily = false
    @State private var dailyError: String?

    // カスタム生成(折りたたみ)
    @State private var showsCustom = false
    @State private var prompt = ""
    @State private var instrumental = false
    @State private var isSubmitting = false
    @State private var customError: String?

    // 進行状況・クレジット
    @State private var tasks: [GenerationTask] = []
    @State private var tracksByTaskId: [Int: Track] = [:]
    @State private var credits: Int?

    private var canSubmitCustom: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    dailyHero
                    Divider()
                    paramsRow
                    Divider()
                    customSection
                    Divider()
                    progressSection
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .navigationTitle("生成")
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

    // MARK: - おまかせ生成ヒーロー

    private var dailyHero: some View {
        VStack(spacing: 0) {
            Image(systemName: "sparkles")
                .font(.system(size: 34))
                .foregroundStyle(Color.appAccent)
            Text("おまかせ生成")
                .font(.title3.weight(.heavy))
                .padding(.top, 8)
            Text("今日のニュースとこれまでの評価(👍/👎)から、AI が 1 曲つくります")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
                .padding(.top, 6)

            Button {
                Task { await runDaily() }
            } label: {
                HStack(spacing: 8) {
                    if isRunningDaily {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Color.appBackground)
                    }
                    Text(isRunningDaily ? "曲を考えています…" : "いますぐ生成")
                }
                .font(.subheadline.weight(.bold))
                // 案A ミニマルの主要ボタン: ライトは AccentDeep 塗り+クリーム文字、
                // ダークは AccentColor(=AccentDeep と同値)塗り+暗色文字(AppBackground)
                .foregroundStyle(Color.appBackground)
                .padding(.horizontal, 36)
                .padding(.vertical, 12)
                .background(Capsule().fill(Color.accentDeep))
            }
            .buttonStyle(.borderless)
            .disabled(isRunningDaily)
            .padding(.top, 14)
            .accessibilityIdentifier("generate.daily")

            if let dailyError {
                Text(dailyError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
    }

    private func runDaily() async {
        isRunningDaily = true
        defer { isRunningDaily = false }
        do {
            // サーバー側で LLM 生成 → Suno 送信まで待つため長め
            _ = try await BackendAPI.postJSON(DailyRunResponse.self, path: "/api/daily/run", timeout: 180)
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

    // MARK: - カスタム生成(折りたたみ)

    @ViewBuilder
    private var customSection: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { showsCustom.toggle() }
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("カスタム生成")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                    Text("どんな曲にするかを自分で指定")
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.secondary)
                    .rotationEffect(.degrees(showsCustom ? 90 : 0))
            }
            .contentShape(Rectangle())
            .padding(.vertical, 13)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("generate.custom.toggle")

        if showsCustom {
            VStack(alignment: .leading, spacing: 12) {
                TextField("例: 朝にぴったりの爽やかなアコースティックポップ", text: $prompt, axis: .vertical)
                    .lineLimit(3...8)
                    .font(.subheadline)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                    .accessibilityIdentifier("generate.custom.prompt")

                Toggle("インストゥルメンタル(歌なし)", isOn: $instrumental)
                    .font(.subheadline)

                HStack {
                    if let customError {
                        Text(customError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Spacer()
                    Button {
                        Task { await submitCustom() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("生成する")
                                .font(.subheadline.weight(.bold))
                        }
                    }
                    .tint(.accentDeep)
                    .disabled(!canSubmitCustom)
                    .accessibilityIdentifier("generate.custom.submit")
                }
            }
            .padding(.bottom, 16)
        }
    }

    private func submitCustom() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(
                    prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
                    instrumental: instrumental
                )
            )
            prompt = ""
            customError = nil
            await loadTasks()
            await loadCredits()
        } catch {
            customError = error.localizedDescription
        }
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
        var label = "今日 \(Self.timeFormatter.string(from: task.updatedAt)) 完了"
        if task.mode == "daily_adventure" { label += " · 冒険日" }
        return label
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
