// スプレッドシートの行データと、日次損益の計算ロジック。
// 列構成: A=日付(YYYY-MM-DD) / B=純資産額 / C=入出金 / D=損益(参考値・任意) / E=日記
//
// 損益は「純資産額が記録されている直近の記帳日」との差分から入出金を除いた額として、
// 常にアプリ側で都度計算する(シート上のD列の値には依存しない)。

const TradeData = {
  spreadsheetId: null,
  sheetName: null,
  rows: [],
  entriesByDate: new Map(),

  configure(spreadsheetId, sheetName) {
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
  },

  async ensureHeader() {
    const header = await SheetsAPI.readRange(this.spreadsheetId, `${this.sheetName}!A1:E1`);
    if (header.length === 0) {
      await SheetsAPI.writeRange(this.spreadsheetId, `${this.sheetName}!A1:E1`, [
        ["日付", "純資産額", "入出金", "損益", "日記"],
      ]);
    }
  },

  async loadAll() {
    const values = await SheetsAPI.readRange(this.spreadsheetId, `${this.sheetName}!A2:E100000`);
    this.rows = [];
    this.entriesByDate = new Map();

    values.forEach((row, i) => {
      const date = row[0];
      if (!date) return;
      const entry = {
        rowNumber: i + 2,
        date: String(date),
        netWorth: row[1] === undefined || row[1] === "" ? null : Number(row[1]),
        cashFlow: row[2] === undefined || row[2] === "" ? 0 : Number(row[2]),
        diary: row[4] || "",
        pl: null,
      };
      this.rows.push(entry);
      this.entriesByDate.set(entry.date, entry);
    });

    this._computeDailyPL();
  },

  _computeDailyPL() {
    const withNetWorth = this.rows
      .filter((e) => e.netWorth !== null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let prevNetWorth = null;
    withNetWorth.forEach((e) => {
      e.pl = prevNetWorth === null ? null : e.netWorth - prevNetWorth - e.cashFlow;
      prevNetWorth = e.netWorth;
    });
    this.sortedEntries = withNetWorth;
  },

  getEntry(dateStr) {
    return this.entriesByDate.get(dateStr) || null;
  },

  // 純資産額が記録されている行を日付昇順で返す(損益計算済み)。
  // グラフ・分析画面で使う。
  getSortedEntries() {
    return this.sortedEntries || [];
  },

  // from <= date <= to (両端含む、YYYY-MM-DD文字列比較)の範囲を返す。
  getEntriesInRange(from, to) {
    return this.getSortedEntries().filter((e) => e.date >= from && e.date <= to);
  },

  async upsertEntry(dateStr, { netWorth, cashFlow, diary }) {
    const existing = this.entriesByDate.get(dateStr);
    const rowValues = [dateStr, netWorth, cashFlow, "", diary || ""];
    if (existing) {
      await SheetsAPI.writeRange(
        this.spreadsheetId,
        `${this.sheetName}!A${existing.rowNumber}:E${existing.rowNumber}`,
        [rowValues]
      );
    } else {
      await SheetsAPI.appendRange(this.spreadsheetId, `${this.sheetName}!A:E`, [rowValues]);
    }
    await this.loadAll();
  },
};
