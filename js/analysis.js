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

function formatFactor(n) {
  if (n === null || n === undefined) return "-";
  if (!isFinite(n)) return "∞";
  return n.toFixed(2);
}

function formatCount(n) {
  return `${n}日`;
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
  const grossProfit = withPL.filter((e) => e.pl > 0).reduce((sum, e) => sum + e.pl, 0);
  const grossLoss = withPL.filter((e) => e.pl < 0).reduce((sum, e) => sum + e.pl, 0);
  const winCount = withPL.filter((e) => e.pl > 0).length;
  const lossCount = withPL.filter((e) => e.pl < 0).length;
  const maxProfit = withPL.length ? Math.max(...withPL.map((e) => e.pl)) : null;
  const maxLoss = withPL.length ? Math.min(...withPL.map((e) => e.pl)) : null;

  const returns = withPL
    .map((e) => {
      const prevNetWorth = e.netWorth - e.pl - e.cashFlow;
      return prevNetWorth > 0 ? (e.pl / prevNetWorth) * 100 : null;
    })
    .filter((r) => r !== null);
  const avgReturnPct = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : null;

  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  withPL.forEach((e) => {
    cum += e.pl;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  });

  const totalDeposit = entries.filter((e) => e.cashFlow > 0).reduce((s, e) => s + e.cashFlow, 0);
  const totalWithdrawal = entries.filter((e) => e.cashFlow < 0).reduce((s, e) => s + e.cashFlow, 0);

  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : null) : grossProfit / Math.abs(grossLoss);
  const recoveryFactor = maxDrawdown === 0 ? (totalPL > 0 ? Infinity : null) : totalPL / Math.abs(maxDrawdown);

  return {
    totalPL,
    grossProfit,
    grossLoss,
    winCount,
    lossCount,
    maxProfit,
    maxLoss,
    avgReturnPct,
    maxDrawdown,
    totalDeposit,
    totalWithdrawal,
    profitFactor,
    recoveryFactor,
  };
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
      this._renderDetail(entries, periodEntries);
      this._renderChart(periodEntries);
      this._renderMonthList(y, entries);
      this.el.dayList.innerHTML = "";
    } else {
      const m = this.cursorDate.getMonth() + 1;
      this.el.periodLabel.textContent = `${y}年${m}月`;
      const periodEntries = entries.filter((e) => e.date.startsWith(`${y}-${pad2(m)}`));
      this._renderDetail(entries, periodEntries);
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
    // 記録開始時点の純資産額が0(入金前から記帳を始めた等)だと基準が定義できないため、
    // その場合は総入金額を基準にする。
    const totalReturnPct = entries[0].netWorth
      ? (m.totalPL / entries[0].netWorth) * 100
      : m.totalDeposit > 0
        ? (m.totalPL / m.totalDeposit) * 100
        : null;

    const today = new Date();
    const yearEntries = entries.filter((e) => e.date.startsWith(`${today.getFullYear()}-`));
    const monthEntries = entries.filter((e) => e.date.startsWith(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}`));
    const yearMetrics = computeMetrics(yearEntries);
    const monthMetrics = computeMetrics(monthEntries);
    const yearReturnPct = periodReturnPct(entries, yearEntries, yearMetrics.totalPL);
    const monthReturnPct = periodReturnPct(entries, monthEntries, monthMetrics.totalPL);

    const wrap = this.el.metrics;
    wrap.innerHTML = "";
    const rows = [
      ["総資産", formatYen(currentNetWorth).replace(/^\+/, ""), null],
      ["総リターン", formatPct(totalReturnPct), pctColorClass(totalReturnPct)],
      ["今年のパフォーマンス", formatPct(yearReturnPct), pctColorClass(yearReturnPct)],
      ["今月のパフォーマンス", formatPct(monthReturnPct), pctColorClass(monthReturnPct)],
      ["総利益", formatYen(m.grossProfit), "profit"],
      ["総損失", formatYen(m.grossLoss), "loss"],
      ["総入金", formatYen(m.totalDeposit), null],
      ["総出金", formatYen(m.totalWithdrawal), null],
      ["プラス日数", formatCount(m.winCount), null],
      ["マイナス日数", formatCount(m.lossCount), null],
      ["最大利益", m.maxProfit !== null ? formatYen(m.maxProfit) : "-", m.maxProfit !== null ? "profit" : null],
      ["最大損失", m.maxLoss !== null ? formatYen(m.maxLoss) : "-", m.maxLoss !== null ? "loss" : null],
      ["平均リターン", formatPct(m.avgReturnPct), null],
      ["最大ドローダウン", formatYen(m.maxDrawdown), "loss"],
    ];
    rows.forEach(([label, value, colorClass]) => wrap.appendChild(this._metricItem(label, value, colorClass)));
  },

  // 月間・年間タブ共通: 選択中の期間の詳細指標。
  _renderDetail(fullEntries, periodEntries) {
    const m = computeMetrics(periodEntries);
    const avgProfit = m.winCount ? m.grossProfit / m.winCount : 0;
    const avgLoss = m.lossCount ? m.grossLoss / m.lossCount : 0;

    const wrap = this.el.metrics;
    wrap.innerHTML = "";
    const rows = [
      ["総損益", formatYen(m.totalPL), m.totalPL >= 0 ? "profit" : "loss"],
      ["総利益", formatYen(m.grossProfit), "profit"],
      ["総損失", formatYen(m.grossLoss), "loss"],
      ["平均利益", formatYen(avgProfit), "profit"],
      ["平均損失", formatYen(avgLoss), "loss"],
      ["平均リターン", formatPct(m.avgReturnPct), null],
      ["最大利益", m.maxProfit !== null ? formatYen(m.maxProfit) : "-", m.maxProfit !== null ? "profit" : null],
      ["最大損失", m.maxLoss !== null ? formatYen(m.maxLoss) : "-", m.maxLoss !== null ? "loss" : null],
      ["勝ち数", formatCount(m.winCount), null],
      ["負け数", formatCount(m.lossCount), null],
      ["プロフィットファクター", formatFactor(m.profitFactor), null],
      ["リカバリーファクター", formatFactor(m.recoveryFactor), null],
      ["最大ドローダウン", formatYen(m.maxDrawdown), "loss"],
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
