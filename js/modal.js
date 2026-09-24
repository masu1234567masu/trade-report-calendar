// 日付タップで開く記帳モーダル(朝作戦&fanda・report・純資産額・入出金)。

const EntryModal = {
  currentDate: null,

  el: {
    overlay: document.getElementById("entry-modal-overlay"),
    dateLabel: document.getElementById("entry-modal-date"),
    morningInput: document.getElementById("entry-morning-input"),
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
  },

  open(dateStr) {
    this.currentDate = dateStr;
    const entry = TradeData.getEntry(dateStr);
    this.el.dateLabel.textContent = dateStr;
    this.el.morningInput.value = entry ? entry.morning : "";
    this.el.reportInput.value = entry ? entry.report : "";
    this.el.netWorthInput.value = entry && entry.netWorth !== null ? entry.netWorth : "";
    this.el.cashFlowInput.value = entry ? entry.cashFlow : 0;
    this.el.errorMsg.hidden = true;
    this.el.overlay.hidden = false;
    this.el.morningInput.focus();
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
        morning: this.el.morningInput.value,
        report: this.el.reportInput.value,
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
