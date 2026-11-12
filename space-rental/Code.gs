/**
 * 학교 공간 대여 — 웹앱 서버 (구글시트에 묶인 앱스크립트)
 *
 * 화면에서 부르는 함수:
 *   getInit, getDay, recommend, createBooking, updateBooking, cancelBooking,
 *   myBookings, adminBookings, decide, getHistory
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
    repeatMaxDays: Math.max(1, parseInt(s['반복예약최대일수'], 10) || 200)
  };
}

function me_() {
  var email = currentEmail_();
  var me = { email: email, name: '', role: '', dept: '', registered: false, admin: false };
  if (!email) return me;
  var row = readTab_('사용자').filter(function (u) {
    return String(u['이메일']).toLowerCase() === email;
  })[0];
  if (!row) return me;
  var role = String(row['역할'] || '');
  me.role = role.indexOf('관리') >= 0 ? '관리자' : role.indexOf('학생') >= 0 ? '학생' : '교직원';
  me.name = row['이름'] || email.split('@')[0];
  me.dept = row['소속'] || '';
  me.registered = true;
  me.admin = me.role === '관리자';
  return me;
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
      bookable: !/^(n|no|x|아니오|불가)$/i.test(String(r['신청가능'] || 'Y').trim())
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
      createdAt: r['신청일시'] || '', updatedAt: r['수정일시'] || '', handler: r['처리자'] || '', memo: r['비고'] || ''
    };
  });
}

function bookingRow_(b) {
  var row = {
    'ID': b.id, '묶음ID': b.groupId, '공간ID': b.roomId, '날짜': b.date, '교시': b.periods.join(','),
    '이메일': b.email, '이름': b.name, '역할': b.role, '소속': b.dept,
    '목적': b.purpose, '인원': b.people, '상태': b.status,
    '신청일시': b.createdAt, '수정일시': b.updatedAt, '처리자': b.handler, '비고': b.memo
  };
  if (b._row) row._row = b._row;
  return row;
}

/** 화면으로 내보내는 예약. 등록되지 않은 계정에는 이름과 목적을 가립니다. */
function publicBooking_(b, me) {
  var open = me.registered;
  return {
    id: b.id, groupId: b.groupId, roomId: b.roomId, date: b.date, periods: b.periods, status: b.status,
    name: open ? b.name : '', dept: open ? b.dept : '', role: open ? b.role : '',
    purpose: open ? b.purpose : '', people: open ? b.people : 0,
    memo: open ? b.memo : '', createdAt: open ? b.createdAt : '',
    mine: !!me.email && b.email === me.email
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
    공간ID: b.roomId, 날짜: b.date, 교시: b.periods.join(','), 목적: b.purpose, 인원: b.people,
    상태: b.status, 신청자: b.name, 비고: b.memo
  });
}

function logRow_(me, action, before, after, ctx) {
  var b = after || before;
  var room = ctx.rooms.filter(function (r) { return r.id === b.roomId; })[0];
  return {
    '일시': nowStr_(), '이메일': me.email, '이름': me.name, '동작': action,
    '예약ID': b.id, '공간': roomLabel_(room), '날짜': b.date,
    '내용': periodNames_(b.periods, ctx.periods) + ' · ' + b.purpose + ' · ' + b.people + '명 · 신청자 ' + b.name + ' · ' + b.status,
    '변경전': before ? snapshot_(before) : '', '변경후': after ? snapshot_(after) : ''
  };
}

/* ---------- 읽기 API ---------- */

function getInit() {
  var me = me_();
  var now = nowStr_();
  var out = {
    me: me, settings: settings_(), rooms: rooms_(), periods: periods_(),
    today: today_(), now: now.slice(11, 16)
  };
  if (me.admin) out.sheetUrl = sheetUrl_();
  return out;
}

/** 하루치 살아 있는 예약 (확정·승인대기) */
function getDay(date) {
  if (!isDate_(date)) throw new Error('날짜가 올바르지 않아요.');
  var me = me_();
  return bookings_().filter(function (b) { return b.date === date && isActive_(b); })
    .map(function (b) { return publicBooking_(b, me); });
}

/** 조건에 맞는 공간을 이유와 함께 추천합니다. */
function recommend(q) {
  q = q || {};
  if (!isDate_(q.date)) throw new Error('날짜를 골라 주세요.');
  var day = bookings_().filter(function (b) { return b.date === q.date; });
  return recommend_(rooms_(), day, periods_(), q);
}

function myBookings() {
  var me = me_();
  if (!me.registered) return [];
  var from = addDays_(today_(), -30);
  var order = periodOrder_(periods_());
  return bookings_().filter(function (b) { return b.email === me.email && b.date >= from; })
    .sort(byDateThenPeriod_(order))
    .map(function (b) { return publicBooking_(b, me); });
}

/* ---------- 쓰기 API ---------- */

function requireUser_() {
  var me = me_();
  if (!me.email) throw new Error('로그인한 계정을 확인할 수 없어요. 학교 구글 계정으로 로그인했는지 확인해 주세요.');
  if (!me.registered) throw new Error('등록되지 않은 계정(' + me.email + ')이에요. 관리자에게 등록을 요청해 주세요.');
  return me;
}

function requireAdmin_() {
  var me = requireUser_();
  if (!me.admin) throw new Error('관리자만 할 수 있어요.');
  return me;
}

/** 교시·목적·인원을 확인하고 정리해서 돌려줍니다. */
function cleanInput_(data, room, periods) {
  var order = periodOrder_(periods);
  var seen = {};
  var list = (data.periods || []).map(String).filter(function (p) {
    if (!order[p] || seen[p]) return false;
    seen[p] = true;
    return true;
  }).sort(function (a, b) { return order[a] - order[b]; });
  if (!list.length) throw new Error('사용할 교시를 한 개 이상 골라 주세요.');

  var purpose = String(data.purpose || '').trim().slice(0, 100);
  if (!purpose) throw new Error('사용 목적을 적어 주세요.');

  var people = parseInt(data.people, 10);
  if (!(people >= 1)) throw new Error('사용 인원을 숫자로 적어 주세요.');
  if (room.capacity && people > room.capacity) {
    throw new Error(room.name + '의 정원은 ' + room.capacity + '명이에요. 인원을 줄이거나 더 큰 공간을 골라 주세요.');
  }
  return { periods: list, purpose: purpose, people: people };
}

function conflictText_(list, want, periods) {
  var taken = {};
  list.forEach(function (b) {
    b.periods.forEach(function (p) { if (want.indexOf(p) >= 0) taken[p] = true; });
  });
  return periodNames_(want.filter(function (p) { return taken[p]; }), periods);
}

/**
 * 예약 신청.
 * data = {roomId, date, periods[], purpose, people, repeat: {until, weekdays[]} | null, skipConflicts}
 * 반복 예약에서 겹치는 날이 있으면 {needConfirm, conflicts, okCount} 를 돌려주고 아무것도 만들지 않습니다.
 * skipConflicts 를 true 로 다시 부르면 겹치는 날을 빼고 만듭니다.
 */
function createBooking(data) {
  data = data || {};
  return withLock_(function () {
    var me = requireUser_();
    var conf = settings_();
    var periods = periods_();
    var rooms = rooms_();
    var today = today_();

    var room = rooms.filter(function (r) { return r.id === data.roomId; })[0];
    if (!room) throw new Error('공간을 찾을 수 없어요.');
    if (!room.bookable) throw new Error(room.name + '은(는) 신청을 받지 않는 공간이에요.');
    if (!isDate_(data.date)) throw new Error('날짜가 올바르지 않아요.');
    if (data.date < today) throw new Error('지난 날짜는 신청할 수 없어요.');
    if (data.date > addDays_(today, conf.maxDays)) {
      throw new Error('오늘부터 ' + conf.maxDays + '일 뒤까지만 신청할 수 있어요.');
    }
    var input = cleanInput_(data, room, periods);

    var dates = [data.date];
    var groupId = '';
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
      if (dates.length > 1) groupId = 'G' + newId_();
    }

    var all = bookings_();
    var okDates = [];
    var conflicts = [];
    dates.forEach(function (d) {
      var hit = findConflicts_(all, { roomId: room.id, date: d, periods: input.periods });
      if (hit.length) conflicts.push({ date: d, periods: conflictText_(hit, input.periods, periods) });
      else okDates.push(d);
    });

    if (conflicts.length && !data.repeat) {
      throw new Error(conflicts[0].periods + '에 이미 예약이 있어요. 다른 교시나 공간을 골라 주세요.');
    }
    if (!okDates.length) throw new Error('고른 날짜 모두 이미 예약이 있어요.');
    if (conflicts.length && !data.skipConflicts) {
      return { needConfirm: true, conflicts: conflicts, okCount: okDates.length };
    }

    var status = me.role === '학생' ? '승인대기' : '확정';
    var now = nowStr_();
    var ctx = { rooms: rooms, periods: periods };
    var made = okDates.map(function (d) {
      return {
        id: 'R' + newId_(), groupId: groupId, roomId: room.id, date: d, periods: input.periods,
        email: me.email, name: me.name, role: me.role, dept: me.dept,
        purpose: input.purpose, people: input.people, status: status,
        createdAt: now, updatedAt: '', handler: '', memo: ''
      };
    });
    appendRows_('예약', made.map(bookingRow_));
    appendRows_('기록', made.map(function (b) { return logRow_(me, groupId ? '반복신청' : '신청', null, b, ctx); }));
    return { created: made.length, status: status, skipped: conflicts };
  });
}

function findBooking_(all, id) {
  var b = all.filter(function (x) { return x.id === id; })[0];
  if (!b) throw new Error('예약을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
  return b;
}

function requireOwner_(b, me, today) {
  if (me.admin) return;
  if (b.email !== me.email) throw new Error('본인이 신청한 예약만 바꿀 수 있어요.');
  if (b.date < today) throw new Error('지난 예약은 바꿀 수 없어요.');
}

/** 예약 수정: 교시·목적·인원. 학생이 교시를 바꾸면 다시 승인 대기가 됩니다. */
function updateBooking(id, data) {
  data = data || {};
  return withLock_(function () {
    var me = requireUser_();
    var periods = periods_();
    var rooms = rooms_();
    var all = bookings_();
    var b = findBooking_(all, id);
    requireOwner_(b, me, today_());
    if (!isActive_(b)) throw new Error('이미 ' + b.status + '된 예약은 고칠 수 없어요.');

    var room = rooms.filter(function (r) { return r.id === b.roomId; })[0];
    if (!room) throw new Error('공간을 찾을 수 없어요.');
    var input = cleanInput_(data, room, periods);
    var hit = findConflicts_(all, { roomId: b.roomId, date: b.date, periods: input.periods }, b.id);
    if (hit.length) throw new Error(conflictText_(hit, input.periods, periods) + '에 이미 다른 예약이 있어요.');

    var before = JSON.parse(JSON.stringify(b));
    var moved = input.periods.join(',') !== b.periods.join(',');
    b.periods = input.periods;
    b.purpose = input.purpose;
    b.people = input.people;
    b.updatedAt = nowStr_();
    if (moved && b.role === '학생' && !me.admin) {
      b.status = '승인대기';
      b.handler = '';
    }
    updateRows_('예약', [bookingRow_(b)]);
    appendRows_('기록', [logRow_(me, '수정', before, b, { rooms: rooms, periods: periods })]);
    return { status: b.status };
  });
}

/** 예약 취소. scope = 'one' (이 날만) | 'following' (반복 예약에서 이 날부터 남은 일정 모두) */
function cancelBooking(id, scope) {
  return withLock_(function () {
    var me = requireUser_();
    var all = bookings_();
    var b = findBooking_(all, id);
    requireOwner_(b, me, today_());
    if (!isActive_(b)) throw new Error('이미 ' + b.status + '된 예약이에요.');

    var targets = [b];
    if (scope === 'following' && b.groupId) {
      targets = all.filter(function (x) {
        return x.groupId === b.groupId && x.date >= b.date && isActive_(x);
      });
    }
    var ctx = { rooms: rooms_(), periods: periods_() };
    var now = nowStr_();
    var logs = targets.map(function (x) {
      var before = JSON.parse(JSON.stringify(x));
      x.status = '취소';
      x.updatedAt = now;
      x.handler = me.email === x.email ? '' : me.name;
      return logRow_(me, '취소', before, x, ctx);
    });
    updateRows_('예약', targets.map(bookingRow_));
    appendRows_('기록', logs);
    return { cancelled: targets.length };
  });
}

/* ---------- 관리자 API ---------- */

/** 승인 대기 전체와, 기간 안의 모든 예약 */
function adminBookings(q) {
  var me = requireAdmin_();
  q = q || {};
  var today = today_();
  var from = isDate_(q.from) ? q.from : today;
  var to = isDate_(q.to) ? q.to : addDays_(today, 30);
  var order = periodOrder_(periods_());
  var all = bookings_().sort(byDateThenPeriod_(order));
  var withEmail = function (b) {
    var p = publicBooking_(b, me);
    p.email = b.email;
    p.handler = b.handler;
    return p;
  };
  return {
    from: from, to: to,
    pending: all.filter(function (b) { return b.status === '승인대기'; }).map(withEmail),
    list: all.filter(function (b) { return b.date >= from && b.date <= to; }).map(withEmail)
  };
}

/** 승인·반려. scope = 'one' | 'group' (같은 반복 예약의 승인 대기 전체) */
function decide(id, approve, reason, scope) {
  return withLock_(function () {
    var me = requireAdmin_();
    var all = bookings_();
    var b = findBooking_(all, id);
    if (b.status !== '승인대기') throw new Error('승인 대기 중인 예약이 아니에요. (현재: ' + b.status + ')');
    var targets = [b];
    if (scope === 'group' && b.groupId) {
      targets = all.filter(function (x) { return x.groupId === b.groupId && x.status === '승인대기'; });
    }
    var ctx = { rooms: rooms_(), periods: periods_() };
    var now = nowStr_();
    var memo = String(reason || '').trim().slice(0, 100);
    var logs = targets.map(function (x) {
      var before = JSON.parse(JSON.stringify(x));
      x.status = approve ? '확정' : '반려';
      x.updatedAt = now;
      x.handler = me.name;
      if (memo) x.memo = memo;
      return logRow_(me, approve ? '승인' : '반려', before, x, ctx);
    });
    updateRows_('예약', targets.map(bookingRow_));
    appendRows_('기록', logs);
    return { done: targets.length };
  });
}

/** 최근 기록 (새것부터). q = 검색어 */
function getHistory(q) {
  requireAdmin_();
  var word = String(q || '').trim().toLowerCase();
  var rows = readTab_('기록').slice().reverse();
  if (word) {
    rows = rows.filter(function (r) {
      return [r['일시'], r['이메일'], r['이름'], r['동작'], r['공간'], r['날짜'], r['내용']]
        .join(' ').toLowerCase().indexOf(word) >= 0;
    });
  }
  return rows.slice(0, HISTORY_LIMIT).map(function (r) {
    return {
      at: r['일시'], email: r['이메일'], name: r['이름'], action: r['동작'], bookingId: r['예약ID'],
      room: r['공간'], date: r['날짜'], text: r['내용'], before: r['변경전'], after: r['변경후']
    };
  });
}
