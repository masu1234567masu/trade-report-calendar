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
