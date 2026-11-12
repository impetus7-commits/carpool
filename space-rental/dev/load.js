// 테스트용: 실제 서버 코드(Logic, Setup, Code)와 가짜 저장소를 한 묶음으로 불러옵니다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const FILES = ['Logic.gs', 'Setup.gs', 'Code.gs', 'dev/mock-store.js'];

function serverSource() {
  return FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
}

/** 새 서버 한 벌. 반환값의 속성으로 서버 함수와 MOCK 을 쓸 수 있습니다. */
function loadServer() {
  const ctx = vm.createContext({ console });
  vm.runInContext(serverSource(), ctx);
  return ctx;
}

module.exports = { loadServer, serverSource, root };
