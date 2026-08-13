// iTunes Search API クライアント(生成経路「アーティスト経由」の楽曲データソース)。
// API キー不要・無料。外部 API の面倒(タイムアウト・エラーの日本語化・重複除去)はここに閉じ込める。
// レート制限は約 20 req/分だが、登録・再取得は手動操作のみなので当たらない
import type { ArtistSongInput } from "./db.ts";

const BASE_URL = "https://itunes.apple.com";
const TIMEOUT_MS = 10_000;
// lookup の limit は 200 で頭打ち(300 を指定しても track は 200 行までしか返らない)
const SONG_LIMIT = 200;
// 曲名検索はカバー・ピアノ版のノイズが多く、本家が上位 10 件に入らないことがあるため広めに取る
const SONG_SEARCH_LIMIT = 25;

export interface ArtistCandidate {
  itunesArtistId: number;
  name: string;
  // JP ストアの表示名(artistLinkUrl の slug 由来)。ASCII のみの表示名は null(name を使う)
  nameJa: string | null;
  genre: string | null;
}

// 曲名検索の候補。artistName は track 行の表示名(country=JP だと「クイーン」「米津玄師」の
// ようにローカライズされる)で表示専用 — 登録名には使わない(fetchSongs の artistName を使う)
export interface SongCandidate {
  itunesTrackId: number;
  title: string;
  artistName: string;
  itunesArtistId: number;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
}

interface ItunesResult {
  wrapperType?: string;
  artistId?: number;
  artistName?: string;
  artistLinkUrl?: string;
  trackId?: number;
  trackName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
}

// artist 行の artistLinkUrl(…/jp/artist/<表示名の slug>/<id>)から JP ストアの表示名を取り出す。
// artist 行の artistName は country=JP でも lang=ja_jp でもローカライズされず常に正式表記
// (「米津玄師」→ "Kenshi Yonezu")のため、日本語の表示名はこの slug からしか取れない。
// slug の制約(実測)と対応:
// - ASCII は小文字化される(DAOKO → daoko)→ 全 ASCII なら表記情報が失われているので不採用(null)
// - 中黒・空白は「-」になる(フレディ・マーキュリー → フレディ-マーキュリー)
//   → カタカナに挟まれた「-」は「・」に戻す(この文脈の「-」はほぼ中黒・空白由来のため)
// - 末尾の記号は落ちる(ずっと真夜中でいいのに。→ ずっと真夜中でいいのに)→ 許容
export function artistNameJaFromLinkUrl(linkUrl: string | undefined): string | null {
  const slug = linkUrl?.match(/\/artist\/([^/?]+)\//)?.[1];
  if (!slug) return null;
  let name: string;
  try {
    name = decodeURIComponent(slug);
  } catch {
    return null;
  }
  if (/^[\x00-\x7f]*$/.test(name)) return null;
  return name.replace(/(?<=[゠-ヿ])-(?=[゠-ヿ])/g, "・");
}

async function request(path: string, params: Record<string, string>): Promise<ItunesResult[]> {
  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new Error(
      timedOut
        ? "iTunes への接続がタイムアウトしました"
        : `iTunes への接続に失敗しました: ${err}`
    );
  }
  if (!res.ok) {
    // 403 はレート制限(約 20 req/分)のことが多い
    throw new Error(`iTunes API がエラーを返しました (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { results?: ItunesResult[] };
  return body.results ?? [];
}

// アーティスト候補の検索。日本語で検索してもヒットするが、返る名前は iTunes の正式表記
// (「米津玄師」→「Kenshi Yonezu」)。別名義も混ざるので、呼び出し側で選ばせる。
// country=JP で 0 件なら US で再試行する(邦楽・洋楽の両対応)
export async function searchArtists(term: string): Promise<ArtistCandidate[]> {
  for (const country of ["JP", "US"]) {
    const results = await request("/search", {
      term,
      entity: "musicArtist",
      limit: "10",
      country,
    });
    const candidates = results
      .filter((r) => r.artistId !== undefined && r.artistName)
      .map((r) => ({
        itunesArtistId: r.artistId!,
        name: r.artistName!,
        // US フォールバック時は slug も英語なので自然に null になる
        nameJa: artistNameJaFromLinkUrl(r.artistLinkUrl),
        genre: r.primaryGenreName ?? null,
      }));
    if (candidates.length > 0) return candidates;
  }
  return [];
}

// 曲名の正規化(重複判定用)。シングル版・アルバム版・ベスト盤で同じ曲が複数行返るため、
// trim + 小文字化で同一視する(「(Live)」等の別バージョンは曲名自体が違うので残る)
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

// 同じキーの行を最古のリリース(= オリジナル版)だけ残して畳む。
// 並びは初出の位置を保つ(Map.set は既存キーの挿入位置を変えないため)
function dedupeKeepingOldest<T>(
  rows: { key: string; releaseDate: string; value: T }[]
): T[] {
  const byKey = new Map<string, { releaseDate: string; value: T }>();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    // リリース日不明は最後尾扱いにして、日付のある行を優先する
    if (existing && (existing.releaseDate || "9999") <= (row.releaseDate || "9999")) continue;
    byKey.set(row.key, row);
  }
  return [...byKey.values()].map((v) => v.value);
}

function releaseYearOf(releaseDate: string): number | null {
  return releaseDate ? Number(releaseDate.slice(0, 4)) || null : null;
}

// 曲候補への変換。trackId / trackName / artistId が揃わない行は候補にしない
function toSongCandidate(r: ItunesResult): SongCandidate | null {
  if (r.trackId === undefined || !r.trackName || r.artistId === undefined) return null;
  return {
    itunesTrackId: r.trackId,
    title: r.trackName.trim(),
    artistName: r.artistName ?? "",
    itunesArtistId: r.artistId,
    album: r.collectionName ?? null,
    releaseYear: releaseYearOf(r.releaseDate ?? ""),
    genre: r.primaryGenreName ?? null,
  };
}

// 曲名で検索する。track 行に artistId が入るのでアーティストの逆引きはこの 1 リクエストで完結する。
// カバー・ピアノ版・オルゴールが多く混ざる(「Lemon」の上位 10 件で本家は 2 行だけ)ため、
// 呼び出し側で候補から選ばせる。日本語でも検索できるが読みマッチで曲名の違う行も混ざるので、
// 候補には曲名とアーティスト名の両方を出すこと。
// country=JP で 0 件なら US で再試行する(邦楽・洋楽の両対応)
export async function searchSongs(term: string): Promise<SongCandidate[]> {
  for (const country of ["JP", "US"]) {
    const results = await request("/search", {
      term,
      entity: "song",
      limit: String(SONG_SEARCH_LIMIT),
      country,
    });
    // 同じ曲がベスト盤・シングル・アルバムで複数行返る(クイーンの Bohemian Rhapsody は 4 行)。
    // アーティストが違えばカバー版として残す
    const candidates = dedupeKeepingOldest(
      results.flatMap((r) => {
        const candidate = toSongCandidate(r);
        if (!candidate) return [];
        return [
          {
            key: `${candidate.itunesArtistId} ${normalizeTitle(candidate.title)}`,
            releaseDate: r.releaseDate ?? "",
            value: candidate,
          },
        ];
      })
    );
    if (candidates.length > 0) return candidates;
  }
  return [];
}

// trackId から曲メタを取り直す(クライアントの申告を信用しないため)
export async function fetchTrack(itunesTrackId: number): Promise<SongCandidate | null> {
  for (const country of ["JP", "US"]) {
    const results = await request("/lookup", { id: String(itunesTrackId), country });
    for (const r of results) {
      if (r.wrapperType !== "track") continue;
      const candidate = toSongCandidate(r);
      if (candidate) return candidate;
    }
  }
  return null;
}

// 登録アーティストの楽曲一覧。重複は最古のリリース(= オリジナル版)を残す。
// track 行の artistId は登録アーティストと一致しないものが混ざる(コラボ曲)が、
// 本人の曲なので除外しない。lookup の応答はアーティスト 1 行 + track 行なので、
// アーティストの正式表記(検索の track 行と違いローカライズされない)とジャンルも
// 同じ 1 リクエストから拾える
export async function fetchSongs(itunesArtistId: number): Promise<{
  artistName: string | null;
  artistNameJa: string | null; // JP ストアの表示名(slug 由来。ASCII のみは null)
  artistGenre: string | null;
  songs: ArtistSongInput[];
}> {
  const results = await request("/lookup", {
    id: String(itunesArtistId),
    entity: "song",
    limit: String(SONG_LIMIT),
    country: "JP",
  });
  const artistRow = results.find((r) => r.wrapperType === "artist");
  const songs = dedupeKeepingOldest(
    results.flatMap((r) => {
      if (r.wrapperType !== "track" || !r.trackName) return [];
      const releaseDate = r.releaseDate ?? "";
      return [
        {
          key: normalizeTitle(r.trackName),
          releaseDate,
          value: {
            title: r.trackName.trim(),
            album: r.collectionName ?? null,
            releaseYear: releaseYearOf(releaseDate),
            genre: r.primaryGenreName ?? null,
            itunesTrackId: r.trackId ?? null,
          } satisfies ArtistSongInput,
        },
      ];
    })
  );
  return {
    artistName: artistRow?.artistName ?? null,
    artistNameJa: artistNameJaFromLinkUrl(artistRow?.artistLinkUrl),
    artistGenre: artistRow?.primaryGenreName ?? null,
    songs,
  };
}

// アーティスト 1 件の lookup(name_ja バックフィル用)。曲を取らないぶん fetchSongs より軽い
export async function fetchArtist(itunesArtistId: number): Promise<ArtistCandidate | null> {
  const results = await request("/lookup", { id: String(itunesArtistId), country: "JP" });
  const r = results.find((row) => row.wrapperType === "artist");
  if (!r || r.artistId === undefined || !r.artistName) return null;
  return {
    itunesArtistId: r.artistId,
    name: r.artistName,
    nameJa: artistNameJaFromLinkUrl(r.artistLinkUrl),
    genre: r.primaryGenreName ?? null,
  };
}
