/**
 * 학교 공간 대여 — 기존 사용 대장(구글시트) 자동 가져오기
 *
 * 대장 → [예약] 탭 한 방향입니다. 대장에 적거나 고치거나 지운 내용을 주기적으로 읽어
 * [예약] 탭의 "대장에서 온 예약"을 대장과 같게 맞춥니다. 웹에서 신청한 예약은 건드리지 않습니다.
 *
 * 준비: [설정] 탭에 줄을 추가합니다 —  항목: 대장주소1, 대장주소2, …   값: 대장 구글시트 주소
 * 시작: 편집기에서 startLedgerSync 실행 (10분마다 자동으로 가져옴)
 * 중지: stopLedgerSync 실행
 *
 * - 오늘 이후 날짜만 맞춥니다. 지난 날짜의 예약은 그대로 둡니다.
 * - 대장의 시트 이름과 [공간] 탭의 이름이 같은 곳만 가져옵니다. [공간] 탭은 바꾸지 않습니다.
 *   이름이 다른 곳은 짝을 정해 둡니다: 대장의 '스쿨캠핑' → 공간 '작은정원' (기본값).
 *   더 필요하면 [설정] 탭에 줄을 추가합니다 —  항목: 대장짝:대장시트이름   값: 공간 이름
 * - 같은 날짜 줄이 두 번 있으면 아래쪽 줄만 씁니다.
 * - 바뀐 내용은 [기록] 탭에 "대장추가 / 대장변경 / 대장삭제"로 남습니다.
 * - 대장 내용이 웹 예약과 겹치면 관리 화면의 [겹침]에 나옵니다.
 */

var SYNC_LOG_LIMIT = 150;   // 한 번에 [기록] 탭에 자세히 남기는 최대 건수

function syncIsDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/**
 * [설정] 탭의 대장주소 → [{id, school}]
 * school = 그 대장에서 학교를 알 수 없는 내용에 넣을 기본 학교. [설정] 탭의 '대장학교1' 처럼 대장주소와 같은 번호로 적습니다.
 * (예: 고등학교만 쓰는 대장이면 대장학교1 = 고)
 */
function syncSources_() {
  var conf = readTab_('설정');
  var schoolOf = {};
  conf.forEach(function (r) {
    var m = /^대장학교(.*)$/.exec(String(r['항목']).trim());
    if (m) schoolOf[m[1].trim()] = SCHOOLS_.filter(function (x) { return splitList_(r['값']).indexOf(x) >= 0; }).join(',');
  });
  return conf.filter(function (r) {
    return /^대장주소/.test(String(r['항목'])) && String(r['값']).trim();
  }).map(function (r) {
    var m = /[-\w]{25,}/.exec(String(r['값']));
    if (!m) throw new Error("[설정] 탭의 '" + r['항목'] + "' 값이 구글시트 주소가 아니에요.");
    return { id: m[0], school: schoolOf[String(r['항목']).trim().replace(/^대장주소/, '').trim()] || '' };
  });
}

/** 대장 시트 이름 → 공간 이름. 기본값에 [설정] 탭의 '대장짝:시트이름' 줄을 더합니다. */
function syncAliases_() {
  var out = {};
  Object.keys(SYNC_ALIASES_).forEach(function (k) { out[k] = SYNC_ALIASES_[k]; });
  readTab_('설정').forEach(function (r) {
    var m = /^대장짝\s*[:：]\s*(.+)$/.exec(String(r['항목']).trim());
    if (m && String(r['값']).trim()) out[m[1].trim()] = String(r['값']).trim();
  });
  return out;
}

/** 대장 한 시트를 [[날짜, 칸0 … 칸9], …] 로 읽습니다. 병합된 칸은 왼쪽 위 값을 범위 전체에 채웁니다. */
function syncReadSheet_(sh, tz) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var range = sh.getRange(1, 1, last, 12);
  var v = range.getValues();
  range.getMergedRanges().forEach(function (m) {
    var r0 = m.getRow(), c0 = m.getColumn();
    if (r0 <= 4 || c0 < 3) return;
    var val = v[r0 - 1][c0 - 1];
    for (var r = r0; r < r0 + m.getNumRows() && r <= last; r++) {
      for (var c = c0; c < c0 + m.getNumColumns() && c <= 12; c++) v[r - 1][c - 1] = val;
    }
  });
  return v.map(function (row) {
    var out = [syncIsDate_(row[0]) ? Utilities.formatDate(row[0], tz, 'yyyy-MM-dd') : ''];
    for (var c = 2; c < 12; c++) out.push(syncIsDate_(row[c]) || row[c] == null ? '' : String(row[c]));
    return out;
  });
}

function syncText_(v) {
  v = v == null ? '' : String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** 실제로 맞추는 일. 반환: {msg, add, change, remove, unmatched} */
function syncRun_() {
  var today = today_();
  var periods = periods_();
  var slotIds = SYNC_SLOTS_.map(function (name) {
    var hit = periods.filter(function (p) { return p.name === name; })[0] ||
      periods.filter(function (p) { return p.name.indexOf(name) === 0 || name.indexOf(p.name) === 0; })[0];
    if (!hit) throw new Error("[교시] 탭에 '" + name + "' 이(가) 없어요.");
    return hit.id;
  });
  var sources = syncSources_();
  if (!sources.length) throw new Error("[설정] 탭에 '대장주소1' 같은 줄이 없어요. 대장 구글시트 주소를 적어 주세요.");

  // 1) 대장 읽기 — 하나라도 못 열면 아무것도 바꾸지 않고 멈춤
  var tabs = [];
  sources.forEach(function (src) {
    var ss;
    try {
      ss = SpreadsheetApp.openById(src.id);
    } catch (e) {
      throw new Error('대장을 열 수 없어요 (' + src.id.slice(0, 8) + '…). 배포한 계정이 볼 수 있는 시트인지 확인해 주세요.');
    }
    var tz = ss.getSpreadsheetTimeZone() || 'Asia/Seoul';
    ss.getSheets().forEach(function (sh) { tabs.push({ title: sh.getName(), grid: syncReadSheet_(sh, tz), school: src.school }); });
  });
  var rooms = rooms_();
  var match = ledgerMatchRooms_(tabs.map(function (t) { return t.title; }), rooms, syncAliases_());
  var desired = [];
  var unmatched = [];
  tabs.forEach(function (t, i) {
    if (!match[i].room) { unmatched.push(t.title); return; }
    ledgerBookings_(ledgerRows_(t.grid, today), match[i].room.id, slotIds).forEach(function (b) {
      b.school = inferSchool_(b.purpose) || t.school;   // 적힌 글로 학교를 짐작하고, 모르면 그 대장의 기본 학교
      desired.push(b);
    });
  });
  var seen = {};
  desired = desired.filter(function (b) { return seen[b.id] ? false : (seen[b.id] = true); });

  // 2) 지금 [예약] 탭과 비교
  var existing = bookings_().filter(function (b) { return isLedger_(b) && b.date >= today; });
  if (!desired.length && existing.length > 20) {
    throw new Error('대장에서 읽은 내용이 하나도 없어요. 대장의 표 모양이 바뀌었는지 확인해 주세요. (아무것도 바꾸지 않았습니다)');
  }
  var diff = ledgerDiff_(existing, desired);
  var note = unmatched.length ? ' · [공간] 탭에 없는 시트 ' + unmatched.length + '개: ' + unmatched.join(', ') : '';
  var n = diff.add.length + diff.change.length + diff.remove.length;
  // 이미 가져온 줄 가운데 사용학교가 비어 있는 것은 조용히 채웁니다 (기록에는 남기지 않음).
  var hasSchool = tabHeaders_('예약').indexOf('사용학교') >= 0;
  var blank = {};
  existing.forEach(function (b) { if (!b.school) blank[b.id] = true; });
  var fill = hasSchool ? desired.filter(function (b) { return blank[b.id] && b.school; }).length : 0;
  if (!n && fill) n = -1;
  if (!n) return { msg: '변경 없음 (대장 예약 ' + desired.length + '건)' + note, add: 0, change: 0, remove: 0, unmatched: unmatched };

  // 3) [예약] 탭을 한 번에 다시 씀: 대장에서 온 오늘 이후 줄만 바꾸고 나머지는 그대로
  var now = nowStr_();
  var sh = sheet_('예약');
  var cols = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var iId = cols.indexOf('ID'), iMemo = cols.indexOf('비고'), iDate = cols.indexOf('날짜'), iSchool = cols.indexOf('사용학교');
  if (iId < 0 || iMemo < 0 || iDate < 0) throw new Error("[예약] 탭 머리글이 올바르지 않아요.");
  var last = sh.getLastRow();
  var old = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getDisplayValues() : [];
  var oldRow = {};
  var keep = old.filter(function (r) {
    if (r.join('').trim() === '') return false;
    var mine = String(r[iId]).indexOf('L-') === 0 && String(r[iMemo]).trim() === SYNC_MEMO_ && String(r[iDate]) >= today;
    if (mine) oldRow[r[iId]] = r;
    return !mine;
  });
  var changed = {};
  diff.change.forEach(function (c) { changed[c.after.id] = true; });
  var fresh = desired.map(function (b) {
    if (oldRow[b.id] && !changed[b.id]) {
      if (iSchool >= 0 && b.school && !String(oldRow[b.id][iSchool]).trim()) oldRow[b.id][iSchool] = b.school;
      return oldRow[b.id];
    }
    var o = {
      'ID': b.id, '묶음ID': '', '공간ID': b.roomId, '날짜': b.date, '교시': b.periods.join(','),
      '이메일': '', '이름': '기존 대장', '역할': '교직원', '소속': '', '목적': b.purpose, '인원': '',
      '상태': '확정', '신청일시': oldRow[b.id] ? oldRow[b.id][cols.indexOf('신청일시')] : now,
      '수정일시': oldRow[b.id] ? now : '', '처리자': '', '비고': SYNC_MEMO_, '사용학교': b.school || ''
    };
    return cols.map(function (h) { return o[h] == null ? '' : o[h]; });
  });
  var all = keep.concat(fresh).map(function (r) { return r.map(syncText_); });
  if (sh.getMaxRows() < all.length + 1) sh.insertRowsAfter(sh.getMaxRows(), all.length + 1 - sh.getMaxRows());
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, cols.length).setNumberFormat('@').setValues(all);
  delete tabCache_['예약'];

  // 4) 기록
  var ctx = { rooms: rooms, periods: periods };
  var who = { email: '', name: '대장 동기화' };
  var full = function (b) {
    return { id: b.id, roomId: b.roomId, date: b.date, periods: b.periods, purpose: b.purpose, people: 0, status: '확정', name: '기존 대장', memo: SYNC_MEMO_, school: b.school || '' };
  };
  var logs = [];
  diff.add.forEach(function (b) { logs.push(logRow_(who, '대장추가', null, full(b), ctx)); });
  diff.change.forEach(function (c) { logs.push(logRow_(who, '대장변경', c.before, full(c.after), ctx)); });
  diff.remove.forEach(function (b) { logs.push(logRow_(who, '대장삭제', b, null, ctx)); });
  var msg = '추가 ' + diff.add.length + ' · 변경 ' + diff.change.length + ' · 삭제 ' + diff.remove.length + (fill ? ' · 학교 구분 채움 ' + fill : '') + note;
  if (logs.length > SYNC_LOG_LIMIT) {
    logs = logs.slice(0, SYNC_LOG_LIMIT);
    logs.push({ '일시': now, '이메일': '', '이름': '대장 동기화', '동작': '대장동기화', '예약ID': '', '공간': '', '날짜': '',
      '내용': msg + ' (건수가 많아 앞의 ' + SYNC_LOG_LIMIT + '건만 자세히 남김)', '변경전': '', '변경후': '' });
  }
  appendRows_('기록', logs);
  return { msg: msg, add: diff.add.length, change: diff.change.length, remove: diff.remove.length, unmatched: unmatched };
}

/** 대장을 읽어 [예약] 탭을 맞춥니다. 10분마다 자동으로 불리고, 관리 화면의 "지금 가져오기"로도 불립니다. */
function syncLedger() {
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    try {
      var res = syncRun_();
      props.setProperty('LEDGER_SYNC_LAST', nowStr_() + ' · ' + res.msg);
      console.log(res.msg);
      return res.msg;
    } catch (e) {
      props.setProperty('LEDGER_SYNC_LAST', nowStr_() + ' · 실패: ' + e.message);
      throw e;
    }
  });
}

/** 마지막 가져오기 결과 (관리 화면 표시용) */
function ledgerStatus_() {
  return PropertiesService.getScriptProperties().getProperty('LEDGER_SYNC_LAST') || '';
}

/** 아무것도 바꾸지 않고, 대장의 시트가 [공간] 탭의 어느 줄과 짝지어지는지 실행 로그로 보여 줍니다. */
function checkLedgerSync() {
  var titles = [];
  syncSources_().forEach(function (src) {
    SpreadsheetApp.openById(src.id).getSheets().forEach(function (sh) { titles.push(sh.getName()); });
  });
  var match = ledgerMatchRooms_(titles, rooms_(), syncAliases_());
  console.log(match.map(function (m) {
    return m.room ? m.title + '  →  [' + m.room.id + '] ' + m.room.name + '  (' + m.how + ')'
      : m.title + '  →  짝 없음 (' + (m.how || '[공간] 탭에 같은 이름이 없음') + ')';
  }).join('\n') || "[설정] 탭에 '대장주소1' 같은 줄이 없어요.");
}

/**
 * [예약] 탭에서 사용학교가 비어 있는 줄을 채웁니다. 편집기에서 한 번 실행하세요. (지난 날짜의 줄도 채웁니다)
 * 1) 사용 목적·사용 부서에 적힌 글로 짐작합니다. 예: "중학교 법교육" → 중, "동아리(고)" → 고
 * 2) 글로 알 수 없는 대장 예약은, 그 공간이 속한 대장의 기본 학교([설정] 탭의 대장학교1 …)를 넣습니다.
 * 그래도 알 수 없는 줄은 비워 둡니다. 이미 값이 있는 줄은 건드리지 않습니다.
 */
function fillSchools() {
  return withLock_(function () {
    var sh = sheet_('예약');
    var cols = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var c = function (name) { return cols.indexOf(name); };
    if (c('사용학교') < 0) throw new Error("[예약] 탭에 '사용학교' 열이 없어요. setup 을 먼저 실행해 주세요.");
    var last = sh.getLastRow();
    if (last < 2) { console.log('예약이 없습니다.'); return; }

    // 공간별 기본 학교: 기본 학교가 적힌 대장의 시트와 짝지어진 공간
    var byRoom = {};
    var sources = syncSources_().filter(function (s) { return s.school; });
    if (sources.length) {
      var titles = [], schools = [];
      sources.forEach(function (s) {
        SpreadsheetApp.openById(s.id).getSheets().forEach(function (t) { titles.push(t.getName()); schools.push(s.school); });
      });
      ledgerMatchRooms_(titles, rooms_(), syncAliases_()).forEach(function (m, i) { if (m.room) byRoom[m.room.id] = schools[i]; });
    }

    var v = sh.getRange(2, 1, last - 1, cols.length).getDisplayValues();
    var out = [], count = { '중': 0, '고': 0, '법인': 0 }, filled = 0, left = 0;
    v.forEach(function (r) {
      var cur = String(r[c('사용학교')]).trim();
      if (r.join('').trim() === '' || cur) { out.push([cur]); return; }
      var guess = inferSchool_(r[c('목적')] + ' ' + (c('사용부서') >= 0 ? r[c('사용부서')] : ''));
      if (!guess && String(r[c('비고')]).trim() === SYNC_MEMO_) guess = byRoom[r[c('공간ID')]] || '';
      if (guess) { filled++; guess.split(',').forEach(function (x) { count[x]++; }); } else left++;
      out.push([guess]);
    });
    sh.getRange(2, c('사용학교') + 1, out.length, 1).setNumberFormat('@').setValues(out);
    delete tabCache_['예약'];
    var msg = '사용학교를 ' + filled + '줄 채웠습니다 (중 ' + count['중'] + ', 고 ' + count['고'] + ', 법인 ' + count['법인'] + '). 알 수 없어 비워 둔 줄 ' + left + '개.';
    appendRows_('기록', [{ '일시': nowStr_(), '이메일': String(Session.getEffectiveUser().getEmail() || ''), '이름': '학교 구분 채우기', '동작': '학교채움',
      '예약ID': '', '공간': '', '날짜': '', '내용': msg, '변경전': '', '변경후': '' }]);
    console.log(msg);
    return msg;
  });
}

/** 10분마다 자동으로 가져오기를 시작합니다. 편집기에서 한 번 실행하세요. */
function startLedgerSync() {
  stopLedgerSync();
  ScriptApp.newTrigger('syncLedger').timeBased().everyMinutes(10).create();
  console.log('자동 가져오기를 시작했습니다 (10분마다). 첫 결과: ' + syncLedger());
}

/** 자동 가져오기를 멈춥니다. 이미 가져온 예약은 그대로 남습니다. */
function stopLedgerSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLedger') ScriptApp.deleteTrigger(t);
  });
  console.log('자동 가져오기를 멈췄습니다.');
}
