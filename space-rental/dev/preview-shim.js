/**
 * 미리보기 전용: 브라우저 안에서 실제 서버 코드(Code.gs)를 가짜 저장소로 돌리고
 * google.script.run 을 흉내 냅니다. 데이터는 이 브라우저(localStorage)에만 저장됩니다.
 * 미리보기의 관리자 비밀번호는 preview1234 입니다.
 */
(function () {
  var KEY = 'space-rental-preview-v4';
  var PREVIEW_PW = 'preview1234';
  var DEVICES = [['preview-device-a', '기기 A (홍길동 선생님)'], ['preview-device-b', '기기 B (다른 사람)']];
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && saved.db) { MOCK.db = saved.db; MOCK.seq = saved.seq || 0; MOCK.props = saved.props || {}; MOCK.cache = saved.cache || {}; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ db: MOCK.db, seq: MOCK.seq, props: MOCK.props, cache: MOCK.cache })); } catch (e) {}
  }
  MOCK.onSave = save;
  // 화면이 쓰는 기기 번호를 미리보기용으로 고정 (화면 스크립트보다 먼저 실행됨)
  try {
    var dev = localStorage.getItem('space.device');
    if (!DEVICES.some(function (d) { return d[0] === dev; })) localStorage.setItem('space.device', DEVICES[0][0]);
  } catch (e) {}

  if (!saved) {
    mockReset_();
    MOCK.db['설정'].forEach(function (r) { if (r['항목'] === '관리자') r['값'] = '(예시) 홍길동T'; });
    setProp_('ADMIN_SALT', 'preview');
    setProp_('ADMIN_HASH', sha256_('preview' + PREVIEW_PW));
    var t = today_(), A = { device: DEVICES[0][0] }, B = { device: DEVICES[1][0] };
    var seed = [
      [A, { roomId: 'A102', date: t, periods: ['P3', 'P4'], school: ['고'], unit: '진로상담부', name: '홍길동', purpose: '(예시) 진로 특강', people: 90 }],
      [A, { roomId: 'A103', date: t, periods: ['PL'], school: ['고'], unit: '국어과', name: '홍길동', purpose: '(예시) 독서 토론', people: 12 }],
      [A, { roomId: 'A202', date: t, periods: ['P6', 'P7'], school: ['고'], unit: '수학과', name: '홍길동', purpose: '(예시) 교과 협의회', people: 8 }],
      [B, { roomId: 'A203', date: t, periods: ['PA'], school: ['고'], unit: '과학 동아리', name: '김영희', purpose: '(예시) 동아리 발표 준비', people: 6 }],
      [B, { roomId: 'A403', date: addDays_(t, 1), periods: ['PA'], school: ['고'], unit: '댄스 동아리', name: '김영희', purpose: '(예시) 댄스 동아리 연습', people: 15,
        repeat: { until: addDays_(t, 21), weekdays: [weekday_(addDays_(t, 1))] } }],
      [A, { roomId: 'A401', date: t, periods: ['P1', 'P2', 'P3', 'P4', 'P5'], school: ['고'], unit: '음악과', name: '홍길동', purpose: '(예시) 합창 연습', people: 30 }],
      [A, { roomId: 'C101', date: t, periods: ['P2', 'P3'], school: ['고'], unit: '1학년부', name: '홍길동', purpose: '(예시) 배구', people: 30, shared: true }],
      [B, { roomId: 'C101', date: t, periods: ['P3'], school: ['중'], unit: '중 2학년부', name: '박철수', purpose: '(예시) 농구', people: 28, shared: true, ackExisting: true }]
    ];
    seed.forEach(function (s) { try { createBooking(s[0], s[1]); } catch (e) {} });
    save();
  }

  var server = { getInit: getInit, getDay: getDay, getRoomRange: getRoomRange, recommend: recommend, myBookings: myBookings,
    searchBookings: searchBookings, getPhoto: getPhoto, createBooking: createBooking, updateBooking: updateBooking,
    cancelBooking: cancelBooking, adminLogin: adminLogin, adminLogout: adminLogout, adminBookings: adminBookings,
    getStats: getStats, getHistory: getHistory, runLedgerSync: runLedgerSync };

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
          save();
          if (ok) ok(out === undefined ? null : JSON.parse(JSON.stringify(out)));
        }, 120);
      };
    });
    return r;
  }
  window.google = { script: { run: runner(null, null) } };

  window.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.style.cssText = 'background:#111;color:#fff;font:12px/1.4 sans-serif;padding:6px 12px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap';
    var cur = '';
    try { cur = localStorage.getItem('space.device'); } catch (e) {}
    bar.innerHTML = '<span>미리보기</span><select aria-label="미리보기 기기" style="font:inherit;border-radius:6px;padding:2px">' + DEVICES.map(function (d) {
      return '<option value="' + d[0] + '"' + (d[0] === cur ? ' selected' : '') + '>' + d[1] + '</option>';
    }).join('') + '</select><span>관리자 비밀번호: ' + PREVIEW_PW + '</span><button type="button" style="font:inherit;border-radius:6px;border:0;padding:2px 6px">초기화</button>';
    bar.querySelector('select').onchange = function () { localStorage.setItem('space.device', this.value); location.reload(); };
    bar.querySelector('button').onclick = function () {
      ['space.device', 'space.admin', 'space.school', 'space.unit', 'space.name', KEY].forEach(function (k) { localStorage.removeItem(k); });
      location.reload();
    };
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();
