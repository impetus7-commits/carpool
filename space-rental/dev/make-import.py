"""기존 '교실 사용 대장' 엑셀 3종 → Import.gs (구글시트로 옮기는 일회용 스크립트) 만들기.

사용:  python3 -I dev/make-import.py <출력 Import.gs> <대장1.xlsx> <대장2.xlsx> <대장3.xlsx>

- 2026학년도(2026-03-01 ~ 2027-02-28) 칸만 옮깁니다.
- [공간] 탭은 바꾸지 않습니다. 실행할 때 [공간] 탭에서 같은 이름의 공간을 찾아 그 ID 로 예약을 만듭니다.
- 같은 날 이어진 칸에 같은 내용이 있으면 예약 한 건으로 묶습니다.
- 같은 날짜 행이 두 번 있으면 아래쪽 행만 씁니다 (위쪽은 2025년, 아래쪽이 2026년).
- 만들어진 Import.gs 에는 사용 내역(이름 포함)이 들어 있으므로 저장소에 올리지 않습니다.
"""
import sys, json, datetime, collections, openpyxl

START, END = datetime.datetime(2026, 3, 1), datetime.datetime(2027, 2, 28)
# 대장의 9개 칸(C~K)과 그 뒤 한 칸(L) → 교시 이름. 시간대로 적힌 대장(중고교류용)도 같은 자리의 교시로 옮깁니다.
SLOTS = ['1교시', '2교시', '3교시', '4교시', '점심', '5교시', '6교시', '7교시', '방과후', '야간']

# 대장의 시트 이름 → [공간] 탭에서 찾을 이름들. 첫 번째가 대표 이름, 나머지는 같은 곳을 가리키는 다른 이름.
SHEETS = {
    '진로진학실': ['진로진학실'],
    '미네르바1실': ['미네르바1실', '미네르바1'], '미네르바2실': ['미네르바2실', '미네르바2'],
    '미네르바3실': ['미네르바3실', '미네르바3'], '미네르바4실': ['미네르바4실', '미네르바4'],
    '미네르바5실': ['미네르바5실', '미네르바5'], '미네르바6실': ['미네르바6실', '미네르바6'],
    '대강의실(아름자리)': ['대강의실(아름자리)', '대강의실', '아름자리', '아름자리(대강의실)'],
    '설렘온1실': ['설렘온1실', '설렘온1'], '설렘온2실': ['설렘온2실', '설렘온2'], '설렘온3실': ['설렘온3실', '설렘온3'],
    '다운자리(스튜디오)': ['다운자리(스튜디오)', '디지털미디어센터 다운자리(스튜디오)', '다운자리 스튜디오', '스튜디오(다운자리)'],
    '다운자리(부스1)': ['다운자리(부스1)', '디지털미디어센터 다운자리(부스1)', '다운자리 부스1', '부스1(다운자리)'],
    '다운자리(부스2)': ['다운자리(부스2)', '디지털미디어센터 다운자리(부스2)', '다운자리 부스2', '부스2(다운자리)'],
    '건산홀(246석)': ['건산홀', '건산홀(246석)'],
    '체육관': ['체육관'], '동진실': ['동진실'], '모던가옥': ['모던가옥'], '스마트건강교실': ['스마트건강교실'],
    '스쿨캠핑': ['스쿨캠핑', '스쿨캠핑장', '작은정원'], 'LAB XR': ['LAB XR', '랩 XR', 'XR LAB', 'XR랩'], 'VR 미팅룸': ['VR 미팅룸', 'VR미팅룸', 'VR 회의실'],
}
# 이전 버전의 가져오기가 [공간] 탭에 넣었던 ID (그 상태면 백업 탭에서 되돌립니다)
OLD_IDS = ['J01'] + ['M0%d' % i for i in range(1, 7)] + ['H0%d' % i for i in range(1, 8)] + ['S0%d' % i for i in range(1, 9)]

def clean(v):
    return ' '.join(str(v).split()) if v is not None else ''

out_path, files = sys.argv[1], sys.argv[2:]
sheets, bookings, report, dropped = [], [], [], []
for f in files:
    wb = openpyxl.load_workbook(f, data_only=True)
    for ws in wb:
        if ws.title not in SHEETS:
            raise SystemExit('모르는 시트: ' + ws.title)
        idx = len(sheets)
        sheets.append(SHEETS[ws.title])
        grid = {}
        for row in ws.iter_rows(min_row=1, max_col=12):
            for c in row:
                if c.value is not None:
                    grid[(c.row, c.column)] = c.value
        for rng in ws.merged_cells.ranges:          # 병합된 칸은 왼쪽 위 값을 범위 전체에 채움
            if rng.min_row > 4 and rng.min_col >= 3:
                v = grid.get((rng.min_row, rng.min_col))
                for r in range(rng.min_row, rng.max_row + 1):
                    for c in range(rng.min_col, min(rng.max_col, 12) + 1):
                        if v is not None: grid[(r, c)] = v
        days = {}   # 같은 날짜 행이 두 번 있으면 아래쪽 행만 씀 (위쪽은 2025년, 아래쪽이 2026년)
        for r in range(1, ws.max_row + 1):
            d = grid.get((r, 1))
            if not isinstance(d, datetime.datetime) or not (START <= d <= END):
                continue
            if d in days:
                dropped.append((SHEETS[ws.title][0], d.strftime('%Y-%m-%d'), [t for x in days[d] for t in x]))
            days[d] = [[] for _ in SLOTS]
            for i in range(len(SLOTS)):
                t = clean(grid.get((r, 3 + i)))
                if t and t not in days[d][i]:
                    days[d][i].append(t)
        n_cells = n_book = 0
        for d in sorted(days):
            texts = [' / '.join(x) for x in days[d]]
            i = 0
            while i < len(texts):
                if not texts[i]:
                    i += 1; continue
                j = i
                while j + 1 < len(texts) and texts[j + 1] == texts[i]:
                    j += 1
                bookings.append([idx, d.strftime('%Y-%m-%d'), list(range(i, j + 1)), texts[i][:100]])
                n_cells += j - i + 1; n_book += 1
                i = j + 1
        report.append((SHEETS[ws.title][0], n_cells, n_book))
if len(sheets) != len(SHEETS): raise SystemExit('대장 시트 수가 다릅니다')

js = r"""/**
 * 기존 '2026 교실 사용 대장' 3종을 [예약] 탭으로 옮기는 일회용 스크립트입니다.
 * [공간] 탭을 기준으로 합니다: 대장의 교실 이름과 같은 이름의 공간을 [공간] 탭에서 찾아 그 ID 로 예약을 만듭니다.
 * [공간] 탭의 내용은 바꾸지 않습니다. [공간] 탭에 없는 교실의 내역은 옮기지 않고 실행 로그에 알려 줍니다.
 *
 * 쓰는 법 (앱스크립트 편집기, 파일 이름 "Import"):
 *   1) checkLedger  실행 → 어느 교실이 [공간] 탭의 어느 줄과 짝지어지는지 실행 로그로 확인 (아무것도 바꾸지 않음)
 *   2) importLedger 실행 → [예약] 탭에 옮김
 * 여러 번 실행해도 됩니다. 실행할 때마다 이전에 이 스크립트가 옮긴 줄을 지우고 [공간] 탭 기준으로 다시 만듭니다.
 * 사용 내역이 들어 있으므로 공개된 곳에 올리지 마세요.
 */

var LEDGER_MEMO_ = '기존 사용 대장에서 옮김';
var LEDGER_SLOTS_ = %s;
var LEDGER_OLD_IDS_ = %s;
// 대장의 교실: [대표 이름, 같은 곳을 가리키는 다른 이름…]
var LEDGER_SHEETS_ = %s;
// [교실 번호(위 목록 순서), 날짜, [칸 번호…], 내용]
var LEDGER_BOOKINGS_ = %s;

function ledgerNorm_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s()\[\]{}·・.,_\-\/]/g, '');
}

/** 대장의 교실마다 [공간] 탭의 줄을 찾습니다. 반환: [{name, room: {id, name} | null, how}] */
function ledgerMatch_() {
  var rooms = readTab_('공간').filter(function (r) { return r['ID'] && r['이름']; })
    .map(function (r) { return { id: r['ID'], name: r['이름'], key: ledgerNorm_(r['이름']) }; });
  var used = {};
  var out = LEDGER_SHEETS_.map(function (names) { return { name: names[0], keys: names.map(ledgerNorm_), room: null, how: '' }; });
  // 1) 이름이 같은 것 (띄어쓰기·괄호 무시)
  out.forEach(function (m) {
    var hit = rooms.filter(function (r) { return !used[r.id] && m.keys.indexOf(r.key) >= 0; });
    if (hit.length === 1) { m.room = hit[0]; m.how = '이름 일치'; used[hit[0].id] = true; }
    else if (hit.length > 1) m.how = '같은 이름의 공간이 ' + hit.length + '개';
  });
  // 2) 대표 이름이 들어 있는 것 (예: "설렘온1실(본관 2층)") — 후보가 하나뿐일 때만
  out.forEach(function (m) {
    if (m.room || m.how) return;
    var k = m.keys[0];
    var hit = rooms.filter(function (r) { return !used[r.id] && r.key.length >= 3 && (r.key.indexOf(k) >= 0 || k.indexOf(r.key) >= 0); });
    var rivals = out.filter(function (o) { return o !== m && !o.room && hit.length === 1 && (hit[0].key.indexOf(o.keys[0]) >= 0 || o.keys[0].indexOf(hit[0].key) >= 0); });
    if (hit.length === 1 && !rivals.length) { m.room = hit[0]; m.how = '비슷한 이름'; used[hit[0].id] = true; }
    else if (hit.length > 1) m.how = '비슷한 이름의 공간이 ' + hit.length + '개';
  });
  return out;
}

function ledgerReport_(match) {
  var count = {};
  LEDGER_BOOKINGS_.forEach(function (b) { count[b[0]] = (count[b[0]] || 0) + 1; });
  var lines = [], miss = [];
  match.forEach(function (m, i) {
    var n = count[i] || 0;
    if (m.room) lines.push('  ' + m.name + '  →  [' + m.room.id + '] ' + m.room.name + '  (' + m.how + ', 예약 ' + n + '건)');
    else miss.push('  ' + m.name + '  (' + (m.how || '[공간] 탭에 없음') + ', 예약 ' + n + '건은 옮기지 않음)');
  });
  console.log('[공간] 탭과 짝지어진 교실 ' + lines.length + '곳\n' + (lines.join('\n') || '  (없음)'));
  if (miss.length) console.log('짝을 찾지 못한 교실 ' + miss.length + '곳 — [공간] 탭의 이름을 대장의 교실 이름과 같게 고친 뒤 다시 실행하면 옮겨집니다\n' + miss.join('\n'));
}

/** 이전 버전의 가져오기가 [공간] 탭을 바꿔 놓았으면 가장 최근 백업 탭에서 되돌립니다. 되돌렸으면 백업 탭 이름을 돌려줍니다. */
function ledgerRestoreRooms_() {
  var ids = readTab_('공간').map(function (r) { return r['ID']; }).sort().join(',');
  if (ids !== LEDGER_OLD_IDS_.slice().sort().join(',')) return '';
  var sh = sheet_('공간');
  var backups = sh.getParent().getSheets().filter(function (s) { return s.getName().indexOf('공간_백업_') === 0; })
    .sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  if (!backups.length) return '';
  var src = backups[0];   // 가장 먼저 만든 백업 = 가져오기 전의 원래 값
  var v = src.getDataRange().getDisplayValues();
  sh.copyTo(sh.getParent()).setName('공간_가져온값_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMdd_HHmmss'));
  sh.getRange(1, 1, Math.max(1, sh.getLastRow()), Math.max(1, sh.getLastColumn())).clearContent();
  sh.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v);
  delete tabCache_['공간'];
  return src.getName();
}

/** 이전에 [공간] 탭이 바뀌었다면 되돌리기만 합니다. */
function restoreRooms() {
  return withLock_(function () {
    var from = ledgerRestoreRooms_();
    console.log(from ? "[공간] 탭을 '" + from + "' 탭의 내용으로 되돌렸습니다. (바뀌어 있던 값은 '공간_가져온값_…' 탭에 남겼습니다)"
      : '[공간] 탭은 되돌릴 필요가 없는 상태입니다. (가져오기가 넣은 값이 아니거나 백업 탭이 없음)');
    return from;
  });
}

/** 아무것도 바꾸지 않고, 짝지어진 결과만 실행 로그에 보여 줍니다. */
function checkLedger() {
  var ids = readTab_('공간').map(function (r) { return r['ID']; }).sort().join(',');
  if (ids === LEDGER_OLD_IDS_.slice().sort().join(',')) {
    console.log('지금 [공간] 탭에는 이전 가져오기가 넣은 값이 들어 있습니다. importLedger 를 실행하면 먼저 백업 탭의 원래 값으로 되돌린 뒤 옮깁니다. (되돌리기만 하려면 restoreRooms)');
    return;
  }
  ledgerReport_(ledgerMatch_());
}

function importLedger() {
  return withLock_(function () {
    var restored = ledgerRestoreRooms_();
    if (restored) console.log("[공간] 탭을 '" + restored + "' 탭의 내용으로 먼저 되돌렸습니다.");

    var periods = readTab_('교시');
    var slotId = LEDGER_SLOTS_.map(function (name) {
      var hit = periods.filter(function (p) { return p['이름'] === name; })[0] ||
        periods.filter(function (p) { return String(p['이름']).indexOf(name) === 0 || name.indexOf(String(p['이름'])) === 0; })[0];
      if (!hit) throw new Error("[교시] 탭에 '" + name + "' 이(가) 없어요. 교시 이름을 확인한 뒤 다시 실행해 주세요. ([예약] 탭은 바꾸지 않았습니다)");
      return hit['ID'];
    });

    var match = ledgerMatch_();
    ledgerReport_(match);
    var now = nowStr_();
    var head = TABS_['예약'];
    var seen = {};
    var add = [];
    LEDGER_BOOKINGS_.forEach(function (b) {
      var room = match[b[0]].room;
      if (!room) return;
      var ids = b[2].map(function (i) { return slotId[i]; });
      var id = 'L-' + room.id + '-' + b[1].replace(/-/g, '') + '-' + ids[0];
      if (seen[id]) return;
      seen[id] = true;
      add.push({
        'ID': id, '묶음ID': '', '공간ID': room.id, '날짜': b[1], '교시': ids.join(','),
        '이메일': '', '이름': '기존 대장', '역할': '교직원', '소속': '', '목적': b[3], '인원': '',
        '상태': '확정', '신청일시': now, '수정일시': '', '처리자': '', '비고': LEDGER_MEMO_
      });
    });

    // [예약] 탭: 이 스크립트가 예전에 옮긴 줄만 빼고 그대로 두고, 새로 만든 줄을 뒤에 붙여 한 번에 다시 씁니다.
    var sh = sheet_('예약');
    var cols = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var iId = cols.indexOf('ID'), iMemo = cols.indexOf('비고');
    if (iId < 0 || iMemo < 0) throw new Error("[예약] 탭 머리글에 'ID' 또는 '비고' 가 없어요. ([예약] 탭은 바꾸지 않았습니다)");
    var last = sh.getLastRow();
    var old = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getDisplayValues() : [];
    var keep = old.filter(function (r) {
      if (r.join('').trim() === '') return false;
      return !(String(r[iId]).indexOf('L-') === 0 && String(r[iMemo]).trim() === LEDGER_MEMO_);
    });
    var removed = old.filter(function (r) { return r.join('').trim() !== ''; }).length - keep.length;
    var text = function (v) { v = v == null ? '' : String(v); return /^[=+\-@]/.test(v) ? "'" + v : v; };
    var all = keep.map(function (r) { return r.map(text); })
      .concat(add.map(function (o) { return cols.map(function (h) { return text(o[h]); }); }));
    if (sh.getMaxRows() < all.length + 1) sh.insertRowsAfter(sh.getMaxRows(), all.length + 1 - sh.getMaxRows());
    if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, cols.length).setNumberFormat('@').setValues(all);
    delete tabCache_['예약'];

    var ok = match.filter(function (m) { return m.room; }).length;
    var msg = '예약 ' + add.length + '건을 옮겼습니다 (교실 ' + ok + '/' + match.length + '곳' +
      (removed ? ', 이전에 옮긴 ' + removed + '건은 지우고 다시 만듦' : '') + ', 그 밖의 예약 ' + keep.length + '건은 그대로).';
    appendRows_('기록', [{
      '일시': now, '이메일': String(Session.getEffectiveUser().getEmail() || ''), '이름': '가져오기', '동작': '가져오기',
      '예약ID': '', '공간': '', '날짜': '', '내용': '기존 사용 대장(2026학년도): ' + msg, '변경전': '', '변경후': ''
    }]);
    console.log(msg);
    return msg;
  });
}
""" % (json.dumps(SLOTS, ensure_ascii=False), json.dumps(OLD_IDS),
       '[\n  ' + ',\n  '.join(json.dumps(x, ensure_ascii=False) for x in sheets) + '\n]',
       '[\n  ' + ',\n  '.join(json.dumps(b, ensure_ascii=False, separators=(',', ':')) for b in bookings) + '\n]')
open(out_path, 'w', encoding='utf-8').write(js)
for name, c, b in report: print('%-22s 칸 %5d  예약 %5d' % (name, c, b))
for name, d, texts in dropped: print('같은 날짜가 두 번: %s %s — 위쪽 행은 2025년으로 보고 뺌 %s' % (name, d, texts or '(빈 행)'))
print('합계: 교실 %d곳, 예약 %d건 → %s (%d KB)' % (len(sheets), len(bookings), out_path, len(js.encode()) // 1024))
