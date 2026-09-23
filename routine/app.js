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
let reorderMode = false;

function moveItem(itemId, direction) {
  const idx = items.findIndex((it) => it.id === itemId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= items.length) return;
  const tmp = items[idx];
  items[idx] = items[newIdx];
  items[newIdx] = tmp;
  saveJSON(STORAGE_KEYS.items, items);
  render();
}

const el = {
  todayLabel: document.getElementById("today-label"),
  todayLabelBtn: document.getElementById("today-label-btn"),
  progressBadge: document.getElementById("progress-badge"),
  itemList: document.getElementById("item-list"),
  emptyMsg: document.getElementById("empty-msg"),
  addRow: document.getElementById("add-row"),
  reorderToggleBtn: document.getElementById("reorder-toggle-btn"),
  addOpenBtn: document.getElementById("add-open-btn"),
  addForm: document.getElementById("add-form"),
  addInput: document.getElementById("add-input"),
  addCancelBtn: document.getElementById("add-cancel-btn"),
  calendarOverlay: document.getElementById("calendar-overlay"),
  calMonthLabel: document.getElementById("cal-month-label"),
  calendarDays: document.getElementById("calendar-days"),
  calPrevBtn: document.getElementById("cal-prev-btn"),
  calNextBtn: document.getElementById("cal-next-btn"),
  calCloseBtn: document.getElementById("cal-close-btn"),
  dayDetail: document.getElementById("day-detail"),
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

function daysBetween(fromDateStr, toDateStr) {
  return Math.round((new Date(toDateStr) - new Date(fromDateStr)) / 86400000);
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
  el.addRow.hidden = reorderMode;

  let doneCount = 0;

  items.forEach((item, idx) => {
    const checkedToday = isChecked(item.id, today);
    if (checkedToday) doneCount++;

    if (reorderMode) {
      const li = document.createElement("li");
      li.className = "item-row reorder-row";
      li.dataset.id = item.id;
      li.innerHTML = `
        <div class="item-main"><div class="item-label">${escapeHtml(item.label)}</div></div>
        <div class="reorder-controls">
          <button class="reorder-btn" data-action="move-up" ${idx === 0 ? "disabled" : ""} aria-label="上へ移動">▲</button>
          <button class="reorder-btn" data-action="move-down" ${idx === items.length - 1 ? "disabled" : ""} aria-label="下へ移動">▼</button>
        </div>
      `;
      el.itemList.appendChild(li);
      return;
    }

    const isNewToday = item.addedDate === today;
    const missedYesterday = !isNewToday && !isChecked(item.id, yesterday);
    const { streak, lastDate } = computeStreak(item.id);

    // 「何日間チェックされていないか」。一度もチェックしたことがない項目は
    // 追加日からの経過日数を代わりに使う(追加当日はまだ未達成扱いにしない)。
    let neglectedDays = null;
    if (lastDate) {
      neglectedDays = daysBetween(lastDate, today);
    } else if (item.addedDate !== today) {
      neglectedDays = daysBetween(item.addedDate, today);
    }

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
    if (neglectedDays !== null && neglectedDays >= 2) {
      metaParts.push(`<span class="missed-badge">${neglectedDays}日間未達成</span>`);
    } else if (missedYesterday) {
      metaParts.push(`<span class="missed-badge">前日未達成</span>`);
    }
    if (streak >= 2 && (neglectedDays === null || neglectedDays < 2)) {
      metaParts.push(`<span class="streak-badge">🔥${streak}日連続</span>`);
    } else if ((neglectedDays === null || neglectedDays < 2) && lastDate && lastDate !== today) {
      metaParts.push(`<span>前回: ${formatLastDate(lastDate)}</span>`);
    }

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

function formatDateJp(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// ---- 0時をまたいだら自動で当日分の表示に切り替える ----
// iOS Safariはバックグラウンド中setIntervalを間引く/止めることがあるため、
// タイマーだけに頼らず、画面に戻ってきたタイミング(visibilitychange/focus/pageshow)
// でも必ず日付をチェックし直す。
let renderedDate = todayStr();

function checkDateRollover() {
  const current = todayStr();
  if (current !== renderedDate) {
    renderedDate = current;
    confirmingDeleteId = null;
    clearTimeout(confirmTimer);
    render();
  }
}

setInterval(checkDateRollover, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkDateRollover();
});
window.addEventListener("focus", checkDateRollover);
window.addEventListener("pageshow", checkDateRollover);

// ---- カレンダー(月表示で過去の達成状況を見る) ----
let calCursor = new Date();

function openCalendar() {
  calCursor = new Date();
  calCursor.setDate(1);
  el.calendarOverlay.hidden = false;
  renderCalendar();
}

function closeCalendar() {
  el.calendarOverlay.hidden = true;
}

function renderCalendar() {
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  el.calMonthLabel.textContent = `${year}年${month + 1}月`;
  el.dayDetail.hidden = true;
  el.calendarDays.innerHTML = "";

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day cal-day-blank";
    el.calendarDays.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // その日の時点で既に存在していた項目だけを分母にする(後から追加した項目で
    // 過去の達成率を不当に下げないため)。
    const existingItems = items.filter((it) => it.addedDate <= dateStr);
    const doneCount = existingItems.filter((it) => isChecked(it.id, dateStr)).length;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day";
    if (dateStr === today) cell.classList.add("cal-day-today");
    if (existingItems.length > 0) {
      const ratio = doneCount / existingItems.length;
      if (ratio === 1) cell.classList.add("cal-day-full");
      else if (ratio > 0) cell.classList.add("cal-day-partial");
    }
    cell.innerHTML =
      `<span class="cal-day-num">${d}</span>` +
      (existingItems.length ? `<span class="cal-day-ratio">${doneCount}/${existingItems.length}</span>` : "");
    cell.addEventListener("click", () => showDayDetail(dateStr, existingItems));
    el.calendarDays.appendChild(cell);
  }
}

function showDayDetail(dateStr, existingItems) {
  el.dayDetail.hidden = false;
  if (existingItems.length === 0) {
    el.dayDetail.innerHTML = `<p class="day-detail-empty">${formatDateJp(dateStr)}はまだ項目がありませんでした。</p>`;
    return;
  }
  const rows = existingItems
    .map((it) => {
      const done = isChecked(it.id, dateStr);
      return `<li class="day-detail-row${done ? " done" : ""}">${done ? iconCheck() : '<span class="day-detail-dot"></span>'}<span>${escapeHtml(it.label)}</span></li>`;
    })
    .join("");
  el.dayDetail.innerHTML = `<p class="day-detail-date">${formatDateJp(dateStr)}の記録</p><ul class="day-detail-list">${rows}</ul>`;
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
  } else if (action === "move-up") {
    moveItem(itemId, -1);
  } else if (action === "move-down") {
    moveItem(itemId, 1);
  }
});

el.reorderToggleBtn.addEventListener("click", () => {
  reorderMode = !reorderMode;
  el.reorderToggleBtn.textContent = reorderMode ? "完了" : "↕ 並び替え";
  el.reorderToggleBtn.classList.toggle("active", reorderMode);
  confirmingDeleteId = null;
  clearTimeout(confirmTimer);
  render();
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

el.todayLabelBtn.addEventListener("click", openCalendar);
el.calCloseBtn.addEventListener("click", closeCalendar);
el.calendarOverlay.addEventListener("click", (e) => {
  if (e.target === el.calendarOverlay) closeCalendar();
});
el.calPrevBtn.addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
el.calNextBtn.addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

render();
