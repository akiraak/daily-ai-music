// 既存アーティストの日本語表示名(artists.name_ja)を後から埋めるスクリプト。
// 新規登録・再取得(refresh)では name_ja が自動で付くが、導入前に登録したアーティストは
// NULL のまま英語表記で表示され続けるため、iTunes lookup で追い付かせる。
// NULL の行だけを対象にするので、途中で失敗しても何度でも再実行できる。
//
//   node src/scripts/backfill-artist-name-ja.ts [--dry-run] [--limit N]
//
// 本番(コンテナ内)での実行:
//   docker compose --project-directory /home/ubuntu/g3plus-ops/daily-ai-music \
//     exec daily-ai-music node src/scripts/backfill-artist-name-ja.ts --dry-run
//
// iTunes のレート制限(約 20 req/分)に配慮して 1 件ごとに間隔を空ける(逐次実行)
import { setTimeout as sleep } from "node:timers/promises";
import * as db from "../db.ts";
import { fetchArtist } from "../itunes.ts";

const REQUEST_INTERVAL_MS = 3_500;

function parseArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  let dryRun = false;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit は 1 以上の整数です");
      }
      limit = value;
    } else {
      throw new Error(`不明な引数: ${arg}`);
    }
  }
  return { dryRun, limit };
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const missing = db.listArtists().filter((a) => a.name_ja === null);
  // iTunes ID の無いアーティスト(手動登録)は lookup できないのでスキップ(表示は name のまま)
  const noId = missing.filter((a) => a.itunes_artist_id === null);
  const targets = missing
    .filter((a) => a.itunes_artist_id !== null)
    .slice(0, limit ?? Infinity);
  if (targets.length === 0) {
    console.log(
      `[backfill-name-ja] 日本語名が未取得のアーティストはありません` +
        (noId.length > 0 ? `(iTunes ID なしのため対象外: ${noId.length} 件)` : "")
    );
    return;
  }
  console.log(
    `[backfill-name-ja] ${targets.length} 件を処理します${dryRun ? "(dry-run)" : ""}` +
      (noId.length > 0 ? `(iTunes ID なしのため対象外: ${noId.length} 件)` : "")
  );

  let updated = 0;
  let noJa = 0;
  let failed = 0;
  for (const [i, artist] of targets.entries()) {
    if (i > 0) await sleep(REQUEST_INTERVAL_MS);
    try {
      const fetched = await fetchArtist(artist.itunes_artist_id!);
      if (!fetched?.nameJa) {
        // 表示名が ASCII のみ(slug から日本語名を取れない)か、lookup で見つからない。
        // NULL のままなので表示は従来どおり name になる
        noJa++;
        console.log(`  ${artist.name}: 日本語名なし(表示は正式表記のまま)`);
        continue;
      }
      if (!dryRun) db.updateArtistNameJa(artist.id, fetched.nameJa);
      updated++;
      console.log(`  ${artist.name} → ${fetched.nameJa}`);
    } catch (err) {
      failed++;
      console.error(
        `  [!] ${artist.name} の取得に失敗: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  console.log(
    `\n[backfill-name-ja] 完了: 更新 ${updated} / 日本語名なし ${noJa} / 失敗 ${failed}` +
      (dryRun ? "(dry-run のため DB は更新していません)" : "")
  );
}

await main();
