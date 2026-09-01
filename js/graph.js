// グラフ画面: 期間切り替え(週/月/年/全期間) + 上段(累積損益⇔総資産) + 下段(日別損益+最大含み損)

function formatAmount(n) {
  return Math.round(n).toLocaleString("ja-JP") + "円";
}

function fmtDateForGraph(d) {
  return formatDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const GraphView = {
  periodType: "month",
  metric: "cumulative",
  cursorDate: null,
  charts: {},

  el: {
    card: document.getElementById("graph-card"),
    signinMsg: document.getElementById("graph-signin-msg"),
    periodBtns: document.querySelectorAll("#tab-graph .period-btn"),
    metricBtns: document.querySelectorAll("#tab-graph .metric-btn"),
    navRow: document.getElementById("graph-nav"),
    prevBtn: document.getElementById("graph-prev-btn"),
    nextBtn: document.getElementById("graph-next-btn"),
    periodLabel: document.getElementById("graph-period-label"),
    total: document.getElementById("graph-total"),
    topCanvas: document.getElementById("graph-top-canvas"),
    bottomCanvas: document.getElementById("graph-bottom-canvas"),
    emptyMsg: document.getElementById("graph-empty-msg"),
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

    this.el.metricBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.el.metricBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.metric = btn.dataset.metric;
        this.render();
      });
    });

    this.el.prevBtn.addEventListener("click", () => this.shift(-1));
    this.el.nextBtn.addEventListener("click", () => this.shift(1));
  },

  shift(diff) {
    const d = new Date(this.cursorDate);
    if (this.periodType === "week") d.setDate(d.getDate() + diff * 7);
    else if (this.periodType === "month") d.setMonth(d.getMonth() + diff);
    else if (this.periodType === "year") d.setFullYear(d.getFullYear() + diff);
    this.cursorDate = d;
    this.render();
  },

  computeRange() {
    const d = this.cursorDate;
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();

    if (this.periodType === "all") {
      const entries = TradeData.getSortedEntries();
      if (entries.length === 0) return { from: "0000-01-01", to: "9999-12-31", label: "全期間" };
      return { from: entries[0].date, to: entries[entries.length - 1].date, label: "全期間" };
    }
    if (this.periodType === "year") {
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}年` };
    }
    if (this.periodType === "week") {
      const wd = d.getDay();
      const start = new Date(y, m, day - wd);
      const end = new Date(y, m, day - wd + 6);
      return { from: fmtDateForGraph(start), to: fmtDateForGraph(end), label: `${fmtDateForGraph(start)} 〜 ${fmtDateForGraph(end)}` };
    }
    // month
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return { from: fmtDateForGraph(start), to: fmtDateForGraph(end), label: `${y}年${m + 1}月` };
  },

  render() {
    if (typeof Chart === "undefined") {
      this.el.emptyMsg.textContent = "グラフ描画ライブラリの読み込みに失敗しました。通信環境を確認し、ページを再読み込みしてください。";
      this.el.emptyMsg.hidden = false;
      return;
    }
    this.el.emptyMsg.textContent = "この期間のデータはありません。";

    const { from, to, label } = this.computeRange();
    this.el.periodLabel.textContent = label;
    this.el.navRow.style.visibility = this.periodType === "all" ? "hidden" : "visible";

    const entries = TradeData.getEntriesInRange(from, to);
    this.el.emptyMsg.hidden = entries.length > 0;

    let cum = 0;
    const cumSeries = entries.map((e) => {
      cum += e.pl || 0;
      return cum;
    });
    const netWorthSeries = entries.map((e) => e.netWorth);
    const labels = entries.map((e) => e.date);

    if (this.metric === "cumulative") {
      const totalPL = cumSeries.length ? cumSeries[cumSeries.length - 1] : 0;
      this.el.total.textContent = (totalPL >= 0 ? "+" : "") + formatAmount(totalPL);
      this.el.total.className = "graph-total " + (totalPL >= 0 ? "profit" : "loss");
    } else {
      const endNW = netWorthSeries.length ? netWorthSeries[netWorthSeries.length - 1] : 0;
      this.el.total.textContent = formatAmount(endNW);
      this.el.total.className = "graph-total";
    }

    this._renderTopChart(labels, this.metric === "cumulative" ? cumSeries : netWorthSeries);
    this._renderBottomChart(labels, entries, cumSeries);
  },

  _renderTopChart(labels, series) {
    if (this.charts.top) this.charts.top.destroy();
    this.charts.top = new Chart(this.el.topCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: series,
            borderColor: "#4d8dff",
            backgroundColor: "rgba(77,141,255,0.15)",
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: this._commonOptions(),
    });
  },

  _renderBottomChart(labels, entries, cumSeries) {
    if (this.charts.bottom) this.charts.bottom.destroy();

    const dailyPL = entries.map((e) => e.pl || 0);
    const barColors = dailyPL.map((v) => (v >= 0 ? "#2ecc71" : "#ff5c5c"));

    // 期間内の最大含み損(ピークからの最大下落幅)
    let peak = -Infinity;
    let maxDD = 0;
    let maxDDIndex = -1;
    let peakIndex = -1;
    let peakIndexAtDD = -1;
    cumSeries.forEach((v, i) => {
      if (v > peak) {
        peak = v;
        peakIndex = i;
      }
      const dd = v - peak;
      if (dd < maxDD) {
        maxDD = dd;
        maxDDIndex = i;
        peakIndexAtDD = peakIndex;
      }
    });

    const datasets = [
      {
        type: "bar",
        data: dailyPL,
        backgroundColor: barColors,
        order: 2,
      },
      {
        type: "line",
        data: cumSeries,
        borderColor: "#8b98a5",
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        order: 1,
      },
    ];

    if (maxDDIndex >= 0 && maxDD < 0 && peakIndexAtDD >= 0) {
      const ddLineData = cumSeries.map((v, i) => (i === peakIndexAtDD || i === maxDDIndex ? v : null));
      datasets.push({
        type: "line",
        data: ddLineData,
        borderColor: "#ff5c5c",
        borderDash: [4, 4],
        spanGaps: true,
        borderWidth: 1.5,
        pointRadius: (ctx) => (ctx.dataIndex === maxDDIndex || ctx.dataIndex === peakIndexAtDD ? 4 : 0),
        pointBackgroundColor: "#ff5c5c",
        fill: false,
        order: 0,
      });
    }

    this.charts.bottom = new Chart(this.el.bottomCanvas.getContext("2d"), {
      data: { labels, datasets },
      options: this._commonOptions(),
    });
  },

  _commonOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b98a5", maxTicksLimit: 8 }, grid: { color: "#232c37" } },
        y: { ticks: { color: "#8b98a5" }, grid: { color: "#232c37" } },
      },
    };
  },
};
