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
    /// "manual"(カスタム生成)| "daily" | "artist"(アーティスト経由)
    let mode: String
    let instrumental: Bool
    /// 以下は LLM 生成のメタデータ。LLM 導入前の旧データでは nil
    let style: String?
    let styleJa: String?
    /// Suno に渡した原詞(歌声の言語で書かれている)
    let lyrics: String?
    /// 日本語訳。原詞が日本語のとき・旧データでは nil
    let lyricsJa: String?
    /// 原詞の言語 "ja" | "en"(記録の無い旧データ・旧サーバーでは nil)
    let lyricsLang: String?
    let intent: String?
    let sunoModel: String?
    let llmModel: String?
    /// LLM に送った入力全文(旧サーバー・旧データでは nil。optional デコードで後方互換)
    let llmPrompt: String?
    /// web_search で参照した情報源(参照曲ありの生成のみ。参照曲なし・旧サーバーでは nil / 空)
    let sources: [String]?
    /// 曲の中心となった語(リアルワード)
    let realWorldWords: [String]
    /// 参照した曲(使用時点のスナップショット)。`artist` と、参照曲ベースの `daily` で入る。
    /// 参照曲なしの旧データでは nil
    let refArtistName: String?
    let refSongTitle: String?
    let createdAt: Date

    var modeLabel: String { generationModeLabel(mode) }

    /// 歌声の言語のラベル(記録の無い旧データでは nil)
    var vocalLanguageLabel: String? { vocalLanguageLabelFor(lyricsLang) }

    /// 楽曲詳細に出す「リファレンス: <アーティスト>「<曲名>」」の表示文字列
    var referenceLabel: String? {
        guard let refArtistName, let refSongTitle else { return nil }
        return "\(refArtistName)「\(refSongTitle)」"
    }
}

/// 歌声(歌詞)の言語コード。サーバー設定 `vocal_language` と `tasks.lyrics_lang` で共通
enum VocalLanguage {
    static let japanese = "ja"
    static let english = "en"
    /// 旧サーバーが `vocalLanguage` を返さないときの既定(サーバー側の既定と揃える)
    static let `default` = japanese
}

/// 言語コードの表示名。未知・未記録は nil(表示しない)
func vocalLanguageLabelFor(_ code: String?) -> String? {
    switch code {
    case VocalLanguage.japanese: "日本語"
    case VocalLanguage.english: "英語"
    default: nil
    }
}

func generationModeLabel(_ mode: String) -> String {
    switch mode {
    case "manual": "カスタム生成"
    case "daily": "おまかせ生成"
    case "artist": "アーティスト経由"
    default: mode
    }
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
    /// "manual" | "daily" | "artist"(Track.mode と同じ)
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
        // PLANNING は Suno へ送る前(LLM がスタイルと歌詞を考えている最中)。
        // 参照曲ありの生成では web_search で調べるため 3 分ほどかかることがある
        case "PLANNING": 0.05
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
        case "PLANNING": "曲を考えています…"
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

/// POST /api/generate の body。参照曲(artistSongId)は必須で、prompt は
/// リファレンスに重ねる「追加の要望」(iOS からは常に空文字)
struct GenerateRequest: Encodable {
    let prompt: String
    let instrumental: Bool
    let artistSongId: Int
}

struct GenerateResponse: Decodable {
    let task: GenerationTask
}

/// POST /api/daily/run(おまかせ生成の手動トリガ)のレスポンス
struct DailyRunResponse: Decodable {
    let task: GenerationTask
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
    /// 参照曲の候補になる曲数(無効にした曲を除く)。旧サーバーは返さないので optional
    let enabledSongCount: Int?

    /// 一覧の「有効 N / 全 M 曲」の N(有効/無効を持たない旧サーバーでは全曲が候補)
    var enabledSongs: Int { enabledSongCount ?? songCount }
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
    /// 参照曲の候補にするか。旧サーバーは返さない(その頃は全曲が候補だったので nil = 有効)。
    /// トグルの楽観反映(押した瞬間に見た目を変える)のため var
    var enabled: Bool?

    /// 無効な曲は参照曲に選ばれず、この曲での生成もできない(サーバーが 409 で弾く)
    var isEnabled: Bool { enabled ?? true }

    /// 一覧の副題(年 / アルバム。どちらも無ければ空)
    var subtitle: String {
        [releaseYear.map(String.init), album].compactMap { $0 }.joined(separator: " · ")
    }
}

struct ArtistSongsResponse: Decodable {
    let artist: Artist
    let songs: [ArtistSong]
}

/// PATCH /api/artist-songs/:id の body(曲 1 件の有効/無効)
struct SetSongEnabledRequest: Encodable {
    let enabled: Bool
}

struct ArtistSongResponse: Decodable {
    let song: ArtistSong
}

/// PATCH /api/artists/:id/songs の body(曲の一括更新)
struct SetArtistSongsEnabledRequest: Encodable {
    let enabled: Bool
    /// 対象の曲 id。nil はそのアーティストの全曲(Encodable は nil のキーを出さない)
    let ids: [Int]?
}

struct ArtistSongsBulkResponse: Decodable {
    let artist: Artist
    /// 実際に更新された曲数
    let updated: Int
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
    /// 参照曲の候補(アーティスト単位。最終使用が古い順 = 次に選ばれやすい順)。
    /// 空ならアーティスト未登録で、おまかせ生成できない
    let referenceCandidates: [ReferenceCandidateSummary]
    /// 直近に参照した曲
    let recentReferences: [RecentReference]
    let contextNews: Bool
    /// 歌声の言語 "ja" | "en"(旧サーバーでは nil)
    let vocalLanguage: String?
    let wordMaxUses: Int
    let wordWindowDays: Int
    /// 使用上限に達したリアルワード(曲の中心に据えない)
    let bannedWords: [String]
    /// 残り 1 回のリアルワード
    let lastChanceWords: [String]
    /// ウィンドウ内で追跡中のリアルワード総数
    let trackedWordCount: Int
}

/// 参照曲の候補(アーティスト単位)。songCount は有効な曲(無効にした曲を除く)の数
struct ReferenceCandidateSummary: Decodable, Identifiable {
    let artistId: Int
    let artistName: String
    let songCount: Int
    /// このアーティストの曲を最後に参照した日時(未使用は nil = 次に選ばれる)
    let lastUsedAt: Date?

    var id: Int { artistId }
}

/// 直近に参照した曲(毎日の自動生成が選んだ曲)
struct RecentReference: Decodable {
    let artistName: String
    let title: String
    let usedAt: Date
}

struct GenerationParamsResponse: Decodable {
    let params: GenerationParams
}

/// GET/PUT /api/settings のサーバー設定のうち iOS で扱う分(毎日の自動生成+今日のコンテキスト)。
/// リアルワード制限(wordMaxUses 等)は表示しないため定義しない(余分なキーは無視される)。
/// 変更の楽観反映(トグルの即時切替)のため var
struct ServerSettings: Decodable, Equatable {
    var dailyEnabled: Bool
    var dailyHour: Int
    var dailyTimezone: String
    /// 1 日に生成する曲数(1〜10)
    var dailyCount: Int
    var contextNews: Bool
    /// 歌声(歌詞)の言語 "ja" | "en"。旧サーバーは返さないので optional で受け、
    /// 表示・保存時は VocalLanguage.default にフォールバックする
    var vocalLanguage: String?
}

struct SettingsResponse: Decodable {
    let settings: ServerSettings
}

/// PUT /api/settings の部分更新 body(nil のキーは送信されない)
struct SettingsUpdateRequest: Encodable {
    var dailyEnabled: Bool?
    var dailyHour: Int?
    var dailyTimezone: String?
    var dailyCount: Int?
    var contextNews: Bool?
    var vocalLanguage: String?

    init(
        dailyEnabled: Bool? = nil,
        dailyHour: Int? = nil,
        dailyTimezone: String? = nil,
        dailyCount: Int? = nil,
        contextNews: Bool? = nil,
        vocalLanguage: String? = nil
    ) {
        self.dailyEnabled = dailyEnabled
        self.dailyHour = dailyHour
        self.dailyTimezone = dailyTimezone
        self.dailyCount = dailyCount
        self.contextNews = contextNews
        self.vocalLanguage = vocalLanguage
    }
}
