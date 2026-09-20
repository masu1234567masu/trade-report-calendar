// ルーティンチェックリスト
// トレード収支管理アプリ(index.html等)とは完全に独立したページ。
// localStorageのキーは "rcl_" プレフィックスで統一し、トレード収支管理アプリ側の
// "trc_" プレフィックスのキーと絶対に衝突しないようにしている(同一オリジンのため
// localStorageは共有されるが、キー名前空間を分けることで安全にしている)。

const STORAGE_KEYS = {
  items: "rcl_items_v1",
  checks: "rcl_checks_v1",
};

const INITIAL_ITEMS = [
  "トレードカレンダー(前日分)",
  "ファンダチェック+X投稿(@konnichiha2)",
  "トレード計画(エントリー方針)+X投稿(@konnichiha2)",
  "note(AI×美容室経営)+インスタ(piece201.masudayusaku)",
  "note(AI×トレード)+X投稿(@konnichiha2)",
  "note(メンズ薄毛)+X投稿(@masuda_hairlog)",
  "インスタ|中目黒グルメ垢の投稿判断",
  "インスタ|美容師求人アカウントの投稿判断",
  "記帳代行作業",
  "AI作業途中作業確認",
];

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 保存できなくても(プライベートブラウズ等)アプリ自体は動作を継続する。
  }
}

function loadItems() {
  const existing = localStorage.getItem(STORAGE_KEYS.items);
  if (existing === null) {
    const today = todayStr();
    const seeded = INITIAL_ITEMS.map((label, i) => ({
      id: `seed-${i}-${Date.now()}`,
      label,
      addedDate: today,
    }));
    saveJSON(STORAGE_KEYS.items, seeded);
    return seeded;
  }
  return loadJSON(STORAGE_KEYS.items, []);
}

function loadChecks() {
  return loadJSON(STORAGE_KEYS.checks, {});
}

let items = loadItems();
let checks = loadChecks();
let confirmingDeleteId = null;
let confirmTimer = null;

const el = {
  todayLabel: document.getElementById("today-label"),
  progressBadge: document.getElementById("progress-badge"),
  itemList: document.getElementById("item-list"),
  emptyMsg: document.getElementById("empty-msg"),
  addOpenBtn: document.getElementById("add-open-btn"),
  addForm: document.getElementById("add-form"),
  addInput: document.getElementById("add-input"),
  addCancelBtn: document.getElementById("add-cancel-btn"),
};

function isChecked(itemId, dateStr) {
  return !!(checks[dateStr] && checks[dateStr][itemId]);
}

function setChecked(itemId, dateStr, value) {
  if (!checks[dateStr]) checks[dateStr] = {};
  if (value) {
    checks[dateStr][itemId] = true;
  } else {
    delete checks[dateStr][itemId];
    if (Object.keys(checks[dateStr]).length === 0) delete checks[dateStr];
  }
  saveJSON(STORAGE_KEYS.checks, checks);
}

// 連続記録日数と最終チェック日。streakは「直近のチェック日」を起点に、
// そこから1日ずつ遡って途切れずにチェックされている日数を数える。
function computeStreak(itemId) {
  const checkedDates = Object.keys(checks)
    .filter((d) => checks[d][itemId])
    .sort()
    .reverse();
  if (checkedDates.length === 0) return { streak: 0, lastDate: null };

  let streak = 1;
  let cursor = new Date(checkedDates[0]);
  for (let i = 1; i < checkedDates.length; i++) {
    const prev = new Date(checkedDates[i]);
    const diffDays = Math.round((cursor - prev) / 86400000);
    if (diffDays === 1) {
      streak++;
      cursor = prev;
    } else {
      break;
    }
  }
  return { streak, lastDate: checkedDates[0] };
}

function formatLastDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
}

function iconTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
}

function render() {
  const today = todayStr();
  const yesterday = todayStr(-1);
  el.todayLabel.textContent = `${today} のルーティン`;

  el.itemList.innerHTML = "";
  el.emptyMsg.hidden = items.length > 0;

  let doneCount = 0;

  items.forEach((item) => {
    const checkedToday = isChecked(item.id, today);
    if (checkedToday) doneCount++;

    const isNewToday = item.addedDate === today;
    const missedYesterday = !isNewToday && !isChecked(item.id, yesterday);
    const { streak, lastDate } = computeStreak(item.id);

    const li = document.createElement("li");
    li.className = "item-row" + (checkedToday ? " checked" : "") + (missedYesterday ? " missed-yesterday" : "");
    li.dataset.id = item.id;

    if (confirmingDeleteId === item.id) {
      li.innerHTML = `
        <div class="confirm-delete">
          <span class="confirm-delete-text">「${escapeHtml(item.label)}」を削除しますか？</span>
          <div class="confirm-delete-actions">
            <button class="btn btn-ghost" data-action="cancel-delete">取り消し</button>
            <button class="btn btn-danger" data-action="confirm-delete">削除</button>
          </div>
        </div>
      `;
      el.itemList.appendChild(li);
      return;
    }

    const metaParts = [];
    if (missedYesterday) metaParts.push(`<span class="missed-badge">前日未達成</span>`);
    if (streak >= 2) metaParts.push(`<span class="streak-badge">🔥${streak}日連続</span>`);
    else if (lastDate && lastDate !== today) metaParts.push(`<span>前回: ${formatLastDate(lastDate)}</span>`);

    li.innerHTML = `
      <button class="item-check${checkedToday ? " checked" : ""}" data-action="toggle" aria-label="完了にする">${checkedToday ? iconCheck() : ""}</button>
      <div class="item-main">
        <div class="item-label">${escapeHtml(item.label)}</div>
        ${metaParts.length ? `<div class="item-meta">${metaParts.join("")}</div>` : ""}
      </div>
      <button class="item-delete" data-action="delete" aria-label="削除">${iconTrash()}</button>
    `;
    el.itemList.appendChild(li);
  });

  el.progressBadge.textContent = `${doneCount}/${items.length}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

el.itemList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const li = btn.closest(".item-row");
  const itemId = li.dataset.id;
  const action = btn.dataset.action;

  if (action === "toggle") {
    const today = todayStr();
    setChecked(itemId, today, !isChecked(itemId, today));
    render();
  } else if (action === "delete") {
    confirmingDeleteId = itemId;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      confirmingDeleteId = null;
      render();
    }, 4000);
    render();
  } else if (action === "cancel-delete") {
    clearTimeout(confirmTimer);
    confirmingDeleteId = null;
    render();
  } else if (action === "confirm-delete") {
    clearTimeout(confirmTimer);
    items = items.filter((it) => it.id !== itemId);
    saveJSON(STORAGE_KEYS.items, items);
    confirmingDeleteId = null;
    render();
  }
});

el.addOpenBtn.addEventListener("click", () => {
  el.addOpenBtn.hidden = true;
  el.addForm.hidden = false;
  el.addInput.value = "";
  el.addInput.focus();
});

el.addCancelBtn.addEventListener("click", () => {
  el.addForm.hidden = true;
  el.addOpenBtn.hidden = false;
});

el.addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const label = el.addInput.value.trim();
  if (!label) return;
  items.push({
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    addedDate: todayStr(),
  });
  saveJSON(STORAGE_KEYS.items, items);
  el.addForm.hidden = true;
  el.addOpenBtn.hidden = false;
  render();
});

render();
