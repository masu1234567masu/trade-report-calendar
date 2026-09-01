// 日付タップで開く記帳モーダル(純資産額・入出金・日記)。

const EntryModal = {
  currentDate: null,

  el: {
    overlay: document.getElementById("entry-modal-overlay"),
    dateLabel: document.getElementById("entry-modal-date"),
    netWorthInput: document.getElementById("entry-networth-input"),
    cashFlowInput: document.getElementById("entry-cashflow-input"),
    diaryInput: document.getElementById("entry-diary-input"),
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
    this.el.netWorthInput.value = entry && entry.netWorth !== null ? entry.netWorth : "";
    this.el.cashFlowInput.value = entry ? entry.cashFlow : 0;
    this.el.diaryInput.value = entry ? entry.diary : "";
    this.el.errorMsg.hidden = true;
    this.el.overlay.hidden = false;
    this.el.netWorthInput.focus();
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
    if (netWorthRaw === "" || Number.isNaN(Number(netWorthRaw))) {
      this.showError("純資産額を数値で入力してください");
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
        netWorth: Number(netWorthRaw),
        cashFlow: cashFlowRaw === "" ? 0 : Number(cashFlowRaw),
        diary: this.el.diaryInput.value,
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
