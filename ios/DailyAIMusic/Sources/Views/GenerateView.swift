import SwiftUI

struct GenerateView: View {
    @State private var prompt = ""
    @State private var instrumental = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var tasks: [GenerationTask] = []

    private var canSubmit: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    /// Web 管理画面と同じ表示条件: 進行中、または 1 時間以内に失敗したタスク
    private var visibleTasks: [GenerationTask] {
        let oneHourAgo = Date().addingTimeInterval(-3600)
        return tasks.filter { $0.isActive || ($0.status == "FAILED" && $0.updatedAt > oneHourAgo) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("どんな曲を作る?") {
                    TextField("例: 朝にぴったりの爽やかなアコースティックポップ", text: $prompt, axis: .vertical)
                        .lineLimit(3...8)
                    Toggle("インストゥルメンタル(歌なし)", isOn: $instrumental)
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("生成する")
                        }
                    }
                    .tint(.accentDeep)
                    .disabled(!canSubmit)
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .listRowBackground(Color.appBackground)

                if !visibleTasks.isEmpty {
                    Section("生成の進行状況") {
                        ForEach(visibleTasks) { task in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    if task.isActive {
                                        ProgressView().controlSize(.small)
                                    }
                                    Text(task.statusLabel)
                                        .font(.caption)
                                        .foregroundStyle(task.status == "FAILED" ? .red : .secondary)
                                }
                                Text(task.prompt)
                                    .font(.subheadline)
                                    .lineLimit(2)
                                if let error = task.error {
                                    Text(error)
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .listRowBackground(Color.appBackground)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .navigationTitle("生成")
            .task { await pollTasks() }
        }
    }

    private func submit() async {
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
            errorMessage = nil
            await loadTasks()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// タブ表示中は 5 秒間隔でタスク一覧を更新する(.task がタブ離脱時にキャンセルする)
    private func pollTasks() async {
        while !Task.isCancelled {
            await loadTasks()
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func loadTasks() async {
        do {
            tasks = try await BackendAPI.getJSON(TasksResponse.self, path: "/api/tasks").tasks
        } catch {
            // ポーリングの失敗は画面を壊さない(送信時のエラーは submit() で表示する)
        }
    }
}
