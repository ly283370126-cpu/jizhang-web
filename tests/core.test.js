/* 核心逻辑测试 —— 直接 `node tests/core.test.js` 跑，零依赖。
 * 这里锁的是「记账 App 的信任」：金额一分不差、时间不记错、多笔不漏。
 */
const JZ = require('../js/core.js');

let passed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${label}\n    实际: ${a}\n    期望: ${e}`);
}
function ok(value, label) { eq(!!value, true, label); }

function parts(d) { return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes() }; }

const now = new Date(2026, 8, 28, 15, 0, 0);            // 2026-09-28 周一 15:00
const CATS = JZ.DEFAULT_CATEGORIES;
const ACCTS = JZ.DEFAULT_ACCOUNTS;
const food = CATS.find((c) => c.name === '餐饮').id;
const transport = CATS.find((c) => c.name === '交通').id;
const wechat = ACCTS.find((a) => a.name === '微信').id;

// ── 金额：整数分 ─────────────────────────────────────────────
eq(JZ.Money.format(123456), '¥1234.56', '格式化 123456 分');
eq(JZ.Money.format(1200), '¥12.00', '格式化 1200 分');
eq(JZ.Money.format(-500), '-¥5.00', '负数是收入方向时的显示');
eq(JZ.Money.fromYuanText('3.6'), 360, '3.6 元 = 360 分（不走浮点）');
eq(JZ.Money.fromYuanText('0.01'), 1, '0.01 元 = 1 分');
eq(JZ.Money.fromYuanText('12'), 1200, '12 元 = 1200 分');

// ── 金额抽取 ────────────────────────────────────────────────
eq(JZ.extractAll('早餐12，午饭35，打车25').map((a) => a.minor), [1200, 3500, 2500], '一句话三笔');
eq(JZ.extractFirst('今天早上公交 3.6 元').minor, 360, '规格书例子：3.6 元');
eq(JZ.extractFirst('12块5').minor, 1250, '12块5 = 12.50');
eq(JZ.extractFirst('3块20').minor, 320, '3块20 = 3.20（两位按分）');
eq(JZ.extractFirst('三块二十').minor, 320, '中文：三块二十 = 3.20');
eq(JZ.extractFirst('三块六').minor, 360, '中文：三块六 = 3.60（一位按角）');
eq(JZ.extractFirst('3块6角').minor, 360, '带单位：3块6角');
eq(JZ.extractFirst('1元5分').minor, 105, '带单位：1元5分');
eq(JZ.extractFirst('三十五元').minor, 3500, '中文数字：三十五元');
eq(JZ.extractFirst('两百块').minor, 20000, '中文数字：两百块');
eq(JZ.extractAll('9月28日 打车25').map((a) => a.minor), [2500], '日期里的数字不能被当金额');
eq(JZ.extractAll('18:30 咖啡18元').map((a) => a.minor), [1800], '钟点不能被当金额');
eq(JZ.extractAll('买了3个苹果8元').map((a) => a.minor), [800], '量词「3个」不是金额');
eq(JZ.extractAll('第2次 花了30').map((a) => a.minor), [3000], '序号不是金额');
eq(JZ.extractAll('电话13812345678').length, 0, '手机号不是金额');
eq(JZ.extractAll('').length, 0, '空文本没有金额');

// ── 时间解析 ────────────────────────────────────────────────
eq(parts(JZ.parseDate('今天早上公交 3.6 元', now).date), { y: 2026, m: 9, d: 28, h: 7, min: 0 }, '今天早上 = 今天 07:00');
eq(parts(JZ.parseDate('昨天午饭35', now).date), { y: 2026, m: 9, d: 27, h: 12, min: 0 }, '昨天 = 昨天 12:00');
eq(parts(JZ.parseDate('晚上7点 火锅', now).date), { y: 2026, m: 9, d: 28, h: 19, min: 0 }, '晚上7点 = 19:00（不是早上 7 点）');
eq(parts(JZ.parseDate('上周五 聚餐', now).date), { y: 2026, m: 9, d: 25, h: 12, min: 0 }, '上周五 = 9/25');
eq(parts(JZ.parseDate('9月28日 打车25', now).date), { y: 2026, m: 9, d: 28, h: 12, min: 0 }, '9月28日');
eq(parts(JZ.parseDate('30日 打车25', now).date), { y: 2026, m: 8, d: 30, h: 12, min: 0 }, '未来的日号退到上个月（记账不记未来）');
eq(JZ.parseDate('没有时间词', now), null, '没有时间词就返回 null，不猜');
ok(JZ.parseDate('今天早上', now).explicit, '明确说了时间 → explicit');

// ── 切句 ────────────────────────────────────────────────────
eq(JZ.segments('早餐12，午饭35，打车25').length, 3, '标点切句');
eq(JZ.segments('早饭12还有午饭35').length, 2, '「还有」也要切开');
eq(JZ.segments('   ').length, 0, '空白不算片段');

// ── 本地判定（规则引擎） ─────────────────────────────────────
eq(JZ.judge('今天早上公交 3.6 元', { categories: CATS }).categoryId, transport,
   '「早上公交」要判成交通 —— 「早」不能盖过「公交」（最长匹配优先）');
eq(JZ.judge('早饭12', { categories: CATS }).categoryId, food, '早饭 → 餐饮');
eq(JZ.judge('打车25', { categories: CATS }).categoryId, transport, '打车 → 交通');
eq(JZ.judge('工资到账5000', { categories: CATS }).type, 'income', '工资 → 收入方向');
eq(JZ.judge('奈雪18', { categories: CATS, memory: { '奈雪': food } }).source, 'memory', '纠正过的商户走记忆');
eq(JZ.judge('奈雪18', { categories: CATS, memory: { '奈雪': food } }).categoryId, food, '记忆给出分类');
eq(JZ.extractMerchant('今天早上公交 3.6 元'), '公交', '商户抽取：剥掉时间和金额');
eq(JZ.extractMerchant('微信付的早饭12'), '早饭', '商户抽取：剥掉账户词');

// ── 一句话 → 草稿（不写库） ──────────────────────────────────
const parsed = JZ.parseInput('微信付的 早饭12 午饭35 打车25', { now, categories: CATS, accounts: ACCTS });
eq(parsed.kind, 'drafts', '识别为记账');
eq(parsed.drafts.map((d) => d.minor), [1200, 3500, 2500], '三笔金额');
eq(parsed.drafts.map((d) => d.categoryId), [food, food, transport], '三笔分类');
eq(parsed.drafts.map((d) => d.accountId).every((id) => id === wechat), true, '三笔都认出微信');
eq(parsed.drafts.every((d) => d.type === 'expense'), true, '都是支出');
eq(new Set(parsed.drafts.map((d) => d.fingerprint)).size, 3, '三笔指纹互不相同（不会被去重吃掉）');

// 没写时间 → 落到当天 12:00，而不是「现在几点了」（半夜记「早饭12」不能变成早饭在 23:50）
const midnight = new Date(2026, 8, 28, 23, 50, 0);
const noTime = JZ.parseInput('早饭12', { now: midnight, categories: CATS, accounts: ACCTS });
eq(parts(new Date(noTime.drafts[0].occurredAt)), { y: 2026, m: 9, d: 28, h: 12, min: 0 }, '没写时间 → 当天中午 12:00');
eq(noTime.drafts[0].dateExplicit, false, '没写时间 → 标记时间不确定（界面要问一句）');
const withTime = JZ.parseInput('晚上7点 打车25', { now: midnight, categories: CATS, accounts: ACCTS });
eq(parts(new Date(withTime.drafts[0].occurredAt)), { y: 2026, m: 9, d: 28, h: 19, min: 0 }, '晚上7点 = 19:00');
eq(withTime.drafts[0].dateExplicit, true, '写了时间 → 不再标不确定');

eq(JZ.parseInput('本月超过200元的账单', { now, categories: CATS }).kind, 'query', '查询意图');
eq(JZ.parseInput('本月超过200元的账单', { now, categories: CATS }).query.minMinor, 20000, '查询阈值来自本地抽取');
eq(JZ.parseInput('本月超过200元的账单', { now, categories: CATS }).query.rangeLabel, 'current_month', '查询范围');
eq(JZ.parseInput('今天花了多少', { now, categories: CATS }).query.rangeLabel, 'today', '今天 = today');
eq(JZ.parseInput('', { now }).kind, 'empty', '空输入');
eq(JZ.parseInput('今天天气不错', { now, categories: CATS }).kind, 'unknown', '没有金额也没有查询词 → 不知道');

// ── 去重指纹 ────────────────────────────────────────────────
const at = new Date(2026, 8, 28, 12, 30);
eq(JZ.dedupeKey(at, 1790, 'expense', '便利店'), JZ.dedupeKey(new Date(at), 1790, 'expense', '便利店'), '同一张截图两次 → 同一个指纹');
ok(JZ.dedupeKey(at, 1790, 'expense', '便利店') !== JZ.dedupeKey(at, 1790, 'expense', '超市'), '商户不同 → 指纹不同');

// ── 统计 / 预算（数字只来自本地） ────────────────────────────
const txs = [
  { occurredAt: new Date(2026, 8, 28, 8, 0).toISOString(), type: 'expense', minor: 1200, categoryId: food },
  { occurredAt: new Date(2026, 8, 28, 12, 0).toISOString(), type: 'expense', minor: 3500, categoryId: food },
  { occurredAt: new Date(2026, 8, 27, 9, 0).toISOString(), type: 'expense', minor: 20000, categoryId: transport },
  { occurredAt: new Date(2026, 8, 25, 9, 0).toISOString(), type: 'income', minor: 500000, categoryId: 'c-income' }
];
const todayRange = JZ.rangeFor('today', now);
eq(JZ.sum(txs.filter((t) => JZ.inRange(t, todayRange)), 'expense'), 4700, '今日支出 = 12 + 35');
eq(JZ.sum(txs.filter((t) => JZ.inRange(t, JZ.rangeFor('current_month', now))), 'expense'), 24700, '本月支出');
eq(JZ.byCategory(txs, CATS, 'expense')[0].name, '交通', '分类汇总第一名是交通（200 元）');
eq(JZ.dailyTotals(txs, null, 3, now).map((d) => d.expense), [0, 20000, 4700], '近三天趋势（空缺补 0）');

const budget = { minor: 300000, start: new Date(2026, 8, 1).toISOString(), end: new Date(2026, 8, 30, 23, 59).toISOString() };
const status = JZ.budgetStatus(budget, txs, now);
eq(status.spent, 24700, '预算已花 = 本月支出');
eq(status.remaining, 275300, '预算剩余');
eq(status.daysRemaining, 3, '9/28 → 9/30 还剩 3 天');
eq(status.dailyAvailable, Math.floor(275300 / 3), '今日可用 = 剩余 / 剩余天数');

// ── 结果 ────────────────────────────────────────────────────
if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log(`✓ 全部通过：${passed} 项`);
