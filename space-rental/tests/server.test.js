const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../dev/load.js');

const ADMIN = 'admin@school.example';
const TEACHER = 'teacher@school.example';
const STUDENT = 'student@school.example';
const STUDENT2 = 'student2@school.example';

// 2026-11-12 는 목요일
function server(user) {
  const s = loadServer();
  s.MOCK.now = '2026-11-12T10:00:00';
  s.MOCK.user = user || TEACHER;
  return s;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const base = (extra) => Object.assign(
  { roomId: 'A202', date: '2026-11-13', periods: ['P5', 'P6'], purpose: '동아리 회의', people: 10 }, extra);

test('날짜 계산과 반복 날짜 펼치기', () => {
  const s = server();
  assert.equal(s.isDate_('2026-02-30'), false);
  assert.equal(s.addDays_('2026-12-31', 1), '2027-01-01');
  assert.equal(s.weekday_('2026-11-12'), 4);
  assert.deepEqual(plain(s.expandDates_('2026-11-12', '2026-11-26', [2, 4])),
    ['2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']);
});

test('교직원 신청은 즉시 확정되고 기록이 남는다', () => {
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

test('학생 신청은 승인 대기, 관리자가 승인하면 확정', () => {
  const s = server(STUDENT);
  assert.equal(s.createBooking(base()).status, '승인대기');
  const id = plain(s.myBookings())[0].id;
  assert.throws(() => s.decide(id, true, '', 'one'), /관리자만/);
  s.MOCK.user = ADMIN;
  assert.equal(plain(s.adminBookings({})).pending.length, 1);
  s.decide(id, true, '', 'one');
  assert.equal(plain(s.getDay('2026-11-13'))[0].status, '확정');
  assert.deepEqual(plain(s.getHistory('')).map((x) => x.action), ['승인', '신청']);
});

test('반려하면 사유가 남고 그 시간은 다시 비워진다', () => {
  const s = server(STUDENT);
  s.createBooking(base());
  const id = plain(s.myBookings())[0].id;
  s.MOCK.user = ADMIN;
  s.decide(id, false, '수업과 겹침', 'one');
  assert.equal(plain(s.getDay('2026-11-13')).length, 0);
  s.MOCK.user = STUDENT;
  const mine = plain(s.myBookings())[0];
  assert.equal(mine.status, '반려');
  assert.equal(mine.memo, '수업과 겹침');
});

test('겹치는 교시는 신청할 수 없다 (승인 대기도 자리를 잡는다)', () => {
  const s = server(STUDENT);
  s.createBooking(base());
  s.MOCK.user = TEACHER;
  assert.throws(() => s.createBooking(base({ periods: ['P6', 'P7'] })), /6교시에 이미 예약/);
  assert.equal(s.createBooking(base({ periods: ['P7'] })).created, 1);
  assert.equal(s.createBooking(base({ roomId: 'A203' })).created, 1);
});

test('입력 검증: 미등록, 지난 날짜, 정원 초과, 신청 불가 공간, 빈 목적', () => {
  const s = server('nobody@school.example');
  assert.throws(() => s.createBooking(base()), /등록되지 않은 계정/);
  s.MOCK.user = TEACHER;
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
  assert.deepEqual(ask.conflicts, [{ date: '2026-11-19', periods: '6교시' }]);
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

test('학생 반복 신청은 관리자가 한 번에 승인할 수 있다', () => {
  const s = server(STUDENT);
  s.createBooking(base({ date: '2026-11-13', repeat: { until: '2026-11-27', weekdays: [5] } }));
  s.MOCK.user = ADMIN;
  const pending = plain(s.adminBookings({})).pending;
  assert.equal(pending.length, 3);
  assert.equal(s.decide(pending[0].id, true, '', 'group').done, 3);
  assert.equal(plain(s.adminBookings({})).pending.length, 0);
});

test('수정·취소는 본인과 관리자만, 학생이 교시를 바꾸면 다시 승인 대기', () => {
  const s = server(STUDENT);
  s.createBooking(base());
  const id = plain(s.myBookings())[0].id;
  s.MOCK.user = ADMIN;
  s.decide(id, true, '', 'one');

  s.MOCK.user = STUDENT2;
  assert.throws(() => s.updateBooking(id, base()), /본인이 신청한/);
  assert.throws(() => s.cancelBooking(id, 'one'), /본인이 신청한/);

  s.MOCK.user = STUDENT;
  assert.equal(s.updateBooking(id, base({ purpose: '발표 연습' })).status, '확정');
  assert.equal(s.updateBooking(id, base({ periods: ['P7'] })).status, '승인대기');
  s.cancelBooking(id, 'one');
  assert.throws(() => s.cancelBooking(id, 'one'), /이미 취소/);
  assert.equal(plain(s.getDay('2026-11-13')).length, 0);

  s.MOCK.user = ADMIN;
  const h = plain(s.getHistory(''));
  assert.deepEqual(h.map((x) => x.action), ['취소', '수정', '수정', '승인', '신청']);
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

test('미등록 계정에는 신청자 이름과 목적을 가리고, 관리 기능을 막는다', () => {
  const s = server(TEACHER);
  s.createBooking(base());
  s.MOCK.user = 'nobody@school.example';
  const init = plain(s.getInit());
  assert.equal(init.me.registered, false);
  assert.equal(init.sheetUrl, undefined);
  const day = plain(s.getDay('2026-11-13'));
  assert.equal(day[0].name, '');
  assert.equal(day[0].purpose, '');
  assert.throws(() => s.getHistory(''), /등록되지 않은/);
  s.MOCK.user = TEACHER;
  assert.throws(() => s.getHistory(''), /관리자만/);
  assert.throws(() => s.adminBookings({}), /관리자만/);
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
  assert.throws(() => s.getRoomRange('A202', '2026-01-01', '2026-12-31'), /100일까지만/);
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
  assert.throws(() => s.runLedgerSync(), /관리자만/);
});
