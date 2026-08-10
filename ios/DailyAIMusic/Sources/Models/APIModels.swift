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
    /// "manual"(カスタム生成)| "daily" | "daily_adventure"(冒険日)| "artist"(アーティスト経由)
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
    /// LLM に送った入力全文(旧サーバー・旧データでは nil。optional デコードで後方互換)
    let llmPrompt: String?
    /// 曲の中心となった語(リアルワード)
    let realWorldWords: [String]
    /// 使用プリセット(使用時点のスナップショット)。旧サーバーでは nil、記録の無い旧データでは空配列
    let usedPresets: [UsedPreset]?
    /// artist モードで参照した曲(使用時点のスナップショット)。他モード・旧サーバーでは nil
    let refArtistName: String?
    let refSongTitle: String?
    let createdAt: Date

    var isAdventure: Bool { mode == "daily_adventure" }
    var modeLabel: String { generationModeLabel(mode) }

    /// 楽曲詳細に出す「リファレンス: <アーティスト>「<曲名>」」の表示文字列
    var referenceLabel: String? {
        guard let refArtistName, let refSongTitle else { return nil }
        return "\(refArtistName)「\(refSongTitle)」"
    }
}

/// 曲の生成に使われたプリセット(使用時点のスナップショット。プリセットが編集・削除されても表示できる)
struct UsedPreset: Decodable, Hashable {
    let category: String
    let value: String
    let labelJa: String
}

func generationModeLabel(_ mode: String) -> String {
    switch mode {
    case "manual": "カスタム生成"
    case "daily": "おまかせ生成"
    case "daily_adventure": "おまかせ生成(冒険日)"
    case "artist": "アーティスト経由"
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
    /// "manual" | "daily" | "daily_adventure" | "artist"(Track.mode と同じ)
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

/// POST /api/generate の body。artistSongId を入れるとアーティスト経由生成(mode = artist)になる。
/// nil のときはキー自体を送らない(Encodable の既定動作)ため、旧サーバーとも互換
struct GenerateRequest: Encodable {
    let prompt: String
    let instrumental: Bool
    var artistSongId: Int?
}

struct GenerateResponse: Decodable {
    let task: GenerationTask
}

/// POST /api/daily/run(おまかせ生成の手動トリガ)のレスポンス
struct DailyRunResponse: Decodable {
    let task: GenerationTask
    let adventure: Bool
}

// MARK: - アーティスト経由生成

/// GET /api/artists の登録済みアーティスト
struct Artist: Identifiable, Decodable, Hashable {
    let id: Int
    let name: String
    /// iTunes の分類(取れないときは nil)
    let genre: String?
    /// 取り込み済みの曲数
    let songCount: Int
}

struct ArtistsResponse: Decodable {
    let artists: [Artist]
}

/// GET /api/artists/search の候補(まだ登録されていない。iTunes の検索結果)
struct ArtistCandidate: Decodable, Hashable, Identifiable {
    let itunesArtistId: Int
    let name: String
    let genre: String?

    var id: Int { itunesArtistId }
}

struct ArtistSearchResponse: Decodable {
    let candidates: [ArtistCandidate]
}

/// POST /api/artists の body(itunesArtistId は候補から選んだときに付ける)
struct CreateArtistRequest: Encodable {
    let name: String
    let itunesArtistId: Int?
}

struct CreateArtistResponse: Decodable {
    let artist: Artist
    /// 取り込んだ曲数
    let added: Int
}

/// GET /api/artists/:id/songs の曲
struct ArtistSong: Identifiable, Decodable, Hashable {
    let id: Int
    let title: String
    let album: String?
    let releaseYear: Int?
    let genre: String?

    /// 一覧の副題(年 / アルバム。どちらも無ければ空)
    var subtitle: String {
        [releaseYear.map(String.init), album].compactMap { $0 }.joined(separator: " · ")
    }
}

struct ArtistSongsResponse: Decodable {
    let artist: Artist
    let songs: [ArtistSong]
}

// MARK: - 曲名からの登録(アーティストは iTunes の応答から逆引きする)

/// GET /api/artist-songs/search の候補(まだ登録されていない。iTunes の検索結果)
struct SongCandidate: Decodable, Hashable, Identifiable {
    let itunesTrackId: Int
    let title: String
    /// iTunes の表示名(「クイーン」のようにローカライズされる)。表示専用で、
    /// 実際の登録名はサーバーが iTunes の正式表記(「Queen」)から決める
    let artistName: String
    let album: String?
    let releaseYear: Int?

    var id: Int { itunesTrackId }

    /// 候補行の副題。日本語検索は読みマッチで曲名の違う行も混ざるためアーティスト名を先頭に出す
    var subtitle: String {
        [artistName, releaseYear.map(String.init), album].compactMap { $0 }.joined(separator: " · ")
    }
}

struct SongSearchResponse: Decodable {
    let candidates: [SongCandidate]
}

/// POST /api/artist-songs の body。曲メタはサーバーが取り直すので trackId だけ送る
struct CreateArtistSongRequest: Encodable {
    let itunesTrackId: Int
}

struct CreateArtistSongResponse: Decodable {
    let artist: Artist
    let song: ArtistSong
    /// アーティストも新規登録されたか(既に登録済みなら false)
    let artistCreated: Bool
    /// 新規登録時に取り込んだ曲数
    let importedSongs: Int
}

/// GET /api/credits。プロバイダから取れなかったときは null
struct CreditsResponse: Decodable {
    let credits: Int?
}

struct PingResponse: Decodable {
    let ok: Bool
}

/// GET /api/generation-params — おまかせ生成(毎日の自動生成)が LLM に注入する入力の一覧。
/// サーバー側で runDaily と同じ関数群から組み立てるため、表示と実際の生成入力がずれない
struct GenerationParams: Decodable {
    let adventureProbability: Double
    let contextNews: Bool
    let presets: [PoolPreset]
    /// category → 日本語ラベル(例: "genre" → "ジャンル")
    let categoryLabels: [String: String]
    let recentStyles: [RecentStyle]
    let wordMaxUses: Int
    let wordWindowDays: Int
    /// 使用上限に達したリアルワード(曲の中心に据えない)
    let bannedWords: [String]
    /// 残り 1 回のリアルワード
    let lastChanceWords: [String]
    /// ウィンドウ内で追跡中のリアルワード総数
    let trackedWordCount: Int
}

/// 要素プールのプリセット(評価 👍/👎 の集計付き)
struct PoolPreset: Decodable, Identifiable {
    let id: Int
    let category: String
    let value: String
    let labelJa: String
    let upCount: Int
    let downCount: Int
}

/// 直近の生成スタイル(重複回避用にプロンプトへ注入される)。styleJa が無い旧データは英語のみ
struct RecentStyle: Decodable {
    let style: String
    let styleJa: String?
}

struct GenerationParamsResponse: Decodable {
    let params: GenerationParams
}

/// GET/PUT /api/settings のサーバー設定のうち iOS で扱う分(毎日の自動生成+今日のコンテキスト)。
/// リアルワード制限(wordMaxUses 等)は表示しないため定義しない(余分なキーは無視される)。
/// 変更の楽観反映(トグルの即時切替)のため var
struct ServerSettings: Decodable, Equatable {
    var dailyEnabled: Bool
    var adventureProbability: Double
    var dailyHour: Int
    var dailyTimezone: String
    /// 1 日に生成する曲数(1〜10)
    var dailyCount: Int
    var contextNews: Bool
}

struct SettingsResponse: Decodable {
    let settings: ServerSettings
}

/// PUT /api/settings の部分更新 body(nil のキーは送信されない)
struct SettingsUpdateRequest: Encodable {
    var dailyEnabled: Bool?
    var adventureProbability: Double?
    var dailyHour: Int?
    var dailyTimezone: String?
    var dailyCount: Int?
    var contextNews: Bool?

    init(
        dailyEnabled: Bool? = nil,
        adventureProbability: Double? = nil,
        dailyHour: Int? = nil,
        dailyTimezone: String? = nil,
        dailyCount: Int? = nil,
        contextNews: Bool? = nil
    ) {
        self.dailyEnabled = dailyEnabled
        self.adventureProbability = adventureProbability
        self.dailyHour = dailyHour
        self.dailyTimezone = dailyTimezone
        self.dailyCount = dailyCount
        self.contextNews = contextNews
    }
}
