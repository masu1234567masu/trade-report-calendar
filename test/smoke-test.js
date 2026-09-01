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

  // カレンダーの日次損益が折り返し・はみ出しなく1行に収まっているか。
  // インポート済み494日分(まれに土日でも損益が付く日を含む)すべての月を確認する。
  await page.evaluate(() => loadCalendarData());
  await page.waitForTimeout(200);
  const calendarFitIssues = await page.evaluate(() => {
    const results = [];
    const entries = TradeData.getSortedEntries();
    const seen = new Set();
    entries.forEach((e) => {
      const [y, m] = e.date.split("-").map(Number);
      const key = `${y}-${m}`;
      if (seen.has(key)) return;
      seen.add(key);
      CalendarView.currentYear = y;
      CalendarView.currentMonth = m;
      CalendarView.render();
      document.querySelectorAll(".cal-pl").forEach((el) => {
        if (el.scrollWidth > el.getBoundingClientRect().width + 0.5) {
          results.push({ y, m, text: el.textContent });
        }
      });
    });
    return results;
  });
  calendarFitIssues.length === 0
    ? ok("カレンダーの日次損益が全期間ではみ出し・折り返しなく表示された")
    : fail(`カレンダーではみ出しているセルがある: ${JSON.stringify(calendarFitIssues)}`);

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

    await page.click('#tab-graph .period-btn[data-period="all"]');
    await page.waitForTimeout(200);
    const allPeriodLen = await page.evaluate(() => GraphView.charts.top.data.labels.length);
    allPeriodLen === importRowsLength
      ? ok(`全期間タブでインポート済み${allPeriodLen}行が反映された`)
      : fail(`全期間タブのデータ件数が期待と違う: ${allPeriodLen} (期待値 ${importRowsLength})`);

    await page.click('#tab-graph .metric-btn[data-metric="networth"]');
    await page.waitForTimeout(200);
    const lastNetWorth = await page.evaluate(() => GraphView.charts.top.data.datasets[0].data.slice(-1)[0]);
    const expectedLastNetWorth = await page.evaluate(() => IMPORT_ROWS[IMPORT_ROWS.length - 1][1]);
    lastNetWorth === expectedLastNetWorth
      ? ok("総資産トグルの表示値がインポートデータの最終値と一致した")
      : fail(`総資産トグルの値が期待と違う: ${lastNetWorth} (期待値 ${expectedLastNetWorth})`);
  }

  // 分析画面(月間/年間/全期間タブ切り替え)。
  await page.click('.tab-btn[data-tab="analysis"]');
  await page.waitForTimeout(300);

  // 月間タブ(既定)で、末尾の月(2026年8月、データがある最後の月)へ移動して確認する。
  await page.evaluate(() => {
    AnalysisView.cursorDate = new Date(2026, 7, 1); // 8月(0始まり)
    AnalysisView.render();
  });
  await page.waitForTimeout(200);
  const monthTabState = await page.evaluate(() => ({
    cardVisible: !document.getElementById("analysis-card").hidden,
    periodLabel: document.getElementById("analysis-period-label").textContent,
    metricsCount: document.getElementById("analysis-metrics").children.length,
    dayRowCount: document.getElementById("analysis-day-list").children.length,
    chartLabelCount: AnalysisView.chart ? AnalysisView.chart.data.labels.length : 0,
  }));
  monthTabState.cardVisible &&
  monthTabState.periodLabel === "2026年8月" &&
  monthTabState.metricsCount === 13 &&
  monthTabState.dayRowCount > 0 &&
  monthTabState.chartLabelCount === monthTabState.dayRowCount
    ? ok(`分析画面(月間タブ)に${monthTabState.periodLabel}の指標・日別一覧(${monthTabState.dayRowCount}件)・グラフが表示された`)
    : fail(`分析画面(月間タブ)の表示が期待通りでない: ${JSON.stringify(monthTabState)}`);

  // 日別一覧の行をタップすると、カレンダーと同じ記帳モーダルが開く。
  await page.click("#analysis-day-list .drilldown-row-day", { timeout: 5000 }).catch((e) => {
    fail(`日別一覧の行をタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const dayModalOpened = await page.evaluate(() => !document.getElementById("entry-modal-overlay").hidden);
  dayModalOpened
    ? ok("分析画面(月間タブ)の日別一覧から記帳モーダルが開いた")
    : fail("分析画面の日別一覧をタップしても記帳モーダルが開かない");
  await page.click("#entry-cancel-btn");

  // 前月へ移動できるか(月間タブのナビゲーション)。
  const monthBefore = await page.evaluate(() => document.getElementById("analysis-period-label").textContent);
  await page.click("#analysis-prev-btn");
  await page.waitForTimeout(200);
  const monthAfter = await page.evaluate(() => document.getElementById("analysis-period-label").textContent);
  monthAfter === "2026年7月" && monthAfter !== monthBefore
    ? ok(`月間タブの前月ナビゲーションが動いた(${monthBefore} → ${monthAfter})`)
    : fail(`月間タブの前月ナビゲーションが期待通りでない: ${monthBefore} → ${monthAfter}`);

  // 年間タブ。
  await page.click('#tab-analysis .period-btn[data-period="year"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    AnalysisView.cursorDate = new Date(2026, 0, 1);
    AnalysisView.render();
  });
  await page.waitForTimeout(200);
  const yearTabState = await page.evaluate(() => ({
    periodLabel: document.getElementById("analysis-period-label").textContent,
    metricsCount: document.getElementById("analysis-metrics").children.length,
    monthRowCount: document.getElementById("analysis-month-list").children.length,
  }));
  yearTabState.periodLabel === "2026年" && yearTabState.metricsCount === 13 && yearTabState.monthRowCount > 0
    ? ok(`分析画面(年間タブ)に${yearTabState.periodLabel}の指標・月別内訳(${yearTabState.monthRowCount}件)が表示された`)
    : fail(`分析画面(年間タブ)の表示が期待通りでない: ${JSON.stringify(yearTabState)}`);

  // 年間タブの月一覧をタップすると、月間タブへ飛んでその月が表示される。
  await page.click("#analysis-month-list .drilldown-row-month", { timeout: 5000 }).catch((e) => {
    fail(`年間タブの月一覧行をタップできない: ${e.message}`);
  });
  await page.waitForTimeout(200);
  const afterMonthJump = await page.evaluate(() => ({
    activePeriod: document.querySelector('#tab-analysis .period-btn.active').dataset.period,
    periodLabel: document.getElementById("analysis-period-label").textContent,
  }));
  afterMonthJump.activePeriod === "month" && /^2026年1月$/.test(afterMonthJump.periodLabel)
    ? ok(`年間タブの月一覧から月間タブ(${afterMonthJump.periodLabel})へ飛んだ`)
    : fail(`月一覧タップ後の状態が期待通りでない: ${JSON.stringify(afterMonthJump)}`);

  // 全期間タブ。
  await page.click('#tab-analysis .period-btn[data-period="all"]');
  await page.waitForTimeout(200);
  const allTabState = await page.evaluate(() => ({
    navVisibility: getComputedStyle(document.getElementById("analysis-nav")).visibility,
    metricsCount: document.getElementById("analysis-metrics").children.length,
    monthListEmpty: document.getElementById("analysis-month-list").children.length === 0,
    dayListEmpty: document.getElementById("analysis-day-list").children.length === 0,
  }));
  allTabState.navVisibility === "hidden" &&
  allTabState.metricsCount === 14 &&
  allTabState.monthListEmpty &&
  allTabState.dayListEmpty
    ? ok("分析画面(全期間タブ)に概要指標が表示され、ナビゲーションは隠れた")
    : fail(`分析画面(全期間タブ)の表示が期待通りでない: ${JSON.stringify(allTabState)}`);

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
