// 分析画面: 年→月→日のドリルダウン一覧 + 全期間の概要指標 + 選択期間の詳細指標とグラフ。
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
// 期間全体(概要)にも、年・月単位の期間詳細にも同じロジックを使う。
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
  selectedYear: null,
  selectedMonth: null,

  el: {
    signinMsg: document.getElementById("analysis-signin-msg"),
    emptyMsg: document.getElementById("analysis-empty-msg"),
    overviewCard: document.getElementById("analysis-overview-card"),
    overview: document.getElementById("analysis-overview"),
    drilldownCard: document.getElementById("analysis-drilldown-card"),
    yearList: document.getElementById("analysis-year-list"),
    detailCard: document.getElementById("analysis-detail-card"),
    detailTitle: document.getElementById("analysis-detail-title"),
    detailMetrics: document.getElementById("analysis-detail-metrics"),
    detailCanvas: document.getElementById("analysis-detail-canvas"),
    dayList: document.getElementById("analysis-day-list"),
  },

  chart: null,

  init() {},

  render() {
    const entries = TradeData.getSortedEntries();

    if (entries.length === 0) {
      this.el.emptyMsg.hidden = false;
      this.el.overviewCard.hidden = true;
      this.el.drilldownCard.hidden = true;
      this.el.detailCard.hidden = true;
      return;
    }
    this.el.emptyMsg.hidden = true;
    this.el.overviewCard.hidden = false;
    this.el.drilldownCard.hidden = false;

    this._renderOverview(entries);
    this._renderYearList(entries);

    if (this.selectedYear) {
      this._renderDetail(entries);
      this.el.detailCard.hidden = false;
    } else {
      this.el.detailCard.hidden = true;
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

    const wrap = this.el.overview;
    wrap.innerHTML = "";
    const rows = [
      ["総資産", formatYen(currentNetWorth).replace(/^\+/, ""), null],
      ["総リターン", formatPct(totalReturnPct), pctColorClass(totalReturnPct)],
      ["年間パフォーマンス", formatPct(yearReturnPct), pctColorClass(yearReturnPct)],
      ["月間パフォーマンス", formatPct(monthReturnPct), pctColorClass(monthReturnPct)],
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

  _renderYearList(entries) {
    const byYear = new Map();
    entries.forEach((e) => {
      const year = e.date.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(e);
    });
    const years = Array.from(byYear.keys()).sort().reverse();

    const list = this.el.yearList;
    list.innerHTML = "";

    years.forEach((year) => {
      const yearEntries = byYear.get(year);
      const yearMetrics = computeMetrics(yearEntries);

      const row = document.createElement("button");
      row.className = "drilldown-row" + (this.selectedYear === year && !this.selectedMonth ? " active" : "");
      row.innerHTML = `<span>${year}年</span><span class="${yearMetrics.totalPL >= 0 ? "profit" : "loss"}">${formatYen(yearMetrics.totalPL)}</span>`;
      row.addEventListener("click", () => this.selectYear(year));
      list.appendChild(row);

      if (this.selectedYear === year) {
        const byMonth = new Map();
        yearEntries.forEach((e) => {
          const month = e.date.slice(5, 7);
          if (!byMonth.has(month)) byMonth.set(month, []);
          byMonth.get(month).push(e);
        });
        const months = Array.from(byMonth.keys()).sort().reverse();

        months.forEach((month) => {
          const monthEntries = byMonth.get(month);
          const monthMetrics = computeMetrics(monthEntries);

          const monthRow = document.createElement("button");
          monthRow.className = "drilldown-row drilldown-row-month" + (this.selectedMonth === month ? " active" : "");
          monthRow.innerHTML = `<span>${parseInt(month, 10)}月</span><span class="${monthMetrics.totalPL >= 0 ? "profit" : "loss"}">${formatYen(monthMetrics.totalPL)}</span>`;
          monthRow.addEventListener("click", () => this.selectMonth(year, month));
          list.appendChild(monthRow);
        });
      }
    });
  },

  selectYear(year) {
    this.selectedYear = this.selectedYear === year && !this.selectedMonth ? null : year;
    this.selectedMonth = null;
    this.render();
  },

  selectMonth(year, month) {
    this.selectedYear = year;
    this.selectedMonth = this.selectedMonth === month ? null : month;
    this.render();
  },

  _renderDetail(entries) {
    const prefix = this.selectedMonth ? `${this.selectedYear}-${this.selectedMonth}` : `${this.selectedYear}-`;
    const periodEntries = entries.filter((e) => e.date.startsWith(prefix));
    const m = computeMetrics(periodEntries);
    const avgProfit = m.winCount ? m.grossProfit / m.winCount : 0;
    const avgLoss = m.lossCount ? m.grossLoss / m.lossCount : 0;

    this.el.detailTitle.textContent = this.selectedMonth
      ? `${this.selectedYear}年${parseInt(this.selectedMonth, 10)}月の詳細`
      : `${this.selectedYear}年の詳細`;

    const wrap = this.el.detailMetrics;
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

    this._renderDetailChart(periodEntries);
    this._renderDayList(periodEntries);
  },

  _renderDetailChart(periodEntries) {
    if (typeof Chart === "undefined") return;
    let cum = 0;
    const labels = periodEntries.map((e) => e.date);
    const data = periodEntries.map((e) => {
      cum += e.pl || 0;
      return cum;
    });

    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.el.detailCanvas.getContext("2d"), {
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

  // 月を選択しているときだけ、その月の日別一覧を表示する(年のみ選択時は月一覧が
  // 既に上のドリルダウンリストに出ているため、ここでは出さない)。
  _renderDayList(periodEntries) {
    const list = this.el.dayList;
    list.innerHTML = "";
    if (!this.selectedMonth) return;

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
};
