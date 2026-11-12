// 미리보기 파일 만들기:  node dev/build-preview.js  →  preview.html
// index.html 의 <!--PREVIEW--> 자리에 실제 서버 코드와 가짜 저장소를 끼워 넣습니다.
const fs = require('fs');
const path = require('path');
const { serverSource, root } = require('./load.js');

const shim = fs.readFileSync(path.join(__dirname, 'preview-shim.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes('<!--PREVIEW-->')) throw new Error('index.html 에 <!--PREVIEW--> 표시가 없습니다');
const inject = '<script>\n' + (serverSource() + '\n;\n' + shim).replace(/<\/script/gi, '<\\/script') + '\n</script>';
fs.writeFileSync(path.join(root, 'preview.html'), html.replace('<!--PREVIEW-->', () => inject));
console.log('preview.html 을 만들었습니다.');
