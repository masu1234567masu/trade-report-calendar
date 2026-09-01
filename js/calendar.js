// ホーム(カレンダー)画面: 月表示・日次損益の色分け・月間合計損益。

function formatDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatYen(n) {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("ja-JP")}円`;
}

const CalendarView = {
  currentYear: null,
  currentMonth: null,

  el: {
    monthLabel: document.getElementById("calendar-month-label"),
    monthTotal: document.getElementById("calendar-month-total"),
    grid: document.getElementById("calendar-grid"),
    prevBtn: document.getElementById("calendar-prev-btn"),
    nextBtn: document.getElementById("calendar-next-btn"),
  },

  init() {
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1;
    this.el.prevBtn.addEventListener("click", () => this.changeMonth(-1));
    this.el.nextBtn.addEventListener("click", () => this.changeMonth(1));
  },

  changeMonth(diff) {
    this.currentMonth += diff;
    if (this.currentMonth < 1) {
      this.currentMonth = 12;
      this.currentYear -= 1;
    } else if (this.currentMonth > 12) {
      this.currentMonth = 1;
      this.currentYear += 1;
    }
    this.render();
  },

  render() {
    const y = this.currentYear;
    const m = this.currentMonth;
    this.el.monthLabel.textContent = `${y}年${m}月`;

    const grid = this.el.grid;
    grid.innerHTML = "";

    ["日", "月", "火", "水", "木", "金", "土"].forEach((w) => {
      const cell = document.createElement("div");
      cell.className = "cal-weekday";
      cell.textContent = w;
      grid.appendChild(cell);
    });

    const startWeekday = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();

    for (let i = 0; i < startWeekday; i++) {
      const blank = document.createElement("div");
      blank.className = "cal-cell cal-blank";
      grid.appendChild(blank);
    }

    let monthTotal = 0;
    let hasAny = false;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateKey(y, m, d);
      const entry = TradeData.getEntry(dateStr);
      const cell = document.createElement("div");
      cell.className = "cal-cell";

      const dayNum = document.createElement("div");
      dayNum.className = "cal-daynum";
      dayNum.textContent = d;
      cell.appendChild(dayNum);

      if (entry && entry.pl !== null && entry.pl !== undefined) {
        const plEl = document.createElement("div");
        const isProfit = entry.pl >= 0;
        plEl.className = "cal-pl " + (isProfit ? "profit" : "loss");
        plEl.textContent = formatYen(entry.pl);
        cell.appendChild(plEl);
        cell.classList.add(isProfit ? "cal-cell-profit" : "cal-cell-loss");
        monthTotal += entry.pl;
        hasAny = true;
      }

      cell.addEventListener("click", () => EntryModal.open(dateStr));
      grid.appendChild(cell);
    }

    this.el.monthTotal.textContent = hasAny ? formatYen(monthTotal) : "記録なし";
    this.el.monthTotal.className = "month-total " + (monthTotal >= 0 ? "profit" : "loss");
  },
};
