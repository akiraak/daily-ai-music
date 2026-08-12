// 公開ページ デザイン案の共通モックデータ。
// 実データ(data/images, data/audio)を流用し、複数日分の一覧を再現するため
// 削除済みトラックのカバー/音源に架空のタイトルを付けて補っている。
const ASSET_ROOT = "../../../../data/";
const IMG = (f) => ASSET_ROOT + "images/" + f;
const AUD = (f) => ASSET_ROOT + "audio/" + f;

const TRACKS = [
  { id: 15, title: "Slow Static Bloom",        duration: 243, file: "66a142eb-4f1b-4ea0-aadb-140349f08756", createdAt: "2026-08-12T09:12:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id: 14, title: "Midnight Conveyor",        duration: 218, file: "6147e92b-4645-4e05-a73f-c9e0dd0101e0", createdAt: "2026-08-12T09:08:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id: 13, title: "Paper Moon Circuit",       duration: 262, file: "2feeb146-bdd3-463e-b353-61c871321dfd", createdAt: "2026-08-12T09:03:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id: 12, title: "Glass Harbor Lights",      duration: 231, file: "0a00da9f-7830-44e0-ae3f-c2f28aef5f8f", createdAt: "2026-08-11T09:10:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id: 11, title: "Tin Roof Chorus",          duration: 197, file: "0f91da8f-cee1-4b51-ba01-357f3c9698f8", createdAt: "2026-08-11T09:06:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id: 10, title: "Cold Coffee Orbit",        duration: 254, file: "15249a25-5897-46ac-b7eb-6e813c1fb0ca", createdAt: "2026-08-11T09:01:00Z", sunoModel: "V5_5", llmModel: "claude-sonnet-5" },
  { id:  9, title: "Steel Petals",             duration: 226, file: "260444e5-95ba-4884-aaac-b63e4e1d823c", createdAt: "2026-08-10T09:14:00Z", sunoModel: "V5",   llmModel: "claude-sonnet-5" },
  { id:  8, title: "Rust & Lavender",          duration: 271, file: "2ad8a55b-a85d-4024-81e3-a0691e9dbf8a", createdAt: "2026-08-10T09:09:00Z", sunoModel: "V5",   llmModel: "claude-sonnet-5" },
  { id:  7, title: "Night Shift Lullaby",      duration: 208, file: "30342707-ce09-4766-bb7c-941f7a1bebe8", createdAt: "2026-08-10T09:04:00Z", sunoModel: "V5",   llmModel: "claude-sonnet-5" },
  { id:  6, title: "The Room Holds Its Breath",duration: 248, file: "b8954174-757e-4ea1-8ea8-da7aa6070229", createdAt: "2026-08-08T10:04:00Z", sunoModel: "V5",   llmModel: "claude-sonnet-5" },
  { id:  5, title: "Fireworks, Maybe",         duration: 239, file: "54e51cdd-913e-4ed4-ba73-c6ed1443dc10", createdAt: "2026-08-07T10:58:00Z", sunoModel: "V5",   llmModel: "" },
  { id:  4, title: "Neon Rain Mirage",         duration: 247, file: "e586d26f-e1e6-4617-a2fa-79fe9560d766", createdAt: "2026-08-07T08:34:00Z", sunoModel: "V5",   llmModel: "" },
  { id:  3, title: "Amber Line Home",          duration: 272, file: "e3c9e25f-3383-474b-b13a-98eae6e13968", createdAt: "2026-08-07T08:23:00Z", sunoModel: "V5",   llmModel: "" },
  { id:  2, title: "Harbor Fog Waltz",         duration: 233, file: "47d0eae8-aa7b-473d-a611-b79b1e68d6dc", createdAt: "2026-08-06T09:20:00Z", sunoModel: "V5",   llmModel: "" },
  { id:  1, title: "Sunrise Shuffle",          duration: 206, file: "3997d4fa-e4f7-4b5b-8c67-28739b7a0a45", createdAt: "2026-08-06T09:09:00Z", sunoModel: "V5",   llmModel: "" },
];

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function localDateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateJa(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function modelLabel(t) {
  const suno = t.sunoModel ? `Suno ${t.sunoModel.replace("_", ".")}` : "";
  return t.llmModel ? `${suno} · ${t.llmModel}` : suno;
}

// 日付(ローカル)ごとにグループ化して [{key, date, tracks}] を新しい順で返す
function groupByDate(tracks) {
  const groups = [];
  const byKey = new Map();
  for (const t of tracks) {
    const key = localDateKey(t.createdAt);
    if (!byKey.has(key)) {
      const g = { key, date: new Date(t.createdAt), tracks: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    byKey.get(key).tracks.push(t);
  }
  return groups;
}
