// アーティストページ。iTunes から曲を取り込んだアーティストを管理し、曲を選んで
// 「その曲に似た新曲」を生成する(生成経路 artist)
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const $ = (id) => document.getElementById(id);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

function showMessage(id, text, info = false) {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
  el.classList.toggle("info", info);
}

// 表示中のアーティストの曲(絞り込みはクライアント側で行う。最大 200 件)
let currentArtist = null;
let currentSongs = [];

// --- 検索・登録(アーティスト名 / 曲名の 2 経路) ---

// 検索対象ごとの文言と処理。曲名経路はアーティスト名を思い出せなくても入口に立てるためのもので、
// 選んだ曲の iTunes の応答からアーティストを逆引きして一緒に登録する
const SEARCH_KINDS = {
  artist: {
    placeholder: "アーティスト名(例: 米津玄師 / Radiohead)",
    hint: "名前で検索して候補から選ぶと、その人の曲(最大 200 曲)を iTunes から取り込みます。日本語で検索できますが、登録名は iTunes の表記(ローマ字のことが多い)になります。",
    notFound: (term) => `「${term}」に一致するアーティストが見つかりません。`,
    prompt: "登録するアーティストを選んでください。",
  },
  song: {
    placeholder: "曲名(例: Lemon / 夜に駆ける)",
    hint: "曲名で検索して候補から選ぶと、その曲とアーティスト(最大 200 曲)をまとめて登録します。アーティスト名を足すと精度が上がります(例: 米津玄師 Lemon)。カバーやピアノ版も混ざるので、アーティスト名を見て選んでください。",
    notFound: (term) => `「${term}」に一致する曲が見つかりません。`,
    prompt: "登録する曲を選んでください。",
  },
};

function currentKind() {
  return SEARCH_KINDS[$("search-kind").value] ?? SEARCH_KINDS.artist;
}

function applyKind() {
  const kind = currentKind();
  $("search-term").placeholder = kind.placeholder;
  $("search-hint").textContent = kind.hint;
  $("candidates").replaceChildren();
  showMessage("search-message", null);
}

// 候補行(アーティスト名 / 曲名で見出しと副題が入れ替わるだけ)
function candidateRow({ title, meta, onRegister }) {
  const li = document.createElement("li");
  li.className = "artist";
  li.innerHTML = `
    <span class="artist-name"></span>
    <span class="artist-meta"></span>
    <button type="button" class="icon-btn" data-act="register">登録</button>`;
  li.querySelector(".artist-name").textContent = title;
  li.querySelector(".artist-meta").textContent = meta;
  li.querySelector('[data-act="register"]').addEventListener("click", onRegister);
  return li;
}

function afterRegister(message) {
  $("candidates").replaceChildren();
  $("search-term").value = "";
  showMessage("search-message", message, true);
}

async function registerArtist(name, itunesArtistId) {
  showMessage("search-message", "登録しています…(iTunes から曲を取り込みます)", true);
  try {
    const { artist, added } = await fetchJson("/admin/api/artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, itunesArtistId }),
    });
    afterRegister(`「${artist.name}」を登録し、曲を ${added} 件取り込みました。`);
    loadArtists();
  } catch (err) {
    showMessage("search-message", err.message);
  }
}

// 曲名から登録する。サーバーは itunesTrackId だけを受け取って曲メタを取り直すため、
// 候補の表示名(ローカライズ済み)ではなく iTunes の正式表記でアーティストが登録される
async function registerSong(candidate) {
  showMessage("search-message", "登録しています…(iTunes から曲を取り込みます)", true);
  try {
    const { artist, song, artistCreated, importedSongs } = await fetchJson(
      "/admin/api/artist-songs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itunesTrackId: candidate.itunesTrackId }),
      }
    );
    let message = `「${artist.name}」の「${song.title}」を登録しました`;
    message += artistCreated ? `(曲 ${importedSongs} 件を取り込み)。` : "。";
    // コラボ曲は片方の artistId しか返らないため、表示名と登録先が違うことがある
    if (candidate.artistName && candidate.artistName !== artist.name) {
      message += `「${candidate.artistName}」は ${artist.name} として登録しています。`;
    }
    afterRegister(message);
    await loadArtists();
    // 登録した曲をすぐ生成できる状態にする(曲一覧を開いて絞り込み欄に曲名を入れる)
    $("song-filter").value = song.title;
    await loadSongs(artist);
    $("songs-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showMessage("search-message", err.message);
  }
}

$("search-kind").addEventListener("change", applyKind);

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = $("search-term").value.trim();
  if (!term) return;
  const kind = currentKind();
  const isSong = kind === SEARCH_KINDS.song;
  showMessage("search-message", "検索しています…", true);
  $("candidates").replaceChildren();
  try {
    const path = isSong ? "artist-songs/search" : "artists/search";
    const { candidates } = await fetchJson(
      `/admin/api/${path}?term=${encodeURIComponent(term)}`
    );
    if (candidates.length === 0) {
      showMessage("search-message", kind.notFound(term));
      return;
    }
    showMessage("search-message", kind.prompt, true);
    $("candidates").replaceChildren(
      ...candidates.map((cand) =>
        isSong
          ? candidateRow({
              title: cand.title,
              // 日本語検索は読みマッチで曲名の違う行も混ざるため、アーティスト名も必ず出す
              meta: [cand.artistName, cand.releaseYear, cand.album]
                .filter(Boolean)
                .join(" / "),
              onRegister: () => registerSong(cand),
            })
          : candidateRow({
              title: cand.name,
              meta: cand.genre ?? "",
              onRegister: () => registerArtist(cand.name, cand.itunesArtistId),
            })
      )
    );
  } catch (err) {
    showMessage("search-message", err.message);
  }
});

// --- 登録済みアーティスト ---

function artistRow(a) {
  const li = document.createElement("li");
  li.className = "artist";
  li.innerHTML = `
    <span class="artist-name"></span>
    <span class="artist-meta"></span>
    <button type="button" class="icon-btn" data-act="songs">曲を見る</button>
    <button type="button" class="icon-btn" data-act="refresh">再取得</button>
    <button type="button" class="icon-btn" data-act="delete">削除</button>`;
  li.querySelector(".artist-name").textContent = a.name;
  li.querySelector(".artist-meta").textContent = [
    a.genre,
    `${a.enabledSongCount} / ${a.songCount} 曲`,
  ]
    .filter(Boolean)
    .join(" / ");
  li.querySelector('[data-act="songs"]').addEventListener("click", () => loadSongs(a));
  li.querySelector('[data-act="refresh"]').addEventListener("click", async () => {
    showMessage("artists-message", `「${a.name}」の曲を再取得しています…`, true);
    try {
      const { added } = await fetchJson(`/admin/api/artists/${a.id}/refresh`, {
        method: "POST",
      });
      showMessage(
        "artists-message",
        added > 0 ? `新しい曲を ${added} 件追加しました。` : "新しい曲はありませんでした。",
        true
      );
      loadArtists();
      if (currentArtist?.id === a.id) loadSongs(a);
    } catch (err) {
      showMessage("artists-message", err.message);
    }
  });
  li.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (!confirm(`「${a.name}」と取り込んだ曲を削除しますか?(生成済みの曲は残ります)`)) return;
    try {
      await fetchJson(`/admin/api/artists/${a.id}`, { method: "DELETE" });
      showMessage("artists-message", null);
      if (currentArtist?.id === a.id) {
        currentArtist = null;
        $("songs-panel").hidden = true;
      }
      loadArtists();
    } catch (err) {
      showMessage("artists-message", err.message);
    }
  });
  return li;
}

async function loadArtists() {
  try {
    const { artists } = await fetchJson("/admin/api/artists");
    $("artists-empty").hidden = artists.length > 0;
    $("artists").replaceChildren(...artists.map(artistRow));
  } catch (err) {
    showMessage("artists-message", err.message);
  }
}

// --- 曲一覧と生成 ---

async function generate(song) {
  const extra = $("song-extra").value.trim();
  if (!confirm(`「${song.title}」に似た曲を生成しますか?`)) return;
  showMessage("songs-message", "生成を開始しています…", true);
  try {
    const { task } = await fetchJson("/admin/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artistSongId: song.id, prompt: extra }),
    });
    // 完成までは Suno 側で数分かかるので、進行状況は楽曲一覧ページで見てもらう
    showMessage("songs-message", `生成を開始しました(${task.title})。仕上がりは `, true);
    const link = document.createElement("a");
    link.href = "/admin/";
    link.textContent = "楽曲一覧";
    $("songs-message").append(link, "で確認できます。");
  } catch (err) {
    showMessage("songs-message", err.message);
  }
}

// チェックの切り替え。押した瞬間に見た目を変え(楽観更新)、失敗したら元に戻す
async function setSongEnabled(song, enabled, checkbox) {
  const previous = song.enabled;
  song.enabled = enabled;
  checkbox.closest(".song").classList.toggle("is-disabled", !enabled);
  checkbox.closest(".song").querySelector('[data-act="generate"]').disabled = !enabled;
  try {
    await fetchJson(`/admin/api/artist-songs/${song.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    showMessage("songs-message", null);
    updateSongsTitle();
    loadArtists();
  } catch (err) {
    song.enabled = previous;
    checkbox.checked = previous;
    checkbox.closest(".song").classList.toggle("is-disabled", !previous);
    checkbox.closest(".song").querySelector('[data-act="generate"]').disabled = !previous;
    showMessage("songs-message", err.message);
  }
}

// 表示中の曲(絞り込み + 表示フィルタ)。一括操作の対象もこれに揃える
function visibleSongs() {
  const keyword = $("song-filter").value.trim().toLowerCase();
  const visibility = $("song-visibility").value;
  return currentSongs.filter((s) => {
    if (keyword && !s.title.toLowerCase().includes(keyword)) return false;
    if (visibility === "enabled") return s.enabled;
    if (visibility === "disabled") return !s.enabled;
    return true;
  });
}

function updateSongsTitle() {
  const enabled = currentSongs.filter((s) => s.enabled).length;
  $("songs-title").textContent =
    `${currentArtist.name} の曲(有効 ${enabled} / 全 ${currentSongs.length})`;
}

function renderSongs() {
  $("songs").replaceChildren(
    ...visibleSongs().map((s) => {
      const li = document.createElement("li");
      li.className = s.enabled ? "song" : "song is-disabled";
      li.innerHTML = `
        <label class="song-enabled"><input type="checkbox" data-act="enabled"><span>有効</span></label>
        <span class="song-title"></span>
        <span class="song-meta"></span>
        <button type="button" class="icon-btn" data-act="generate">この曲で生成</button>`;
      li.querySelector(".song-title").textContent = s.title;
      li.querySelector(".song-meta").textContent = [s.releaseYear, s.album]
        .filter(Boolean)
        .join(" / ");
      const checkbox = li.querySelector('[data-act="enabled"]');
      checkbox.checked = s.enabled;
      checkbox.addEventListener("change", () =>
        setSongEnabled(s, checkbox.checked, checkbox)
      );
      const generateBtn = li.querySelector('[data-act="generate"]');
      generateBtn.disabled = !s.enabled;
      generateBtn.addEventListener("click", () => generate(s));
      return li;
    })
  );
}

// 一括操作。絞り込み・表示フィルタが効いているときはその見えている曲だけを対象にする
// (「全て」と言いながら見えていない曲まで変えると取り返しがつかないため)
async function setSongsEnabled(enabled) {
  const targets = visibleSongs();
  if (targets.length === 0) return;
  const all = targets.length === currentSongs.length;
  const label = all ? `全 ${targets.length} 曲` : `表示中の ${targets.length} 曲`;
  if (!confirm(`${label}を${enabled ? "有効" : "無効"}にしますか?`)) return;
  try {
    await fetchJson(`/admin/api/artists/${currentArtist.id}/songs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        ...(all ? {} : { ids: targets.map((s) => s.id) }),
      }),
    });
    showMessage("songs-message", null);
    await loadArtists();
    await loadSongs(currentArtist);
  } catch (err) {
    showMessage("songs-message", err.message);
  }
}

async function loadSongs(artist) {
  currentArtist = artist;
  $("songs-panel").hidden = false;
  $("songs-title").textContent = `${artist.name} の曲`;
  $("songs").replaceChildren();
  showMessage("songs-message", null);
  try {
    const { songs } = await fetchJson(`/admin/api/artists/${artist.id}/songs`);
    currentSongs = songs;
    updateSongsTitle();
    renderSongs();
  } catch (err) {
    showMessage("songs-message", err.message);
  }
}

$("song-filter").addEventListener("input", renderSongs);
$("song-visibility").addEventListener("change", renderSongs);
$("songs-enable-all").addEventListener("click", () => setSongsEnabled(true));
$("songs-disable-all").addEventListener("click", () => setSongsEnabled(false));

applyKind();
loadArtists();
