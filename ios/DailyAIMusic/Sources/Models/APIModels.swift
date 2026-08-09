import Foundation

/// GET /api/tracks の楽曲。audioUrl / imageUrl はサーバーからの相対パス(例: /api/audio/xxx.mp3。X-API-Secret 必須)
/// Hashable は楽曲詳細への NavigationStack 遷移(navigationDestination の value)用
struct Track: Identifiable, Decodable, Hashable {
    let id: Int
    let taskId: Int
    let title: String
    let duration: Double
    let audioUrl: String
    let imageUrl: String?
    /// 1 = 👍, -1 = 👎, nil = 未評価
    let rating: Int?
    /// "manual"(カスタム生成)| "daily" | "daily_adventure"(冒険日)
    let mode: String
    let instrumental: Bool
    /// 以下は LLM 生成のメタデータ。LLM 導入前の旧データでは nil
    let style: String?
    let styleJa: String?
    let lyrics: String?
    let lyricsJa: String?
    let intent: String?
    let sunoModel: String?
    let llmModel: String?
    /// 曲の中心となった語(リアルワード)
    let realWorldWords: [String]
    let createdAt: Date

    var isAdventure: Bool { mode == "daily_adventure" }
    var modeLabel: String { generationModeLabel(mode) }
}

func generationModeLabel(_ mode: String) -> String {
    switch mode {
    case "manual": "カスタム生成"
    case "daily": "おまかせ生成"
    case "daily_adventure": "おまかせ生成(冒険日)"
    default: mode
    }
}

struct TracksResponse: Decodable {
    let tracks: [Track]
}

/// POST /api/tracks/:id/rating の body。サーバーは "rating" キー必須のため、
/// nil(評価解除)でもキーを省略せず "rating": null を送る
struct RatingRequest: Encodable {
    let rating: Int?

    private enum CodingKeys: String, CodingKey { case rating }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(rating, forKey: .rating)
    }
}

struct RatingResponse: Decodable {
    let track: Track
}

/// GET /api/tasks の生成ジョブ
struct GenerationTask: Identifiable, Decodable, Equatable {
    let id: Int
    let prompt: String
    let instrumental: Bool
    let status: String
    let error: String?
    /// "manual" | "daily" | "daily_adventure"(Track.mode と同じ)
    let mode: String
    /// LLM が決めた曲名(TEXT_SUCCESS 以降。それ以前と旧データは nil)
    let title: String?
    let createdAt: Date
    let updatedAt: Date

    var isActive: Bool { status != "COMPLETE" && status != "FAILED" }

    var modeLabel: String { generationModeLabel(mode) }

    /// ライブラリの進行中ジョブカードの進行バー用。実進捗は取れないためステータス段階のおおよその値
    var progressFraction: Double {
        switch status {
        case "PENDING": 0.1
        case "TEXT_SUCCESS": 0.45
        case "FIRST_SUCCESS": 0.7
        case "SUCCESS": 0.9
        case "COMPLETE": 1
        default: 0.05
        }
    }

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

/// POST /api/daily/run(おまかせ生成の手動トリガ)のレスポンス
struct DailyRunResponse: Decodable {
    let task: GenerationTask
    let adventure: Bool
}

/// GET /api/credits。プロバイダから取れなかったときは null
struct CreditsResponse: Decodable {
    let credits: Int?
}

struct PingResponse: Decodable {
    let ok: Bool
}

/// GET/PUT /api/settings のサーバー設定のうち iOS で扱う分(毎日の自動生成+今日のコンテキスト)。
/// リアルワード制限(wordMaxUses 等)・座標(weatherLat/Lon)は表示しないため定義しない(余分なキーは無視される)。
/// 変更の楽観反映(トグルの即時切替)のため var
struct ServerSettings: Decodable, Equatable {
    var dailyEnabled: Bool
    var adventureProbability: Double
    var dailyHour: Int
    var dailyTimezone: String
    var contextNews: Bool
    var contextWeather: Bool
    var weatherCity: String
}

struct SettingsResponse: Decodable {
    let settings: ServerSettings
}

/// PUT /api/settings の部分更新 body(nil のキーは送信されない)。
/// 都市は名前と座標の不整合を防ぐため weatherCity/Lat/Lon を 1 回の PUT で同時に送る(管理画面と同じ)
struct SettingsUpdateRequest: Encodable {
    var dailyEnabled: Bool?
    var adventureProbability: Double?
    var dailyHour: Int?
    var dailyTimezone: String?
    var contextNews: Bool?
    var contextWeather: Bool?
    var weatherCity: String?
    var weatherLat: Double?
    var weatherLon: Double?

    init(
        dailyEnabled: Bool? = nil,
        adventureProbability: Double? = nil,
        dailyHour: Int? = nil,
        dailyTimezone: String? = nil,
        contextNews: Bool? = nil,
        contextWeather: Bool? = nil,
        weatherCity: String? = nil,
        weatherLat: Double? = nil,
        weatherLon: Double? = nil
    ) {
        self.dailyEnabled = dailyEnabled
        self.adventureProbability = adventureProbability
        self.dailyHour = dailyHour
        self.dailyTimezone = dailyTimezone
        self.contextNews = contextNews
        self.contextWeather = contextWeather
        self.weatherCity = weatherCity
        self.weatherLat = weatherLat
        self.weatherLon = weatherLon
    }
}
