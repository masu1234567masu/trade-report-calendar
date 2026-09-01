// データ疎通確認用の画面ロジック。
// 対応するUI: 接続設定フォーム / ログイン / 読み込みテスト / 書き込みテスト

const el = {
  signinBtn: document.getElementById("signin-btn"),
  signedInArea: document.getElementById("signed-in-area"),
  userEmail: document.getElementById("user-email"),
  signoutBtn: document.getElementById("signout-btn"),
  clientIdInput: document.getElementById("client-id-input"),
  sheetIdInput: document.getElementById("sheet-id-input"),
  sheetNameInput: document.getElementById("sheet-name-input"),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
  settingsSavedMsg: document.getElementById("settings-saved-msg"),
  readTestBtn: document.getElementById("read-test-btn"),
  writeTestBtn: document.getElementById("write-test-btn"),
  readResultTable: document.getElementById("read-result-table"),
  logArea: document.getElementById("log-area"),
  signinRequiredMsg: document.getElementById("signin-required-msg"),
  calendarCard: document.getElementById("calendar-card"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabPanels: {
    home: document.getElementById("tab-home"),
    graph: document.getElementById("tab-graph"),
    analysis: document.getElementById("tab-analysis"),
  },
};

el.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    el.tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    Object.entries(el.tabPanels).forEach(([name, panel]) => {
      panel.hidden = name !== btn.dataset.tab;
    });
  });
});

let currentAccessToken = null;

function log(message) {
  const time = new Date().toLocaleTimeString("ja-JP");
  el.logArea.textContent += `[${time}] ${message}\n`;
  el.logArea.scrollTop = el.logArea.scrollHeight;
}

function loadSettingsIntoForm() {
  el.clientIdInput.value = getSetting(APP_CONFIG.storageKeys.clientId);
  el.sheetIdInput.value = getSetting(APP_CONFIG.storageKeys.sheetId);
  el.sheetNameInput.value = getSetting(APP_CONFIG.storageKeys.sheetName) || "Sheet1";
}

function currentSettings() {
  return {
    clientId: getSetting(APP_CONFIG.storageKeys.clientId),
    sheetId: getSetting(APP_CONFIG.storageKeys.sheetId),
    sheetName: getSetting(APP_CONFIG.storageKeys.sheetName) || "Sheet1",
  };
}

el.saveSettingsBtn.addEventListener("click", () => {
  setSetting(APP_CONFIG.storageKeys.clientId, el.clientIdInput.value.trim());
  setSetting(APP_CONFIG.storageKeys.sheetId, el.sheetIdInput.value.trim());
  setSetting(APP_CONFIG.storageKeys.sheetName, el.sheetNameInput.value.trim() || "Sheet1");
  el.settingsSavedMsg.hidden = false;
  setTimeout(() => (el.settingsSavedMsg.hidden = true), 2000);
  log("設定を保存しました");
});

el.signinBtn.addEventListener("click", () => {
  const { clientId } = currentSettings();
  if (!clientId) {
    log("エラー: 先にOAuthクライアントIDを設定して保存してください");
    return;
  }
  if (typeof google === "undefined" || !google.accounts) {
    log("エラー: Googleログイン機能の読み込みに失敗しました。通信環境を確認し、ページを再読み込みしてから試してください");
    return;
  }
  Auth.init(
    clientId,
    async (accessToken) => {
      currentAccessToken = accessToken;
      SheetsAPI.setAccessToken(accessToken);
      el.signinBtn.hidden = true;
      el.signedInArea.hidden = false;
      el.userEmail.textContent = "ログイン済み";
      el.readTestBtn.disabled = false;
      el.writeTestBtn.disabled = false;
      log("ログインに成功しました");
      await loadCalendarData();
    },
    (error) => {
      log(`ログインエラー: ${error}`);
    }
  );
  Auth.requestToken();
});

async function loadCalendarData() {
  const { sheetId, sheetName } = currentSettings();
  if (!sheetId) {
    log("エラー: スプレッドシートIDを設定してください");
    return;
  }
  try {
    el.signinRequiredMsg.hidden = true;
    TradeData.configure(sheetId, sheetName);
    await TradeData.ensureHeader();
    await TradeData.loadAll();
    el.calendarCard.hidden = false;
    CalendarView.render();
    log("カレンダーデータを読み込みました");
  } catch (e) {
    if (isAuthError(e.message)) {
      handleAuthExpired();
      return;
    }
    log(`カレンダー読み込みエラー: ${e.message}`);
  }
}

function resetToLoggedOut(reasonLog) {
  currentAccessToken = null;
  SheetsAPI.setAccessToken(null);
  el.signinBtn.hidden = false;
  el.signedInArea.hidden = true;
  el.readTestBtn.disabled = true;
  el.writeTestBtn.disabled = true;
  el.calendarCard.hidden = true;
  el.signinRequiredMsg.hidden = false;
  if (reasonLog) log(reasonLog);
}

// トークン切れ(401)を検知したときに、ログイン状態の表示を実態に合わせて戻す。
// モーダル側(modal.js)からも、保存エラーが認証切れだった場合に呼ばれる。
function handleAuthExpired() {
  resetToLoggedOut("セッションが切れました。もう一度ログインしてください");
}

el.signoutBtn.addEventListener("click", () => {
  if (!currentAccessToken) return;
  Auth.revoke(currentAccessToken, () => {
    resetToLoggedOut("ログアウトしました");
  });
});

el.readTestBtn.addEventListener("click", async () => {
  const { sheetId, sheetName } = currentSettings();
  if (!sheetId) {
    log("エラー: スプレッドシートIDを設定してください");
    return;
  }
  try {
    log(`読み込み中... (${sheetName}!A1:E10)`);
    const values = await SheetsAPI.readRange(sheetId, `${sheetName}!A1:E10`);
    renderTable(values);
    log(`読み込み成功: ${values.length}行取得`);
  } catch (e) {
    if (isAuthError(e.message)) {
      handleAuthExpired();
      return;
    }
    log(`読み込みエラー: ${e.message}`);
  }
});

el.writeTestBtn.addEventListener("click", async () => {
  const { sheetId, sheetName } = currentSettings();
  if (!sheetId) {
    log("エラー: スプレッドシートIDを設定してください");
    return;
  }
  const testValue = `疎通テスト ${new Date().toLocaleString("ja-JP")}`;
  try {
    log(`書き込み中... (${sheetName}!Z1 に "${testValue}")`);
    await SheetsAPI.writeRange(sheetId, `${sheetName}!Z1`, [[testValue]]);
    log("書き込み成功。読み込みテストで Z1 の値を確認できます");
    const readBack = await SheetsAPI.readRange(sheetId, `${sheetName}!Z1`);
    log(`読み戻し確認: ${JSON.stringify(readBack)}`);
  } catch (e) {
    if (isAuthError(e.message)) {
      handleAuthExpired();
      return;
    }
    log(`書き込みエラー: ${e.message}`);
  }
});

function renderTable(values) {
  const table = el.readResultTable;
  table.innerHTML = "";
  if (values.length === 0) {
    table.hidden = true;
    return;
  }
  values.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  table.hidden = false;
}

loadSettingsIntoForm();
CalendarView.init();
EntryModal.init();
el.signinRequiredMsg.hidden = false;
