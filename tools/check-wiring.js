/* 界面接线自检：HTML 里被 JS 引用的 id / class / 资源文件是否真的存在。
 * 性质：静态检查，能抓住「选择器写错、文件漏了」这类只在浏览器里才炸的错误。
 * 用法：node tools/check-wiring.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');

const problems = [];
const checks = [];

function check(label, condition, detail) {
  checks.push(label);
  if (!condition) problems.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// 1) HTML 里声明的 id
const htmlIds = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]));

// 2) JS 里用到的 id（$('x') 与 getElementById('x') 与 querySelector('#x')）
const usedIds = new Set();
for (const m of app.matchAll(/\$\('([^']+)'\)/g)) usedIds.add(m[1]);
for (const m of app.matchAll(/getElementById\('([^']+)'\)/g)) usedIds.add(m[1]);
// 只从选择器上下文取 '#id'，否则会把 CSS 颜色（#F5F2EC）当成 id
for (const m of app.matchAll(/querySelector(?:All)?\('#([A-Za-z][\w-]*)'/g)) usedIds.add(m[1]);

for (const id of usedIds) {
  check(`id「${id}」在 HTML 里存在`, htmlIds.has(id), 'JS 会拿不到这个元素');
}

// 3) JS 里用到的 class 选择器（.xxx）在 CSS 或 HTML 里出现过
const usedClasses = new Set(Array.from(app.matchAll(/querySelector(?:All)?\('([^']+)'\)/g))
  .flatMap((m) => Array.from(m[1].matchAll(/\.([A-Za-z][\w-]*)/g)).map((x) => x[1])));
for (const cls of usedClasses) {
  check(`class「${cls}」有对应样式或元素`, css.includes('.' + cls) || html.includes('class="' + cls), '可能是拼错或漏样式');
}

// 4) HTML 引用的资源文件都在
const assets = Array.from(html.matchAll(/(?:src|href)="(?!http|#)([^"]+)"/g)).map((m) => m[1]);
for (const asset of assets) {
  check(`资源 ${asset} 存在`, fs.existsSync(path.join(ROOT, asset)), '部署后会 404');
}

// 5) 图标尺寸与 manifest 对得上
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) {
  check(`manifest 图标 ${icon.src} 存在`, fs.existsSync(path.join(ROOT, icon.src)), '主屏图标会缺失');
}

// 6) 没有把 key 之类的东西写进前端
const suspicious = ['apikey_', 'Bearer ', 'sk-', 'TYPESAFE_API_KEY'];
for (const needle of suspicious) {
  check(`前端没有硬编码「${needle}」`, !app.includes(needle) && !html.includes(needle), '密钥不能出现在页面里');
}

// 7) localStorage 键名与测试一致
const core = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
check('存储键名是 jz.v1', core.includes("'jz.v1'"), '改键名要考虑老数据');

if (problems.length) {
  console.error(`✗ 接线自检发现 ${problems.length} 个问题 / 共 ${checks.length} 项\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
  process.exit(1);
}
console.log(`✓ 接线自检全部通过：${checks.length} 项`);
console.log(`  （HTML 里 ${htmlIds.size} 个 id，JS 用到 ${usedIds.size} 个，引用资源 ${assets.length} 个）`);
