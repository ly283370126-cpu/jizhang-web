/* 本地存储层 —— localStorage，数据不出手机。
 *
 * 两条从审计里学来的硬规则，这里照样守：
 *   1. 一次确认多笔 = **一次原子写入**：要么全进，要么一笔都不进
 *   2. 读写出错要报出来，绝不伪装成「没有消费」
 */
(function (global) {
  'use strict';

  const KEY = 'jz.v1';

  function defaults() {
    return {
      version: 1,
      transactions: [],
      categories: JSON.parse(JSON.stringify(global.JZ.DEFAULT_CATEGORIES)),
      accounts: JSON.parse(JSON.stringify(global.JZ.DEFAULT_ACCOUNTS)),
      memory: {},          // 纠正过就记住：{ '奈雪': 'c-food' } —— 越用越准
      budget: null,        // { minor, start(ISO), end(ISO) }
      settings: { proxyUrl: '' }
    };
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createStore(backend) {
    const storage = backend || global.localStorage;
    let state = null;

    function load() {
      if (state) return state;
      let raw = null;
      try {
        raw = storage.getItem(KEY);
      } catch (error) {
        throw new Error('本地存储不可用：' + error.message + '（不是「没有消费」）');
      }
      if (!raw) { state = defaults(); return state; }
      try {
        const parsed = JSON.parse(raw);
        state = Object.assign(defaults(), parsed);
        state.settings = Object.assign({ proxyUrl: '' }, parsed.settings || {});
      } catch (error) {
        // 数据坏了：**不能**当成空账本静默继续，否则用户以为账全没了
        throw new Error('本地账本数据损坏，无法解析：' + error.message);
      }
      return state;
    }

    function persist() {
      try {
        storage.setItem(KEY, JSON.stringify(state));
      } catch (error) {
        throw new Error('写入本地账本失败：' + error.message + '（这笔没有存下）');
      }
    }

    function stateOf() { return load(); }

    /**
     * 一次写入多笔（用户一次确认）。整批原子：
     * 任何一笔与已有记录或批内其他笔撞指纹 → 全部不写，返回冲突详情。
     */
    function addTransactions(list) {
      const data = load();
      const existing = new Set(data.transactions.map((t) => t.fingerprint));
      const seen = new Set();
      for (const item of list) {
        if (!(item.minor > 0)) return { ok: false, reason: 'invalid', detail: '金额必须大于 0' };
        if (!item.fingerprint) continue;
        if (existing.has(item.fingerprint) || seen.has(item.fingerprint)) {
          return { ok: false, reason: 'duplicate', fingerprint: item.fingerprint, detail: '这笔已经记过了' };
        }
        seen.add(item.fingerprint);
      }
      const now = new Date().toISOString();
      const records = list.map((item) => ({
        id: item.id || 't-' + Math.random().toString(36).slice(2, 10),
        type: item.type,
        minor: item.minor,
        occurredAt: item.occurredAt,
        categoryId: item.categoryId || null,
        accountId: item.accountId || null,
        merchant: item.merchant || null,
        note: item.note || null,
        source: item.source || 'manual',
        fingerprint: item.fingerprint || null,
        createdAt: now
      }));
      data.transactions = data.transactions.concat(records);
      persist();
      return { ok: true, inserted: records };
    }

    function removeTransaction(id) {
      const data = load();
      const before = data.transactions.length;
      data.transactions = data.transactions.filter((t) => t.id !== id);
      if (data.transactions.length === before) return { ok: false, detail: '没找到这条记录' };
      persist();
      return { ok: true };
    }

    function updateTransaction(id, patch) {
      const data = load();
      const target = data.transactions.find((t) => t.id === id);
      if (!target) return { ok: false, detail: '没找到这条记录' };
      Object.assign(target, patch);
      persist();
      return { ok: true };
    }

    function all() {
      const data = load();
      return data.transactions.slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    }

    /** 越用越准：用户改过的商户 → 分类，下次自动用 */
    function learn(merchant, categoryId) {
      if (!merchant || !categoryId) return;
      const data = load();
      data.memory[merchant] = categoryId;
      persist();
    }

    function memory() { return load().memory; }
    function categories() { return load().categories; }
    function accounts() { return load().accounts; }

    function setBudget(minor) {
      const data = load();
      if (!minor || minor <= 0) { data.budget = null; persist(); return null; }
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
      data.budget = { minor, start: start.toISOString(), end: end.toISOString() };
      persist();
      return data.budget;
    }

    function budget() { return load().budget; }

    function settings() { return load().settings; }
    function setSettings(patch) {
      const data = load();
      data.settings = Object.assign(data.settings, patch);
      persist();
      return data.settings;
    }

    function clearAll() {
      state = defaults();
      persist();
      return state;
    }

    function exportCsv() {
      const data = load();
      const nameOf = (id, list) => (list.find((x) => x.id === id) || { name: '' }).name;
      const header = ['日期', '类型', '金额', '分类', '账户', '商户', '备注'];
      const lines = [header.join(',')];
      for (const t of all()) {
        const d = new Date(t.occurredAt);
        const stamp = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
          + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const cell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
        lines.push([
          cell(stamp), cell(t.type === 'income' ? '收入' : '支出'),
          cell(global.JZ.Money.format(t.minor, { symbol: '' })),
          cell(nameOf(t.categoryId, data.categories)), cell(nameOf(t.accountId, data.accounts)),
          cell(t.merchant), cell(t.note)
        ].join(','));
      }
      return lines.join('\n');
    }

    return {
      load: stateOf, all, addTransactions, removeTransaction, updateTransaction,
      learn, memory, categories, accounts, setBudget, budget, settings, setSettings,
      clearAll, exportCsv, defaults: clone
    };
  }

  global.JZStore = { createStore, KEY, defaults };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.JZStore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
