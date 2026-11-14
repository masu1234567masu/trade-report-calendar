// 日付タップで開く記帳モーダル(朝作戦&fanda・report・純資産額・入出金)。
//
// 朝作戦&fanda(E列)・report(F列)は、それぞれ「チップ(単一選択)」+「1行テキスト」の
// 組み合わせを "チップ｜テキスト" という1本の文字列にエンコードしてシートに保存する
// (列を増やさずに済ませるため)。チップだけ選んでテキストが空ならチップ名のみ、
// チップを選ばなければテキストのみを保存する。読み込み時は先頭が既知のチップ名かどうかで
// 判定するので、過去の(チップという概念が無かった頃の)自由記述もそのままテキスト欄に
// 表示され、データが失われることはない。

const MARKET_CHIP_VALUES = ["上昇", "下降", "レンジ", "様子見"];
const RESULT_CHIP_VALUES = ["計画通り", "まずまず", "反省", "見送り"];
const CHIP_TEXT_SEPARATOR = "｜";

function encodeChipText(chipValue, text) {
  const t = (text || "").trim();
  if (chipValue && t) return `${chipValue}${CHIP_TEXT_SEPARATOR}${t}`;
  if (chipValue) return chipValue;
  return t;
}

function decodeChipText(stored, knownValues) {
  const s = stored || "";
  const sepIdx = s.indexOf(CHIP_TEXT_SEPARATOR);
  if (sepIdx !== -1) {
    const maybeChip = s.slice(0, sepIdx);
    if (knownValues.includes(maybeChip)) {
      return { chip: maybeChip, text: s.slice(sepIdx + CHIP_TEXT_SEPARATOR.length) };
    }
  }
  if (knownValues.includes(s)) {
    return { chip: s, text: "" };
  }
  return { chip: null, text: s };
}

const EntryModal = {
  currentDate: null,
  selectedMarketChip: null,
  selectedResultChip: null,

  el: {
    overlay: document.getElementById("entry-modal-overlay"),
    dateLabel: document.getElementById("entry-modal-date"),
    marketChips: document.getElementById("market-chips"),
    fandaInput: document.getElementById("entry-fanda-input"),
    resultChips: document.getElementById("result-chips"),
    reportInput: document.getElementById("entry-report-input"),
    netWorthInput: document.getElementById("entry-networth-input"),
    cashFlowInput: document.getElementById("entry-cashflow-input"),
    saveBtn: document.getElementById("entry-save-btn"),
    cancelBtn: document.getElementById("entry-cancel-btn"),
    errorMsg: document.getElementById("entry-error-msg"),
  },

  init() {
    this.el.cancelBtn.addEventListener("click", () => this.close());
    this.el.saveBtn.addEventListener("click", () => this.save());
    this.el.overlay.addEventListener("click", (e) => {
      if (e.target === this.el.overlay) this.close();
    });
    this.el.marketChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      this.selectedMarketChip = this.selectedMarketChip === btn.dataset.value ? null : btn.dataset.value;
      this._renderChipSelection(this.el.marketChips, this.selectedMarketChip);
    });
    this.el.resultChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      this.selectedResultChip = this.selectedResultChip === btn.dataset.value ? null : btn.dataset.value;
      this._renderChipSelection(this.el.resultChips, this.selectedResultChip);
    });
  },

  _renderChipSelection(container, selectedValue) {
    container.querySelectorAll(".chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === selectedValue);
    });
  },

  open(dateStr) {
    this.currentDate = dateStr;
    const entry = TradeData.getEntry(dateStr);

    const morning = decodeChipText(entry ? entry.morning : "", MARKET_CHIP_VALUES);
    const report = decodeChipText(entry ? entry.report : "", RESULT_CHIP_VALUES);

    this.selectedMarketChip = morning.chip;
    this.el.fandaInput.value = morning.text;
    this._renderChipSelection(this.el.marketChips, this.selectedMarketChip);

    this.selectedResultChip = report.chip;
    this.el.reportInput.value = report.text;
    this._renderChipSelection(this.el.resultChips, this.selectedResultChip);

    this.el.dateLabel.textContent = dateStr;
    this.el.netWorthInput.value = entry && entry.netWorth !== null ? entry.netWorth : "";
    this.el.cashFlowInput.value = entry ? entry.cashFlow : 0;
    this.el.errorMsg.hidden = true;
    this.el.overlay.hidden = false;
  },

  close() {
    this.el.overlay.hidden = true;
  },

  showError(message) {
    this.el.errorMsg.textContent = message;
    this.el.errorMsg.hidden = false;
  },

  async save() {
    const netWorthRaw = this.el.netWorthInput.value.trim();
    if (netWorthRaw !== "" && Number.isNaN(Number(netWorthRaw))) {
      this.showError("純資産額を数値で入力してください(空欄も可)");
      return;
    }
    const cashFlowRaw = this.el.cashFlowInput.value.trim();
    if (cashFlowRaw !== "" && Number.isNaN(Number(cashFlowRaw))) {
      this.showError("入出金を数値で入力してください");
      return;
    }

    this.el.saveBtn.disabled = true;
    try {
      await TradeData.upsertEntry(this.currentDate, {
        netWorth: netWorthRaw === "" ? null : Number(netWorthRaw),
        cashFlow: cashFlowRaw === "" ? 0 : Number(cashFlowRaw),
        morning: encodeChipText(this.selectedMarketChip, this.el.fandaInput.value),
        report: encodeChipText(this.selectedResultChip, this.el.reportInput.value),
      });
      this.close();
      CalendarView.render();
      if (!document.getElementById("tab-analysis").hidden) AnalysisView.render();
    } catch (e) {
      if (isAuthError(e.message)) {
        this.close();
        handleAuthExpired();
        return;
      }
      this.showError(`保存エラー: ${e.message}`);
    } finally {
      this.el.saveBtn.disabled = false;
    }
  },
};
