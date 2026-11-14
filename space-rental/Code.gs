/**
 * 학교 공간 대여 — 웹앱 서버 (구글시트에 묶인 앱스크립트)
 *
 * 화면에서 부르는 함수:
 *   getInit, getDay, getRoomRange, recommend, myBookings, searchBookings, getPhoto,
 *   createBooking, updateBooking, cancelBooking,
 *   adminLogin, adminLogout, adminBookings, getStats, getHistory, runLedgerSync
 *
 * 로그인 없이 누구나 씁니다. 화면이 모든 호출의 첫 인자로 who = {device, token} 을 보냅니다.
 * 관리 기능은 관리자 비밀번호로 로그인한 경우(token)에만 됩니다.
 *
 * 데이터는 Store.gs 의 readTab_/appendRows_/updateRows_ 로만 읽고 씁니다.
 * 모든 쓰기는 withLock_ 안에서 처리하고 [기록] 탭에 남깁니다.
 */

var MAX_REPEAT_COUNT = 80;   // 반복 예약 한 번에 만들 수 있는 최대 횟수
var HISTORY_LIMIT = 500;     // 관리 화면에 보여 주는 최근 기록 수

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('학교 공간 대여')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- 읽어서 다듬기 ---------- */

function settings_() {
  var s = {};
  readTab_('설정').forEach(function (r) { s[r['항목']] = r['값']; });
  return {
    school: s['학교이름'] || '우리 학교',
    notice: s['안내문'] || '',
    maxDays: Math.max(1, parseInt(s['예약가능일수'], 10) || 60),
    repeatMaxDays: Math.max(1, parseInt(s['반복예약최대일수'], 10) || 200),
    admin: s['관리자'] || ''   // 화면 위쪽에 보이는 관리자 이름
  };
}

/* ---------- 누가 부르는가 ----------
 * 로그인 없이 씁니다. 화면이 모든 호출에 who = {device, token} 을 함께 보냅니다.
 *   device: 브라우저마다 한 번 만들어 기억해 두는 임의의 번호. 사람이 아니라 기기를 구분합니다.
 *   token : 관리자 비밀번호로 로그인하면 받는 임시 열쇠 (6시간). 관리자 비밀번호는 [설정] 탭의 '관리자비밀번호'.
 */

var ADMIN_SESSION_SEC = 21600;   // 관리자 로그인 유지 시간 (6시간)
var ADMIN_MAX_FAILS = 5;         // 한 기기에서 연속으로 틀릴 수 있는 횟수
var ADMIN_LOCK_SEC = 600;        // 그 뒤 막는 시간 (10분)

function me_(who) {
  who = who || {};
  var device = String(who.device || '').replace(/[^\w-]/g, '').slice(0, 40);
  var token = String(who.token || '').replace(/[^\w-]/g, '').slice(0, 60);
  // 로그인할 때의 비밀번호가 지금 시트의 비밀번호와 같아야 관리자입니다 (시트에서 비밀번호를 바꾸면 모두 로그아웃됨).
  var stamp = token ? cacheGet_('adm_' + token) : '';
  var pw = stamp ? adminPassword_() : '';
  return { device: device, admin: !!stamp && !!pw && stamp === sha256_(pw), name: '' };
}

/** 관리자 비밀번호: [설정] 탭의 '관리자비밀번호' 값. 시트에서 바로 고칠 수 있습니다. */
function adminPassword_() {
  var pw = '';
  readTab_('설정').forEach(function (r) { if (String(r['항목']).trim() === '관리자비밀번호') pw = String(r['값']).trim(); });
  return pw;
}

/** 관리자 로그인. 맞으면 {token} 을 돌려줍니다. */
function adminLogin(who, password) {
  var me = me_(who);
  if (!me.device) throw new Error('기기 정보를 확인할 수 없어요. 화면을 새로 고쳐 주세요.');
  var lockKey = 'admlock_' + me.device, failKey = 'admfail_' + me.device;
  if (cacheGet_(lockKey) || +cacheGet_('admfail_all') >= 60) {
    throw new Error('비밀번호를 여러 번 틀려서 잠시 막혔어요. 10분쯤 뒤에 다시 시도해 주세요.');
  }
  var real = adminPassword_();
  if (!real) {
    throw new Error("관리자 비밀번호가 아직 정해지지 않았어요. 구글시트 [설정] 탭의 '관리자비밀번호' 값에 비밀번호를 적어 주세요.");
  }
  if (String(password == null ? '' : password) !== real) {
    var n = (+cacheGet_(failKey) || 0) + 1;
    cachePut_('admfail_all', String((+cacheGet_('admfail_all') || 0) + 1), ADMIN_LOCK_SEC);
    if (n >= ADMIN_MAX_FAILS) {
      cachePut_(lockKey, '1', ADMIN_LOCK_SEC);
      cacheRemove_(failKey);
      throw new Error('비밀번호를 ' + ADMIN_MAX_FAILS + '번 틀려서 10분 동안 막혔어요.');
    }
    cachePut_(failKey, String(n), ADMIN_LOCK_SEC);
    throw new Error('비밀번호가 맞지 않아요. (남은 기회 ' + (ADMIN_MAX_FAILS - n) + '번)');
  }
  cacheRemove_(failKey);
  var token = newId_() + newId_();
  cachePut_('adm_' + token, sha256_(real), ADMIN_SESSION_SEC);
  return { token: token, hours: ADMIN_SESSION_SEC / 3600 };
}

function adminLogout(who) {
  var token = String((who || {}).token || '').replace(/[^\w-]/g, '');
  if (token) cacheRemove_('adm_' + token);
  return true;
}

function rooms_() {
  return readTab_('공간').filter(function (r) { return r['ID'] && r['이름']; }).map(function (r) {
    return {
      id: r['ID'],
      building: r['건물'] || '본관',
      floor: r['층'] || '1',
      order: parseFloat(r['순서']) || 0,
      name: r['이름'],
      capacity: parseInt(r['수용인원'], 10) || 0,
      uses: splitList_(r['용도']),
      facilities: splitList_(r['시설']),
      note: r['특이사항'] || '',
      desc: r['소개'] || '',
      photos: splitList_(r['사진']),
      video: r['영상'] || '',
      bookable: !/^(n|no|x|아니오|불가)$/i.test(String(r['신청가능'] || 'Y').trim()),
      multi: Math.max(1, parseInt(r['동시예약수'], 10) || 1)   // 같은 시간에 함께 쓸 수 있는 팀 수
    };
  });
}

function periods_() {
  return readTab_('교시').filter(function (r) { return r['ID'] && r['이름']; }).map(function (r) {
    return { id: r['ID'], name: r['이름'], start: hhmm_(r['시작']), end: hhmm_(r['종료']) };
  });
}

function hhmm_(s) {
  var m = /(\d{1,2}):(\d{2})/.exec(String(s || ''));
  return m ? pad2_(+m[1]) + ':' + m[2] : '';
}

function bookings_() {
  return readTab_('예약').filter(function (r) { return r['ID']; }).map(function (r) {
    return {
      _row: r._row,
      id: r['ID'], groupId: r['묶음ID'] || '', roomId: r['공간ID'], date: r['날짜'],
      periods: splitList_(r['교시']),
      email: String(r['이메일'] || '').toLowerCase(), name: r['이름'] || '', role: r['역할'] || '', dept: r['소속'] || '',
      purpose: r['목적'] || '', people: parseInt(r['인원'], 10) || 0, status: r['상태'] || '',
      createdAt: r['신청일시'] || '', updatedAt: r['수정일시'] || '', handler: r['처리자'] || '', memo: r['비고'] || '',
      school: r['사용학교'] || '', unit: r['사용부서'] || '', shared: r['공동사용'] === 'Y', device: r['기기'] || ''
    };
  });
}

function bookingRow_(b) {
  var row = {
    'ID': b.id, '묶음ID': b.groupId, '공간ID': b.roomId, '날짜': b.date, '교시': b.periods.join(','),
    '이메일': b.email, '이름': b.name, '역할': b.role, '소속': b.dept,
    '목적': b.purpose, '인원': b.people, '상태': b.status,
    '신청일시': b.createdAt, '수정일시': b.updatedAt, '처리자': b.handler, '비고': b.memo,
    '사용학교': b.school || '', '사용부서': b.unit || '', '공동사용': b.shared ? 'Y' : '', '기기': b.device || ''
  };
  if (b._row) row._row = b._row;
  return row;
}

/** 화면으로 내보내는 예약. mine = 이 기기에서 신청한 예약 (수정·취소할 수 있음) */
function publicBooking_(b, me) {
  return {
    id: b.id, groupId: b.groupId, roomId: b.roomId, date: b.date, periods: b.periods, status: b.status,
    name: b.name, purpose: b.purpose, people: b.people, memo: b.memo, createdAt: b.createdAt, ledger: isLedger_(b),
    school: b.school, unit: b.unit, shared: !!b.shared,
    mine: !!me.device && b.device === me.device
  };
}

function byDateThenPeriod_(order) {
  return function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (order[a.periods[0]] || 0) - (order[b.periods[0]] || 0);
  };
}

function periodOrder_(periods) {
  var o = {};
  periods.forEach(function (p, i) { o[p.id] = i + 1; });
  return o;
}

function periodNames_(ids, periods) {
  var n = {};
  periods.forEach(function (p) { n[p.id] = p.name; });
  return ids.map(function (id) { return n[id] || id; }).join(', ');
}

function roomLabel_(room) {
  return room ? room.building + ' ' + floorLabel_(room.floor) + ' ' + room.name : '(삭제된 공간)';
}

function floorLabel_(f) {
  var m = /^[Bb](\d+)$/.exec(f);
  if (m) return '지하 ' + m[1] + '층';
  return /^\d+$/.test(f) ? f + '층' : f;
}

/* ---------- 기록 ---------- */

function snapshot_(b) {
  return JSON.stringify({
    공간ID: b.roomId, 날짜: b.date, 교시: b.periods.join(','), 사용학교: b.school || '', 사용부서: b.unit || '',
    목적: b.purpose, 인원: b.people, 함께사용: b.shared ? 'Y' : '', 상태: b.status, 신청자: b.name, 비고: b.memo
  });
}

function logRow_(me, action, before, after, ctx) {
  var b = after || before;
  var room = ctx.rooms.filter(function (r) { return r.id === b.roomId; })[0];
  return {
    '일시': nowStr_(), '이메일': me.email || '', '이름': me.admin ? '관리자' : (me.name || b.name || ''), '동작': action, '기기': me.device || '',
    '예약ID': b.id, '공간': roomLabel_(room), '날짜': b.date,
    '내용': periodNames_(b.periods, ctx.periods) + ' · ' + (b.school ? '[' + b.school + '] ' : '') + (b.unit ? b.unit + ' · ' : '') + b.purpose + (b.shared ? ' (함께 사용)' : '') + (b.people ? ' · ' + b.people + '명' : '') + ' · 신청자 ' + b.name + ' · ' + b.status,
    '변경전': before ? snapshot_(before) : '', '변경후': after ? snapshot_(after) : ''
  };
}

/* ---------- 읽기 API ---------- */

function getInit(who) {
  var me = me_(who);
  var now = nowStr_();
  var out = {
    me: { admin: me.admin }, settings: settings_(), rooms: rooms_(), periods: periods_(),
    today: today_(), now: now.slice(11, 16)
  };
  out.ledgerOn = ledgerOn_();
  if (me.admin) out.sheetUrl = sheetUrl_();
  return out;
}

/** 하루치 살아 있는 예약 (확정) */
function getDay(who, date) {
  if (!isDate_(date)) throw new Error('날짜가 올바르지 않아요.');
  var me = me_(who);
  return bookings_().filter(function (b) { return b.date === date && isActive_(b); })
    .map(function (b) { return publicBooking_(b, me); });
}

/** 한 공간의 기간(최대 1년) 안 살아 있는 예약 — 주간·월간·분기·연간 일정 요약용 */
function getRoomRange(who, roomId, from, to) {
  if (!isDate_(from) || !isDate_(to) || to < from) throw new Error('기간이 올바르지 않아요.');
  if (toUtc_(to) - toUtc_(from) > 370 * 86400000) throw new Error('한 번에 1년까지만 볼 수 있어요.');
  var me = me_(who);
  var order = periodOrder_(periods_());
  return bookings_().filter(function (b) {
    return b.roomId === roomId && b.date >= from && b.date <= to && isActive_(b);
  }).sort(byDateThenPeriod_(order)).map(function (b) { return publicBooking_(b, me); });
}

/** 조건에 맞는 공간을 이유와 함께 추천합니다. */
function recommend(who, q) {
  q = q || {};
  if (!isDate_(q.date)) throw new Error('날짜를 골라 주세요.');
  var day = bookings_().filter(function (b) { return b.date === q.date; });
  return recommend_(rooms_(), day, periods_(), q);
}

/** 이 기기에서 신청한 예약 (지난 1년 치부터) */
function myBookings(who) {
  var me = me_(who);
  if (!me.device) return [];
  var from = addDays_(today_(), -365);
  var order = periodOrder_(periods_());
  return bookings_().filter(function (b) { return b.device === me.device && b.date >= from; })
    .sort(byDateThenPeriod_(order))
    .map(function (b) { return publicBooking_(b, me); });
}

var SEARCH_LIMIT = 300;   // 예약 찾기 한 번에 보여 주는 최대 건수

/**
 * 예약 찾기. q = {school[], unit, name, from, to}
 * 사용 학교·부서·신청자 이름·기간으로 찾습니다. 부서와 이름은 일부만 적어도 됩니다.
 * 기간을 비우면 오늘부터 앞으로의 예약을 찾습니다.
 */
function searchBookings(who, q) {
  q = q || {};
  var me = me_(who);
  var norm = function (v) { return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ''); };
  var unit = norm(q.unit), name = norm(q.name);
  var asked = Array.isArray(q.school) ? q.school : splitList_(q.school);
  var schools = SCHOOLS_.filter(function (x) { return asked.indexOf(x) >= 0; });
  if (!unit && !name && !schools.length && !isDate_(q.from) && !isDate_(q.to)) {
    throw new Error('사용 학교, 부서, 이름, 기간 가운데 하나 이상을 넣어 주세요.');
  }
  var from = isDate_(q.from) ? q.from : (isDate_(q.to) ? addDays_(q.to, -365) : today_());
  var to = isDate_(q.to) ? q.to : addDays_(from, 365);
  if (to < from) throw new Error('기간이 올바르지 않아요.');
  var order = periodOrder_(periods_());
  var hits = bookings_().filter(function (b) {
    if (b.date < from || b.date > to || !isActive_(b)) return false;
    if (unit && norm(b.unit || (isLedger_(b) ? b.purpose : '')).indexOf(unit) < 0) return false;
    if (name && norm(b.name).indexOf(name) < 0) return false;
    if (schools.length) {
      var mine = (b.school || SCHOOL_DEFAULT_).split(',');
      if (!schools.some(function (x) { return mine.indexOf(x) >= 0; })) return false;
    }
    return true;
  }).sort(byDateThenPeriod_(order));
  return { total: hits.length, from: from, to: to, list: hits.slice(0, SEARCH_LIMIT).map(function (b) { return publicBooking_(b, me); }) };
}

/**
 * [공간] 탭에 등록된 드라이브 사진을 서버가 대신 읽어 돌려줍니다.
 * 사진이 "링크가 있는 모든 사용자"로 공유되어 있지 않아도, 배포한 계정이 볼 수 있으면 화면에 보입니다.
 * [공간] 탭에 적힌 사진만 읽을 수 있습니다.
 */
function getPhoto(who, fileId) {
  var id = String(fileId || '');
  var listed = rooms_().some(function (r) {
    return r.photos.some(function (u) { return driveId_(u) === id; });
  });
  if (!id || !listed) throw new Error('[공간] 탭에 등록된 사진이 아니에요.');
  return photoData_(id);
}

/* ---------- 쓰기 API ---------- */

function requireUser_(who) {
  var me = me_(who);
  if (!me.device) throw new Error('기기 정보를 확인할 수 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.');
  return me;
}

function requireAdmin_(who) {
  var me = me_(who);
  if (!me.admin) throw new Error('관리자 로그인이 필요해요. 관리 메뉴에서 비밀번호로 로그인해 주세요.');
  return me;
}

var SCHOOLS_ = ['중', '고', '법인'];

var MAX_ROOMS_AT_ONCE = 12;   // 한 번에 함께 신청할 수 있는 공간 수
var MAX_BOOKINGS_AT_ONCE = 240;   // 한 번에 만들 수 있는 예약 수 (공간 수 × 날짜 수)

/**
 * 한 칸(공간·날짜·교시)에 함께 들어갈 수 있는 예약 수.
 * [공간] 탭의 '동시예약수'가 2 이상인 공간은 '함께 사용'으로 신청한 예약이 그 수까지 들어갑니다.
 */
function slotCap_(room, shared) {
  return room && room.multi > 1 && shared ? room.multi : 1;
}

/** 같은 공간·날짜에서 want 교시 중 이미 꽉 찬 교시와, 겹치는 기존 예약들 */
function slotCheck_(all, room, date, want, shared, excludeId) {
  var same = all.filter(function (b) { return isActive_(b) && b.id !== excludeId && b.roomId === room.id && b.date === date; });
  var cap = slotCap_(room, shared);
  return {
    full: want.filter(function (p) {
      return same.filter(function (b) { return b.periods.indexOf(p) >= 0; }).length >= cap;
    }),
    over: same.filter(function (b) { return b.periods.some(function (p) { return want.indexOf(p) >= 0; }); })
  };
}

function dateLabel_(d) {
  var p = d.split('-');
  return (+p[1]) + '월 ' + (+p[2]) + '일(' + WEEKDAY_NAMES_[weekday_(d)] + ')';
}

function checkPeople_(people, room) {
  if (room.capacity && people > room.capacity) {
    throw new Error(room.name + '의 정원은 ' + room.capacity + '명이에요. 인원을 줄이거나 더 큰 공간을 골라 주세요.');
  }
}

/** 교시·사용학교·부서·목적·인원을 확인하고 정리해서 돌려줍니다. */
function cleanInput_(data, periods) {
  var order = periodOrder_(periods);
  var seen = {};
  var list = (data.periods || []).map(String).filter(function (p) {
    if (!order[p] || seen[p]) return false;
    seen[p] = true;
    return true;
  }).sort(function (a, b) { return order[a] - order[b]; });
  if (!list.length) throw new Error('사용할 교시를 한 개 이상 골라 주세요.');

  var asked = Array.isArray(data.school) ? data.school : splitList_(data.school);
  var school = SCHOOLS_.filter(function (x) { return asked.indexOf(x) >= 0; });
  if (!school.length) throw new Error('사용 학교(중·고·법인)를 한 개 이상 골라 주세요.');
  var unit = String(data.unit || '').trim().slice(0, 40);
  if (!unit) throw new Error('사용 부서를 적어 주세요.');

  var name = String(data.name || '').trim().slice(0, 20);
  if (!name) throw new Error('신청자 이름을 적어 주세요.');

  var purpose = String(data.purpose || '').trim().slice(0, 100);
  if (!purpose) throw new Error('사용 목적을 적어 주세요.');

  var people = parseInt(data.people, 10);
  if (!(people >= 1)) throw new Error('사용 예상 인원을 숫자로 적어 주세요.');
  return { periods: list, purpose: purpose, people: people, school: school.join(','), unit: unit, name: name };
}

/**
 * 예약 신청. 여러 공간을 같은 일정으로 한 번에 신청할 수 있습니다.
 * data = {roomId | roomIds[], date, periods[], school[], unit, purpose, people, shared,
 *         repeat: {until, weekdays[]} | null, skipConflicts, ackExisting}
 * - 반복 신청에서 자리가 없는 날(conflicts)이 있거나, 함께 사용으로 이미 다른 예약이 있는 시간(existing)에 신청하면
 *   {needConfirm, conflicts, existing, okCount} 를 돌려주고 아무것도 만들지 않습니다.
 *   skipConflicts·ackExisting 을 true 로 다시 부르면 자리가 없는 날을 빼고 만듭니다.
 * - 한 번에 두 건 이상 만들면 같은 묶음ID 를 주어 나중에 한꺼번에 취소할 수 있습니다.
 */
function createBooking(who, data) {
  data = data || {};
  return withLock_(function () {
    var me = requireUser_(who);
    var conf = settings_();
    var periods = periods_();
    var rooms = rooms_();
    var today = today_();

    var ids = [];
    (Array.isArray(data.roomIds) && data.roomIds.length ? data.roomIds : [data.roomId]).forEach(function (id) {
      id = String(id == null ? '' : id);
      if (id && ids.indexOf(id) < 0) ids.push(id);
    });
    if (!ids.length) throw new Error('공간을 찾을 수 없어요.');
    if (ids.length > MAX_ROOMS_AT_ONCE) throw new Error('한 번에 ' + MAX_ROOMS_AT_ONCE + '곳까지만 함께 신청할 수 있어요.');
    var targets = ids.map(function (id) {
      var room = rooms.filter(function (r) { return r.id === id; })[0];
      if (!room) throw new Error('공간을 찾을 수 없어요.');
      if (!room.bookable) throw new Error(room.name + '은(는) 신청을 받지 않는 공간이에요.');
      return room;
    });
    var many = targets.length > 1;

    if (!isDate_(data.date)) throw new Error('날짜가 올바르지 않아요.');
    if (data.date < today) throw new Error('지난 날짜는 신청할 수 없어요.');
    if (data.date > addDays_(today, conf.maxDays)) {
      throw new Error('오늘부터 ' + conf.maxDays + '일 뒤까지만 신청할 수 있어요.');
    }
    var input = cleanInput_(data, periods);
    targets.forEach(function (room) { checkPeople_(input.people, room); });
    var heads = tabHeaders_('예약');
    if (['사용학교', '사용부서', '공동사용', '기기'].some(function (h) { return heads.indexOf(h) < 0; })) {
      throw new Error("[예약] 탭에 새 열(사용학교·사용부서·공동사용·기기)이 없어요. 관리자가 앱스크립트 편집기에서 setup 을 한 번 더 실행해야 해요.");
    }

    var dates = [data.date];
    if (data.repeat) {
      var until = data.repeat.until;
      var days = (data.repeat.weekdays || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
      if (!isDate_(until) || until < data.date) throw new Error('반복 종료일은 시작일과 같거나 그 뒤여야 해요.');
      if (until > addDays_(today, conf.repeatMaxDays)) {
        throw new Error('반복 종료일은 오늘부터 ' + conf.repeatMaxDays + '일 뒤까지만 정할 수 있어요.');
      }
      if (!days.length) throw new Error('반복할 요일을 한 개 이상 골라 주세요.');
      dates = expandDates_(data.date, until, days);
      if (!dates.length) throw new Error('고른 기간 안에 해당 요일이 없어요.');
      if (dates.length > MAX_REPEAT_COUNT) {
        throw new Error('한 번에 ' + MAX_REPEAT_COUNT + '회까지만 반복할 수 있어요. (지금 ' + dates.length + '회) 기간을 줄여 주세요.');
      }
    }
    if (dates.length * targets.length > MAX_BOOKINGS_AT_ONCE) {
      throw new Error('한 번에 ' + MAX_BOOKINGS_AT_ONCE + '건까지만 신청할 수 있어요. (지금 ' + (dates.length * targets.length) + '건) 공간이나 기간을 줄여 주세요.');
    }

    var all = bookings_();
    var plan = [];        // 만들 예약: {room, date, shared, over[]}
    var conflicts = [];   // 자리가 없어 신청할 수 없는 곳
    var existing = [];    // 신청은 되지만 같은 시간에 이미 다른 예약이 있는 곳 (함께 사용)
    var hint = '';
    targets.forEach(function (room) {
      var shared = !!data.shared && room.multi > 1;
      dates.forEach(function (d) {
        var c = slotCheck_(all, room, d, input.periods, shared);
        if (c.full.length) {
          conflicts.push({ room: room.name, date: d, periods: periodNames_(c.full, periods) });
          if (!hint) {
            hint = shared ? '이미 ' + room.multi + '팀이 예약해서 자리가 없어요.'
              : room.multi > 1 && !slotCheck_(all, room, d, input.periods, true).full.length
                ? "다른 팀과 함께 쓰는 경우라면 '함께 사용'에 체크해 주세요. (최대 " + room.multi + '팀)'
                : '다른 교시나 공간을 골라 주세요.';
          }
          return;
        }
        plan.push({ room: room, date: d, shared: shared, over: c.over });
        if (c.over.length) {
          existing.push({
            room: room.name, date: d, max: room.multi,
            list: c.over.map(function (b) {
              return { periods: periodNames_(b.periods, periods), who: b.unit || b.name, school: b.school, purpose: b.purpose };
            })
          });
        }
      });
    });

    if (conflicts.length && !data.repeat) {
      throw new Error((many ? conflicts[0].room + ' ' : '') + conflicts[0].periods + '에 이미 예약이 있어요. ' + hint +
        (many ? ' (아무 공간도 신청하지 않았어요.)' : ''));
    }
    if (!plan.length) throw new Error('고른 날짜 모두 이미 예약이 있어요.');
    if ((conflicts.length && !data.skipConflicts) || (existing.length && !data.ackExisting)) {
      return { needConfirm: true, conflicts: conflicts, existing: existing, okCount: plan.length, many: many };
    }

    var status = '확정';   // 승인 절차 없이 신청하면 바로 확정
    var now = nowStr_();
    var ctx = { rooms: rooms, periods: periods };
    var groupId = plan.length > 1 ? 'G' + newId_() : '';
    var made = plan.map(function (x) {
      return {
        id: 'R' + newId_(), groupId: groupId, roomId: x.room.id, date: x.date, periods: input.periods,
        email: '', name: input.name, role: '', dept: '',
        purpose: input.purpose, people: input.people, status: status,
        createdAt: now, updatedAt: '', handler: '', memo: '',
        school: input.school, unit: input.unit, shared: x.shared, device: me.device
      };
    });
    var action = data.repeat ? '반복신청' : many ? '일괄신청' : '신청';
    appendRows_('예약', made.map(bookingRow_));
    appendRows_('기록', made.map(function (b) { return logRow_(me, action, null, b, ctx); }));

    return { created: made.length, status: status, skipped: conflicts, rooms: targets.length };
  });
}

/** [설정] 탭에 대장 주소가 적혀 있으면 자동 가져오기를 쓰는 것으로 봅니다. */
function ledgerOn_() {
  return readTab_('설정').some(function (r) { return /^대장주소/.test(String(r['항목'])) && String(r['값']).trim(); });
}

/** 대장에서 온 예약은 대장에서만 고칩니다 (웹에서 고쳐도 다음 가져오기 때 대장 값으로 돌아가므로). */
function refuseLedger_(b) {
  if (isLedger_(b) && ledgerOn_()) {
    throw new Error('기존 사용 대장에서 가져온 예약이에요. 대장(구글시트)에서 고치면 자동으로 반영돼요.');
  }
}

function findBooking_(all, id) {
  var b = all.filter(function (x) { return x.id === id; })[0];
  if (!b) throw new Error('예약을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
  return b;
}

/**
 * 예약은 누구나 고치고 취소할 수 있습니다 (로그인도 예약 비밀번호도 없음). 누가 했는지는 기록에 이름과 기기 번호로 남습니다.
 * 지난 날짜의 예약만 관리자가 아니면 바꿀 수 없습니다.
 */
function requireOwner_(b, me, today) {
  if (me.admin) return;
  if (b.date < today) throw new Error('지난 예약은 바꿀 수 없어요.');
}

/** 예약 수정: 교시·사용 학교·부서·목적·인원 */
function updateBooking(who, id, data) {
  data = data || {};
  return withLock_(function () {
    var me = requireUser_(who);
    var periods = periods_();
    var rooms = rooms_();
    var all = bookings_();
    var b = findBooking_(all, id);
    requireOwner_(b, me, today_());
    refuseLedger_(b);
    if (!isActive_(b)) throw new Error('이미 ' + b.status + '된 예약은 고칠 수 없어요.');

    var room = rooms.filter(function (r) { return r.id === b.roomId; })[0];
    if (!room) throw new Error('공간을 찾을 수 없어요.');
    var input = cleanInput_(data, periods);
    checkPeople_(input.people, room);
    var full = slotCheck_(all, room, b.date, input.periods, b.shared, b.id).full;
    if (full.length) throw new Error(periodNames_(full, periods) + '에 이미 다른 예약이 있어요.');

    var before = JSON.parse(JSON.stringify(b));
    b.periods = input.periods;
    b.purpose = input.purpose;
    b.people = input.people;
    b.school = input.school;
    b.unit = input.unit;
    b.name = input.name;
    b.updatedAt = nowStr_();
    updateRows_('예약', [bookingRow_(b)]);
    appendRows_('기록', [logRow_(me, '수정', before, b, { rooms: rooms, periods: periods })]);
    return { status: b.status };
  });
}

/**
 * 예약 취소. scope =
 *   'one'       이 예약만
 *   'following' 같은 묶음·같은 공간에서 이 날부터 남은 일정
 *   'room'      같은 묶음·같은 공간의 오늘 이후 일정 전부 (반복 예약 일괄 취소)
 *   'group'     같은 묶음의 오늘 이후 일정 전부 (함께 신청한 다른 공간까지)
 */
function cancelBooking(who, id, scope) {
  return withLock_(function () {
    var me = requireUser_(who);
    var all = bookings_();
    var b = findBooking_(all, id);
    requireOwner_(b, me, today_());
    refuseLedger_(b);
    if (!isActive_(b)) throw new Error('이미 ' + b.status + '된 예약이에요.');

    var targets = [b];
    if (b.groupId && (scope === 'following' || scope === 'room' || scope === 'group')) {
      var from = scope === 'following' ? b.date : today_();
      targets = all.filter(function (x) {
        return x.groupId === b.groupId && isActive_(x) && x.date >= from && (scope === 'group' || x.roomId === b.roomId);
      });
      if (!targets.length) targets = [b];
    }
    var ctx = { rooms: rooms_(), periods: periods_() };
    var now = nowStr_();
    var logs = targets.map(function (x) {
      var before = JSON.parse(JSON.stringify(x));
      x.status = '취소';
      x.updatedAt = now;
      x.handler = me.admin ? '관리자' : (x.device && x.device === me.device ? '' : '다른 기기');   // 신청한 기기가 아닌 곳에서 취소했는지
      return logRow_(me, '취소', before, x, ctx);
    });
    updateRows_('예약', targets.map(bookingRow_));
    appendRows_('기록', logs);
    return { cancelled: targets.length };
  });
}

/* ---------- 관리자 API ---------- */

/** 겹친 예약과, 기간 안의 모든 예약 */
function adminBookings(who, q) {
  var me = requireAdmin_(who);
  q = q || {};
  var today = today_();
  var from = isDate_(q.from) ? q.from : today;
  var to = isDate_(q.to) ? q.to : addDays_(today, 30);
  var order = periodOrder_(periods_());
  var all = bookings_().sort(byDateThenPeriod_(order));
  var roomOf = {};
  rooms_().forEach(function (r) { roomOf[r.id] = r; });
  var capOf = function (roomId) { return slotCap_(roomOf[roomId], true); };
  var withEmail = function (b) {
    var p = publicBooking_(b, me);
    p.device = b.device;
    p.handler = b.handler;
    return p;
  };
  return {
    from: from, to: to,
    ledgerOn: ledgerOn_(), sync: ledgerStatus_(),
    clashes: findClashes_(all, today, capOf).map(function (c) {
      return { roomId: c.roomId, date: c.date, periods: c.periods, a: withEmail(c.a), b: withEmail(c.b) };
    }),
    list: all.filter(function (b) { return b.date >= from && b.date <= to; }).map(withEmail)
  };
}

/**
 * 승인 대기 기능을 없애기 전에 들어온 '승인대기' 예약을 모두 '확정'으로 바꿉니다.
 * 편집기에서 한 번 실행하세요. 바뀐 예약은 [기록] 탭에 '확정전환'으로 남습니다.
 */
function confirmPending() {
  return withLock_(function () {
    var all = bookings_().filter(function (b) { return b.status === '승인대기'; });
    if (!all.length) { console.log('승인 대기 중인 예약이 없습니다.'); return 0; }
    var who = { email: String(Session.getEffectiveUser().getEmail() || ''), name: '승인 대기 정리' };
    var ctx = { rooms: rooms_(), periods: periods_() };
    var now = nowStr_();
    var logs = all.map(function (x) {
      var before = JSON.parse(JSON.stringify(x));
      x.status = '확정';
      x.updatedAt = now;
      return logRow_(who, '확정전환', before, x, ctx);
    });
    updateRows_('예약', all.map(bookingRow_));
    appendRows_('기록', logs);
    console.log('승인 대기 예약 ' + all.length + '건을 확정으로 바꿨습니다.');
    return all.length;
  });
}

/** 통계용: 기간(최대 1년) 안의 살아 있는 예약 전체. 관리자만. */
function getStats(who, from, to) {
  var me = requireAdmin_(who);
  if (!isDate_(from) || !isDate_(to) || to < from) throw new Error('기간이 올바르지 않아요.');
  if (toUtc_(to) - toUtc_(from) > 370 * 86400000) throw new Error('한 번에 1년까지만 볼 수 있어요.');
  return bookings_().filter(function (b) { return isActive_(b) && b.date >= from && b.date <= to; })
    .map(function (b) { return publicBooking_(b, me); });
}

/** 관리자가 화면에서 누르는 "지금 가져오기" */
function runLedgerSync(who) {
  requireAdmin_(who);
  return syncLedger();
}

/** 최근 기록 (새것부터). q = 검색어 */
function getHistory(who, q) {
  requireAdmin_(who);
  var word = String(q || '').trim().toLowerCase();
  var rows = readTab_('기록').slice().reverse();
  if (word) {
    rows = rows.filter(function (r) {
      return [r['일시'], r['이메일'], r['기기'], r['이름'], r['동작'], r['공간'], r['날짜'], r['내용']]
        .join(' ').toLowerCase().indexOf(word) >= 0;
    });
  }
  return rows.slice(0, HISTORY_LIMIT).map(function (r) {
    return {
      at: r['일시'], email: r['이메일'], device: r['기기'] || '', name: r['이름'], action: r['동작'], bookingId: r['예약ID'],
      room: r['공간'], date: r['날짜'], text: r['내용'], before: r['변경전'], after: r['변경후']
    };
  });
}
