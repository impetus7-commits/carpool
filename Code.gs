/**
 * 행사 카풀 보드 — Google Apps Script 웹앱 서버
 * 데이터는 스크립트 속성(PropertiesService)에 저장합니다.
 *   event      : 행사 정보 JSON
 *   car_<id>   : 차량 1대 JSON (운전자, 출발 시각/장소, 좌석, 탑승자)
 */

var MAX_SEATS = 8;
// 관리자 비밀번호는 Secret.gs 의 ADMIN_PIN 에 둡니다 (Git에는 올리지 않는 파일, Secret.example.gs 참고).

function adminPin_() {
  return typeof ADMIN_PIN === 'undefined' ? '' : String(ADMIN_PIN);
}

/* ---------- 비밀번호 잠금: 5번 틀리면 10분 동안 막음 ---------- */

var MAX_FAILS = 5;     // 허용하는 연속 실패 횟수
var LOCK_SEC = 600;    // 잠금 시간(초) = 10분

function guard_(key) {
  var until = +CacheService.getScriptCache().get('lock_' + key) || 0;
  var left = until - Date.now();
  if (left > 0) {
    throw new Error('비밀번호를 여러 번 틀려서 잠시 막혔어요. ' + Math.ceil(left / 60000) + '분 뒤에 다시 시도해 주세요.');
  }
}

/** 실패를 1회 기록하고 남은 기회를 돌려줍니다. 0이면 방금 잠긴 것입니다. */
function fail_(key) {
  var cache = CacheService.getScriptCache();
  var n = (+cache.get('fail_' + key) || 0) + 1;
  if (n >= MAX_FAILS) {
    cache.put('lock_' + key, String(Date.now() + LOCK_SEC * 1000), LOCK_SEC);
    cache.remove('fail_' + key);
    return 0;
  }
  cache.put('fail_' + key, String(n), LOCK_SEC);
  return MAX_FAILS - n;
}

function pass_(key) {
  CacheService.getScriptCache().remove('fail_' + key);
}

function failMsg_(base, left) {
  return left ? base + ' (남은 기회 ' + left + '번)' : '비밀번호를 ' + MAX_FAILS + '번 틀려서 ' + (LOCK_SEC / 60) + '분 동안 막혔어요.';
}

/** 반드시 잠금(withLock_/locked_) 안에서 부릅니다. */
function checkAdmin_(pin) {
  guard_('admin');
  var real = adminPin_();
  if (!real || String(pin || '') !== real) throw new Error(failMsg_('관리자 비밀번호가 맞지 않아요.', fail_('admin')));
  pass_('admin');
}

/** 관리자 비밀번호 확인만 합니다. */
function checkAdmin(pin) {
  return locked_(function () { checkAdmin_(pin); return true; });
}

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('행사 카풀')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- 읽기 ---------- */

function getState() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var cars = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('car_') === 0) {
      try {
        var car = JSON.parse(props[k]);
        delete car.pinHash; // 비밀번호는 화면으로 내보내지 않음
        cars.push(car);
      } catch (e) {}
    }
  });
  cars.sort(function (a, b) {
    return (a.time || '').localeCompare(b.time || '') || a.createdAt - b.createdAt;
  });
  var event = {};
  try { event = JSON.parse(props.event || '{}'); } catch (e) {}
  return { event: event, cars: cars, url: ScriptApp.getService().getUrl(), now: Date.now() };
}

/* ---------- 쓰기 (모두 잠금 안에서 처리) ---------- */

function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn(PropertiesService.getScriptProperties());
  } finally {
    lock.releaseLock();
  }
}

function withLock_(fn) {
  locked_(fn);
  return getState();
}

function clean_(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function readCar_(store, id) {
  var raw = store.getProperty('car_' + clean_(id, 40));
  if (!raw) throw new Error('이미 삭제된 차량입니다. 화면을 새로고침해 주세요.');
  return JSON.parse(raw);
}

function hashPin_(id, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + ':' + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function saveEvent(ev, adminPin) {
  return withLock_(function (store) {
    checkAdmin_(adminPin);
    store.setProperty('event', JSON.stringify({
      title: clean_(ev.title, 40),
      date: clean_(ev.date, 10),
      place: clean_(ev.place, 60),
      note: clean_(ev.note, 120)
    }));
  });
}

function addCar(c) {
  var driver = clean_(c.driver, 20);
  var seats = Math.max(1, Math.min(MAX_SEATS, parseInt(c.seats, 10) || 0));
  if (!driver) throw new Error('운전자 이름을 입력해 주세요.');
  if (!/^\d{2}:\d{2}$/.test(c.time || '')) throw new Error('출발 시각을 선택해 주세요.');
  var backTime = /^\d{2}:\d{2}$/.test(c.backTime || '') ? c.backTime : '';
  var pin = String(c.pin || '');
  if (!/^\d{4}$/.test(pin)) throw new Error('삭제용 비밀번호 숫자 4자리를 입력해 주세요.');
  return withLock_(function (store) {
    var id = Utilities.getUuid().slice(0, 8);
    var riders = [];
    for (var i = 0; i < seats; i++) riders.push(null);
    store.setProperty('car_' + id, JSON.stringify({
      id: id,
      driver: driver,
      time: c.time,
      from: clean_(c.from, 40),
      backTime: backTime,
      backTo: clean_(c.backTo, 40),
      memo: clean_(c.memo, 80),
      riders: riders,
      pinHash: hashPin_(id, pin),
      createdAt: Date.now()
    }));
  });
}

/** 등록할 때 정한 4자리 비밀번호(또는 관리자 비밀번호)가 맞아야 삭제됩니다. 5번 틀리면 10분 동안 막힙니다. */
function deleteCar(id, pin) {
  return withLock_(function (store) {
    var car = readCar_(store, id);
    pin = String(pin || '');
    var key = 'car_' + car.id;
    if (car.pinHash) {
      guard_(key);
      var isAdmin = adminPin_() && pin === adminPin_();
      if (isAdmin) guard_('admin'); // 관리자 비밀번호가 잠긴 동안에는 관리자 비밀번호로도 삭제 불가
      if (!isAdmin && hashPin_(car.id, pin) !== car.pinHash) {
        fail_('admin'); // 이 경로로 관리자 비밀번호를 맞혀 보는 것도 막음
        throw new Error(failMsg_('비밀번호가 맞지 않아요. 차를 등록한 분께 확인해 주세요.', fail_(key)));
      }
      pass_(key);
      if (isAdmin) pass_('admin');
    }
    store.deleteProperty('car_' + car.id);
  });
}

function joinSeat(id, seat, name) {
  name = clean_(name, 20);
  if (!name) throw new Error('이름을 입력해 주세요.');
  return withLock_(function (store) {
    var car = readCar_(store, id);
    if (seat < 0 || seat >= car.riders.length) throw new Error('없는 좌석입니다.');
    if (car.riders[seat]) throw new Error('방금 ' + car.riders[seat] + '님이 먼저 앉았어요. 다른 자리를 골라 주세요.');
    car.riders[seat] = name;
    store.setProperty('car_' + car.id, JSON.stringify(car));
  });
}

function leaveSeat(id, seat) {
  return withLock_(function (store) {
    var car = readCar_(store, id);
    if (seat >= 0 && seat < car.riders.length) car.riders[seat] = null;
    store.setProperty('car_' + car.id, JSON.stringify(car));
  });
}

/** 다음 행사를 위해 차량·탑승 기록을 모두 지웁니다 (행사 정보는 유지). */
function resetCars(adminPin) {
  return withLock_(function (store) {
    checkAdmin_(adminPin);
    Object.keys(store.getProperties()).forEach(function (k) {
      if (k.indexOf('car_') === 0) store.deleteProperty(k);
    });
  });
}
