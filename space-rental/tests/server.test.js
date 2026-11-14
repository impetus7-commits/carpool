const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../dev/load.js');

const ADMIN = 'admin@school.example';
const TEACHER = 'teacher@school.example';
const STUDENT = 'student@school.example';
const STUDENT2 = 'student2@school.example';

// 로그인이 없으므로 "누가"는 기기 번호로 구분합니다. 테스트에서는 s.MOCK.user 를 바꾸면 다른 기기가 됩니다.
// ADMIN 은 관리자 비밀번호로 로그인한 기기입니다.
const API = ['getInit', 'getDay', 'getRoomRange', 'recommend', 'myBookings', 'searchBookings', 'getPhoto',
  'createBooking', 'updateBooking', 'cancelBooking', 'adminLogin', 'adminLogout', 'adminBookings', 'getStats', 'getHistory', 'runLedgerSync'];
const ADMIN_PW = 'school-pw-1234';

// 2026-11-12 는 목요일
function server(user) {
  const raw = loadServer();
  raw.MOCK.now = '2026-11-12T10:00:00';
  raw.MOCK.user = user || TEACHER;
  raw.setProp_('ADMIN_SALT', 'salt');
  raw.setProp_('ADMIN_HASH', raw.sha256_('salt' + ADMIN_PW));
  let token = '';
  const who = () => {
    const u = raw.MOCK.user;
    const w = { device: 'dev-' + u.split('@')[0] };
    if (u === ADMIN) {
      if (!token) token = raw.adminLogin(w, ADMIN_PW).token;
      w.token = token;
    }
    return w;
  };
  return new Proxy(raw, {
    get(t, k) { return k === 'raw' ? t : API.includes(k) ? (...a) => t[k](who(), ...a) : t[k]; },   // s.raw = who 를 직접 넘기는 원래 서버
    set(t, k, v) { t[k] = v; return true; },
  });
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const base = (extra) => Object.assign(
  { roomId: 'A202', date: '2026-11-13', periods: ['P5', 'P6'], school: ['고'], unit: '수학과', name: '이선생', purpose: '동아리 회의', people: 10 }, extra);

test('날짜 계산과 반복 날짜 펼치기', () => {
  const s = server();
  assert.equal(s.isDate_('2026-02-30'), false);
  assert.equal(s.addDays_('2026-12-31', 1), '2027-01-01');
  assert.equal(s.weekday_('2026-11-12'), 4);
  assert.deepEqual(plain(s.expandDates_('2026-11-12', '2026-11-26', [2, 4])),
    ['2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']);
});

test('신청하면 즉시 확정되고 기록이 남는다', () => {
  const s = server(TEACHER);
  const r = s.createBooking(base());
  assert.equal(r.created, 1);
  assert.equal(r.status, '확정');
  const day = plain(s.getDay('2026-11-13'));
  assert.equal(day.length, 1);
  assert.equal(day[0].mine, true);
  assert.deepEqual(day[0].periods, ['P5', 'P6']);
  s.MOCK.user = ADMIN;
  const h = plain(s.getHistory(''));
  assert.equal(h.length, 1);
  assert.equal(h[0].action, '신청');
  assert.equal(h[0].name, '이선생');
  assert.match(h[0].room, /본관 2층 세미나실 1/);
});

test('누가 신청해도 승인 없이 바로 확정된다', () => {
  const s = server(STUDENT);
  assert.equal(s.createBooking(base()).status, '확정');
  assert.equal(plain(s.getDay('2026-11-13'))[0].status, '확정');
  assert.equal(typeof s.decide, 'undefined', '승인·반려 기능은 없다');
  s.MOCK.user = ADMIN;
  assert.equal(plain(s.adminBookings({})).pending, undefined);
});

test('예전 승인대기 예약은 confirmPending 으로 한 번에 확정한다 (그동안에도 자리는 잡는다)', () => {
  const s = server(TEACHER);
  s.createBooking(base());
  s.createBooking(base({ periods: ['P1'] }));
  s.MOCK.db['예약'].forEach((r) => { r['상태'] = '승인대기'; });
  s.MOCK.user = STUDENT;
  assert.throws(() => s.createBooking(base({ periods: ['P6'] })), /6교시에 이미 예약/);
  s.MOCK.user = ADMIN;
  assert.equal(s.confirmPending(), 2);
  assert.deepEqual(plain(s.getDay('2026-11-13')).map((b) => b.status), ['확정', '확정']);
  assert.equal(plain(s.getHistory('확정전환')).length, 2);
  assert.equal(s.confirmPending(), 0);
});

test('겹치는 교시는 신청할 수 없다', () => {
  const s = server(STUDENT);
  s.createBooking(base());
  s.MOCK.user = TEACHER;
  assert.throws(() => s.createBooking(base({ periods: ['P6', 'P7'] })), /6교시에 이미 예약/);
  assert.equal(s.createBooking(base({ periods: ['P7'] })).created, 1);
  assert.equal(s.createBooking(base({ roomId: 'A203' })).created, 1);
});

test('입력 검증: 지난 날짜, 정원 초과, 신청 불가 공간, 빈 목적·이름', () => {
  const s = server(TEACHER);
  assert.throws(() => s.createBooking(base({ name: ' ' })), /신청자 이름/);
  assert.throws(() => s.createBooking(base({ date: '2026-11-11' })), /지난 날짜/);
  assert.throws(() => s.createBooking(base({ date: '2027-03-01' })), /60일 뒤까지만/);
  assert.throws(() => s.createBooking(base({ people: 21 })), /정원은 20명/);
  assert.throws(() => s.createBooking(base({ roomId: 'A101' })), /신청을 받지 않는/);
  assert.throws(() => s.createBooking(base({ purpose: '  ' })), /사용 목적/);
  assert.throws(() => s.createBooking(base({ periods: ['없는교시'] })), /교시를 한 개 이상/);
});

test('반복 예약: 기간 안의 요일마다 만들고, 겹치는 날은 확인 후 건너뛴다', () => {
  const s = server(TEACHER);
  s.createBooking(base({ date: '2026-11-19', periods: ['P6'] })); // 둘째 목요일 선점
  const repeat = { until: '2026-12-03', weekdays: [4] };
  const ask = plain(s.createBooking(base({ date: '2026-11-12', repeat })));
  assert.equal(ask.needConfirm, true);
  assert.equal(ask.okCount, 3);
  assert.deepEqual(ask.conflicts, [{ room: '세미나실 1', date: '2026-11-19', periods: '6교시' }]);
  assert.equal(plain(s.myBookings()).length, 1, '확인 전에는 아무것도 만들지 않는다');

  const r = plain(s.createBooking(base({ date: '2026-11-12', repeat, skipConflicts: true })));
  assert.equal(r.created, 3);
  const mine = plain(s.myBookings()).filter((b) => b.groupId);
  assert.deepEqual(mine.map((b) => b.date), ['2026-11-12', '2026-11-26', '2026-12-03']);
  assert.equal(new Set(mine.map((b) => b.groupId)).size, 1);

  // 이 날부터 남은 일정 모두 취소
  assert.equal(s.cancelBooking(mine[1].id, 'following').cancelled, 2);
  const left = plain(s.myBookings()).filter((b) => b.groupId && b.status === '확정');
  assert.deepEqual(left.map((b) => b.date), ['2026-11-12']);
});

test('반복 예약 검증: 요일 없음, 종료일 오류, 횟수 초과', () => {
  const s = server(TEACHER);
  assert.throws(() => s.createBooking(base({ repeat: { until: '2026-12-01', weekdays: [] } })), /요일을 한 개 이상/);
  assert.throws(() => s.createBooking(base({ repeat: { until: '2026-11-01', weekdays: [1] } })), /종료일/);
  assert.throws(() => s.createBooking(base({ repeat: { until: '2026-11-14', weekdays: [1] } })), /해당 요일이 없어요/);
  assert.throws(() => s.createBooking(base({ repeat: { until: '2028-01-01', weekdays: [1] } })), /200일 뒤까지만/);
  assert.throws(() => s.createBooking(base({ repeat: { until: '2027-05-01', weekdays: [1, 2, 3, 4, 5] } })), /80회까지만/);
});

test('수정·취소는 신청한 기기와 관리자만, 모든 변경은 기록에 남는다', () => {
  const s = server(STUDENT);
  s.createBooking(base());
  const id = plain(s.myBookings())[0].id;

  s.MOCK.user = STUDENT2;
  assert.throws(() => s.updateBooking(id, base()), /이 기기에서 신청한 예약만/);
  assert.throws(() => s.cancelBooking(id, 'one'), /이 기기에서 신청한 예약만/);

  s.MOCK.user = STUDENT;
  assert.equal(s.updateBooking(id, base({ purpose: '발표 연습' })).status, '확정');
  assert.equal(s.updateBooking(id, base({ periods: ['P7'] })).status, '확정', '교시를 바꿔도 확정 그대로');
  s.cancelBooking(id, 'one');
  assert.throws(() => s.cancelBooking(id, 'one'), /이미 취소/);
  assert.equal(plain(s.getDay('2026-11-13')).length, 0);

  s.MOCK.user = ADMIN;
  const h = plain(s.getHistory(''));
  assert.deepEqual(h.map((x) => x.action), ['취소', '수정', '수정', '신청']);
  assert.equal(JSON.parse(h[1].before)['교시'], 'P5,P6');
  assert.equal(JSON.parse(h[1].after)['교시'], 'P7');
  assert.equal(plain(s.getHistory('발표')).length >= 1, true);
});

test('수정할 때 다른 예약과 겹치면 막는다', () => {
  const s = server(TEACHER);
  s.createBooking(base({ periods: ['P5'] }));
  s.createBooking(base({ periods: ['P6'] }));
  const first = plain(s.myBookings())[0];
  assert.throws(() => s.updateBooking(first.id, base({ periods: ['P5', 'P6'] })), /6교시에 이미 다른 예약/);
  assert.equal(s.updateBooking(first.id, base({ periods: ['P4', 'P5'] })).status, '확정');
});

test('관리 기능은 관리자 비밀번호로 로그인해야 쓸 수 있다', () => {
  const s = server(TEACHER);
  s.createBooking(base());
  const init = plain(s.getInit());
  assert.equal(init.me.admin, false);
  assert.equal(init.sheetUrl, undefined);
  assert.equal(plain(s.getDay('2026-11-13'))[0].name, '이선생', '예약 현황은 누구나 본다');
  assert.throws(() => s.getHistory(''), /관리자 로그인이 필요/);
  assert.throws(() => s.adminBookings({}), /관리자 로그인이 필요/);
  assert.throws(() => s.getStats('2026-11-01', '2026-11-30'), /관리자 로그인이 필요/);

  // 비밀번호가 틀리면 남은 기회를 알려 주고, 5번 틀리면 그 기기를 10분 막는다
  const raw = s.raw, dev = { device: 'dev-x' };
  assert.throws(() => raw.adminLogin(dev, 'wrong'), /맞지 않아요. \(남은 기회 4번\)/);
  for (let i = 0; i < 3; i++) assert.throws(() => raw.adminLogin(dev, 'wrong'), /맞지 않아요/);
  assert.throws(() => raw.adminLogin(dev, 'wrong'), /5번 틀려서 10분 동안 막혔어요/);
  assert.throws(() => raw.adminLogin(dev, ADMIN_PW), /잠시 막혔어요/, '막힌 동안에는 맞는 비밀번호도 안 된다');

  // 다른 기기에서 맞게 넣으면 로그인되고, 로그아웃하면 다시 막힌다
  const mine = { device: 'dev-y' };
  mine.token = raw.adminLogin(mine, ADMIN_PW).token;
  assert.ok(mine.token.length >= 20);
  assert.equal(raw.me_(mine).admin, true);
  assert.equal(plain(raw.getInit(mine)).me.admin, true);
  assert.equal(raw.me_({ device: 'dev-z', token: 'guess' }).admin, false, '지어낸 열쇠는 통하지 않는다');
  raw.adminLogout(mine);
  assert.equal(raw.me_(mine).admin, false);

  // 비밀번호를 정하지 않았으면 로그인할 수 없고, [설정] 탭에 적어 둔 값으로도 로그인할 수 있다
  raw.MOCK.props = {};
  assert.throws(() => raw.adminLogin({ device: 'dev-q' }, 'anything'), /아직 정해지지 않았어요/);
  raw.MOCK.db['설정'].push({ '항목': '관리자비밀번호', '값': 'sheet-pw', '설명': '' });
  assert.ok(raw.adminLogin({ device: 'dev-q' }, 'sheet-pw').token);
});

test('추천: 빈 시간·인원·용도·시설로 고르고 이유를 붙인다', () => {
  const s = server(TEACHER);
  s.createBooking(base({ roomId: 'A202', periods: ['P5'] }));
  const list = plain(s.recommend({
    date: '2026-11-13', periods: ['P5'], people: 14, purpose: '토론', facilities: ['전자칠판'], keyword: ''
  }));
  const top = list[0];
  assert.equal(top.roomId, 'A203', '세미나실 2: 16명, 토론, 전자칠판, 비어 있음');
  assert.equal(top.ok, true);
  assert.ok(top.reasons.some((x) => /5교시 비어 있음/.test(x)));
  assert.ok(top.reasons.some((x) => /14명에게 알맞은 크기/.test(x)));
  assert.ok(top.reasons.some((x) => /'토론' 용도/.test(x)));
  assert.ok(top.reasons.some((x) => /전자칠판 있음/.test(x)));

  const taken = list.find((x) => x.roomId === 'A202');
  assert.equal(taken.ok, false);
  assert.ok(taken.warnings.some((x) => /5교시에 이미 예약/.test(x)));
  const small = list.find((x) => x.roomId === 'B202');
  assert.equal(small.ok, false);
  assert.ok(small.warnings.some((x) => /정원 12명/.test(x)));
  assert.equal(list.some((x) => x.roomId === 'A101'), false, '신청 불가 공간은 추천하지 않는다');
  assert.ok(list.findIndex((x) => !x.ok) > list.findIndex((x) => x.ok));
});

test('추천: 검색어로 찾는다', () => {
  const s = server(TEACHER);
  const list = plain(s.recommend({ date: '2026-11-13', periods: [], people: 0, purpose: '', facilities: [], keyword: '피아노' }));
  assert.equal(list[0].roomId, 'A401');
  assert.ok(list[0].reasons.some((x) => /'피아노'가 시설에 있음/.test(x)));
});

test('사진: [공간] 탭에 등록된 드라이브 파일만 서버가 대신 읽어 준다', () => {
  const s = server(TEACHER);
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  s.mockReset_();
  s.MOCK.db['공간'][1]['사진'] = 'https://drive.google.com/file/d/' + id + '/view?usp=sharing, https://drive.google.com/open?id=2AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.match(s.getPhoto(id), /^data:image\//);
  assert.match(s.getPhoto('2AbCdEfGhIjKlMnOpQrStUvWxYz012345'), /^data:image\//);
  assert.throws(() => s.getPhoto('9ZZZdEfGhIjKlMnOpQrStUvWxYz012345'), /등록된 사진이 아니에요/);
  assert.throws(() => s.getPhoto(''), /등록된 사진이 아니에요/);
});

test('일정 요약: 한 공간의 기간 안 살아 있는 예약만 날짜순으로 준다', () => {
  const s = server(TEACHER);
  s.createBooking(base({ date: '2026-11-20', periods: ['P3'] }));
  s.createBooking(base({ date: '2026-11-13', periods: ['P5', 'P6'] }));
  s.createBooking(base({ date: '2026-11-16', periods: ['P1'], roomId: 'A203' }));
  s.createBooking(base({ date: '2026-12-25', periods: ['P1'] }));
  const cancelled = plain(s.myBookings()).find((b) => b.date === '2026-11-20');
  s.cancelBooking(cancelled.id, 'one');
  const list = plain(s.getRoomRange('A202', '2026-11-01', '2026-11-30'));
  assert.deepEqual(list.map((b) => b.date), ['2026-11-13']);
  assert.deepEqual(list[0].periods, ['P5', 'P6']);
  assert.throws(() => s.getRoomRange('A202', '2026-11-30', '2026-11-01'), /기간이 올바르지/);
  assert.equal(plain(s.getRoomRange('A202', '2026-01-01', '2026-12-31')).length, 2, '연간 요약: 1년 치를 한 번에');
  assert.throws(() => s.getRoomRange('A202', '2026-01-01', '2027-12-31'), /1년까지만/);
});

test('대장 가져오기: 시트 이름을 [공간] 탭 이름과 짝짓는다', () => {
  const s = server();
  const rooms = [{ id: 'R1', name: '미네르바 1실' }, { id: 'R2', name: '대강의실' }, { id: 'R3', name: '설렘온1실 (본관 2층)' },
    { id: 'R4', name: '건산홀' }, { id: 'R5', name: '온라인 스튜디오' }, { id: 'R6', name: '체육관' }, { id: 'R7', name: '체육관 탁구장' }];
  const m = plain(s.ledgerMatchRooms_(['미네르바1실', '대강의실(아름자리)', '설렘온1실', '건산홀(246석)', '다운자리(스튜디오)', '체육관', '동진실'], rooms));
  assert.deepEqual(m.map((x) => x.room && x.room.id), ['R1', 'R2', 'R3', 'R4', null, 'R6', null]);
});

test('대장 가져오기: 오늘 이후만, 같은 날짜는 아래 줄만, 이어진 같은 내용은 한 건', () => {
  const s = server();
  const e = ['', '', '', '', '', '', '', '', '', ''];
  const grid = [
    ['', '1교시', '2교시'].concat(e.slice(2)),
    ['2026-11-11', '지난 날'].concat(e.slice(1)),
    ['2026-11-13', '위쪽 줄(작년)', '위쪽 줄(작년)'].concat(e.slice(2)),
    ['2026-11-12', '회의', '회의', '', '수업\n(수학과)', '', '', '', '', '', '야간 행사'],
    ['2026-11-13', '', '', '', '', '', '동아리', '동아리', '동아리', '', ''],
  ];
  const rows = plain(s.ledgerRows_(grid, '2026-11-12'));
  assert.deepEqual(rows.map((r) => r.date), ['2026-11-12', '2026-11-13']);
  const ids = ['P1', 'P2', 'P3', 'P4', 'PL', 'P5', 'P6', 'P7', 'PA', 'PN'];
  const b = plain(s.ledgerBookings_(rows, 'R9', ids));
  assert.deepEqual(b.map((x) => [x.id, x.periods.join(','), x.purpose]), [
    ['L-R9-20261112-P1', 'P1,P2', '회의'],
    ['L-R9-20261112-P4', 'P4', '수업 (수학과)'],
    ['L-R9-20261112-PN', 'PN', '야간 행사'],
    ['L-R9-20261113-P5', 'P5,P6,P7', '동아리'],
  ]);
});

test('대장 가져오기: 추가·변경·삭제를 가려내고, 겹친 예약을 찾는다', () => {
  const s = server();
  const mk = (id, periods, purpose, extra) => Object.assign({ id, roomId: 'R1', date: '2026-11-13', periods, purpose, status: '확정', memo: s.SYNC_MEMO_ }, extra);
  const existing = [mk('L-a', ['P1'], '그대로'), mk('L-b', ['P2'], '바뀔 것'), mk('L-c', ['P3'], '지워질 것'), mk('L-d', ['P4'], '취소됐던 것', { status: '취소' })];
  const desired = [mk('L-a', ['P1'], '그대로'), mk('L-b', ['P2', 'P3'], '바뀔 것'), mk('L-d', ['P4'], '취소됐던 것'), mk('L-e', ['P5'], '새로 적음')];
  const d = plain(s.ledgerDiff_(existing, desired));
  assert.deepEqual(d.add.map((x) => x.id), ['L-e']);
  assert.deepEqual(d.remove.map((x) => x.id), ['L-c']);
  assert.deepEqual(d.change.map((x) => x.after.id), ['L-b', 'L-d']);

  const web = { id: 'R123', roomId: 'R1', date: '2026-11-13', periods: ['P3', 'P4'], purpose: '웹', status: '확정', memo: '' };
  const clashes = plain(s.findClashes_(desired.concat([web, mk('L-old', ['P3'], '지난 날', { date: '2026-11-01' })]), '2026-11-12'));
  assert.equal(clashes.length, 2);
  assert.deepEqual(clashes.map((c) => c.periods.join(',')).sort(), ['P3', 'P4']);
});

test('대장 가져오기를 켜면 대장에서 온 예약은 웹에서 고치거나 취소할 수 없다', () => {
  const s = server(ADMIN);
  s.mockReset_();
  const row = { 'ID': 'L-A202-20261113-P5', '공간ID': 'A202', '날짜': '2026-11-13', '교시': 'P5', '이름': '기존 대장', '역할': '교직원', '목적': '동아리', '상태': '확정', '비고': s.SYNC_MEMO_ };
  s.appendRows_('예약', [row]);
  assert.equal(plain(s.getDay('2026-11-13'))[0].ledger, true);
  assert.equal(s.cancelBooking(row.ID, 'one').cancelled, 1, '대장 주소가 없으면 평소처럼 취소할 수 있다');
  s.updateRows_('예약', [{ _row: 2, '상태': '확정' }]);
  s.appendRows_('설정', [{ '항목': '대장주소1', '값': 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit' }]);
  assert.equal(plain(s.getInit()).ledgerOn, true);
  assert.throws(() => s.cancelBooking(row.ID, 'one'), /대장\(구글시트\)에서 고치면/);
  assert.throws(() => s.updateBooking(row.ID, base()), /대장\(구글시트\)에서 고치면/);
  s.MOCK.user = TEACHER;
  assert.throws(() => s.createBooking(base({ periods: ['P5'] })), /5교시에 이미 예약/);
  assert.throws(() => s.runLedgerSync(), /관리자 로그인이 필요/);
});

test('신청 항목: 사용 학교와 사용 부서는 꼭 넣어야 하고, 예약과 기록에 남는다', () => {
  const s = server(TEACHER);
  assert.throws(() => s.createBooking(base({ school: [] })), /사용 학교/);
  assert.throws(() => s.createBooking(base({ school: ['대학'] })), /사용 학교/);
  assert.throws(() => s.createBooking(base({ unit: ' ' })), /사용 부서/);
  s.createBooking(base({ school: ['법인', '중'], unit: '김교사' }));
  const b = plain(s.getDay('2026-11-13'))[0];
  assert.equal(b.school, '중,법인');
  assert.equal(b.unit, '김교사');
  s.updateBooking(b.id, base({ school: ['고'], unit: '교육과정부' }));
  assert.equal(plain(s.getDay('2026-11-13'))[0].unit, '교육과정부');
  s.MOCK.user = ADMIN;
  const h = plain(s.getHistory(''));
  assert.match(h[0].text, /\[고\] 교육과정부/);
  assert.equal(JSON.parse(h[0].before)['사용부서'], '김교사');
});

test('함께 사용: 동시예약수만큼 같은 시간에 예약할 수 있고, 기존 예약을 먼저 알려 준다', () => {
  const s = server(TEACHER);
  const gym = (extra) => base(Object.assign({ roomId: 'C101', periods: ['P2', 'P3'], people: 30, purpose: '배구', shared: true }, extra));
  assert.equal(plain(s.getInit()).rooms.find((r) => r.id === 'C101').multi, 3);

  assert.equal(s.createBooking(gym({ unit: '1학년' })).created, 1, '첫 팀은 바로 신청');
  const ask = plain(s.createBooking(gym({ unit: '2학년', periods: ['P3'] })));
  assert.equal(ask.needConfirm, true, '둘째 팀은 기존 예약을 먼저 보여 준다');
  assert.deepEqual(ask.existing, [{ room: '체육관', date: '2026-11-13', max: 3, list: [{ periods: '2교시, 3교시', who: '1학년', school: '고', purpose: '배구' }] }]);
  assert.equal(plain(s.getDay('2026-11-13')).length, 1, '확인 전에는 만들지 않는다');
  assert.equal(s.createBooking(gym({ unit: '2학년', periods: ['P3'], ackExisting: true })).created, 1);
  assert.equal(s.createBooking(gym({ unit: '중 3학년', school: ['중'], periods: ['P3'], ackExisting: true })).created, 1);
  assert.throws(() => s.createBooking(gym({ unit: '넷째 팀', periods: ['P3'], ackExisting: true })), /이미 3팀이 예약해서 자리가 없어요/);
  assert.equal(s.createBooking(gym({ unit: '넷째 팀', periods: ['P2'], ackExisting: true })).created, 1, '2교시는 아직 1팀뿐');

  // 함께 사용에 체크하지 않으면 빈 시간에만 신청할 수 있다
  assert.throws(() => s.createBooking(gym({ shared: false, periods: ['P2'] })), /'함께 사용'에 체크해 주세요. \(최대 3팀\)/);
  assert.equal(s.createBooking(gym({ shared: false, periods: ['P5'], purpose: '학년 행사' })).created, 1);
  // 방과후·야간도 동시예약수만큼 함께 쓸 수 있다 (교시 구분 없이 동시예약수로만 관리)
  s.createBooking(gym({ periods: ['PA', 'PN'] }));
  assert.equal(s.createBooking(gym({ periods: ['PA'], unit: '캠핑 2팀', ackExisting: true })).created, 1);
  // 동시예약수가 없는 공간은 함께 사용이 안 된다
  s.createBooking(base({ periods: ['P2'] }));
  assert.throws(() => s.createBooking(base({ periods: ['P2'], shared: true, ackExisting: true })), /2교시에 이미 예약/);

  // 허용 수 안에서 겹친 것은 관리 화면의 겹침에 나오지 않는다
  s.MOCK.user = ADMIN;
  assert.equal(plain(s.adminBookings({})).clashes.length, 0);
});

test('함께 사용: 반복 신청은 자리가 없는 날과 함께 쓰는 날을 한 번에 알려 준다', () => {
  const s = server(TEACHER);
  const gym = (extra) => base(Object.assign({ roomId: 'C101', periods: ['P2'], people: 30, purpose: '배구', shared: true }, extra));
  s.createBooking(gym({ date: '2026-11-13' }));
  ['A', 'B', 'C'].forEach((u) => s.createBooking(gym({ date: '2026-11-20', unit: u, ackExisting: true })));
  const repeat = { until: '2026-11-27', weekdays: [5] };
  const ask = plain(s.createBooking(gym({ date: '2026-11-13', unit: '새 팀', repeat })));
  assert.equal(ask.needConfirm, true);
  assert.deepEqual(ask.conflicts.map((c) => c.date), ['2026-11-20']);
  assert.deepEqual(ask.existing.map((c) => c.date), ['2026-11-13']);
  assert.equal(ask.okCount, 2);
  const r = plain(s.createBooking(gym({ date: '2026-11-13', unit: '새 팀', repeat, skipConflicts: true, ackExisting: true })));
  assert.equal(r.created, 2);
});

test('여러 공간을 같은 일정으로 한 번에 예약한다 (하루, 반복)', () => {
  const s = server(TEACHER);
  const r = plain(s.createBooking(base({ roomId: undefined, roomIds: ['A202', 'A203', 'B202'], people: 10 })));
  assert.equal(r.created, 3);
  assert.equal(r.rooms, 3);
  const day = plain(s.getDay('2026-11-13'));
  assert.deepEqual(day.map((b) => b.roomId).sort(), ['A202', 'A203', 'B202']);
  assert.equal(new Set(day.map((b) => b.groupId)).size, 1, '한 번에 신청한 것은 같은 묶음');
  assert.ok(day[0].groupId);

  // 하루 신청은 한 곳이라도 자리가 없으면 아무것도 만들지 않는다
  assert.throws(() => s.createBooking(base({ roomIds: ['A204', 'A203'], periods: ['P6', 'P7'] })), /세미나실 2 6교시에 이미 예약이 있어요.*아무 공간도 신청하지 않았어요/);
  assert.equal(plain(s.getDay('2026-11-13')).length, 3);
  // 정원은 공간마다 확인한다
  assert.throws(() => s.createBooking(base({ roomIds: ['A204', 'A201'], periods: ['P1'], people: 20 })), /진로상담실의 정원은 8명/);
  assert.throws(() => s.createBooking(base({ roomIds: ['A204', 'A101'], periods: ['P1'] })), /교무실은\(는\) 신청을 받지 않는/);

  // 반복 + 여러 공간: 자리가 없는 곳만 빼고 만든다
  const repeat = { until: '2026-11-27', weekdays: [5] };
  const ask = plain(s.createBooking(base({ roomIds: ['A202', 'A204'], periods: ['P5'], repeat })));
  assert.equal(ask.needConfirm, true);
  assert.deepEqual(ask.conflicts, [{ room: '세미나실 1', date: '2026-11-13', periods: '5교시' }]);
  assert.equal(ask.okCount, 5);
  const made = plain(s.createBooking(base({ roomIds: ['A202', 'A204'], periods: ['P5'], repeat, skipConflicts: true })));
  assert.equal(made.created, 5);
  s.MOCK.user = ADMIN;
  assert.equal(plain(s.getHistory('일괄신청')).length, 3);
});

test('반복·일괄 예약 한꺼번에 취소: 이 공간 전체, 함께 신청한 공간까지 전체', () => {
  const s = server(TEACHER);
  const repeat = { until: '2026-12-04', weekdays: [5] };   // 금요일 4회
  s.createBooking(base({ roomIds: ['A202', 'A203'], repeat }));
  const mine = () => plain(s.myBookings()).filter((b) => b.status === '확정');
  assert.equal(mine().length, 8);
  const third = mine().find((b) => b.roomId === 'A202' && b.date === '2026-11-27');

  assert.equal(s.cancelBooking(third.id, 'following').cancelled, 2, '이 날부터: 같은 공간의 11/27, 12/4');
  assert.deepEqual(mine().filter((b) => b.roomId === 'A202').map((b) => b.date), ['2026-11-13', '2026-11-20']);
  assert.equal(mine().filter((b) => b.roomId === 'A203').length, 4, '다른 공간은 그대로');

  const first = mine().find((b) => b.roomId === 'A203' && b.date === '2026-11-20');
  assert.equal(s.cancelBooking(first.id, 'room').cancelled, 4, '이 공간의 반복 전체 (앞 날짜 포함)');
  assert.equal(mine().length, 2);

  s.createBooking(base({ roomIds: ['A204', 'B202'], periods: ['P1'], repeat }));
  s.MOCK.now = '2026-11-25T10:00:00';   // 시간이 지난 뒤
  const one = plain(s.myBookings()).find((b) => b.roomId === 'A204' && b.date === '2026-11-27');
  assert.equal(s.cancelBooking(one.id, 'group').cancelled, 4, '함께 신청한 공간까지: 오늘 이후(11/27, 12/4) × 2곳');
  const past = plain(s.myBookings()).filter((b) => b.roomId === 'A204' && b.status === '확정');
  assert.deepEqual(past.map((b) => b.date), ['2026-11-13', '2026-11-20'], '지난 날짜는 기록으로 남긴다');
  s.MOCK.user = STUDENT;
  assert.throws(() => s.cancelBooking(one.id, 'group'), /이 기기에서 신청한 예약만/);
});

test('학교 구분 짐작과 화면 설정(관리자 이름)', () => {
  const s = server(TEACHER);
  assert.equal(s.inferSchool_('중학교 법교육(1학년부)'), '중');
  assert.equal(s.inferSchool_('동아리(고)'), '고');
  assert.equal(s.inferSchool_('중2학년 스쿨핑 고1-1 스쿨핑'), '중,고');
  assert.equal(s.inferSchool_('고 중간고사'), '고');
  assert.equal(s.inferSchool_('중간고사 집중 대비'), '');
  assert.equal(s.inferSchool_('법인 이사회'), '법인');
  assert.equal(s.schoolFor_('진학기획부'), '고', '중학교·법인 표시가 없으면 고등학교');
  assert.equal(s.schoolFor_('중학교 VR체험'), '중');
  // 중학교 표시: 중1·중2·중3, '중 ', (중)
  ['중1학년 진로특강', '중2 특강', '중3금융교육', '휘경여중3학년 발표', '중 영화 상영', '(중)1학년 6반 학급 단합활동', '동아리(중)', '댄스부(휘쓸) 중'].forEach((x) => {
    assert.equal(s.schoolFor_(x), '중', x);
  });
  // 중학교로 구별하기 어려운 것은 고등학교
  ['문화예술수업', '중간고사 감독', '집중 이수', '토론대회', '한일음식교류(휘경*금강)', '대수(김은영)', '동아리(창체부)'].forEach((x) => {
    assert.equal(s.schoolFor_(x), '고', x);
  });
  assert.equal(plain(s.getInit()).settings.admin, '');
  s.mockReset_();
  s.MOCK.db['설정'].forEach((r) => { if (r['항목'] === '관리자') r['값'] = '홍길동T'; });
  assert.equal(plain(s.getInit()).settings.admin, '홍길동T');
});

test('대장 가져오기: 이름이 다른 곳은 정해 둔 짝으로 찾는다 (스쿨캠핑 → 작은정원)', () => {
  const s = server();
  const rooms = [{ id: 'R1', name: '작은정원' }, { id: 'R2', name: '체육관' }, { id: 'R3', name: '세미나실' }];
  const m = plain(s.ledgerMatchRooms_(['스쿨캠핑', '체육관', '동진실'], rooms, s.SYNC_ALIASES_));
  assert.deepEqual(m.map((x) => x.room && x.room.id), ['R1', 'R2', null]);
  assert.equal(m[0].how, '정해 둔 짝');
  // [설정] 탭에서 더한 짝, 그리고 정해 둔 공간이 없으면 원래 이름으로 찾기
  const m2 = plain(s.ledgerMatchRooms_(['동진실', '스쿨캠핑'], [{ id: 'R3', name: '세미나실' }, { id: 'R9', name: '스쿨캠핑' }], { '동진실': '세미나실', '스쿨캠핑': '작은정원' }));
  assert.deepEqual(m2.map((x) => x.room && x.room.id), ['R3', 'R9']);
});

test('화면(index.html)의 스크립트에 문법 오류가 없다', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf("<script>\n'use strict'");
  assert.ok(start > 0);
  const src = html.slice(start + 8, html.indexOf('</script>', start));
  assert.doesNotThrow(() => new Function(src));
});

test('통계: 관리자만 기간 안의 모든 공간 예약을 받는다', () => {
  const s = server(TEACHER);
  s.createBooking(base());
  s.createBooking(base({ roomId: 'A203', date: '2026-11-20', school: ['중'] }));
  s.createBooking(base({ date: '2026-12-25' }));
  const gone = plain(s.myBookings()).find((b) => b.date === '2026-11-20');
  assert.throws(() => s.getStats('2026-11-01', '2026-11-30'), /관리자 로그인이 필요/);
  s.MOCK.user = ADMIN;
  assert.deepEqual(plain(s.getStats('2026-11-01', '2026-11-30')).map((b) => b.roomId + ' ' + b.date + ' ' + b.school), ['A202 2026-11-13 고', 'A203 2026-11-20 중']);
  s.cancelBooking(gone.id, 'one');
  assert.equal(plain(s.getStats('2026-11-01', '2026-11-30')).length, 1, '취소한 예약은 빼고');
  assert.throws(() => s.getStats('2026-01-01', '2027-12-31'), /1년까지만/);
});

test('예약 찾기: 사용 학교·부서·이름·기간으로 찾는다 (다른 기기에서도 보이지만 고치지는 못한다)', () => {
  const s = server(TEACHER);
  s.createBooking(base({ unit: '교육과정부', name: '홍길동' }));
  s.createBooking(base({ roomId: 'A203', date: '2026-11-20', unit: '1학년부', name: '김철수', school: ['중'] }));
  s.createBooking(base({ roomId: 'A204', date: '2026-12-01', unit: '교육 과정부', name: '홍길동', school: ['법인', '고'] }));
  s.createBooking(base({ roomId: 'B202', date: '2026-11-13', unit: '연구부', name: '이영희' }));
  const gone = plain(s.myBookings()).find((b) => b.roomId === 'B202');
  s.cancelBooking(gone.id, 'one');

  s.MOCK.user = STUDENT;   // 다른 기기
  assert.equal(plain(s.myBookings()).length, 0, '이 기기에서 신청한 예약은 없다');
  const find = (q) => plain(s.searchBookings(q)).list.map((b) => b.date + ' ' + b.unit + ' ' + b.name);
  assert.deepEqual(find({ unit: '교육과정' }), ['2026-11-13 교육과정부 홍길동', '2026-12-01 교육 과정부 홍길동'], '띄어쓰기 무시, 일부만 적어도 됨');
  assert.deepEqual(find({ name: '김철' }), ['2026-11-20 1학년부 김철수']);
  assert.deepEqual(find({ school: ['중'] }), ['2026-11-20 1학년부 김철수']);
  assert.deepEqual(find({ school: ['법인'] }), ['2026-12-01 교육 과정부 홍길동']);
  assert.deepEqual(find({ name: '홍길동', from: '2026-11-20', to: '2026-12-31' }), ['2026-12-01 교육 과정부 홍길동']);
  assert.deepEqual(find({ unit: '연구부' }), [], '취소한 예약은 나오지 않는다');
  assert.deepEqual(find({ from: '2026-11-13', to: '2026-11-13' }), ['2026-11-13 교육과정부 홍길동']);
  assert.throws(() => s.searchBookings({}), /하나 이상을 넣어 주세요/);

  const hit = plain(s.searchBookings({ unit: '교육과정부' })).list[0];
  assert.equal(hit.mine, false);
  assert.throws(() => s.cancelBooking(hit.id, 'one'), /이 기기에서 신청한 예약만/);
  s.MOCK.user = TEACHER;
  assert.equal(plain(s.searchBookings({ unit: '교육과정부' })).list[0].mine, true);
  s.MOCK.user = ADMIN;
  assert.equal(s.cancelBooking(hit.id, 'one').cancelled, 1, '관리자는 누구 예약이든 취소할 수 있다');
  const h = plain(s.getHistory(''))[0];
  assert.equal(h.name, '관리자');
  assert.equal(h.device, 'dev-admin');
});
