// パラメータ一覧ページ。毎日の自動生成で LLM が選ぶプリセット(要素プール)の一覧・追加・編集・削除
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const $ = (id) => document.getElementById(id);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

let categoryLabels = {};

function showPresetMessage(text) {
  const el = $("preset-message");
  el.textContent = text ?? "";
  el.hidden = !text;
}

function renderPresetView(li, p) {
  li.innerHTML = `
    <span class="preset-label"></span>
    <span class="preset-value"></span>
    <button type="button" class="icon-btn" data-act="edit">編集</button>
    <button type="button" class="icon-btn" data-act="delete">削除</button>`;
  li.querySelector(".preset-label").textContent = p.labelJa;
  li.querySelector(".preset-value").textContent = p.value;
  li.querySelector('[data-act="edit"]').addEventListener("click", () =>
    renderPresetEdit(li, p)
  );
  li.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (!confirm(`「${p.labelJa}」を削除しますか?`)) return;
    try {
      await fetchJson(`/admin/api/presets/${p.id}`, { method: "DELETE" });
      showPresetMessage(null);
      loadPresets();
    } catch (err) {
      showPresetMessage(err.message);
    }
  });
}

// 行内編集(値・表示名のみ。カテゴリ変更は削除して追加し直す)
function renderPresetEdit(li, p) {
  li.innerHTML = `
    <div class="preset-edit">
      <input data-f="value" placeholder="値(英語・プロンプト用)">
      <input data-f="labelJa" placeholder="表示名(日本語)">
      <button type="button" class="icon-btn" data-act="save">保存</button>
      <button type="button" class="icon-btn" data-act="cancel">キャンセル</button>
    </div>`;
  const valueInput = li.querySelector('[data-f="value"]');
  const labelInput = li.querySelector('[data-f="labelJa"]');
  valueInput.value = p.value;
  labelInput.value = p.labelJa;
  li.querySelector('[data-act="cancel"]').addEventListener("click", () =>
    renderPresetView(li, p)
  );
  li.querySelector('[data-act="save"]').addEventListener("click", async () => {
    try {
      const { preset } = await fetchJson(`/admin/api/presets/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: valueInput.value, labelJa: labelInput.value }),
      });
      showPresetMessage(null);
      renderPresetView(li, preset);
    } catch (err) {
      showPresetMessage(err.message);
    }
  });
}

async function loadPresets() {
  try {
    const { presets, categoryLabels: labels } = await fetchJson("/admin/api/presets");
    categoryLabels = labels;
    const groups = new Map();
    for (const p of presets) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category).push(p);
    }
    $("preset-groups").replaceChildren(
      ...[...groups.entries()].map(([category, items]) => {
        const div = document.createElement("div");
        div.className = "preset-group";
        const h3 = document.createElement("h3");
        h3.textContent = categoryLabels[category]
          ? `${categoryLabels[category]} (${category})`
          : category;
        const ul = document.createElement("ul");
        ul.append(
          ...items.map((p) => {
            const li = document.createElement("li");
            li.className = "preset";
            renderPresetView(li, p);
            return li;
          })
        );
        div.append(h3, ul);
        return div;
      })
    );
    $("preset-category-list").replaceChildren(
      ...[...groups.keys()].map((category) => {
        const opt = document.createElement("option");
        opt.value = category;
        return opt;
      })
    );
  } catch (err) {
    showPresetMessage(err.message);
  }
}

$("preset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await fetchJson("/admin/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: $("preset-category").value,
        value: $("preset-value").value,
        labelJa: $("preset-label").value,
      }),
    });
    $("preset-value").value = "";
    $("preset-label").value = "";
    showPresetMessage(null);
    loadPresets();
  } catch (err) {
    showPresetMessage(err.message);
  }
});

loadPresets();
