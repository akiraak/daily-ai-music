import Foundation
import os

enum BackendAPIError: LocalizedError {
    case invalidBaseURL
    /// 401: X-API-Secret の未設定・不一致
    case unauthorized
    case serverError(statusCode: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            "サーバー URL が不正です。設定画面を確認してください。"
        case .unauthorized:
            "認証に失敗しました(401)。設定画面の API Secret を確認してください。"
        case .serverError(let statusCode, let message):
            if let message, !message.isEmpty {
                "サーバーエラー(HTTP \(statusCode)): \(message)"
            } else {
                "サーバーエラー(HTTP \(statusCode))"
            }
        }
    }
}

/// server の /api/* 呼び出しの共通処理。
/// base URL と API Secret は設定画面の値(UserDefaults、未設定時はビルド埋め込みの既定値)を使う。
/// 通信の開始・結果は os.Logger(category: "BackendAPI")に記録する(secret 値はログに出さない)
enum BackendAPI {
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "DailyAIMusic",
        category: "BackendAPI"
    )

    static var baseURLString: String {
        if let value = UserDefaults.standard.string(forKey: AppSettingsKeys.backendBaseURL),
           !value.isEmpty {
            return value
        }
        return AppSettingsKeys.defaultBackendBaseURL
    }

    private static var secret: String {
        if let value = UserDefaults.standard.string(forKey: AppSettingsKeys.apiSecret),
           !value.isEmpty {
            return value
        }
        return AppSettingsKeys.defaultAPISecret
    }

    /// API レスポンス内の相対パス(/audio/... /images/...)から絶対 URL を作る(再生・カバー画像用)
    static func absoluteURL(forServerPath path: String) -> URL? {
        guard let base = URL(string: baseURLString) else { return nil }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }

    /// created_at 等の ISO8601(ミリ秒付き。SQLite の strftime('%Y-%m-%dT%H:%M:%fZ'))対応のデコーダ
    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { d in
            let container = try d.singleValueContainer()
            let s = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: s) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: s) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "invalid date: \(s)")
        }
        return decoder
    }

    static func getJSON<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "GET")
        let data = try await send(request, path: path)
        return try makeDecoder().decode(type, from: data)
    }

    static func postJSON<T: Decodable>(_ type: T.Type, path: String, body: some Encodable) async throws -> T {
        var request = try makeRequest(path: path, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let data = try await send(request, path: path)
        return try makeDecoder().decode(type, from: data)
    }

    private static func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = absoluteURL(forServerPath: path) else {
            logger.error("\(method, privacy: .public) \(path, privacy: .public): invalid base URL \"\(baseURLString, privacy: .public)\"")
            throw BackendAPIError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if !secret.isEmpty {
            request.setValue(secret, forHTTPHeaderField: "X-API-Secret")
        }
        logger.info("\(method, privacy: .public) \(url.absoluteString, privacy: .public)")
        return request
    }

    private static func send(_ request: URLRequest, path: String) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            logger.error("\(path, privacy: .public): transport error: \(error.localizedDescription, privacy: .public)")
            throw error
        }

        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
        if (200...299).contains(statusCode) {
            logger.info("\(path, privacy: .public): HTTP \(statusCode) (\(data.count) bytes)")
            return data
        }

        let bodySnippet = String(data: data.prefix(500), encoding: .utf8) ?? "<non-UTF8 \(data.count) bytes>"
        logger.error("\(path, privacy: .public): HTTP \(statusCode) body=\(bodySnippet, privacy: .public)")
        if statusCode == 401 {
            throw BackendAPIError.unauthorized
        }
        // サーバーは {"error": "..."} 形式でメッセージを返す
        let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
        throw BackendAPIError.serverError(statusCode: statusCode, message: message)
    }
}
