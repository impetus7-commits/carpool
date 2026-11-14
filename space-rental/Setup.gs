/**
 * 학교 공간 대여 — 탭 머리글, 예시 데이터, 처음 설정
 * 시트 메뉴 [공간대여 → 처음 설정]을 한 번 실행하면 필요한 탭이 만들어집니다.
 */

var TABS_ = {
  '공간': ['ID', '건물', '층', '순서', '이름', '수용인원', '용도', '시설', '특이사항', '소개', '사진', '영상', '신청가능', '동시예약수'],
  '사용자': ['이메일', '이름', '역할', '소속'],
  '교시': ['ID', '이름', '시작', '종료'],
  '예약': ['ID', '묶음ID', '공간ID', '날짜', '교시', '이메일', '이름', '역할', '소속', '목적', '인원', '상태', '신청일시', '수정일시', '처리자', '비고', '사용학교', '사용부서', '공동사용', '기기'],
  '기록': ['일시', '이메일', '이름', '동작', '예약ID', '공간', '날짜', '내용', '변경전', '변경후', '기기'],
  '설정': ['항목', '값', '설명']
};

/** 예시 데이터 — 학교 실정에 맞게 시트에서 고쳐 쓰세요. */
var SAMPLE_ = {
  '공간': [
    ['A101', '본관', '1', '1', '교무실', '', '', '', '교직원 업무 공간', '', '', '', 'N', ''],
    ['A102', '본관', '1', '2', '시청각실', '120', '강연, 발표, 영상 시청, 설명회', '빔프로젝터, 음향, 마이크, 냉난방, 무대', '음식물 반입 금지. 사용 후 음향 장비 전원을 꺼 주세요.', '계단식 좌석 120석을 갖춘 강연·발표 공간입니다.', '', '', 'Y', ''],
    ['A103', '본관', '1', '3', '도서관', '60', '독서, 자습, 토론, 모둠 활동', '모둠 책상, 와이파이, 냉난방, 전자칠판', '점심시간에는 대출·반납 이용자와 함께 씁니다.', '장서 2만 권과 모둠 책상 10개가 있는 열린 학습 공간입니다.', '', '', 'Y', ''],
    ['A104', '본관', '1', '4', '보건실', '', '', '', '', '', '', '', 'N', ''],
    ['A201', '본관', '2', '1', '진로상담실', '8', '상담, 면접 연습, 소모임', '원탁, 냉난방, 와이파이', '상담 일정이 우선입니다.', '소규모 상담과 면접 연습에 알맞은 조용한 방입니다.', '', '', 'Y', ''],
    ['A202', '본관', '2', '2', '세미나실 1', '20', '회의, 토론, 발표, 동아리', '빔프로젝터, 화이트보드, 와이파이, 냉난방', '', '이동식 책상으로 배치를 자유롭게 바꿀 수 있습니다.', '', '', 'Y', ''],
    ['A203', '본관', '2', '3', '세미나실 2', '16', '회의, 토론, 동아리, 소모임', '전자칠판, 화이트보드, 와이파이, 냉난방', '', '전자칠판이 있는 소규모 회의 공간입니다.', '', '', 'Y', ''],
    ['A204', '본관', '2', '4', '컴퓨터실', '32', '정보 수업, 코딩, 온라인 평가, 영상 편집', '컴퓨터 32대, 빔프로젝터, 프린터, 냉난방', '개인 저장 장치 사용 전 담당 교사에게 알려 주세요.', '컴퓨터 32대가 있는 정보 교육 공간입니다.', '', '', 'Y', ''],
    ['A301', '본관', '3', '1', '과학실 1', '28', '실험, 과학 수업, 탐구 활동', '실험대, 개수대, 빔프로젝터, 환기 장치', '실험은 반드시 지도 교사와 함께 합니다.', '화학·물리 실험을 위한 실험대 7개가 있습니다.', '', '', 'Y', ''],
    ['A302', '본관', '3', '2', '과학실 2', '28', '실험, 과학 수업, 탐구 활동', '실험대, 개수대, 현미경, 빔프로젝터', '실험은 반드시 지도 교사와 함께 합니다.', '생명과학·지구과학 탐구용 실험실입니다.', '', '', 'Y', ''],
    ['A303', '본관', '3', '3', '수학교과교실', '30', '수업, 자습, 보충 학습', '전자칠판, 화이트보드, 냉난방', '', '벽면 전체가 화이트보드인 교과교실입니다.', '', '', 'Y', ''],
    ['A304', '본관', '3', '4', '영어교과교실', '30', '수업, 토론, 발표', '전자칠판, 음향, 냉난방', '', '모둠 배치가 쉬운 교과교실입니다.', '', '', 'Y', ''],
    ['A401', '본관', '4', '1', '음악실', '35', '음악 수업, 합창, 합주, 공연 연습', '피아노, 음향, 방음, 보면대', '악기는 제자리에 정리해 주세요.', '그랜드 피아노와 방음 시설을 갖춘 음악 공간입니다.', '', '', 'Y', ''],
    ['A402', '본관', '4', '2', '미술실', '30', '미술 수업, 전시 준비, 만들기', '작업대, 개수대, 이젤, 건조대', '물감 사용 후 개수대를 정리해 주세요.', '넓은 작업대가 있는 미술 공간입니다.', '', '', 'Y', ''],
    ['A403', '본관', '4', '3', '다목적실', '50', '댄스, 연극, 공연 연습, 체조, 행사', '전면 거울, 음향, 마루 바닥, 냉난방', '실내화를 신어 주세요.', '전면 거울과 마루 바닥이 있는 활동 공간입니다.', '', '', 'Y', ''],
    ['A404', '본관', '4', '4', '스터디카페', '24', '자습, 모둠 학습, 멘토링', '칸막이 책상, 와이파이, 냉난방', '대화는 모둠 구역에서만 해 주세요.', '개인 좌석과 모둠 좌석이 나뉜 자기주도학습 공간입니다.', '', '', 'Y', ''],
    ['A501', '본관', '5', '1', '대강당', '400', '행사, 공연, 입학식, 학년 모임, 강연', '무대, 조명, 음향, 마이크, 빔프로젝터', '무대 조명은 담당 교사만 조작합니다.', '전교생 행사와 공연을 여는 강당입니다.', '', '', 'Y', ''],
    ['B101', '창의관', '1', '1', '메이커실', '20', '만들기, 발명, 공학 동아리', '3D 프린터, 레이저 커터, 공구, 작업대', '장비는 사용 교육을 받은 사람만 다룹니다.', '3D 프린터 4대와 공구가 있는 제작 공간입니다.', '', '', 'Y', ''],
    ['B102', '창의관', '1', '2', '가사실', '24', '조리 실습, 가정 수업', '조리대, 인덕션, 냉장고, 개수대', '사용 후 가스·전기를 꼭 확인해 주세요.', '조리대 6개가 있는 실습 공간입니다.', '', '', 'Y', ''],
    ['B201', '창의관', '2', '1', '온라인 스튜디오', '6', '영상 촬영, 방송, 녹음, 온라인 수업', '카메라, 조명, 크로마키, 마이크, 방음', '장비 대여는 방송부 담당 교사에게 문의하세요.', '촬영과 녹음을 할 수 있는 작은 스튜디오입니다.', '', '', 'Y', ''],
    ['B202', '창의관', '2', '2', '토론실', '12', '토론, 회의, 모의 면접', '원탁, 전자칠판, 와이파이, 냉난방', '', '원탁 배치의 토론 전용 공간입니다.', '', '', 'Y', ''],
    ['C101', '체육관', '1', '1', '체육관', '300', '체육 수업, 경기, 행사, 체육 동아리', '농구 골대, 배구 네트, 음향, 탈의실', '실내 운동화를 신어 주세요.', '농구·배구·배드민턴을 할 수 있는 실내 체육관입니다.', '', '', 'Y', '3'],
    ['C201', '체육관', '2', '1', '탁구장', '16', '탁구, 체육 동아리', '탁구대 4대, 냉난방', '', '탁구대 4대가 있는 소규모 체육 공간입니다.', '', '', 'Y', '']
  ],
  '교시': [
    ['P0', '아침', '07:50', '08:30'],
    ['P1', '1교시', '08:40', '09:30'],
    ['P2', '2교시', '09:40', '10:30'],
    ['P3', '3교시', '10:40', '11:30'],
    ['P4', '4교시', '11:40', '12:30'],
    ['PL', '점심', '12:30', '13:30'],
    ['P5', '5교시', '13:30', '14:20'],
    ['P6', '6교시', '14:30', '15:20'],
    ['P7', '7교시', '15:30', '16:20'],
    ['PA', '방과후', '16:30', '18:00'],
    ['PN', '야간', '18:50', '21:00']
  ],
  '설정': [
    ['학교이름', '우리고등학교', '화면 맨 위에 보이는 이름'],
    ['안내문', '사용 후에는 정리 정돈과 전원 확인을 부탁드립니다.', '첫 화면에 보이는 한 줄 안내 (비워도 됨)'],
    ['예약가능일수', '60', '오늘부터 며칠 뒤까지 신청할 수 있는지'],
    ['반복예약최대일수', '200', '반복 예약의 종료일을 오늘부터 며칠 뒤까지 허용할지'],
    ['관리자', '', '화면 위쪽에 "관리자 : ○○" 로 보이는 이름 (비우면 표시하지 않음)']
  ]
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('공간대여')
    .addItem('처음 설정 (탭 만들기)', 'setup')
    .addItem('관리자 비밀번호 정하기', 'setAdminPassword')
    .addToUi();
}

/**
 * 웹 화면의 [관리] 메뉴에 들어갈 때 쓰는 비밀번호를 정합니다.
 * 구글시트 메뉴 [공간대여 → 관리자 비밀번호 정하기]로 실행하세요. (편집기에서 실행해도, 시트 화면에 입력 창이 뜹니다.)
 * 비밀번호 자체는 저장하지 않고, 알아볼 수 없게 바꾼 값만 스크립트 속성에 둡니다. 시트에는 보이지 않습니다.
 */
function setAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('관리자 비밀번호 정하기', '웹 화면의 [관리] 메뉴에서 쓸 비밀번호를 넣어 주세요. (6자 이상)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pw = String(res.getResponseText() || '').trim();
  if (pw.length < 6) { ui.alert('6자 이상으로 정해 주세요. 바꾸지 않았습니다.'); return; }
  var salt = Utilities.getUuid();
  setProp_('ADMIN_SALT', salt);
  setProp_('ADMIN_HASH', sha256_(salt + pw));
  ui.alert('관리자 비밀번호를 정했습니다.\n\n이미 로그인해 있던 관리자는 최대 6시간 뒤에 다시 로그인해야 합니다.');
}

/**
 * 필요한 탭을 만들고, 비어 있으면 예시 데이터를 채웁니다. 여러 번 실행해도 기존 내용은 지우지 않습니다.
 * 연결된 시트가 없으면(시트 밖에서 만든 프로젝트) "학교 공간 대여" 시트를 새로 만들어 연결합니다.
 * 끝나면 아래 [실행 로그]에 시트 주소가 나옵니다.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SHEET_ID');
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('학교 공간 대여');
      props.setProperty('SHEET_ID', ss.getId());
    }
  }
  Object.keys(TABS_).forEach(function (name) {
    var head = TABS_[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, head.length).setValues([head]);
    } else {
      // 이미 쓰던 탭이면, 새로 생긴 머리글만 오른쪽 끝에 덧붙입니다 (기존 내용은 그대로).
      var have = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
      var missing = head.filter(function (h) { return have.indexOf(h) < 0; });
      if (missing.length) {
        var at = sh.getLastColumn() + 1;
        if (sh.getMaxColumns() < at + missing.length - 1) sh.insertColumnsAfter(sh.getMaxColumns(), at + missing.length - 1 - sh.getMaxColumns());
        sh.getRange(1, at, 1, missing.length).setNumberFormat('@').setValues([missing]);
      }
    }
    var width = sh.getLastColumn();
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1c7c45').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (sh.getLastRow() === 1 && SAMPLE_[name]) {
      sh.getRange(2, 1, SAMPLE_[name].length, head.length).setValues(SAMPLE_[name]);
    }
  });

  // [공간] 여러 팀이 함께 쓰는 곳은 동시예약수가 비어 있으면 3을 넣습니다 (다른 숫자를 적어 두었으면 그대로 둡니다).
  var rooms = ss.getSheetByName('공간');
  var rHead = rooms.getRange(1, 1, 1, rooms.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var cName = rHead.indexOf('이름'), cMulti = rHead.indexOf('동시예약수');
  if (cName >= 0 && cMulti >= 0 && rooms.getLastRow() > 1) {
    var rv = rooms.getRange(2, 1, rooms.getLastRow() - 1, rooms.getLastColumn()).getDisplayValues();
    rv.forEach(function (r, i) {
      if (/^(체육관|동진실|작은정원|스쿨캠핑)$/.test(String(r[cName]).trim()) && !String(r[cMulti]).trim()) {
        rooms.getRange(i + 2, cMulti + 1).setNumberFormat('@').setValue('3');
      }
    });
  }

  // [설정] 새로 생긴 항목이 없으면 줄을 덧붙입니다.
  var conf = ss.getSheetByName('설정');
  var keys = conf.getLastRow() > 1 ? conf.getRange(2, 1, conf.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var extra = SAMPLE_['설정'].filter(function (r) { return keys.indexOf(r[0]) < 0; });
  if (extra.length) conf.getRange(conf.getLastRow() + 1, 1, extra.length, 3).setNumberFormat('@').setValues(extra);

  var users = ss.getSheetByName('사용자');
  if (users.getLastRow() === 1) {
    users.getRange(2, 1, 1, 4).setValues([[Session.getEffectiveUser().getEmail(), '관리자', '관리자', '']]);
  }
  users.getRange('C2:C').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['교직원', '학생', '관리자'], true).build());
  ss.getSheetByName('공간').getRange('M2:M').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).build());

  ['예약', '기록'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sh.protect().setDescription('웹앱이 자동으로 쓰는 탭입니다').setWarningOnly(true);
    }
  });

  var first = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  SpreadsheetApp.flush();
  var made = ss.getSheets().map(function (s) { return s.getName(); }).join(', ');
  console.log('설정이 끝났습니다. 탭: ' + made);
  console.log('구글시트 주소: ' + ss.getUrl());
  try {
    SpreadsheetApp.getUi().alert('설정이 끝났습니다.\n\n1) [사용자] 탭에 교직원·학생 계정을 등록하세요.\n2) [공간] 탭을 학교에 맞게 고치세요.\n3) 앱스크립트 편집기 오른쪽 위 [배포 → 새 배포]로 웹앱을 배포하세요.');
  } catch (e) {
    // 시트 화면이 열려 있지 않으면 알림 창을 띄울 수 없습니다. 실행 로그의 주소로 시트를 여세요.
  }
}
