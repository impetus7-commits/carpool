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

/** 탭의 머리글 목록 */
function tabHeaders_(name) { return headers_(sheet_(name)); }

/** 탭의 모든 행을 [{_row, 머리글: 값, …}] 으로 읽습니다. 값은 모두 글자입니다. */
/* ---------- 읽기 캐시 ----------
 * 로그인 없이 많은 사람이 동시에 쓰면 모든 실행이 배포한 계정 하나로 몰려
 * "너무 많은 스크립트가 동시에 실행되고 있습니다"(동시 실행 약 30개 한도)가 날 수 있습니다.
 * 실행 하나하나를 짧게 끝내도록, 자주 읽는 탭은 시트 대신 캐시(최대 READ_CACHE_SEC 초)에서 읽습니다.
 * - 웹에서 쓰면(신청·수정·취소·대장 가져오기) 그 탭의 캐시를 바로 지웁니다.
 * - 시트에서 직접 고친 내용은 최대 READ_CACHE_SEC 초 뒤에 화면에 반영됩니다.
 * - 쓰기 작업(잠금 안)은 캐시를 쓰지 않고 늘 시트를 직접 읽습니다.
 */
var READ_CACHE_SEC = 120;
var READ_CACHE_TABS_ = { '예약': 1, '공간': 1, '교시': 1, '설정': 1 };
var READ_CACHE_CHUNK = 25000;   // 캐시 값 하나의 크기 한도(100KB)를 넘지 않게 나눠 담는 글자 수
var inLock_ = false;            // 지금 이 실행이 잠금을 쥐고 있는지

function readCacheKey_(name) { return 'tabv_' + encodeURIComponent(name); }

/** 캐시에서 탭 내용(2차원 배열)을 꺼냅니다. 없으면 null */
function readCacheGet_(name) {
  try {
    var c = CacheService.getScriptCache();
    var meta = c.get(readCacheKey_(name));
    if (!meta) return null;
    var m = meta.split(':'), ver = m[0], n = +m[1];
    var keys = [];
    for (var i = 0; i < n; i++) keys.push('tabd_' + ver + '_' + i);
    var got = c.getAll(keys);
    var text = '';
    for (var j = 0; j < n; j++) {
      if (got[keys[j]] == null) return null;
      text += got[keys[j]];
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function readCachePut_(name, values) {
  try {
    var c = CacheService.getScriptCache();
    var text = JSON.stringify(values), ver = Utilities.getUuid().slice(0, 8), parts = {}, n = 0;
    for (var i = 0; i < text.length; i += READ_CACHE_CHUNK) parts['tabd_' + ver + '_' + (n++)] = text.slice(i, i + READ_CACHE_CHUNK);
    c.putAll(parts, READ_CACHE_SEC + 30);
    c.put(readCacheKey_(name), ver + ':' + n, READ_CACHE_SEC);
  } catch (e) {
    // 캐시에 못 담아도 동작에는 문제없음 (다음에 시트를 다시 읽음)
  }
}

/** 웹에서 탭을 바꿨을 때 그 탭의 캐시를 지웁니다. */
function readCacheDrop_(name) {
  try { CacheService.getScriptCache().remove(readCacheKey_(name)); } catch (e) {}
}

/** 탭 내용(2차원 배열). 잠금 밖의 읽기는 캐시를 먼저 봅니다. */
function tabValues_(name) {
  var cached = !inLock_ && READ_CACHE_TABS_[name];
  if (cached) {
    var hit = readCacheGet_(name);
    if (hit) return hit;
  }
  if (!cached) return sheet_(name).getDataRange().getDisplayValues();
  // 캐시가 비었을 때: 쓰는 사람이 없을 때만(잠금을 바로 얻을 때만) 읽은 내용을 캐시에 담습니다.
  // 쓰는 도중에 읽은 옛 내용이 캐시에 남는 일을 막기 위함입니다.
  var lock = LockService.getScriptLock();
  if (lock.tryLock(0)) {
    try {
      var fresh = sheet_(name).getDataRange().getDisplayValues();
      readCachePut_(name, fresh);
      return fresh;
    } finally {
      lock.releaseLock();
    }
  }
  return sheet_(name).getDataRange().getDisplayValues();
}

function readTab_(name) {
  if (tabCache_[name]) return tabCache_[name];
  var v = tabValues_(name);
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
  readCacheDrop_(name);
  sortTab_(name);
}

/**
 * [예약]·[기록] 탭은 최근 것이 위로 오도록 내림차순으로 정렬해 둡니다.
 *   예약: 날짜 → 신청일시 내림차순,  기록: 일시 내림차순
 * 줄을 덧붙일 때마다 자동으로 정렬하고, 시트에서 직접 고친 뒤에는 메뉴 [공간대여 → 예약·기록 최근순 정렬]로 다시 정렬합니다.
 */
var SORT_KEYS_ = { '예약': ['날짜', '신청일시'], '기록': ['일시'] };

function sortTab_(name) {
  var keys = SORT_KEYS_[name];
  if (!keys) return;
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 3) return;
  var head = headers_(sh);
  var spec = keys.map(function (k) { return head.indexOf(k); }).filter(function (i) { return i >= 0; })
    .map(function (i) { return { column: i + 1, ascending: false }; });
  if (!spec.length) return;
  sh.getRange(2, 1, last - 1, head.length).sort(spec);
  delete tabCache_[name];
  readCacheDrop_(name);
}

/** list = [{_row, 머리글: 새 값, …}] — 적힌 머리글의 칸만 바꿉니다. */
function updateRows_(name, list) {
  if (!list.length) return;
  var sh = sheet_(name);
  var head = headers_(sh);
  // 여러 줄을 고칠 때도 시트를 한 번 읽고 한 번만 씁니다 (줄마다 읽고 쓰면 반복 예약 일괄 취소가 매우 느려집니다).
  var lo = Math.min.apply(null, list.map(function (o) { return o._row; }));
  var hi = Math.max.apply(null, list.map(function (o) { return o._row; }));
  var range = sh.getRange(lo, 1, hi - lo + 1, head.length);
  var v = range.getDisplayValues();
  list.forEach(function (o) {
    var row = v[o._row - lo];
    head.forEach(function (h, c) { if (h in o) row[c] = o[h]; });
  });
  range.setNumberFormat('@').setValues(v.map(function (r) { return r.map(cell_); }));
  delete tabCache_[name];
  readCacheDrop_(name);
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

/* ---------- 관리자 로그인에 쓰는 저장소 ---------- */

/** 스크립트 속성 (관리자 비밀번호의 해시 등). 시트에는 보이지 않습니다. */
function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function setProp_(key, value) { PropertiesService.getScriptProperties().setProperty(key, String(value)); }

/** 잠깐 기억해 두는 값 (관리자 로그인 열쇠, 비밀번호 틀린 횟수). 최대 6시간. */
function cacheGet_(key) { return CacheService.getScriptCache().get(key) || ''; }
function cachePut_(key, value, seconds) { CacheService.getScriptCache().put(key, String(value), Math.min(21600, seconds)); }
function cacheRemove_(key) { CacheService.getScriptCache().remove(key); }

function sha256_(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function withLock_(fn) {
  if (inLock_) return fn();   // 이미 잠금 안
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    throw new Error('지금 사용하는 사람이 많아요. 잠시 뒤에 다시 시도해 주세요.');
  }
  inLock_ = true;
  tabCache_ = {};   // 잠금 안에서는 늘 시트를 새로 읽음
  try {
    return fn();
  } finally {
    inLock_ = false;
    tabCache_ = {};
    lock.releaseLock();
  }
}

function today_() { return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ_, 'yyyy-MM-dd HH:mm:ss'); }
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function sheetUrl_() { return book_().getUrl(); }
