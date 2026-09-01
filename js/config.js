// アプリの接続設定。値は画面上の「接続設定」フォームからlocalStorageに保存されます。
// コードを直接編集する必要はありません。
const APP_CONFIG = {
  storageKeys: {
    clientId: "trc_client_id",
    sheetId: "trc_sheet_id",
    sheetName: "trc_sheet_name",
  },
  scopes: "https://www.googleapis.com/auth/spreadsheets",
};

function getSetting(key) {
  return localStorage.getItem(key) || "";
}

function setSetting(key, value) {
  localStorage.setItem(key, value);
}
