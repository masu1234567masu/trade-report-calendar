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
