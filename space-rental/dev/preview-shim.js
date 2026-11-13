/**
 * 미리보기 전용: 브라우저 안에서 실제 서버 코드(Code.gs)를 가짜 저장소로 돌리고
 * google.script.run 을 흉내 냅니다. 데이터는 이 브라우저(localStorage)에만 저장됩니다.
 */
(function () {
  var KEY = 'space-rental-preview-v3';
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && saved.db) { MOCK.db = saved.db; MOCK.user = saved.user || MOCK.user; MOCK.seq = saved.seq || 0; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ db: MOCK.db, user: MOCK.user, seq: MOCK.seq })); } catch (e) {}
  }
  MOCK.onSave = save;

  if (!saved) {
    mockReset_();
    MOCK.db['설정'].forEach(function (r) { if (r['항목'] === '관리자') r['값'] = '(예시) 홍길동T'; });
    var t = today_();
    var seed = [
      ['teacher@school.example', { roomId: 'A102', date: t, periods: ['P3', 'P4'], school: ['고'], unit: '진로상담부', purpose: '(예시) 진로 특강', people: 90 }],
      ['teacher@school.example', { roomId: 'A103', date: t, periods: ['PL'], school: ['고'], unit: '국어과', purpose: '(예시) 독서 토론', people: 12 }],
      ['teacher@school.example', { roomId: 'A202', date: t, periods: ['P6', 'P7'], school: ['고'], unit: '수학과', purpose: '(예시) 교과 협의회', people: 8 }],
      ['student@school.example', { roomId: 'A203', date: t, periods: ['PA'], school: ['고'], unit: '과학 동아리', purpose: '(예시) 동아리 발표 준비', people: 6 }],
      ['student2@school.example', { roomId: 'A403', date: addDays_(t, 1), periods: ['PA'], school: ['고'], unit: '댄스 동아리', purpose: '(예시) 댄스 동아리 연습', people: 15,
        repeat: { until: addDays_(t, 21), weekdays: [weekday_(addDays_(t, 1))] } }],
      ['teacher@school.example', { roomId: 'A401', date: t, periods: ['P1', 'P2', 'P3', 'P4', 'P5'], school: ['고'], unit: '음악과', purpose: '(예시) 합창 연습', people: 30 }],
      ['teacher@school.example', { roomId: 'C101', date: t, periods: ['P2', 'P3'], school: ['고'], unit: '1학년 체육', purpose: '(예시) 배구', people: 30, shared: true }],
      ['teacher@school.example', { roomId: 'C101', date: t, periods: ['P3'], school: ['중'], unit: '중 2학년 체육', purpose: '(예시) 농구', people: 28, shared: true, ackExisting: true }]
    ];
    var me = MOCK.user;
    seed.forEach(function (s) { MOCK.user = s[0]; try { createBooking(s[1]); } catch (e) {} });
    MOCK.user = me;
    save();
  }

  var server = { getInit: getInit, getDay: getDay, recommend: recommend, createBooking: createBooking,
    updateBooking: updateBooking, cancelBooking: cancelBooking, myBookings: myBookings,
    adminBookings: adminBookings, getHistory: getHistory, getPhoto: getPhoto, getRoomRange: getRoomRange, runLedgerSync: runLedgerSync };

  function runner(ok, bad) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, bad); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    Object.keys(server).forEach(function (name) {
      r[name] = function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          var out;
          try { out = server[name].apply(null, args); } catch (e) { if (bad) bad(e); return; }
          if (ok) ok(out === undefined ? null : JSON.parse(JSON.stringify(out)));
        }, 120);
      };
    });
    return r;
  }
  window.google = { script: { run: runner(null, null) } };

  window.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.style.cssText = 'background:#111;color:#fff;font:12px/1.4 sans-serif;padding:6px 12px;display:flex;gap:8px;align-items:center;justify-content:center';
    var users = MOCK.db['사용자'].map(function (u) { return [u['이메일'], u['이름'] + ' · ' + u['역할']]; });
    users.push(['nobody@school.example', '미등록 계정']);
    bar.innerHTML = '<span>미리보기</span><select aria-label="미리보기 계정" style="font:inherit;border-radius:6px;padding:2px">' + users.map(function (u) {
      return '<option value="' + u[0] + '"' + (u[0] === MOCK.user ? ' selected' : '') + '>' + u[1] + '</option>';
    }).join('') + '</select><button type="button" style="font:inherit;border-radius:6px;border:0;padding:2px 6px">초기화</button>';
    bar.querySelector('select').onchange = function () { MOCK.user = this.value; save(); location.reload(); };
    bar.querySelector('button').onclick = function () { localStorage.removeItem(KEY); location.reload(); };
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();
