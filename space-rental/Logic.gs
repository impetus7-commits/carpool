/**
 * 학교 공간 대여 — 순수 계산 (시트·로그인과 무관)
 * 날짜 계산, 예약 겹침 판단, 반복 날짜 펼치기, 공간 추천
 */

// '승인대기'는 예전 데이터용 (confirmPending 으로 확정 전환). 남아 있는 동안에도 자리는 잡습니다.
var ACTIVE_STATUS_ = ['확정', '승인대기'];
var WEEKDAY_NAMES_ = ['일', '월', '화', '수', '목', '금', '토'];

function splitList_(s) {
  return String(s == null ? '' : s).split(/[,\n;、]+/)
    .map(function (x) { return x.trim(); })
    .filter(Boolean);
}

/** 구글 드라이브 주소에서 파일 ID 를 꺼냅니다. 드라이브 주소가 아니면 '' */
function driveId_(url) {
  var m = /drive\.google\.com\/.*(?:\/d\/|[?&]id=)([\w-]{20,})/.exec(String(url || ''));
  return m ? m[1] : '';
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function toUtc_(s) {
  var p = String(s).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function fromUtc_(t) {
  var d = new Date(t);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function isDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && fromUtc_(toUtc_(s)) === s;
}

function addDays_(s, n) { return fromUtc_(toUtc_(s) + n * 86400000); }

/** 0=일 … 6=토 */
function weekday_(s) { return new Date(toUtc_(s)).getUTCDay(); }

/** start~until 사이에서 weekdays(0~6)에 해당하는 날짜들 */
function expandDates_(start, until, weekdays) {
  var out = [];
  for (var d = start; d <= until; d = addDays_(d, 1)) {
    if (weekdays.indexOf(weekday_(d)) >= 0) out.push(d);
  }
  return out;
}

function isActive_(b) { return ACTIVE_STATUS_.indexOf(b.status) >= 0; }

/** want = {roomId, date, periods[]} 와 겹치는 살아 있는 예약들 */
function findConflicts_(bookings, want, excludeId) {
  return bookings.filter(function (b) {
    return isActive_(b) && b.id !== excludeId &&
      b.roomId === want.roomId && b.date === want.date &&
      b.periods.some(function (p) { return want.periods.indexOf(p) >= 0; });
  });
}

function looseMatch_(list, word) {
  var w = String(word).toLowerCase().replace(/\s+/g, '');
  if (!w) return false;
  return list.some(function (x) {
    var v = String(x).toLowerCase().replace(/\s+/g, '');
    return v && (v.indexOf(w) >= 0 || w.indexOf(v) >= 0);
  });
}

/**
 * 공간 추천.
 * q = {periods[], people, purpose, facilities[], keyword}
 * dayBookings = 해당 날짜의 예약들, periods = [{id,name}]
 * 반환: [{roomId, ok, score, reasons[], warnings[]}] — 조건에 맞는 것부터, 점수 높은 순
 */
function recommend_(rooms, dayBookings, periods, q) {
  var nameOf = {};
  periods.forEach(function (p) { nameOf[p.id] = p.name; });
  var want = (q.periods || []).filter(function (p) { return nameOf[p]; });
  var people = Math.max(0, parseInt(q.people, 10) || 0);
  var purpose = String(q.purpose || '').trim();
  var needs = (q.facilities || []).filter(Boolean);
  var words = String(q.keyword || '').split(/[\s,]+/).filter(Boolean);

  var out = [];
  rooms.forEach(function (r) {
    if (!r.bookable) return;
    var x = { roomId: r.id, ok: true, score: 0, reasons: [], warnings: [] };

    if (want.length) {
      var busy = {};
      dayBookings.forEach(function (b) {
        if (isActive_(b) && b.roomId === r.id) b.periods.forEach(function (p) { busy[p] = true; });
      });
      var taken = want.filter(function (p) { return busy[p]; });
      if (taken.length) {
        x.ok = false;
        x.warnings.push(taken.map(function (p) { return nameOf[p]; }).join(', ') + '에 이미 예약이 있어요');
      } else {
        x.score += 40;
        x.reasons.push(want.map(function (p) { return nameOf[p]; }).join(', ') + ' 비어 있음');
      }
    }

    if (people) {
      if (!r.capacity) {
        x.warnings.push('수용 인원 정보가 없어요');
      } else if (r.capacity < people) {
        x.ok = false;
        x.warnings.push('정원 ' + r.capacity + '명으로 ' + people + '명이 쓰기에는 좁아요');
      } else {
        var ratio = people / r.capacity;
        if (ratio >= 0.5) {
          x.score += 25;
          x.reasons.push(people + '명에게 알맞은 크기 (정원 ' + r.capacity + '명)');
        } else if (ratio >= 0.25) {
          x.score += 12;
          x.reasons.push(people + '명이 여유 있게 사용 (정원 ' + r.capacity + '명)');
        } else {
          x.score += 3;
          x.reasons.push('수용은 되지만 인원에 비해 큰 공간 (정원 ' + r.capacity + '명)');
        }
      }
    }

    if (purpose) {
      if (looseMatch_(r.uses, purpose)) {
        x.score += 30;
        x.reasons.push("'" + purpose + "' 용도로 쓰는 공간");
      } else {
        x.score -= 5;
        x.warnings.push("'" + purpose + "' 용도로 등록된 공간은 아니에요");
      }
    }

    needs.forEach(function (f) {
      if (looseMatch_(r.facilities, f)) {
        x.score += 15;
        x.reasons.push(f + ' 있음');
      } else {
        x.ok = false;
        x.score -= 15;
        x.warnings.push(f + ' 없음');
      }
    });

    words.forEach(function (w) {
      var where = looseMatch_([r.name], w) ? '이름'
        : looseMatch_(r.uses, w) ? '용도'
        : looseMatch_(r.facilities, w) ? '시설'
        : (r.note + ' ' + r.desc).toLowerCase().indexOf(w.toLowerCase()) >= 0 ? '소개' : '';
      if (where) {
        x.score += 10;
        x.reasons.push("검색어 '" + w + "'가 " + where + '에 있음');
      }
    });

    if (r.note && x.ok) x.warnings.push('특이사항: ' + r.note);
    x.capacity = r.capacity;
    x.name = r.name;
    out.push(x);
  });

  out.sort(function (a, b) {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (a.capacity !== b.capacity) return (a.capacity || 1e9) - (b.capacity || 1e9);
    return a.name < b.name ? -1 : 1;
  });
  out.forEach(function (x) { delete x.capacity; delete x.name; });
  return out;
}

/* ---------- 기존 사용 대장 자동 가져오기 (계산 부분) ---------- */

var SYNC_MEMO_ = '기존 사용 대장에서 옮김';
// 대장의 C~K 칸과 그 뒤 한 칸(L) → 교시 이름. 시간대로 적힌 대장도 같은 자리의 교시로 옮깁니다.
var SYNC_SLOTS_ = ['1교시', '2교시', '3교시', '4교시', '점심', '5교시', '6교시', '7교시', '방과후', '야간'];

/** 대장에서 옮겨 온 예약인지 */
function isLedger_(b) { return String(b.id).indexOf('L-') === 0 && b.memo === SYNC_MEMO_; }

function ledgerKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s()\[\]{}（）·・.,_\-\/]/g, '');
}

/** 이름에서 찾을 열쇠들: 전체, 괄호 밖, 괄호 안, 끝의 '실'을 뗀 것 */
function ledgerNames_(name) {
  var keys = [ledgerKey_(name)];
  var m = /^(.*?)[(（](.*?)[)）]\s*$/.exec(String(name));
  if (m) { keys.push(ledgerKey_(m[1])); keys.push(ledgerKey_(m[2])); }
  keys.slice().forEach(function (k) { if (/실$/.test(k)) keys.push(k.slice(0, -1)); });
  return keys.filter(function (k, i) { return k.length >= 2 && keys.indexOf(k) === i; });
}

// 대장의 시트 이름과 [공간] 탭의 이름이 다른 곳: 대장 시트 이름 → 공간 이름
// ([설정] 탭에 '대장짝:시트이름' 줄을 넣어 더하거나 바꿀 수 있습니다.)
var SYNC_ALIASES_ = { '스쿨캠핑': '작은정원' };

/**
 * 대장의 시트 이름마다 [공간] 탭의 줄을 찾습니다.
 * rooms = [{id, name}], aliases = {대장 시트 이름: 공간 이름} → [{title, room | null, how}]
 */
function ledgerMatchRooms_(titles, rooms, aliases) {
  var rs = rooms.map(function (r) { return { id: r.id, name: r.name, keys: ledgerNames_(r.name) }; });
  var out = titles.map(function (t) { return { title: t, keys: ledgerNames_(t), room: null, how: '' }; });
  var used = {};
  var take = function (m, hit, how) {
    if (hit.length === 1) { m.room = { id: hit[0].id, name: hit[0].name }; m.how = how; used[hit[0].id] = true; }
    else if (hit.length > 1) m.how = '이름이 비슷한 공간이 ' + hit.length + '개';
  };
  // 0) 따로 정해 둔 짝 (대장 시트 이름과 공간 이름이 다른 곳). 정해 둔 공간이 없으면 아래 규칙으로 찾습니다.
  var alias = {};
  Object.keys(aliases || {}).forEach(function (k) { alias[ledgerKey_(k)] = ledgerKey_(aliases[k]); });
  out.forEach(function (m) {
    var want = alias[m.keys[0]];
    if (!want) return;
    var hit = rs.filter(function (r) { return !used[r.id] && r.keys.indexOf(want) >= 0; });
    if (hit.length === 1) take(m, hit, '정해 둔 짝');
  });
  // 1) 전체 이름이 같은 것
  out.forEach(function (m) {
    if (m.room) return;
    take(m, rs.filter(function (r) { return !used[r.id] && r.keys[0] === m.keys[0]; }), '이름 일치');
  });
  // 2) 괄호 안팎·'실'을 뗀 이름이 같은 것
  out.forEach(function (m) {
    if (m.room || m.how) return;
    take(m, rs.filter(function (r) {
      return !used[r.id] && r.keys.some(function (k) { return m.keys.indexOf(k) >= 0; });
    }), '이름 일치');
  });
  // 3) 이름이 들어 있는 것 — 후보가 하나뿐이고, 그 공간을 노리는 다른 시트가 없을 때만
  out.forEach(function (m) {
    if (m.room || m.how) return;
    var k = m.keys[0];
    var near = function (key, r) { return r.keys[0].length >= 3 && (r.keys[0].indexOf(key) >= 0 || key.indexOf(r.keys[0]) >= 0); };
    var hit = rs.filter(function (r) { return !used[r.id] && near(k, r); });
    if (hit.length === 1) {
      var rivals = out.filter(function (o) { return o !== m && !o.room && near(o.keys[0], hit[0]); });
      if (rivals.length) return;
    }
    take(m, hit, '비슷한 이름');
  });
  return out.map(function (m) { return { title: m.title, room: m.room, how: m.how }; });
}

/**
 * 대장 한 시트의 줄들 → 날짜별 칸 내용.
 * grid = [[날짜('yyyy-MM-dd' 또는 ''), 칸0 … 칸9], …]  (위에서 아래 순서)
 * from 이후 날짜만. 같은 날짜가 두 번 나오면 아래쪽 줄만 씁니다 (위쪽은 지난 학년도).
 */
function ledgerRows_(grid, from) {
  var days = {};
  grid.forEach(function (row) {
    var d = row[0];
    if (!isDate_(d) || d < from) return;
    days[d] = SYNC_SLOTS_.map(function (x, i) {
      return String(row[i + 1] == null ? '' : row[i + 1]).split(/\s+/).filter(Boolean).join(' ').slice(0, 100);
    });
  });
  return Object.keys(days).sort().map(function (d) { return { date: d, slots: days[d] }; });
}

/** 날짜별 칸 내용 → 예약들. 이어진 칸에 같은 내용이 있으면 한 건으로 묶습니다. */
function ledgerBookings_(rows, roomId, slotIds) {
  var out = [];
  rows.forEach(function (r) {
    var i = 0;
    while (i < r.slots.length) {
      if (!r.slots[i]) { i++; continue; }
      var j = i;
      while (j + 1 < r.slots.length && r.slots[j + 1] === r.slots[i]) j++;
      var ids = slotIds.slice(i, j + 1);
      out.push({
        id: 'L-' + roomId + '-' + r.date.replace(/-/g, '') + '-' + ids[0],
        roomId: roomId, date: r.date, periods: ids, purpose: r.slots[i]
      });
      i = j + 1;
    }
  });
  return out;
}

/** 지금 [예약] 탭에 있는 대장 예약(existing)과 대장에서 방금 읽은 것(desired)의 차이 */
function ledgerDiff_(existing, desired) {
  var have = {}, want = {};
  existing.forEach(function (b) { have[b.id] = b; });
  desired.forEach(function (b) { want[b.id] = b; });
  var same = function (a, b) {
    return a.roomId === b.roomId && a.date === b.date && a.purpose === b.purpose &&
      a.periods.join(',') === b.periods.join(',') && a.status === '확정';
  };
  return {
    add: desired.filter(function (b) { return !have[b.id]; }),
    remove: existing.filter(function (b) { return !want[b.id]; }),
    change: desired.filter(function (b) { return have[b.id] && !same(have[b.id], b); })
      .map(function (b) { return { before: have[b.id], after: b }; })
  };
}

/**
 * 적힌 글에서 사용 학교(중·고·법인) 표시를 찾습니다. 표시가 없으면 '' (schoolFor_ 는 이때 고등학교로 봅니다).
 * 예: "중학교 법교육" → 중, "동아리(고)" → 고, "중3 리허설" → 중, "고/수업(음악과)" → 고, "중+고 합동" → 중,고
 * "중간고사", "집중", "고사" 처럼 낱말 속에 들어 있는 글자는 세지 않습니다.
 */
var SCHOOL_DEFAULT_ = '고';   // 글에 중학교·법인 표시가 없으면 고등학교로 봅니다

/** 적힌 글로 학교를 정합니다. 표시가 없으면 고등학교. */
function schoolFor_(text) { return inferSchool_(text) || SCHOOL_DEFAULT_; }

function inferSchool_(text) {
  var t = ' ' + String(text == null ? '' : text) + ' ';
  var solo = function (ch) {   // 앞뒤가 띄어쓰기·기호·숫자인 한 글자
    return new RegExp('[\\s(\\[,·/+*~]' + ch + '(?=[\\s\\d/\\-+):(\\],·~]|$)').test(t);
  };
  var out = [];
  // 중학교 표시: "중학교", "중1·중2·중3", "(중)", 따로 떨어진 "중" (예: "중 영화 상영", "중/수업")
  if (/중학교|중등|중[1-3]/.test(t) || solo('중')) out.push('중');
  if (/고등학교|고교/.test(t) || solo('고')) out.push('고');
  if (/법인/.test(t)) out.push('법인');
  return out.join(',');
}

/**
 * from 이후 날짜에서 같은 공간·날짜·교시에 허용 수보다 많이 겹쳐 있는 살아 있는 예약 쌍.
 * capOf(roomId, periodId) = 그 칸에 함께 들어갈 수 있는 예약 수 (없으면 1)
 */
function findClashes_(bookings, from, capOf) {
  var groups = {};
  bookings.forEach(function (b) {
    if (!isActive_(b) || b.date < from) return;
    var k = b.roomId + '|' + b.date;
    (groups[k] || (groups[k] = [])).push(b);
  });
  var out = [];
  Object.keys(groups).sort().forEach(function (k) {
    var g = groups[k];
    for (var i = 0; i < g.length; i++) {
      for (var j = i + 1; j < g.length; j++) {
        var both = g[i].periods.filter(function (p) {
          if (g[j].periods.indexOf(p) < 0) return false;
          var n = g.filter(function (b) { return b.periods.indexOf(p) >= 0; }).length;
          return n > (capOf ? capOf(g[i].roomId, p) : 1);
        });
        if (both.length) out.push({ roomId: g[i].roomId, date: g[i].date, periods: both, a: g[i], b: g[j] });
      }
    }
  });
  return out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    splitList_: splitList_, isDate_: isDate_, addDays_: addDays_, weekday_: weekday_,
    expandDates_: expandDates_, findConflicts_: findConflicts_, recommend_: recommend_
  };
}
