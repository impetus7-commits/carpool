"""기존 '교실 사용 대장' 엑셀 3종 → Import.gs (구글시트로 옮기는 일회용 스크립트) 만들기.

사용:  python3 -I dev/make-import.py <출력 Import.gs> <대장1.xlsx> <대장2.xlsx> <대장3.xlsx>

- 2026학년도(2026-03-01 ~ 2027-02-28) 칸만 옮깁니다.
- 같은 날 이어진 칸에 같은 내용이 있으면 예약 한 건으로 묶습니다.
- 만들어진 Import.gs 에는 사용 내역(이름 포함)이 들어 있으므로 저장소에 올리지 않습니다.
"""
import sys, json, datetime, collections, openpyxl

START, END = datetime.datetime(2026, 3, 1), datetime.datetime(2027, 2, 28)
# 대장의 9개 칸(C~K)과 그 뒤 한 칸(L) → 교시 이름. 시간대로 적힌 대장(중고교류용)도 같은 자리의 교시로 옮깁니다.
SLOTS = ['1교시', '2교시', '3교시', '4교시', '점심', '5교시', '6교시', '7교시', '방과후', '야간']

SHARED_NOTE = '중·고 공동 사용 공간입니다. 신청 전에 교감 선생님께 사용 가능 여부를 확인하세요. 정규 수업 시간은 표시되지 않을 수 있습니다.'
HS_NOTE = '사용 문의: 연구부행정지원부'
KEY_NOTE = '사용 문의·열쇠 대여: 연구부행정지원부'
U = '위치 미정'
# 시트 이름 → [ID, 건물, 층, 순서, 이름, 수용인원, 용도, 시설, 특이사항, 소개]
ROOMS = {
    '진로진학실': ['J01', '체육관', '3', 1, '진로진학실', '', '', '전자칠판', '', '교실 2개 크기'],
    '미네르바1실': ['M01', U, '미네르바실', 1, '미네르바1실', 25, '', '전자칠판', '', '교실 1개 크기, 25명 내외'],
    '미네르바2실': ['M02', U, '미네르바실', 2, '미네르바2실', 10, '', '이동용 전자칠판, 스마트티비', '', '교실 1개 크기, 책걸상 10개 이하'],
    '미네르바3실': ['M03', U, '미네르바실', 3, '미네르바3실', '', '', '', '', ''],
    '미네르바4실': ['M04', U, '미네르바실', 4, '미네르바4실', '', '', '', '', ''],
    '미네르바5실': ['M05', U, '미네르바실', 5, '미네르바5실', '', '', '', '', ''],
    '미네르바6실': ['M06', U, '미네르바실', 6, '미네르바6실', '', '', '', '', ''],
    '대강의실(아름자리)': ['H01', U, '고교학점제공간', 1, '대강의실(아름자리)', 50, '', '전자칠판, 전자교탁, 보조스크린 2개, 무선마이크', HS_NOTE, '50명 내외. 의자를 더 놓으면 50명 이상도 수용할 수 있습니다.'],
    '설렘온1실': ['H02', U, '고교학점제공간', 2, '설렘온1실', 30, '', '전자칠판, 전자교탁, 유튜브 실시간 방송 송출 기기', KEY_NOTE, '교실 1개 크기, 30명 이내'],
    '설렘온2실': ['H03', U, '고교학점제공간', 3, '설렘온2실', 10, '', '전자칠판', KEY_NOTE, '교실 1/2 크기, 10명 내외'],
    '설렘온3실': ['H04', U, '고교학점제공간', 4, '설렘온3실', 20, '', '전자칠판', KEY_NOTE, '교실 1/2 크기, 20명 이내'],
    '다운자리(스튜디오)': ['H05', U, '고교학점제공간', 5, '다운자리(스튜디오)', '', '', '', HS_NOTE, '디지털미디어센터 다운자리. 스튜디오 형식'],
    '다운자리(부스1)': ['H06', U, '고교학점제공간', 6, '다운자리(부스1)', '', '', '', HS_NOTE, '디지털미디어센터 다운자리. 부스 형식'],
    '다운자리(부스2)': ['H07', U, '고교학점제공간', 7, '다운자리(부스2)', '', '', '', HS_NOTE, '디지털미디어센터 다운자리. 부스 형식'],
    '건산홀(246석)': ['S01', U, '중고교류공간', 1, '건산홀', 246, '', '', SHARED_NOTE, '246석'],
    '체육관': ['S02', '체육관', '층 미정', 1, '체육관', '', '', '', SHARED_NOTE, ''],
    '동진실': ['S03', U, '중고교류공간', 2, '동진실', '', '', '', SHARED_NOTE, ''],
    '모던가옥': ['S04', U, '중고교류공간', 3, '모던가옥', '', '', '', SHARED_NOTE, ''],
    '스마트건강교실': ['S05', U, '중고교류공간', 4, '스마트건강교실', '', '', '', SHARED_NOTE, ''],
    '스쿨캠핑': ['S06', U, '중고교류공간', 5, '스쿨캠핑', '', '', '', SHARED_NOTE, ''],
    'LAB XR': ['S07', U, '중고교류공간', 6, 'LAB XR', '', '', '', SHARED_NOTE, ''],
    'VR 미팅룸': ['S08', U, '중고교류공간', 7, 'VR 미팅룸', '', '', '', SHARED_NOTE, ''],
}

def clean(v):
    return ' '.join(str(v).split()) if v is not None else ''

out_path, files = sys.argv[1], sys.argv[2:]
rooms, bookings, report, seen_sheets = [], [], [], set()
for f in files:
    wb = openpyxl.load_workbook(f, data_only=True)
    for ws in wb:
        if ws.title not in ROOMS:
            raise SystemExit('모르는 시트: ' + ws.title)
        seen_sheets.add(ws.title)
        meta = ROOMS[ws.title]
        rooms.append([str(x) for x in meta] + ['', '', 'Y'])
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
        days = collections.defaultdict(lambda: [[] for _ in SLOTS])   # 같은 날짜 행이 두 번 있으면 합침
        for r in range(1, ws.max_row + 1):
            d = grid.get((r, 1))
            if not isinstance(d, datetime.datetime) or not (START <= d <= END):
                continue
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
                bookings.append([meta[0], d.strftime('%Y-%m-%d'), list(range(i, j + 1)), texts[i][:100]])
                n_cells += j - i + 1; n_book += 1
                i = j + 1
        report.append((meta[4], n_cells, n_book))
missing = set(ROOMS) - seen_sheets
if missing: raise SystemExit('대장에 없는 시트: ' + ', '.join(missing))

js = '''/**
 * 기존 '2026 교실 사용 대장' 3종을 공간 대여 시트로 옮기는 일회용 스크립트입니다.
 * 앱스크립트 편집기에 "Import" 라는 스크립트 파일로 붙여 넣고, 함수 목록에서 importLedger 를 골라 실행하세요.
 * 여러 번 실행해도 같은 내용이 두 번 들어가지 않습니다. 다 옮긴 뒤에는 이 파일을 지워도 됩니다.
 * 사용 내역이 들어 있으므로 공개된 곳에 올리지 마세요.
 */

var LEDGER_SLOTS_ = %s;
// [ID, 건물, 층, 순서, 이름, 수용인원, 용도, 시설, 특이사항, 소개, 사진, 영상, 신청가능]
var LEDGER_ROOMS_ = %s;
// [공간ID, 날짜, [칸 번호…], 내용]
var LEDGER_BOOKINGS_ = %s;

function importLedger() {
  return withLock_(function () {
    // 1) 대장의 칸 → [교시] 탭의 ID
    var periods = readTab_('교시');
    var slotId = LEDGER_SLOTS_.map(function (name) {
      var hit = periods.filter(function (p) { return p['이름'] === name; })[0] ||
        periods.filter(function (p) { return String(p['이름']).indexOf(name) === 0 || name.indexOf(String(p['이름'])) === 0; })[0];
      if (!hit) throw new Error("[교시] 탭에 '" + name + "' 이(가) 없어요. 교시 이름을 확인한 뒤 다시 실행해 주세요. (아무것도 바꾸지 않았습니다)");
      return hit['ID'];
    });

    // 2) 공간: 처음이면 예시 공간을 백업한 뒤 실제 공간으로 바꾸고, 이미 옮겼으면 빠진 공간만 더함
    var head = TABS_['공간'];
    var have = {};
    readTab_('공간').forEach(function (r) { have[r['ID']] = true; });
    var fresh = LEDGER_ROOMS_.filter(function (r) { return !have[r[0]]; });
    var replaced = fresh.length === LEDGER_ROOMS_.length;
    if (replaced) ledgerClearRooms_();
    appendRows_('공간', fresh.map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    }));

    // 3) 예약: 아직 없는 것만 더함
    var done = {};
    readTab_('예약').forEach(function (r) { done[r['ID']] = true; });
    var now = nowStr_();
    var rows = [];
    LEDGER_BOOKINGS_.forEach(function (b) {
      var ids = b[2].map(function (i) { return slotId[i]; });
      var id = 'L-' + b[0] + '-' + b[1].replace(/-/g, '') + '-' + ids[0];
      if (done[id]) return;
      done[id] = true;
      rows.push({
        'ID': id, '묶음ID': '', '공간ID': b[0], '날짜': b[1], '교시': ids.join(','),
        '이메일': '', '이름': '기존 대장', '역할': '교직원', '소속': '', '목적': b[3], '인원': '',
        '상태': '확정', '신청일시': now, '수정일시': '', '처리자': '', '비고': '기존 사용 대장에서 옮김'
      });
    });
    appendRows_('예약', rows);

    var msg = '공간 ' + fresh.length + '곳' + (replaced ? ' (예시 공간은 백업 탭으로 옮김)' : '') + ', 예약 ' + rows.length + '건을 옮겼습니다.';
    appendRows_('기록', [{
      '일시': now, '이메일': String(Session.getEffectiveUser().getEmail() || ''), '이름': '가져오기', '동작': '가져오기',
      '예약ID': '', '공간': '', '날짜': '', '내용': '기존 사용 대장(2026학년도): ' + msg, '변경전': '', '변경후': ''
    }]);
    console.log(msg);
    return msg;
  });
}

/** [공간] 탭을 백업 탭으로 복사하고 머리글 아래를 비웁니다. */
function ledgerClearRooms_() {
  var sh = sheet_('공간');
  var last = sh.getLastRow();
  if (last < 2) return;
  sh.copyTo(book_()).setName('공간_백업_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MMdd_HHmmss'));
  sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  delete tabCache_['공간'];
}
''' % (json.dumps(SLOTS, ensure_ascii=False),
       '[\n  ' + ',\n  '.join(json.dumps(r, ensure_ascii=False) for r in rooms) + '\n]',
       '[\n  ' + ',\n  '.join(json.dumps(b, ensure_ascii=False, separators=(',', ':')) for b in bookings) + '\n]')
open(out_path, 'w', encoding='utf-8').write(js)
print('%-22s %6s %6s' % ('공간', '칸', '예약'))
for name, c, b in report: print('%-22s %6d %6d' % (name, c, b))
print('합계: 공간 %d곳, 칸 %d, 예약 %d건 → %s (%d KB)' % (len(rooms), sum(r[1] for r in report), len(bookings), out_path, len(js.encode()) // 1024))
