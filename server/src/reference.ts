// 毎日の自動生成で使う参照曲の選択。登録済みの曲(artist_songs)から 1 曲を選び、
// その曲に似た新曲を作らせる。選ぶのはサーバー(LLM には選ばせない)。
//
// 選択規則は「ノイズ除外 → アーティストを LRU で選ぶ → その人の曲を LRU で選ぶ」の 2 段階。
// アーティスト一様にするのは、取り込みが 1 アーティスト最大 200 曲でカタログの大小差が
// 桁違いのため(曲一様だと大カタログの人ばかり選ばれる)。LRU + ランダムなら「直近 N 日は除外」
// のような設定を増やさずに、連続回避・枯渇回避・一巡が同時に成立する
import * as db from "./db.ts";

export interface ReferenceCandidate {
  id: number;
  artistId: number;
  artistName: string;
  title: string;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
  lastUsedAt: string | null; // この曲を参照したタスクの最新 created_at(未使用は null)
}

// 別バージョン・派生音源を示す語。iTunes の取り込みは曲名の完全一致でしか重複を畳まないため、
// 同じ曲のライブ版・リミックスがそのまま候補に残る。参照曲としては原曲を引きたい
const NOISE_KEYWORDS = [
  "live",
  "remix",
  "instrumental",
  "karaoke",
  "cover",
  "off vocal",
  "acoustic version",
  "acoustic ver",
  "demo",
  "remaster",
  "remastered",
  "radio edit",
  "tv size",
  "a cappella",
  "acappella",
  "backing track",
  "reprise",
  "medley",
  "ライブ",
  "ライヴ",
  "カラオケ",
  "インスト",
  "オフボーカル",
];

// ASCII の語は語境界で見る(「cover」が「discovery」に誤ヒットしないように)。
// 日本語などの非 ASCII は語境界の概念が無いので単純な部分一致
function containsKeyword(lower: string, keyword: string): boolean {
  if (/^[\x20-\x7e]+$/.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower);
  }
  return lower.includes(keyword);
}

// 曲名のうち、括弧書き・ダッシュ以降の「注釈」部分だけを取り出す。
// 本題側は見ない(「Live and Let Die」「Cover Me」のような原曲を落とさないため)
function annotations(title: string): string[] {
  const parts: string[] = title.match(/[([{（【][^)\]}）】]*[)\]}）】]/g) ?? [];
  parts.push(...title.split(/\s[-–—~〜]\s?/).slice(1));
  return parts;
}

export function isNoisyTitle(title: string): boolean {
  return annotations(title).some((part) => {
    const lower = part.toLowerCase();
    return NOISE_KEYWORDS.some((k) => containsKeyword(lower, k));
  });
}

// ノイズ除外を適用した候補。除外した結果 0 件になるなら適用しない(小さいカタログを空にしない)
export function usableCandidates(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const filtered = candidates.filter((c) => !isNoisyTitle(c.title));
  return filtered.length > 0 ? filtered : candidates;
}

// 未使用(null)を最古とみなす比較
function isOlder(a: string | null, b: string | null): boolean {
  if (a === null) return b !== null;
  if (b === null) return false;
  return a < b;
}

// 最も古い使用日時を共有するものだけを返す(未使用が 1 つでもあれば未使用のグループ)
function oldestGroup<T>(items: T[], keyOf: (item: T) => string | null): T[] {
  let best: string | null | undefined;
  let group: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (best === undefined || isOlder(key, best)) {
      best = key;
      group = [item];
    } else if (key === best) {
      group.push(item);
    }
  }
  return group;
}

// アーティストの最終使用日時 = その人の曲の last_used_at の最大(全曲未使用なら null)
function artistLastUsedAt(songs: ReferenceCandidate[]): string | null {
  let max: string | null = null;
  for (const s of songs) {
    if (s.lastUsedAt !== null && (max === null || s.lastUsedAt > max)) max = s.lastUsedAt;
  }
  return max;
}

function pickOne<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// アーティストごとにまとめる(挿入順を保つので、同点グループの並びは候補の並び順に従う)
export function groupByArtist(
  candidates: ReferenceCandidate[]
): Map<number, ReferenceCandidate[]> {
  const byArtist = new Map<number, ReferenceCandidate[]>();
  for (const c of candidates) {
    const list = byArtist.get(c.artistId);
    if (list) list.push(c);
    else byArtist.set(c.artistId, [c]);
  }
  return byArtist;
}

// 参照曲を 1 曲選ぶ純関数(テストと分布確認のため random を注入できる)
export function pickReferenceSong(
  candidates: ReferenceCandidate[],
  random: () => number = Math.random
): ReferenceCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const pool = usableCandidates(candidates);
  const artists = [...groupByArtist(pool).values()];
  const songs = pickOne(oldestGroup(artists, artistLastUsedAt), random);
  return pickOne(oldestGroup(songs, (s) => s.lastUsedAt), random);
}

function toCandidate(row: db.ReferenceCandidateRow): ReferenceCandidate {
  return {
    id: row.id,
    artistId: row.artist_id,
    artistName: row.artist_name,
    title: row.title,
    album: row.album,
    releaseYear: row.release_year,
    genre: row.genre,
    lastUsedAt: row.last_used_at,
  };
}

export function listCandidates(): ReferenceCandidate[] {
  return db.listReferenceCandidates().map(toCandidate);
}

// DB から候補を取って 1 曲選ぶ。登録が 1 件も無ければ undefined(呼び出し側がフォールバックする)
export function selectReferenceSong(): ReferenceCandidate | undefined {
  return pickReferenceSong(listCandidates());
}

// 生成パラメータ画面用のアーティスト別サマリ(候補曲数はノイズ除外後の数)。
// 最終使用が古い順 = 次に選ばれやすい順に並べる
export interface ReferenceArtistSummary {
  artistId: number;
  artistName: string;
  songCount: number;
  lastUsedAt: string | null;
}

export function referenceCandidateSummary(
  candidates: ReferenceCandidate[] = listCandidates()
): ReferenceArtistSummary[] {
  const summaries = [...groupByArtist(usableCandidates(candidates)).values()].map(
    (songs) => ({
      artistId: songs[0].artistId,
      artistName: songs[0].artistName,
      songCount: songs.length,
      lastUsedAt: artistLastUsedAt(songs),
    })
  );
  return summaries.sort((a, b) => {
    if (a.lastUsedAt === b.lastUsedAt) return a.artistName.localeCompare(b.artistName);
    return isOlder(a.lastUsedAt, b.lastUsedAt) ? -1 : 1;
  });
}
