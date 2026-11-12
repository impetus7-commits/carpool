/**
 * 학교 공간 대여 — 순수 계산 (시트·로그인과 무관)
 * 날짜 계산, 예약 겹침 판단, 반복 날짜 펼치기, 공간 추천
 */

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

if (typeof module !== 'undefined') {
  module.exports = {
    splitList_: splitList_, isDate_: isDate_, addDays_: addDays_, weekday_: weekday_,
    expandDates_: expandDates_, findConflicts_: findConflicts_, recommend_: recommend_
  };
}
