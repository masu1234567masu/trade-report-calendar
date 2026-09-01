// Google Sheets API v4 への読み書きラッパー。
// すべてブラウザから直接 REST API を叩く(バックエンドサーバーなし)。

const SheetsAPI = {
  accessToken: null,

  setAccessToken(token) {
    this.accessToken = token;
  },

  async readRange(spreadsheetId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`読み込み失敗: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.values || [];
  },

  async writeRange(spreadsheetId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) {
      throw new Error(`書き込み失敗: ${res.status} ${await res.text()}`);
    }
    return res.json();
  },

  async appendRange(spreadsheetId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) {
      throw new Error(`追記失敗: ${res.status} ${await res.text()}`);
    }
    return res.json();
  },
};
