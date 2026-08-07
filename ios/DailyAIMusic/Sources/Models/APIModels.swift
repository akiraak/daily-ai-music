import Foundation

/// GET /api/tracks の楽曲。audioUrl / imageUrl はサーバーからの相対パス(例: /api/audio/xxx.mp3。X-API-Secret 必須)
struct Track: Identifiable, Decodable, Equatable {
    let id: Int
    let taskId: Int
    let title: String
    let duration: Double
    let audioUrl: String
    let imageUrl: String?
    let createdAt: Date
}

struct TracksResponse: Decodable {
    let tracks: [Track]
}

/// GET /api/tasks の生成ジョブ
struct GenerationTask: Identifiable, Decodable, Equatable {
    let id: Int
    let prompt: String
    let instrumental: Bool
    let status: String
    let error: String?
    let createdAt: Date
    let updatedAt: Date

    var isActive: Bool { status != "COMPLETE" && status != "FAILED" }

    /// Web 管理画面(public/app.js の STATUS_LABELS)と同じ日本語ラベル
    var statusLabel: String {
        switch status {
        case "PENDING": "待機中"
        case "TEXT_SUCCESS": "歌詞生成完了・音声生成中"
        case "FIRST_SUCCESS": "1 曲目完了"
        case "SUCCESS": "音源を保存中"
        case "COMPLETE": "完了"
        case "FAILED": "失敗"
        default: status
        }
    }
}

struct TasksResponse: Decodable {
    let tasks: [GenerationTask]
}

struct GenerateRequest: Encodable {
    let prompt: String
    let instrumental: Bool
}

struct GenerateResponse: Decodable {
    let task: GenerationTask
}

struct PingResponse: Decodable {
    let ok: Bool
}
