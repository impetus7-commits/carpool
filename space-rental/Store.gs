/**
 * 학교 공간 대여 — 저장소 (구글시트, 로그인 계정, 잠금, 시각)
 * Code.gs 는 이 파일의 함수로만 데이터를 읽고 씁니다.
 * 테스트와 미리보기에서는 이 파일 대신 dev/mock-store.js 를 씁니다.
 */

var TZ_ = 'Asia/Seoul';
var tabCache_ = {};

/**
 * 데이터를 담는 구글시트.
 * 시트의 [확장 프로그램 → Apps Script]로 만든 프로젝트면 그 시트를 쓰고,
 * script.google.com 에서 따로 만든 프로젝트면 setup 이 만들어 둔 시트(스크립트 속성 SHEET_ID)를 씁니다.
 */
function book_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('연결된 구글시트가 없어요. 앱스크립트 편집기에서 setup 함수를 먼저 실행해 주세요.');
}

function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 탭이 없어요. 시트 메뉴 [공간대여 → 처음 설정]을 먼저 실행해 주세요.");
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });
}

/** 탭의 모든 행을 [{_row, 머리글: 값, …}] 으로 읽습니다. 값은 모두 글자입니다. */
function readTab_(name) {
  if (tabCache_[name]) return tabCache_[name];
  var v = sheet_(name).getDataRange().getDisplayValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('').trim() === '') continue;
    var o = { _row: i + 1 };
    head.forEach(function (h, c) { if (h) o[h] = String(v[i][c]).trim(); });
    rows.push(o);
  }
  tabCache_[name] = rows;
  return rows;
}

/** 수식으로 해석될 수 있는 글자는 앞에 ' 를 붙여 글자로 저장합니다. */
function cell_(v) {
  v = v == null ? '' : String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var head = headers_(sh);
  var vals = objs.map(function (o) {
    return head.map(function (h) { return cell_(o[h]); });
  });
  var start = sh.getLastRow() + 1;
  var need = start + vals.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(start, 1, vals.length, head.length).setNumberFormat('@').setValues(vals);
  delete tabCache_[name];
}

/** list = [{_row, 머리글: 새 값, …}] — 적힌 머리글의 칸만 바꿉니다. */
function updateRows_(name, list) {
  if (!list.length) return;
  var sh = sheet_(name);
  var head = headers_(sh);
  list.forEach(function (o) {
    var range = sh.getRange(o._row, 1, 1, head.length);
    var cur = range.getDisplayValues()[0];
    var next = head.map(function (h, c) { return cell_(h in o ? o[h] : cur[c]); });
    range.setNumberFormat('@').setValues([next]);
  });
  delete tabCache_[name];
}

/** 드라이브 사진을 data: 주소로 돌려줍니다. 너비 1200 으로 줄인 그림을 먼저 받고, 안 되면 원본(5MB 이하)이나 작은 미리보기를 씁니다. */
function photoData_(id) {
  var encode = function (type, bytes) { return 'data:' + type + ';base64,' + Utilities.base64Encode(bytes); };
  try {
    var res = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1200', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    var type = String(res.getHeaders()['Content-Type'] || '').split(';')[0];
    if (res.getResponseCode() === 200 && type.indexOf('image/') === 0) return encode(type, res.getContent());
  } catch (e) {
    // 아래 방법으로 다시 시도
  }
  var file;
  try {
    file = DriveApp.getFileById(id);
  } catch (e) {
    throw new Error('사진 파일을 열 수 없어요. 웹앱을 배포한 계정이 볼 수 있는 파일인지 확인해 주세요.');
  }
  var kind = String(file.getMimeType());
  if (file.getSize() <= 5 * 1024 * 1024 && /^image\/(jpeg|png|gif|webp)$/.test(kind)) return encode(kind, file.getBlob().getBytes());
  var thumb = file.getThumbnail();
  if (!thumb) throw new Error('사진을 읽을 수 없어요. JPG 나 PNG 파일로 올려 주세요.');
  return encode(thumb.getContentType(), thumb.getBytes());
}

/** 사진을 서버가 읽을 수 있도록 권한을 허용합니다. 편집기에서 한 번 실행하세요. */
function allowPhotos() {
  DriveApp.getRootFolder();
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  console.log('사진 읽기 권한이 허용되었습니다. [배포 → 배포 관리 → 수정 → 새 버전]으로 다시 배포해 주세요.');
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    throw new Error('지금 신청이 몰려 있어요. 잠시 뒤에 다시 시도해 주세요.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function today_() { return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd HH:mm:ss'); }
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function sheetUrl_() { return book_().getUrl(); }
