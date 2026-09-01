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
  importBtn: document.getElementById("import-btn"),
  importSummary: document.getElementById("import-summary"),
  graphCard: document.getElementById("graph-card"),
  graphSigninMsg: document.getElementById("graph-signin-msg"),
  analysisSigninMsg: document.getElementById("analysis-signin-msg"),
  readResultTable: document.getElementById("read-result-table"),
  logArea: document.getElementById("log-area"),
  signinRequiredMsg: document.getElementById("signin-required-msg"),
  globalStatus: document.getElementById("global-status"),
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
    // グラフ・分析はCanvasが非表示の間は正しいサイズで描画できないため、
    // タブが実際に表示された後に描画する。
    if (btn.dataset.tab === "graph" && currentAccessToken) {
      GraphView.render();
    }
    if (btn.dataset.tab === "analysis" && currentAccessToken) {
      AnalysisView.render();
    }
  });
});

let currentAccessToken = null;

function log(message) {
  const time = new Date().toLocaleTimeString("ja-JP");
  el.logArea.textContent += `[${time}] ${message}\n`;
  el.logArea.scrollTop = el.logArea.scrollHeight;
}

// 折りたたまれた「接続設定」欄の中のログだけだと気づかれないため、
// ログイン関連のエラーは画面上部にも常に見える形で出す。
function showGlobalError(message) {
  el.globalStatus.textContent = message;
  el.globalStatus.hidden = false;
  log(message);
}

function clearGlobalError() {
  el.globalStatus.hidden = true;
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
  clearGlobalError();
  const { clientId } = currentSettings();
  if (!clientId) {
    showGlobalError("エラー: 先にOAuthクライアントIDを設定して保存してください(下の「接続設定」を開いて入力・保存してください)");
    return;
  }
  try {
    Auth.login(clientId);
  } catch (e) {
    showGlobalError(`ログイン処理でエラーが発生しました: ${e.message}`);
  }
});

// アクセストークンをlocalStorageに有効期限付きで保存する。
// ページを開き直すたびの再ログインを避けるための簡易キャッシュ(app.js下部の
// 起動処理・resetToLoggedOut()参照)。
function saveAccessToken(token, expiresIn) {
  const expiresAt = Date.now() + expiresIn * 1000;
  setSetting(APP_CONFIG.storageKeys.accessToken, token);
  setSetting(APP_CONFIG.storageKeys.accessTokenExpiresAt, String(expiresAt));
  setSetting(APP_CONFIG.storageKeys.explicitLogout, "");
}

// 保存済みのトークンがまだ有効(期限まで60秒以上余裕がある)ならそれを返す。
function loadCachedAccessToken() {
  const token = getSetting(APP_CONFIG.storageKeys.accessToken);
  const expiresAt = Number(getSetting(APP_CONFIG.storageKeys.accessTokenExpiresAt));
  if (!token || !expiresAt || Date.now() > expiresAt - 60000) return null;
  return token;
}

function clearCachedAccessToken() {
  setSetting(APP_CONFIG.storageKeys.accessToken, "");
  setSetting(APP_CONFIG.storageKeys.accessTokenExpiresAt, "");
}

// ログイン成功後の画面状態を実際に反映する共通処理。
// 新規ログイン(onLoginSuccess)でも、保存済みトークンの復元(restoreSession)でも使う。
async function activateSession(accessToken) {
  currentAccessToken = accessToken;
  SheetsAPI.setAccessToken(accessToken);
  el.signinBtn.hidden = true;
  el.signedInArea.hidden = false;
  el.userEmail.textContent = "ログイン済み";
  el.readTestBtn.disabled = false;
  el.writeTestBtn.disabled = false;
  el.importBtn.disabled = false;
  await loadCalendarData();
}

async function onLoginSuccess(accessToken, expiresIn) {
  clearGlobalError();
  saveAccessToken(accessToken, expiresIn || 3600);
  log("ログインに成功しました");
  await activateSession(accessToken);
}

// 保存済みの有効なトークンで、ログイン操作なしに状態を復元する。
async function restoreSession(accessToken) {
  clearGlobalError();
  log("保存済みのログイン状態を復元しました");
  await activateSession(accessToken);
}

async function loadCalendarData() {
  const { sheetId, sheetName } = currentSettings();
  if (!sheetId) {
    showGlobalError(
      "エラー: この端末では接続設定が未入力です。下の「接続設定・データ疎通確認」を開いて、スプレッドシートIDを入力・保存してください(設定は端末ごとに別々です)"
    );
    document.getElementById("settings-details").open = true;
    return;
  }
  try {
    el.signinRequiredMsg.hidden = true;
    TradeData.configure(sheetId, sheetName);
    await TradeData.ensureHeader();
    await TradeData.loadAll();
    el.calendarCard.hidden = false;
    el.graphCard.hidden = false;
    el.graphSigninMsg.hidden = true;
    el.analysisSigninMsg.hidden = true;
    CalendarView.render();
    if (!el.tabPanels.graph.hidden) GraphView.render();
    if (!el.tabPanels.analysis.hidden) AnalysisView.render();
    log("カレンダーデータを読み込みました");
  } catch (e) {
    if (isAuthError(e.message)) {
      handleAuthExpired();
      return;
    }
    showGlobalError(`カレンダー読み込みエラー: ${e.message}`);
  }
}

function resetToLoggedOut(reasonLog) {
  currentAccessToken = null;
  SheetsAPI.setAccessToken(null);
  clearCachedAccessToken();
  el.signinBtn.hidden = false;
  el.signedInArea.hidden = true;
  el.readTestBtn.disabled = true;
  el.writeTestBtn.disabled = true;
  el.importBtn.disabled = true;
  el.calendarCard.hidden = true;
  el.signinRequiredMsg.hidden = false;
  el.graphCard.hidden = true;
  el.graphSigninMsg.hidden = false;
  el.analysisSigninMsg.hidden = false;
  document.getElementById("analysis-overview-card").hidden = true;
  document.getElementById("analysis-drilldown-card").hidden = true;
  document.getElementById("analysis-detail-card").hidden = true;
  if (reasonLog) log(reasonLog);
}

// トークン切れ(401)を検知したときに、ログイン状態の表示を実態に合わせて戻す。
// モーダル側(modal.js)からも、保存エラーが認証切れだった場合に呼ばれる。
function handleAuthExpired() {
  resetToLoggedOut(null);
  showGlobalError("セッションが切れました。もう一度ログインしてください");
}

el.signoutBtn.addEventListener("click", () => {
  if (!currentAccessToken) return;
  Auth.revoke(currentAccessToken, () => {
    resetToLoggedOut("ログアウトしました");
    // 明示的にログアウトした場合は、次に開いたときに自動で再ログインしない
    // (通常のログインボタンから、あらためて自分の意思でログインしてもらう)。
    setSetting(APP_CONFIG.storageKeys.explicitLogout, "1");
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

el.importSummary.textContent =
  `対象: ${IMPORT_ROWS.length}行(${IMPORT_ROWS[0][0]} 〜 ${IMPORT_ROWS[IMPORT_ROWS.length - 1][0]})。` +
  "列: 日付/純資産額/入出金/損益(空欄・アプリ側で都度計算)/日記。";

el.importBtn.addEventListener("click", async () => {
  const { sheetId, sheetName } = currentSettings();
  if (!sheetId) {
    log("エラー: スプレッドシートIDを設定してください");
    return;
  }
  el.importBtn.disabled = true;
  try {
    const startRow = 2;
    const endRow = startRow + IMPORT_ROWS.length - 1;
    const targetRange = `${sheetName}!A${startRow}:E${endRow}`;

    log("ヘッダー行を書き込み中...");
    await SheetsAPI.writeRange(sheetId, `${sheetName}!A1:E1`, [["日付", "純資産額", "入出金", "損益", "日記"]]);

    log(`${IMPORT_ROWS.length}行を書き込み中... (${targetRange})`);
    await SheetsAPI.writeRange(sheetId, targetRange, IMPORT_ROWS);

    log("インポート完了。カレンダーを再読み込みします");
    await loadCalendarData();
  } catch (e) {
    if (isAuthError(e.message)) {
      handleAuthExpired();
      return;
    }
    showGlobalError(`インポートエラー: ${e.message}`);
  } finally {
    el.importBtn.disabled = false;
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
GraphView.init();
AnalysisView.init();
el.signinRequiredMsg.hidden = false;

// Googleのログイン画面から戻ってきた直後であれば、URLからトークンを受け取る。
const redirectResult = Auth.consumeRedirectResult();
if (redirectResult && redirectResult.token) {
  onLoginSuccess(redirectResult.token, redirectResult.expiresIn);
} else if (redirectResult && redirectResult.error) {
  if (redirectResult.silent) {
    // 自動での再ログイン試行(loginSilent)が失敗しただけなので、
    // ユーザー操作ではタップしていない。エラー表示はせず、通常の
    // 「Googleでログイン」ボタンが見えている状態のままにする。
    log(`自動ログインを試みましたが失敗しました(${redirectResult.error})。ログインボタンから再ログインしてください`);
  } else {
    showGlobalError(`ログインエラー: ${redirectResult.error}`);
  }
} else {
  // リダイレクト直後でなければ、保存済みの有効なトークンがないか確認する。
  const cachedToken = loadCachedAccessToken();
  if (cachedToken) {
    restoreSession(cachedToken);
  } else {
    // 保存済みトークンも無ければ、明示的にログアウトしていない限り、
    // タップ不要の自動再ログインを試みる(ブラウザにGoogleのログイン
    // セッションが残っていれば、同意画面を出さずに裏で戻ってくる)。
    const { clientId } = currentSettings();
    const explicitlyLoggedOut = getSetting(APP_CONFIG.storageKeys.explicitLogout) === "1";
    if (clientId && !explicitlyLoggedOut) {
      Auth.loginSilent(clientId);
    }
  }
}
