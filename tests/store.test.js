/* 存储层测试 —— `node tests/store.test.js`。用假 localStorage，不碰浏览器。 */
require('../js/core.js');
const { createStore } = require('../js/store.js');
const JZ = globalThis.JZ;

let passed = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${label}\n    实际: ${a}\n    期望: ${e}`);
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _map: map
  };
}

function tx(overrides) {
  return Object.assign({
    type: 'expense', minor: 1200, occurredAt: new Date(2026, 8, 28, 8, 0).toISOString(),
    categoryId: 'c-food', merchant: '早饭', fingerprint: 'fp-' + Math.random().toString(36).slice(2, 8)
  }, overrides || {});
}

// ── 基本读写 ────────────────────────────────────────────────
{
  const store = createStore(fakeStorage());
  eq(store.all().length, 0, '新库是空的');
  const result = store.addTransactions([tx(), tx(), tx()]);
  eq(result.ok, true, '三笔一次写入成功');
  eq(store.all().length, 3, '库里三笔');
  eq(store.all().map((t) => t.minor), [1200, 1200, 1200], '金额都是整数分');
}

// ── 原子性：整批要么全进要么全不进 ──────────────────────────
{
  const store = createStore(fakeStorage());
  store.addTransactions([tx({ fingerprint: 'dup' })]);
  const result = store.addTransactions([tx({ fingerprint: 'a' }), tx({ fingerprint: 'dup' }), tx({ fingerprint: 'c' })]);
  eq(result.ok, false, '撞到已存在的指纹 → 整批失败');
  eq(result.reason, 'duplicate', '失败原因是重复');
  eq(store.all().length, 1, '**失败后库里还是只有原来那 1 笔**（不能留下半批）');
}
{
  const store = createStore(fakeStorage());
  const result = store.addTransactions([tx({ fingerprint: 'same' }), tx({ fingerprint: 'same' })]);
  eq(result.ok, false, '批内自己撞指纹也算冲突');
  eq(store.all().length, 0, '批内冲突 → 一笔都不写');
}
{
  const store = createStore(fakeStorage());
  const result = store.addTransactions([tx(), tx({ minor: 0 })]);
  eq(result.ok, false, '金额为 0 的笔不能入账');
  eq(store.all().length, 0, '有非法笔 → 整批不写');
}

// ── 删除 / 修改 ─────────────────────────────────────────────
{
  const store = createStore(fakeStorage());
  store.addTransactions([tx({ fingerprint: 'x1' }), tx({ fingerprint: 'x2' })]);
  const target = store.all()[0];
  eq(store.removeTransaction(target.id).ok, true, '删除成功');
  eq(store.all().length, 1, '删掉一笔后剩一笔');
  eq(store.removeTransaction('不存在').ok, false, '删不存在的返回失败');
  eq(store.updateTransaction(target.id, { minor: 9999 }).ok, false, '改不存在的返回失败');
}

// ── 越用越准：纠正过的商户 ──────────────────────────────────
{
  const store = createStore(fakeStorage());
  store.learn('奈雪', 'c-food');
  eq(store.memory(), { '奈雪': 'c-food' }, '记忆写进去了');
  const parsed = JZ.parseInput('奈雪18', { now: new Date(2026, 8, 28, 15, 0), memory: store.memory() });
  eq(parsed.drafts[0].categoryId, 'c-food', '下次说「奈雪」自动归到餐饮');
  eq(parsed.drafts[0].ruleSource, 'memory', '来源标成记忆');
}

// ── 预算 ────────────────────────────────────────────────────
{
  const store = createStore(fakeStorage());
  const budget = store.setBudget(300000);
  eq(budget.minor, 300000, '预算 3000 元');
  // 关键：预算最后一天是「本月最后一天 23:59」，不是次月 1 日 —— 否则剩余天数会多算一天
  const end = new Date(budget.end);
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  eq(end.getDate(), lastDay, '预算结束落在本月最后一天');
  eq(end.getMonth(), now.getMonth(), '结束时间还在本月');
  const daysLeft = lastDay - now.getDate() + 1;
  const status = JZ.budgetStatus(budget, [], now);
  eq(status.daysRemaining, daysLeft, '本月还剩 ' + daysLeft + ' 天（含今天）');
  store.setBudget(0);
  eq(store.budget(), null, '设成 0 等于取消预算');
}

// ── 忘掉一条记性 ────────────────────────────────────────────
{
  const store = createStore(fakeStorage());
  store.learn('奈雪', 'c-food');
  eq(store.forget('奈雪').ok, true, '忘掉已存在的记性');
  eq(store.memory(), {}, '记性清单空了');
  eq(store.forget('奈雪').ok, false, '再忘一次返回失败');
}

// ── 导出 CSV ────────────────────────────────────────────────
{
  const store = createStore(fakeStorage());
  store.addTransactions([tx({ fingerprint: 'e1', merchant: '早饭', note: '早饭12' })]);
  const csv = store.exportCsv();
  const lines = csv.split('\n');
  eq(lines[0], '日期,类型,金额,分类,账户,商户,备注', 'CSV 表头');
  eq(lines.length, 2, '一行数据');
  eq(lines[1].includes('"12.00"'), true, '金额是两位小数');
  eq(lines[1].includes('"早饭12"'), true, '备注带上了原文');
}

// ── 数据坏了必须报错，不能静默变空账本 ──────────────────────
{
  const storage = fakeStorage();
  storage.setItem('jz.v1', '{这不是 JSON');
  const store = createStore(storage);
  let threw = null;
  try { store.all(); } catch (error) { threw = error.message; }
  eq(typeof threw === 'string', true, '损坏数据要抛错');
  eq((threw || '').includes('损坏'), true, '错误信息说明是数据损坏');
}
{
  const storage = fakeStorage();
  storage.getItem = () => { throw new Error('storage disabled'); };
  const store = createStore(storage);
  let threw = null;
  try { store.all(); } catch (error) { threw = error.message; }
  eq((threw || '').includes('不是「没有消费」'), true, '存储不可用要说清「不是没有消费」');
}

// ── 落盘后能读回来（真持久化，不是内存幻觉） ────────────────
{
  const storage = fakeStorage();
  const first = createStore(storage);
  first.addTransactions([tx({ fingerprint: 'persist', merchant: '早饭' })]);
  const second = createStore(storage);     // 模拟「关掉网页再打开」
  eq(second.all().length, 1, '重新打开后账还在');
  eq(second.all()[0].merchant, '早饭', '内容也还在');
}

if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log(`✓ 存储层全部通过：${passed} 项`);
