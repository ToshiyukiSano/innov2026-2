/** @OnlyCurrentDoc */
// ↑ このスプレッドシートだけを操作する指定（承認画面で求める権限をしぼるため。消さないでください）

/**
 * DX・IoTデータ処理講座 第2回　IoTデータ受信用 Google Apps Script（ひな形）
 *
 * ■ このプログラムがすること
 *   M5StickC や Node-RED（第3回）から送られた測定値（JSON）を受け取り、
 *   このスプレッドシートの「受信データ」シートに1行ずつ追加します。
 *
 * ■ 使い方（くわしくはスライド参照）
 *   1. 受信用スプレッドシートで「拡張機能」→「Apps Script」を開き、このコードを全部貼り付けて保存
 *   2. 上の関数選択で「setup」を選んで「実行」→ 権限の内容を確認して承認
 *      → 実行ログに表示される「合言葉（token）」を控える
 *   3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *   4. 表示されたウェブアプリのURL（…/exec）が受信用URL
 *   ※ コードを直したときは「デプロイ」→「デプロイを管理」→ 編集 → バージョン「新バージョン」で
 *     デプロイし直します（URL は変わりません）。保存しただけでは受信側に反映されません。
 *
 * ■ 受け付けるデータ（送信データ仕様 R8-第2回版）
 *   POST 本文は JSON。Content-Type: application/json
 *   {
 *     "token":         "合言葉",          必須  文字列  setup で作られたもの
 *     "device_id":     "stick-01",        必須  文字列  機器の呼び名（32文字まで）
 *     "temperature_c": 23.4,              必須  数値    温度 [℃]
 *     "humidity_pct":  45.2,              必須  数値    相対湿度 [%]
 *     "pressure_hpa":  1012.3,            必須  数値    気圧 [hPa]（Pa ではない）
 *     "measured_at":   "2026-11-21T10:15:30+09:00",  任意  送信側の測定日時（ISO 8601、時差付き）
 *     "source":        "m5stickc",        任意  送信元の種類（m5stickc / node-red など）
 *     "note":          ""                 任意  メモ（200文字まで）
 *   }
 *   数値は "23.4" のような文字列ではなく、数値として送ります。
 *
 * ■ 返事（応答）
 *   成功： {"status":"ok", "row":行番号, "received_at":"受信日時"}
 *   失敗： {"status":"error", "message":"理由"}
 *   ※ ウェブアプリの仕組み上、失敗でも HTTP の状態コードは 200 になります。
 *     送信側は status が "ok" かどうかで成功を判断してください。
 *   ※ POST すると、途中で別のURLへの転送（HTTP 302）が返ることがあります。
 *     記録は転送の前に行われます。
 */

const SHEET_NAME = '受信データ';
const HEADERS = ['受信日時', '測定日時(送信側)', '機器ID', '温度_℃', '湿度_%', '気圧_hPa', '送信元', 'メモ'];

// 値の範囲チェック（センサーの測定範囲や単位の取り違えを見つけるため。安全基準ではありません）
const LIMITS = {
  temperature_c: { min: -40, max: 85,   hint: '温度は ℃ で送ってください' },
  humidity_pct:  { min: 0,   max: 100,  hint: '湿度は % で送ってください' },
  pressure_hpa:  { min: 300, max: 1100, hint: '気圧は hPa で送ってください（Pa の値なら 100 で割る）' },
};
const KNOWN_KEYS = ['token', 'device_id', 'temperature_c', 'humidity_pct', 'pressure_hpa',
                    'measured_at', 'source', 'note'];

/** 最初に1回だけ実行：シートと見出しを作り、合言葉を用意する */
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('TOKEN', token);
  }
  console.log('準備できました。合言葉（token）: ' + token);
  console.log('合言葉はAIやチャットに貼らないでください。');
}

/** 合言葉を作り直したいときに実行（古い合言葉の送信は受け付けなくなります） */
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

/** データの受信（POST） */
function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const body = parseBody_(e);
    checkToken_(body.token);
    const row = buildRow_(body);
    lock.waitLock(10000);          // 同時に届いたときに行が重ならないよう順番待ち
    locked = true;
    const sheet = getSheet_();
    sheet.appendRow(row);
    const result = { status: 'ok', row: sheet.getLastRow(), received_at: fmt_(row[0]) };
    const ignored = Object.keys(body).filter(function (k) { return KNOWN_KEYS.indexOf(k) < 0; });
    if (ignored.length) result.ignored_keys = ignored;   // 項目名の打ち間違いに気づくため
    return json_(result);
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message ? err.message : err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** ブラウザでURLを開いたときの確認用（データは表示しません） */
function doGet() {
  return json_({ status: 'ok', message: '受信窓口は動いています。データは POST（JSON）で送ってください。' });
}

// ---------------------------------------------------------------- 以下は内部の処理

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('データが届いていません。POST の本文に JSON を入れてください');
  }
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('JSON 形式として読めません。{"token": ..., "temperature_c": ...} の形で送ってください');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('JSON は { } で囲んだ1件分のデータにしてください');
  }
  return body;
}

function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) throw new Error('受信側の合言葉が未設定です。Apps Script で setup を実行してください');
  if (typeof token !== 'string' || token !== expected) throw new Error('合言葉（token）が違います');
}

function buildRow_(b) {
  const missing = ['device_id', 'temperature_c', 'humidity_pct', 'pressure_hpa']
    .filter(function (k) { return b[k] === undefined || b[k] === null || b[k] === ''; });
  if (missing.length) throw new Error('必要な項目がありません: ' + missing.join(', '));

  if (typeof b.device_id !== 'string' || b.device_id.length > 32) {
    throw new Error('device_id は32文字以内の文字列で送ってください');
  }
  const t = num_(b, 'temperature_c');
  const h = num_(b, 'humidity_pct');
  const p = num_(b, 'pressure_hpa');

  let measured = '';
  if (b.measured_at !== undefined && b.measured_at !== null && b.measured_at !== '') {
    if (typeof b.measured_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(b.measured_at)) {
      throw new Error('measured_at は 2026-11-21T10:15:30+09:00 の形（時差付き）で送るか、省略してください');
    }
    measured = new Date(b.measured_at);
    if (isNaN(measured.getTime())) throw new Error('measured_at の日時が正しくありません');
  }

  const source = optText_(b, 'source', 32);
  const note = optText_(b, 'note', 200);
  return [new Date(), measured, safe_(b.device_id), t, h, p, safe_(source), safe_(note)];
}

function num_(b, key) {
  const v = b[key];
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(key + ' は数値で送ってください（"23.4" のような文字列ではなく 23.4）');
  }
  const lim = LIMITS[key];
  if (v < lim.min || v > lim.max) {
    throw new Error(key + ' の値 ' + v + ' は想定範囲（' + lim.min + '〜' + lim.max + '）外です。' + lim.hint);
  }
  return v;
}

function optText_(b, key, maxLen) {
  const v = b[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error(key + ' は文字列で送ってください');
  return v.slice(0, maxLen);
}

// 「=」などで始まる文字がシートで数式として扱われないようにする
function safe_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function fmt_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
