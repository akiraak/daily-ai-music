// 毎日の自動生成で使う参照曲の選択。登録済みの曲(artist_songs)から 1 曲を選び、
// その曲に似た新曲を作らせる。選ぶのはサーバー(LLM には選ばせない)。
//
// 選択規則は「有効な曲(artist_songs.enabled = 1)だけを候補に、アーティストを LRU で選ぶ →
// その人の曲を LRU で選ぶ」の 2 段階(候補の絞り込みは db.listReferenceCandidates() が行う)。
// アーティスト一様にするのは、取り込みが 1 アーティスト最大 200 曲でカタログの大小差が
// 桁違いのため(曲一様だと大カタログの人ばかり選ばれる)。LRU + ランダムなら「直近 N 日は除外」
// のような設定を増やさずに、連続回避・枯渇回避・一巡が同時に成立する
import * as db from "./db.ts";

export interface ReferenceCandidate {
  id: number;
  artistId: number;
  artistName: string;
  artistNameJa: string | null; // 表示用(無ければ artistName を表示する)
  title: string;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
  lastUsedAt: string | null; // この曲を参照したタスクの最新 created_at(未使用は null)
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
  const artists = [...groupByArtist(candidates).values()];
  const songs = pickOne(oldestGroup(artists, artistLastUsedAt), random);
  return pickOne(oldestGroup(songs, (s) => s.lastUsedAt), random);
}

function toCandidate(row: db.ReferenceCandidateRow): ReferenceCandidate {
  return {
    id: row.id,
    artistId: row.artist_id,
    artistName: row.artist_name,
    artistNameJa: row.artist_name_ja,
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

// DB から候補を取って 1 曲選ぶ。有効な曲が 1 曲も無ければ undefined(呼び出し側が 409 にする)
export function selectReferenceSong(): ReferenceCandidate | undefined {
  return pickReferenceSong(listCandidates());
}

// アーティストを固定して曲だけを LRU で選ぶ(「アーティストでおまかせ」= POST /api/generate の
// artistId 経路用)。選択規則は 2 段階選択の曲側と同じなので、同じアーティストで連続生成しても
// 違う曲が選ばれ、一巡する。有効な曲が無ければ undefined(呼び出し側が 409 にする)
export function selectReferenceSongForArtist(
  artistId: number,
  random: () => number = Math.random
): ReferenceCandidate | undefined {
  const songs = listCandidates().filter((c) => c.artistId === artistId);
  if (songs.length === 0) return undefined;
  return pickOne(oldestGroup(songs, (s) => s.lastUsedAt), random);
}

// 生成パラメータ画面用のアーティスト別サマリ(候補曲数は有効な曲の数)。
// 最終使用が古い順 = 次に選ばれやすい順に並べる
export interface ReferenceArtistSummary {
  artistId: number;
  artistName: string;
  artistNameJa: string | null; // 表示用(無ければ artistName を表示する)
  songCount: number;
  lastUsedAt: string | null;
}

export function referenceCandidateSummary(
  candidates: ReferenceCandidate[] = listCandidates()
): ReferenceArtistSummary[] {
  const summaries = [...groupByArtist(candidates).values()].map(
    (songs) => ({
      artistId: songs[0].artistId,
      artistName: songs[0].artistName,
      artistNameJa: songs[0].artistNameJa,
      songCount: songs.length,
      lastUsedAt: artistLastUsedAt(songs),
    })
  );
  return summaries.sort((a, b) => {
    if (a.lastUsedAt === b.lastUsedAt) return a.artistName.localeCompare(b.artistName);
    return isOlder(a.lastUsedAt, b.lastUsedAt) ? -1 : 1;
  });
}
