// iTunes Search API クライアント(生成経路「アーティスト経由」の楽曲データソース)。
// API キー不要・無料。外部 API の面倒(タイムアウト・エラーの日本語化・重複除去)はここに閉じ込める。
// レート制限は約 20 req/分だが、登録・再取得は手動操作のみなので当たらない
import type { ArtistSongInput } from "./db.ts";

const BASE_URL = "https://itunes.apple.com";
const TIMEOUT_MS = 10_000;
// lookup の limit は 200 で頭打ち(300 を指定しても track は 200 行までしか返らない)
const SONG_LIMIT = 200;

export interface ArtistCandidate {
  itunesArtistId: number;
  name: string;
  genre: string | null;
}

interface ItunesResult {
  wrapperType?: string;
  artistId?: number;
  artistName?: string;
  trackId?: number;
  trackName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
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

// 登録アーティストの楽曲一覧。重複は最古のリリース(= オリジナル版)を残す。
// track 行の artistId は登録アーティストと一致しないものが混ざる(コラボ曲)が、
// 本人の曲なので除外しない。lookup の応答はアーティスト 1 行 + track 行なので、
// アーティストのジャンルも同じ 1 リクエストから拾える
export async function fetchSongs(
  itunesArtistId: number
): Promise<{ artistGenre: string | null; songs: ArtistSongInput[] }> {
  const results = await request("/lookup", {
    id: String(itunesArtistId),
    entity: "song",
    limit: String(SONG_LIMIT),
    country: "JP",
  });
  const artistGenre =
    results.find((r) => r.wrapperType === "artist")?.primaryGenreName ?? null;
  const byTitle = new Map<string, { song: ArtistSongInput; releaseDate: string }>();
  for (const r of results) {
    if (r.wrapperType !== "track" || !r.trackName) continue;
    const releaseDate = r.releaseDate ?? "";
    const key = normalizeTitle(r.trackName);
    const existing = byTitle.get(key);
    // 最古を残す(リリース日不明は最後尾扱いにして、日付のある行を優先する)
    if (existing && (existing.releaseDate || "9999") <= (releaseDate || "9999")) continue;
    byTitle.set(key, {
      releaseDate,
      song: {
        title: r.trackName.trim(),
        album: r.collectionName ?? null,
        releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
        genre: r.primaryGenreName ?? null,
        itunesTrackId: r.trackId ?? null,
      },
    });
  }
  return { artistGenre, songs: [...byTitle.values()].map((v) => v.song) };
}
