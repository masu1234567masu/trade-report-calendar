// 分析画面: 月間/年間/全期間のタブ切り替え(グラフ画面と同じUI) + 各期間の指標とグラフ。
// 月間・年間タブは前後の期間へナビゲーションでき、月間タブでは日別一覧から
// カレンダーと同じ記帳モーダルを開ける。
//
// 損益(pl)はTradeData側で「純資産額が記録されている直近の記帳日との差分」として
// 計算済み(js/data.js参照)。ここではその値を使って集計するだけで、独自に
// 損益を計算し直すことはしない。

function formatPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return "-";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function formatCount(n) {
  return `${n}日`;
}

// 勝率・負け率など、単純な割合(符号なし)の表示用。計算不能ならnullを返す。
function formatRate(n) {
  if (n === null || n === undefined || !isFinite(n)) return null;
  return `${n.toFixed(1)}%`;
}

// null(基準なしで計算不能)を"損失"側に誤分類しないためのヘルパー。
function pctColorClass(n) {
  return n === null || n === undefined || !isFinite(n) ? null : n >= 0 ? "profit" : "loss";
}

// 指定した記帳エントリ群(日付昇順)から集計指標を計算する。
// 全期間にも、年・月単位の期間詳細にも同じロジックを使う。
function computeMetrics(entries) {
  const withPL = entries.filter((e) => e.pl !== null);
  const totalPL = withPL.reduce((sum, e) => sum + e.pl, 0);
  const winCount = withPL.filter((e) => e.pl > 0).length;
  const lossCount = withPL.filter((e) => e.pl < 0).length;

  const totalDeposit = entries.filter((e) => e.cashFlow > 0).reduce((s, e) => s + e.cashFlow, 0);
  const totalWithdrawal = entries.filter((e) => e.cashFlow < 0).reduce((s, e) => s + e.cashFlow, 0);

  return { totalPL, winCount, lossCount, totalDeposit, totalWithdrawal };
}

// 勝ち数・負け数に併記する勝率・負け率(%)。勝ちも負けも無ければnull。
function winLossRates(m) {
  const total = m.winCount + m.lossCount;
  if (!total) return { win: null, loss: null };
  return { win: formatRate((m.winCount / total) * 100), loss: formatRate((m.lossCount / total) * 100) };
}

function countWithRate(count, rateStr) {
  return rateStr ? `${count}日 (${rateStr})` : formatCount(count);
}

// fullEntries(全期間, 日付昇順)の中でperiodEntriesが始まる直前の記帳を基準額とした
// 期間リターン(%)を返す。基準にできる記帳がなければ null。
function periodReturnPct(fullEntries, periodEntries, totalPL) {
  if (periodEntries.length === 0) return null;
  const firstDate = periodEntries[0].date;
  const idx = fullEntries.findIndex((e) => e.date === firstDate);
  const baseIdx = idx > 0 ? idx - 1 : idx;
  const base = fullEntries[baseIdx] ? fullEntries[baseIdx].netWorth : null;
  return base ? (totalPL / base) * 100 : null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

const AnalysisView = {
  periodType: "month", // month | year | all
  cursorDate: null,
  chart: null,

  el: {
    signinMsg: document.getElementById("analysis-signin-msg"),
    emptyMsg: document.getElementById("analysis-empty-msg"),
    card: document.getElementById("analysis-card"),
    periodBtns: document.querySelectorAll("#tab-analysis .period-btn"),
    navRow: document.getElementById("analysis-nav"),
    prevBtn: document.getElementById("analysis-prev-btn"),
    nextBtn: document.getElementById("analysis-next-btn"),
    periodLabel: document.getElementById("analysis-period-label"),
    metrics: document.getElementById("analysis-metrics"),
    canvas: document.getElementById("analysis-canvas"),
    monthList: document.getElementById("analysis-month-list"),
    dayList: document.getElementById("analysis-day-list"),
  },

  init() {
    this.cursorDate = new Date();

    this.el.periodBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.el.periodBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.periodType = btn.dataset.period;
        this.render();
      });
    });

    this.el.prevBtn.addEventListener("click", () => this.shift(-1));
    this.el.nextBtn.addEventListener("click", () => this.shift(1));
  },

  shift(diff) {
    const d = new Date(this.cursorDate);
    if (this.periodType === "month") d.setMonth(d.getMonth() + diff);
    else if (this.periodType === "year") d.setFullYear(d.getFullYear() + diff);
    this.cursorDate = d;
    this.render();
  },

  // 年間タブの月一覧から特定の月へ飛ぶ(月間タブに切り替えてその月を表示)。
  jumpToMonth(year, month) {
    this.periodType = "month";
    this.cursorDate = new Date(year, month - 1, 1);
    this.el.periodBtns.forEach((b) => b.classList.toggle("active", b.dataset.period === "month"));
    this.render();
  },

  render() {
    const entries = TradeData.getSortedEntries();

    if (entries.length === 0) {
      this.el.emptyMsg.hidden = false;
      this.el.card.hidden = true;
      return;
    }
    this.el.emptyMsg.hidden = true;
    this.el.card.hidden = false;
    this.el.navRow.style.visibility = this.periodType === "all" ? "hidden" : "visible";

    if (this.periodType === "all") {
      this.el.periodLabel.textContent = "全期間";
      this._renderOverview(entries);
      this._renderChart(entries);
      this.el.monthList.innerHTML = "";
      this.el.dayList.innerHTML = "";
      return;
    }

    const y = this.cursorDate.getFullYear();
    if (this.periodType === "year") {
      this.el.periodLabel.textContent = `${y}年`;
      const periodEntries = entries.filter((e) => e.date.startsWith(`${y}-`));
      this._renderDetail(periodEntries);
      this._renderChart(periodEntries);
      this._renderMonthList(y, entries);
      this.el.dayList.innerHTML = "";
    } else {
      const m = this.cursorDate.getMonth() + 1;
      this.el.periodLabel.textContent = `${y}年${m}月`;
      const periodEntries = entries.filter((e) => e.date.startsWith(`${y}-${pad2(m)}`));
      this._renderDetail(periodEntries);
      this._renderChart(periodEntries);
      this.el.monthList.innerHTML = "";
      this._renderDayList(periodEntries);
    }
  },

  _metricItem(label, value, colorClass) {
    const item = document.createElement("div");
    item.className = "metric-item";
    const labelEl = document.createElement("div");
    labelEl.className = "metric-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "metric-value" + (colorClass ? " " + colorClass : "");
    valueEl.textContent = value;
    item.appendChild(labelEl);
    item.appendChild(valueEl);
    return item;
  },

  // 全期間タブ: 口座全体の概要指標。
  _renderOverview(entries) {
    const m = computeMetrics(entries);
    const currentNetWorth = entries[entries.length - 1].netWorth;
    // 現状の元金 = 入金合計 − 出金合計(出金は負の値で記録されているので足す)。
    const principal = m.totalDeposit + m.totalWithdrawal;
    const rates = winLossRates(m);

    const today = new Date();
    const yearEntries = entries.filter((e) => e.date.startsWith(`${today.getFullYear()}-`));
    const monthEntries = entries.filter((e) => e.date.startsWith(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}`));
    const yearReturnPct = periodReturnPct(entries, yearEntries, computeMetrics(yearEntries).totalPL);
    const monthReturnPct = periodReturnPct(entries, monthEntries, computeMetrics(monthEntries).totalPL);

    const wrap = this.el.metrics;
    wrap.innerHTML = "";
    const rows = [
      ["総資産", formatYen(currentNetWorth).replace(/^\+/, ""), null],
      ["現状の入金額(元金)", formatYen(principal).replace(/^\+/, ""), null],
      ["今年のパフォーマンス", formatPct(yearReturnPct), pctColorClass(yearReturnPct)],
      ["今月のパフォーマンス", formatPct(monthReturnPct), pctColorClass(monthReturnPct)],
      ["プラス日数", countWithRate(m.winCount, rates.win), null],
      ["マイナス日数", countWithRate(m.lossCount, rates.loss), null],
    ];
    rows.forEach(([label, value, colorClass]) => wrap.appendChild(this._metricItem(label, value, colorClass)));
  },

  // 月間・年間タブ共通: 選択中の期間の詳細指標。
  _renderDetail(periodEntries) {
    const m = computeMetrics(periodEntries);
    const rates = winLossRates(m);

    const wrap = this.el.metrics;
    wrap.innerHTML = "";
    const rows = [
      ["総損益", formatYen(m.totalPL), m.totalPL >= 0 ? "profit" : "loss"],
      ["勝ち数", countWithRate(m.winCount, rates.win), null],
      ["負け数", countWithRate(m.lossCount, rates.loss), null],
    ];
    rows.forEach(([label, value, colorClass]) => wrap.appendChild(this._metricItem(label, value, colorClass)));
  },

  // 年間タブ: その年の月別内訳。タップすると月間タブへ飛ぶ。
  _renderMonthList(year, entries) {
    const byMonth = new Map();
    entries
      .filter((e) => e.date.startsWith(`${year}-`))
      .forEach((e) => {
        const month = e.date.slice(5, 7);
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push(e);
      });
    const months = Array.from(byMonth.keys()).sort();

    const list = this.el.monthList;
    list.innerHTML = "";
    months.forEach((month) => {
      const monthMetrics = computeMetrics(byMonth.get(month));
      const row = document.createElement("button");
      row.className = "drilldown-row drilldown-row-month";
      row.innerHTML = `<span>${parseInt(month, 10)}月</span><span class="${monthMetrics.totalPL >= 0 ? "profit" : "loss"}">${formatYen(monthMetrics.totalPL)}</span>`;
      row.addEventListener("click", () => this.jumpToMonth(year, parseInt(month, 10)));
      list.appendChild(row);
    });
  },

  // 月間タブ: 日別一覧。タップするとカレンダーと同じ記帳モーダルを開く。
  _renderDayList(periodEntries) {
    const list = this.el.dayList;
    list.innerHTML = "";
    periodEntries.forEach((e) => {
      const row = document.createElement("button");
      row.className = "drilldown-row drilldown-row-day";
      const plText = e.pl !== null ? formatYen(e.pl) : "-";
      const plClass = e.pl !== null && e.pl >= 0 ? "profit" : e.pl !== null ? "loss" : "drilldown-row-label";
      row.innerHTML = `<span>${e.date}</span><span class="${plClass}">${plText}</span>`;
      row.addEventListener("click", () => EntryModal.open(e.date));
      list.appendChild(row);
    });
  },

  _renderChart(periodEntries) {
    if (typeof Chart === "undefined") return;
    let cum = 0;
    const labels = periodEntries.map((e) => e.date);
    const data = periodEntries.map((e) => {
      cum += e.pl || 0;
      return cum;
    });

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.el.canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: "#4d8dff",
            backgroundColor: "rgba(77,141,255,0.15)",
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: GraphView._commonOptions(),
    });
  },
};
