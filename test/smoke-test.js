// 画面の変更を入れるたびに実行する動作確認スクリプト。
// 実際のGoogleログインはできないため、ログイン成功後の状態を偽装し、
// Sheets APIへの通信はスタブして、アプリ本体のロジック(カレンダー描画・
// モーダルの開閉・保存)をヘッドレスブラウザで実際に操作して確認する。
//
// 使い方:
//   npm install playwright   (初回のみ)
//   python3 -m http.server 8123  (別ターミナルでリポジトリ直下で起動)
//   node test/smoke-test.js
//
// 画面(グラフ・分析)を追加したら、このスクリプトにも操作手順を足していくこと。
//
// グラフ画面が使うChart.jsは js/vendor/chart.umd.js としてリポジトリに
// 同梱済み(CDN不使用)なので、追加の設定なしにローカルサーバー配信で
// そのままテストできる。

const { chromium, devices } = require("playwright");

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:8123/";

function fail(message) {
  console.error(`NG: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(BASE_URL, { waitUntil: "load" });

  // この端末で接続設定(スプレッドシートID)が未入力のままログインしたケース。
  // 過去に「ログイン済み表示になるのに、カレンダー/グラフは出ないまま」という
  // 不具合が起きた。原因はエラーが折りたたみの中のログにしか出ておらず、
  // 画面上は何も変わったように見えなかったこと。再発防止のため確認する。
  await page.evaluate(async () => {
    await onLoginSuccess("fake-token-no-sheet-id");
  });
  await page.waitForTimeout(200);
  const noSheetIdState = await page.evaluate(() => ({
    globalStatusVisible: !document.getElementById("global-status").hidden,
    settingsOpen: document.getElementById("settings-details").open,
  }));
  noSheetIdState.globalStatusVisible && noSheetIdState.settingsOpen
    ? ok("スプレッドシートID未設定のログインで、画面上部にエラーが表示され接続設定が開いた")
    : fail(`スプレッドシートID未設定なのにエラーが見える形で出ていない: ${JSON.stringify(noSheetIdState)}`);
  await page.evaluate(() => {
    resetToLoggedOut(null);
    clearGlobalError();
    document.getElementById("settings-details").open = false;
  });

  // Sheets API自体が(スプレッドシートID未設定ではなく)400エラーを返すケース。
  // 実機で「ログイン済み表示なのにカレンダーが出ず、原因は折りたたみ内のログにしか
  // 出ていない400エラーだった」という不具合が起きた。一般化した修正(自動読み込み中の
  // エラーはすべてshowGlobalErrorで出す)が効いているか確認する。
  await page.evaluate(async () => {
    setSetting(APP_CONFIG.storageKeys.sheetId, "fake-sheet-id");
    SheetsAPI.readRange = async () => {
      throw new Error('読み込み失敗: 400 {"error":{"code":400,"message":"Unable to parse range","status":"INVALID_ARGUMENT"}}');
    };
    await onLoginSuccess("fake-token-400");
  });
  await page.waitForTimeout(200);
  const apiErrorState = await page.evaluate(() => ({
    globalStatusVisible: !document.getElementById("global-status").hidden,
    globalStatusText: document.getElementById("global-status").textContent,
  }));
  apiErrorState.globalStatusVisible && /400/.test(apiErrorState.globalStatusText)
    ? ok("Sheets APIの400エラーが画面上部に表示された")
    : fail(`Sheets APIの400エラーが見える形で出ていない: ${JSON.stringify(apiErrorState)}`);
  await page.evaluate(() => {
    resetToLoggedOut(null);
    clearGlobalError();
  });

  // ログイン状態のキャッシュ(localStorage)。「毎回ログインし直すのが面倒」という
  // フィードバックを受けて、有効期限内のトークンは再読み込みしても使い回すようにした。
  // 再読み込み後もSheets APIへの通信をスタブできるよう、fetch自体をここで
  // 差し替えておく(SheetsAPI.readRangeへの直接上書きは再読み込みで失われるため)。
  await page.addInitScript(() => {
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (typeof url === "string" && url.includes("sheets.googleapis.com")) {
        const body = url.includes("A1%3AE1")
          ? { values: [["日付", "純資産額", "入出金", "損益", "日記"]] }
          : { values: [] };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });
  await page.evaluate(async () => {
    SheetsAPI.readRange = async (id, range) =>
      range.includes("A1:E1") ? [["日付", "純資産額", "入出金", "損益", "日記"]] : [];
    setSetting(APP_CONFIG.storageKeys.clientId, "fake-client-id");
    setSetting(APP_CONFIG.storageKeys.sheetId, "fake-sheet-id");
    setSetting(APP_CONFIG.storageKeys.sheetName, "Sheet1");
    await onLoginSuccess("fake-token-cache-test", 3600);
  });
  const cacheSaved = await page.evaluate(() => ({
    token: getSetting(APP_CONFIG.storageKeys.accessToken),
    expiresAt: Number(getSetting(APP_CONFIG.storageKeys.accessTokenExpiresAt)),
  }));
  cacheSaved.token === "fake-token-cache-test" && cacheSaved.expiresAt > Date.now()
    ? ok("ログイン成功時にトークンがキャッシュ(localStorage)へ保存された")
    : fail(`トークンがキャッシュされていない: ${JSON.stringify(cacheSaved)}`);

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(300);
  const restoredState = await page.evaluate(() => ({
    signedIn: !document.getElementById("signed-in-area").hidden,
    token: typeof currentAccessToken !== "undefined" ? currentAccessToken : null,
  }));
  restoredState.signedIn && restoredState.token === "fake-token-cache-test"
    ? ok("再読み込みしても、キャッシュ済みトークンでログイン状態が自動復元された(再ログイン不要)")
    : fail(`再読み込み後にログイン状態が復元されなかった: ${JSON.stringify(restoredState)}`);

  await page.evaluate(() => {
    Auth.revoke = (token, done) => done();
  });
  await page.click("#signout-btn");
  await page.waitForTimeout(200);
  const afterLogout = await page.evaluate(() => ({
    token: getSetting(APP_CONFIG.storageKeys.accessToken),
    explicitLogout: getSetting(APP_CONFIG.storageKeys.explicitLogout),
  }));
  afterLogout.token === "" && afterLogout.explicitLogout === "1"
    ? ok("ログアウトでキャッシュされたトークンが消え、自動再ログインしないフラグが立った")
    : fail(`ログアウト後の状態が期待と違う: ${JSON.stringify(afterLogout)}`);

  // ログイン状態とSheets APIを偽装する。
  await page.evaluate(async () => {
    window.__fakeRows = [];
    SheetsAPI.readRange = async (id, range) => {
      if (range.includes("A1:E1")) return [["日付", "純資産額", "入出金", "損益", "日記"]];
      return window.__fakeRows;
    };
    SheetsAPI.writeRange = async () => ({});
    SheetsAPI.appendRange = async (id, range, values) => {
      window.__fakeRows.push(values[0]);
      return {};
    };

    setSetting(APP_CONFIG.storageKeys.clientId, "fake-client-id");
    setSetting(APP_CONFIG.storageKeys.sheetId, "fake-sheet-id");
    setSetting(APP_CONFIG.storageKeys.sheetName, "Sheet1");
    loadSettingsIntoForm();

    currentAccessToken = "fake-token";
    SheetsAPI.setAccessToken("fake-token");
    el.signinBtn.hidden = true;
    el.signedInArea.hidden = false;
    el.readTestBtn.disabled = false;
    el.writeTestBtn.disabled = false;
    el.importBtn.disabled = false;
    await loadCalendarData();
  });

  // ログイン中はサインインボタンが完全に隠れているか(表示上のバグ検知)。
  const signinBtnBox = await page.locator("#signin-btn").boundingBox();
  if (signinBtnBox !== null) {
    fail("ログイン中なのに『Googleでログイン』ボタンが表示領域を持っている(hidden属性がCSSに負けている疑い)");
  } else {
    ok("ログイン中は『Googleでログイン』ボタンが正しく非表示");
  }

  // カレンダー表示。
  const calendarVisible = await page.evaluate(() => !el.calendarCard.hidden);
  calendarVisible ? ok("カレンダーが表示された") : fail("カレンダーが表示されない");

  // 日付タップ→モーダルオープン。
  await page.click(".cal-cell:not(.cal-blank)", { timeout: 5000 }).catch((e) => {
    fail(`日付マスをタップできない(他の要素にブロックされている可能性): ${e.message}`);
  });
  await page.waitForTimeout(200);
  const modalOpened = await page.evaluate(() => !document.getElementById("entry-modal-overlay").hidden);
  modalOpened ? ok("モーダルが開いた") : fail("モーダルが開かない");

  // 保存。
  await page.fill("#entry-networth-input", "1000000");
  await page.click("#entry-save-btn", { timeout: 5000 }).catch((e) => {
    fail(`保存ボタンをタップできない: ${e.message}`);
  });
  await page.waitForTimeout(300);
  const closedAfterSave = await page.evaluate(() => document.getElementById("entry-modal-overlay").hidden);
  closedAfterSave ? ok("保存後にモーダルが閉じた") : fail("保存してもモーダルが閉じない");

  // 再度開いてキャンセル。
  await page.click(".cal-cell:not(.cal-blank)", { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.click("#entry-cancel-btn", { timeout: 5000 }).catch((e) => {
    fail(`キャンセルボタンをタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const closedAfterCancel = await page.evaluate(() => document.getElementById("entry-modal-overlay").hidden);
  closedAfterCancel ? ok("キャンセルでモーダルが閉じた") : fail("キャンセルしてもモーダルが閉じない");

  // 過去データ一括インポート。
  await page.evaluate(() => {
    window.__bulkWrites = [];
    SheetsAPI.writeRange = async (id, range, values) => {
      window.__bulkWrites.push({ range, rowCount: values.length });
      // ヘッダー行以外(本体データ)は、後続のreadRangeが読めるよう保持しておく。
      if (!range.includes("A1:E1")) {
        window.__fakeRows = values;
      }
      return {};
    };
  });
  await page.click("#settings-details summary");
  const importBtnDisabled = await page.evaluate(() => document.getElementById("import-btn").disabled);
  importBtnDisabled ? fail("ログイン中なのに一括インポートボタンが無効のまま") : ok("一括インポートボタンが有効になっている");
  await page.click("#import-btn", { timeout: 5000 }).catch((e) => {
    fail(`一括インポートボタンをタップできない: ${e.message}`);
  });
  await page.waitForTimeout(300);
  const bulkWrites = await page.evaluate(() => window.__bulkWrites);
  const bulkWrite = bulkWrites.find((w) => w.rowCount > 1);
  if (bulkWrite && bulkWrite.rowCount === (await page.evaluate(() => IMPORT_ROWS.length))) {
    ok(`一括インポートで${bulkWrite.rowCount}行を書き込んだ(${bulkWrite.range})`);
  } else {
    fail(`一括インポートの書き込み行数が期待と違う: ${JSON.stringify(bulkWrites)}`);
  }

  // グラフ画面。
  await page.click('.tab-btn[data-tab="graph"]');
  await page.waitForTimeout(300);
  const chartJsLoaded = await page.evaluate(() => typeof Chart !== "undefined");
  if (!chartJsLoaded) {
    fail("Chart.jsが読み込めていない(js/vendor/chart.umd.jsの配信を確認すること)");
  } else {
    const graphState = await page.evaluate(() => ({
      cardVisible: !document.getElementById("graph-card").hidden,
      topChartExists: !!GraphView.charts.top,
      bottomChartExists: !!GraphView.charts.bottom,
    }));
    graphState.cardVisible ? ok("グラフ画面が表示された") : fail("グラフ画面が表示されない");
    graphState.topChartExists && graphState.bottomChartExists
      ? ok("上段・下段グラフが両方描画された")
      : fail("グラフが描画されていない");

    const importRowsLength = await page.evaluate(() => IMPORT_ROWS.length);

    await page.click('.period-btn[data-period="all"]');
    await page.waitForTimeout(200);
    const allPeriodLen = await page.evaluate(() => GraphView.charts.top.data.labels.length);
    allPeriodLen === importRowsLength
      ? ok(`全期間タブでインポート済み${allPeriodLen}行が反映された`)
      : fail(`全期間タブのデータ件数が期待と違う: ${allPeriodLen} (期待値 ${importRowsLength})`);

    await page.click('.metric-btn[data-metric="networth"]');
    await page.waitForTimeout(200);
    const lastNetWorth = await page.evaluate(() => GraphView.charts.top.data.datasets[0].data.slice(-1)[0]);
    const expectedLastNetWorth = await page.evaluate(() => IMPORT_ROWS[IMPORT_ROWS.length - 1][1]);
    lastNetWorth === expectedLastNetWorth
      ? ok("総資産トグルの表示値がインポートデータの最終値と一致した")
      : fail(`総資産トグルの値が期待と違う: ${lastNetWorth} (期待値 ${expectedLastNetWorth})`);
  }

  // 分析画面。
  await page.click('.tab-btn[data-tab="analysis"]');
  await page.waitForTimeout(300);
  const analysisOverview = await page.evaluate(() => ({
    overviewVisible: !document.getElementById("analysis-overview-card").hidden,
    overviewItemCount: document.getElementById("analysis-overview").children.length,
  }));
  analysisOverview.overviewVisible && analysisOverview.overviewItemCount === 14
    ? ok("分析画面の概要が表示された")
    : fail(`分析画面の概要が期待通りでない: ${JSON.stringify(analysisOverview)}`);

  await page.click("#analysis-year-list .drilldown-row", { timeout: 5000 }).catch((e) => {
    fail(`年の一覧行をタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const afterYearClick = await page.evaluate(() => ({
    detailVisible: !document.getElementById("analysis-detail-card").hidden,
    monthRowCount: document.querySelectorAll("#analysis-year-list .drilldown-row-month").length,
  }));
  afterYearClick.detailVisible && afterYearClick.monthRowCount > 0
    ? ok(`年をタップして詳細と月一覧(${afterYearClick.monthRowCount}件)が表示された`)
    : fail(`年タップ後の表示が期待通りでない: ${JSON.stringify(afterYearClick)}`);

  await page.click("#analysis-year-list .drilldown-row-month", { timeout: 5000 }).catch((e) => {
    fail(`月の一覧行をタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const afterMonthClick = await page.evaluate(() => ({
    dayRowCount: document.getElementById("analysis-day-list").children.length,
    chartExists: !!AnalysisView.chart,
  }));
  afterMonthClick.dayRowCount > 0 && afterMonthClick.chartExists
    ? ok(`月をタップして日別一覧(${afterMonthClick.dayRowCount}件)と詳細グラフが表示された`)
    : fail(`月タップ後の表示が期待通りでない: ${JSON.stringify(afterMonthClick)}`);

  // 日別一覧の行をタップすると、カレンダーと同じ記帳モーダルが開く(日次ドリルダウン)。
  await page.click("#analysis-day-list .drilldown-row-day", { timeout: 5000 }).catch((e) => {
    fail(`日別一覧の行をタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const dayModalOpened = await page.evaluate(() => !document.getElementById("entry-modal-overlay").hidden);
  dayModalOpened
    ? ok("分析画面の日別一覧から記帳モーダルが開いた")
    : fail("分析画面の日別一覧をタップしても記帳モーダルが開かない");
  await page.click("#entry-cancel-btn");

  const relevantErrors = errors.filter(
    (e) => !/accounts\.google\.com|gsi\/client|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|favicon/.test(e)
  );
  if (relevantErrors.length > 0) {
    fail(`コンソールエラーあり:\n${relevantErrors.join("\n")}`);
  } else {
    ok("アプリ由来のコンソールエラーなし");
  }

  await browser.close();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error("スクリプト自体のエラー:", e);
  process.exit(1);
});
