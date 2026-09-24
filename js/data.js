// スプレッドシートの行データと、日次損益の計算ロジック。
// 列構成: A=日付(YYYY-MM-DD) / B=純資産額(空欄可) / C=入出金 / D=損益(参考値・任意) /
//         E=朝作戦&fanda(旧: 日記) / F=report
//
// 損益は「純資産額が記録されている直近の記帳日」との差分から入出金を除いた額として、
// 常にアプリ側で都度計算する(シート上のD列の値には依存しない)。
// 純資産額は空欄で保存できるため(日記だけ書きたい日など)、純資産額なしの日に記録した
// 入出金も含めて、次に純資産額が記録された日までの入出金を合算してから差し引く。

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
    const header = await SheetsAPI.readRange(this.spreadsheetId, `${this.sheetName}!A1:F1`);
    if (header.length === 0) {
      await SheetsAPI.writeRange(this.spreadsheetId, `${this.sheetName}!A1:F1`, [
        ["日付", "純資産額", "入出金", "損益", "朝作戦&fanda", "report"],
      ]);
    } else if (!header[0][5]) {
      // 既存シート(旧5列構成)からの移行。データ行には触れず、ヘッダー行の
      // E列ラベルを「日記」→「朝作戦&fanda」に更新し、F列に新しく"report"を追加する。
      await SheetsAPI.writeRange(this.spreadsheetId, `${this.sheetName}!E1:F1`, [["朝作戦&fanda", "report"]]);
    }
  },

  async loadAll() {
    const values = await SheetsAPI.readRange(this.spreadsheetId, `${this.sheetName}!A2:F100000`);
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
        morning: row[4] || "",
        report: row[5] || "",
        pl: null,
      };
      this.rows.push(entry);
      this.entriesByDate.set(entry.date, entry);
    });

    this._computeDailyPL();
  },

  _computeDailyPL() {
    const sorted = [...this.rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let prevNetWorth = null;
    let cashFlowSinceLastNetWorth = 0;
    const withNetWorth = [];
    sorted.forEach((e) => {
      cashFlowSinceLastNetWorth += e.cashFlow;
      if (e.netWorth === null) return;
      e.pl = prevNetWorth === null ? null : e.netWorth - prevNetWorth - cashFlowSinceLastNetWorth;
      prevNetWorth = e.netWorth;
      cashFlowSinceLastNetWorth = 0;
      withNetWorth.push(e);
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

  async upsertEntry(dateStr, { netWorth, cashFlow, morning, report }) {
    const existing = this.entriesByDate.get(dateStr);
    const rowValues = [
      dateStr,
      netWorth === null || netWorth === undefined ? "" : netWorth,
      cashFlow,
      "",
      morning || "",
      report || "",
    ];
    if (existing) {
      await SheetsAPI.writeRange(
        this.spreadsheetId,
        `${this.sheetName}!A${existing.rowNumber}:F${existing.rowNumber}`,
        [rowValues]
      );
    } else {
      await SheetsAPI.appendRange(this.spreadsheetId, `${this.sheetName}!A:F`, [rowValues]);
    }
    await this.loadAll();
  },
};
