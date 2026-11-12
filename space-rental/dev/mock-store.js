/**
 * Store.gs 대신 쓰는 가짜 저장소 (메모리). 테스트와 미리보기 전용 — 앱스크립트에는 올리지 않습니다.
 * Setup.gs 의 TABS_, SAMPLE_ 뒤에 불러야 합니다.
 */

var MOCK = { db: null, user: 'admin@school.example', now: null, seq: 0, onSave: null };

var MOCK_USERS_ = [
  ['admin@school.example', '김관리', '관리자', '교육과정부'],
  ['teacher@school.example', '이선생', '교직원', '수학과'],
  ['student@school.example', '박학생', '학생', '2학년 3반'],
  ['student2@school.example', '최학생', '학생', '1학년 5반']
];

function mockReset_() {
  MOCK.db = {};
  Object.keys(TABS_).forEach(function (name) {
    var rows = name === '사용자' ? MOCK_USERS_ : (SAMPLE_[name] || []);
    MOCK.db[name] = rows.map(function (arr) {
      var o = {};
      TABS_[name].forEach(function (h, i) { o[h] = String(arr[i] == null ? '' : arr[i]); });
      return o;
    });
  });
}

function readTab_(name) {
  if (!MOCK.db) mockReset_();
  return MOCK.db[name].map(function (r, i) {
    var o = { _row: i + 2 };
    Object.keys(r).forEach(function (k) { o[k] = r[k]; });
    return o;
  });
}

function appendRows_(name, objs) {
  if (!MOCK.db) mockReset_();
  objs.forEach(function (o) {
    var r = {};
    TABS_[name].forEach(function (h) { r[h] = o[h] == null ? '' : String(o[h]); });
    MOCK.db[name].push(r);
  });
  if (MOCK.onSave) MOCK.onSave();
}

function updateRows_(name, list) {
  list.forEach(function (o) {
    var r = MOCK.db[name][o._row - 2];
    TABS_[name].forEach(function (h) { if (h in o) r[h] = String(o[h] == null ? '' : o[h]); });
  });
  if (MOCK.onSave) MOCK.onSave();
}

function currentEmail_() { return MOCK.user; }
function withLock_(fn) { return fn(); }

function mockNow_() { return MOCK.now ? new Date(MOCK.now) : new Date(); }
function today_() {
  var d = mockNow_();
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}
function nowStr_() {
  var d = mockNow_();
  return today_() + ' ' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes()) + ':' + pad2_(d.getSeconds());
}
function newId_() { return ('000000' + (++MOCK.seq)).slice(-6) + Math.random().toString(36).slice(2, 6).toUpperCase(); }
function sheetUrl_() { return '#'; }
function photoData_(id) { return 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; }
