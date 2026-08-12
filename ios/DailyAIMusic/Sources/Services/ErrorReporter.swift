import Foundation
import os

/// アプリで起きた失敗をサーバー(POST /api/client-errors)へ送る。
/// サーバー側は origin = 'ios' として `error_logs` に記録し、Mac からは
/// `scripts/fetch-error-logs.sh` でまとめて取得できる(実機のログを見に行かなくても済むように)。
///
/// 方針:
/// - 報告の失敗は無視する(本体の動作を邪魔しない)。送れなかった分は次の報告時にまとめて送る
/// - 同じ内容の連発は 60 秒に 1 回だけ送る(オフラインで画面がリトライし続けても溢れない)
/// - 送信は `BackendAPI.send` を通さない(報告の失敗がまた報告を生む無限ループを避けるため)
actor ErrorReporter {
    static let shared = ErrorReporter()

    /// サーバーの POST /api/client-errors の 1 件分
    private struct Report: Encodable {
        let occurredAt: String
        let level: String
        let source: String
        let event: String
        let message: String
        let detail: [String: String]
    }

    private struct Payload: Encodable {
        let errors: [Report]
    }

    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "DailyAIMusic",
        category: "ErrorReporter"
    )
    /// 未送信の報告(アプリ終了で捨てる。サーバーが落ちているときに溜め込まないよう上限付き)
    private var pending: [Report] = []
    private var lastReportedAt: [String: Date] = [:]

    private static let maxPending = 20
    private static let dedupeInterval: TimeInterval = 60

    private let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// 端末・アプリの情報(どのバージョンで起きたかの切り分け用。個人を識別する値は入れない)
    private static let environmentDetail: [String: String] = {
        let info = Bundle.main.infoDictionary
        var systemInfo = utsname()
        uname(&systemInfo)
        // uname はシミュレータだとホストの arch(arm64)を返すので、シミュレータでは
        // 実際に選ばれている機種を環境変数から採る
        let model =
            ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
            ?? withUnsafePointer(to: &systemInfo.machine) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
            }
        return [
            "appVersion": info?["CFBundleShortVersionString"] as? String ?? "unknown",
            "build": info?["CFBundleVersion"] as? String ?? "unknown",
            "iosVersion": ProcessInfo.processInfo.operatingSystemVersionString,
            "deviceModel": model,
            // URL 全体は載せない(接続先の識別だけできればよい)
            "baseURLHost": URL(string: BackendAPI.baseURLString)?.host ?? "unknown",
        ]
    }()

    /// どのスレッドからでも呼べる撃ちっぱなしの入口(呼び出し側は結果を待たない)
    nonisolated func report(
        source: String,
        event: String,
        message: String,
        level: String = "error",
        detail: [String: String] = [:]
    ) {
        Task {
            await enqueue(
                source: source, event: event, message: message, level: level, detail: detail
            )
        }
    }

    private func enqueue(
        source: String,
        event: String,
        message: String,
        level: String,
        detail: [String: String]
    ) async {
        let key = "\(source)/\(event)/\(message.prefix(120))"
        let now = Date()
        if let last = lastReportedAt[key], now.timeIntervalSince(last) < Self.dedupeInterval {
            return
        }
        lastReportedAt[key] = now

        pending.append(
            Report(
                occurredAt: timestampFormatter.string(from: now),
                level: level,
                source: source,
                event: event,
                message: String(message.prefix(500)),
                detail: detail.merging(Self.environmentDetail) { current, _ in current }
            )
        )
        if pending.count > Self.maxPending {
            pending.removeFirst(pending.count - Self.maxPending)
        }
        await flush()
    }

    private func flush() async {
        guard !pending.isEmpty else { return }
        let batch = pending
        guard var request = try? BackendAPI.makeRequest(path: "/api/client-errors", method: "POST"),
              let body = try? JSONEncoder().encode(Payload(errors: batch)) else {
            pending.removeAll()
            return
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            if (200...299).contains(statusCode) {
                pending.removeFirst(batch.count)
            } else {
                // 401(secret 未設定)などは何度送っても通らないので溜めずに捨てる
                logger.error("報告に失敗: HTTP \(statusCode, privacy: .public)(\(batch.count) 件を破棄)")
                pending.removeFirst(batch.count)
            }
        } catch {
            // 通信できないだけなら次の報告時に送り直す
            logger.info("報告を保留(\(batch.count, privacy: .public) 件): \(error.localizedDescription, privacy: .public)")
        }
    }
}
