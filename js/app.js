/* 界面逻辑。规则：本地判定优先，AI 是可选加速器；确认之后才入账。 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const { createStore } = window.JZStore;

  let store = null;
  const ui = { range: 'today' };

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ───────────────────────── 启动 ─────────────────────────

  function boot() {
    try {
      store = createStore(window.localStorage);
      store.all();                       // 立刻读一次：数据坏了就在这里炸，不装作空账本
    } catch (error) {
      showFatal(error.message);
      return;
    }
    bind();
    render();
  }

  function showFatal(message) {
    document.body.innerHTML = '';
    const box = el('div', 'empty');
    box.style.paddingTop = '80px';
    box.textContent = '账本读不出来：' + message;
    const fix = el('p', null, '数据没有被清掉。先别继续记账，把这条信息发给我。');
    fix.style.color = '#6B6762';
    document.body.appendChild(box);
    document.body.appendChild(fix);
  }

  function bind() {
    $('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      submit(text);
    });
    $('tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.tab');
      if (!tab) return;
      ui.range = tab.dataset.range;
      Array.from(document.querySelectorAll('.tab')).forEach((t) => t.classList.toggle('is-on', t === tab));
      render();
    });
    $('chips').addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-q]');
      if (!chip) return;
      submit(chip.dataset.q);
    });
    $('settingsBtn').addEventListener('click', showSettings);
  }

  // ───────────────────────── 渲染 ─────────────────────────

  function money(minor) { return JZ.Money.format(minor, { symbol: '¥' }); }
  function moneyCompact(minor) { return JZ.Money.format(minor, { symbol: '¥', compact: true }); }

  function dayLabel(iso) {
    const date = new Date(iso);
    const today = JZ.startOfDay(new Date());
    const target = JZ.startOfDay(date);
    const diff = Math.round((today - target) / 86400000);
    const hhmm = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    if (diff === 0) return '今天 ' + hhmm;
    if (diff === 1) return '昨天 ' + hhmm;
    if (diff === 2) return '前天 ' + hhmm;
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hhmm;
  }

  function render() {
    renderSummary();
    renderList();
  }

  function renderSummary() {
    const box = $('summary');
    box.innerHTML = '';
    const transactions = store.all();
    const now = new Date();
    const todayRange = JZ.rangeFor('today', now);
    const monthRange = JZ.rangeFor('current_month', now);
    const todayExpense = JZ.sum(transactions.filter((t) => JZ.inRange(t, todayRange)), 'expense');
    const monthExpense = JZ.sum(transactions.filter((t) => JZ.inRange(t, monthRange)), 'expense');

    const label = el('div', 'label', '今天花了');
    const big = el('div', 'today num');
    const cur = el('span', 'cur', '¥');
    big.appendChild(cur);
    big.appendChild(document.createTextNode(JZ.Money.format(todayExpense, { symbol: '', compact: todayExpense % 100 === 0 && todayExpense < 100000 })));
    box.appendChild(label);
    box.appendChild(big);

    const split = el('div', 'split');
    const monthBox = el('div');
    monthBox.appendChild(el('div', 'k', '本月支出'));
    const monthValue = el('div', 'v num', moneyCompact(monthExpense));
    monthBox.appendChild(monthValue);
    const budgetBox = el('div');
    const budget = store.budget();
    const status = budget ? JZ.budgetStatus(budget, transactions, now) : null;
    budgetBox.appendChild(el('div', 'k', status ? '预算剩余' : '今日可用'));
    budgetBox.appendChild(el('div', 'v num', status ? moneyCompact(status.remaining) : '未设预算'));
    split.appendChild(monthBox);
    split.appendChild(budgetBox);
    box.appendChild(split);

    if (status) {
      const used = Math.min(1, Math.max(0, status.spent / status.budgetMinor));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = (used * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      const hint = el('div', 'hint' + (status.over ? ' warn' : ''));
      const days = JZ.DATE_LABELS ? status.daysRemaining : 0;
      if (status.over) {
        hint.innerHTML = '超了 <b>' + moneyCompact(-status.remaining) + '</b>，本月还有 ' + days + ' 天';
      } else {
        hint.innerHTML = '本月还剩 <b>' + days + '</b> 天，今天还能花 <b>' + moneyCompact(status.dailyAvailable) + '</b>';
      }
      box.appendChild(hint);
    } else {
      const hint = el('div', 'hint');
      hint.innerHTML = '还没设预算。点右上角「设置」定一个，就会告诉你每天还能花多少。';
      box.appendChild(hint);
    }
  }

  function renderList() {
    const list = $('list');
    const empty = $('empty');
    list.innerHTML = '';
    const now = new Date();
    const range = JZ.rangeFor(ui.range, now);
    const items = store.all().filter((t) => JZ.inRange(t, range));

    if (!items.length) {
      empty.hidden = false;
      empty.textContent = ui.range === 'today'
        ? '今天还没有账。说一句就行 —— 「早饭 12」。'
        : '这段时间没有账。';
      return;
    }
    empty.hidden = true;

    const categories = store.categories();
    for (const item of items) {
      const row = el('li', 'row');
      const category = categories.find((c) => c.id === item.categoryId);
      row.appendChild(el('div', 'ic', category ? category.icon : '❔'));
      const mid = el('div', 'mid');
      mid.appendChild(el('div', 't1', item.merchant || item.note || (category ? category.name : '未分类')));
      mid.appendChild(el('div', 't2', [category ? category.name : '未分类', dayLabel(item.occurredAt)].join(' · ')));
      row.appendChild(mid);
      const amount = el('div', 'amt num' + (item.type === 'income' ? ' income' : ''), (item.type === 'income' ? '+' : '−') + money(item.minor).replace('¥', ''));
      row.appendChild(amount);
      const del = el('button', 'del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', '删除');
      del.addEventListener('click', () => {
        if (confirm('删掉这笔「' + (item.merchant || item.note || '') + ' ' + money(item.minor) + '」？')) {
          const result = store.removeTransaction(item.id);
          if (!result.ok) return toast(result.detail, true);
          toast('已删掉');
          render();
        }
      });
      row.appendChild(del);
      list.appendChild(row);
    }
  }

  // ───────────────────────── 记一笔 ─────────────────────────

  function submit(text) {
    const options = {
      now: new Date(),
      categories: store.categories(),
      accounts: store.accounts(),
      memory: store.memory()
    };
    let result;
    try {
      result = JZ.parseInput(text, options);
    } catch (error) {
      return toast('本地解析出错：' + error.message, true);
    }

    if (result.kind === 'empty') return;
    if (result.kind === 'query') return showAnswer(result.query);
    if (result.kind === 'drafts') return showConfirm(result.drafts);
    return toast('没听出金额。试试「早饭 12」这样。', true);
  }

  function showConfirm(drafts) {
    const sheet = $('sheet');
    sheet.innerHTML = '';
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', null, drafts.length > 1 ? '这 ' + drafts.length + ' 笔，对吗？' : '这一笔，对吗？'));
    panel.appendChild(el('div', 'sub', '确认之后才入账。改过的分类会记住，下次自动用。'));

    const categories = store.categories();
    const accounts = store.accounts();
    const edited = drafts.map((draft) => Object.assign({}, draft));

    edited.forEach((draft, index) => {
      const box = el('div', 'draft');
      const head = el('div', 'head');
      const left = el('div');
      const amountInput = document.createElement('input');
      amountInput.className = 'num';
      amountInput.value = JZ.Money.format(draft.minor, { symbol: '', compact: draft.minor % 100 === 0 });
      amountInput.style.cssText = 'width:96px;font-size:20px;font-weight:600;border:1px solid #E8E3DA;border-radius:10px;padding:4px 8px;background:#F5F2EC';
      amountInput.addEventListener('change', () => {
        const minor = JZ.Money.fromYuanText(amountInput.value.trim());
        if (minor === null || minor <= 0) { toast('金额看不懂，没改', true); amountInput.value = JZ.Money.format(draft.minor, { symbol: '' }); return; }
        draft.minor = minor;
        draft.fingerprint = JZ.dedupeKey(new Date(draft.occurredAt), draft.minor, draft.type, draft.merchant || draft.rawSegment);
      });
      left.appendChild(amountInput);
      head.appendChild(left);
      const raw = el('div', 'raw', draft.rawSegment);
      head.appendChild(raw);
      box.appendChild(head);

      const grid = el('div', 'grid');
      // 分类
      const categorySelect = document.createElement('select');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '未分类';
      categorySelect.appendChild(none);
      for (const category of categories) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.icon + ' ' + category.name;
        if (category.id === draft.categoryId) option.selected = true;
        categorySelect.appendChild(option);
      }
      if (draft.needsAttention.indexOf('category') >= 0) categorySelect.classList.add('flag');
      categorySelect.addEventListener('change', () => { draft.categoryId = categorySelect.value || null; });
      grid.appendChild(categorySelect);
      // 账户
      const accountSelect = document.createElement('select');
      const noAccount = document.createElement('option');
      noAccount.value = '';
      noAccount.textContent = '没说是哪个账户';
      accountSelect.appendChild(noAccount);
      for (const account of accounts) {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = account.name;
        if (account.id === draft.accountId) option.selected = true;
        accountSelect.appendChild(option);
      }
      accountSelect.addEventListener('change', () => { draft.accountId = accountSelect.value || null; });
      grid.appendChild(accountSelect);
      // 时间
      const dateInput = document.createElement('input');
      dateInput.type = 'datetime-local';
      const d = new Date(draft.occurredAt);
      const pad = (n) => String(n).padStart(2, '0');
      dateInput.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      dateInput.addEventListener('change', () => {
        const parsed = new Date(dateInput.value);
        if (isNaN(parsed.getTime())) return;
        draft.occurredAt = parsed.toISOString();
        draft.fingerprint = JZ.dedupeKey(parsed, draft.minor, draft.type, draft.merchant || draft.rawSegment);
      });
      grid.appendChild(dateInput);
      // 收支方向
      const typeSelect = document.createElement('select');
      [['expense', '支出'], ['income', '收入']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (value === draft.type) option.selected = true;
        typeSelect.appendChild(option);
      });
      typeSelect.addEventListener('change', () => { draft.type = typeSelect.value; });
      grid.appendChild(typeSelect);

      box.appendChild(grid);
      if (draft.needsAttention.some((f) => f === 'date')) {
        box.appendChild(el('div', 'flag', '时间是我按「现在」默认的，不对就改一下'));
      }
      panel.appendChild(box);
    });

    const actions = el('div', 'actions');
    const cancel = el('button', 'btn-ghost', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { sheet.hidden = true; });
    const confirmBtn = el('button', 'btn-primary', drafts.length > 1 ? '全部记下' : '记下');
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', () => {
      const records = edited.map((draft) => {
        const original = drafts.find((d) => d.id === draft.id);
        return {
          type: draft.type, minor: draft.minor, occurredAt: draft.occurredAt,
          categoryId: draft.categoryId, accountId: draft.accountId,
          merchant: draft.merchant, note: draft.rawSegment,
          source: 'web', fingerprint: draft.fingerprint,
          _learnKey: (original && original.categoryId) !== draft.categoryId ? (draft.merchant || draft.rawSegment) : null
        };
      });
      const result = store.addTransactions(records);
      if (!result.ok) {
        sheet.hidden = true;
        return toast(result.detail || '没记上', true);
      }
      for (const record of records) if (record._learnKey && record.categoryId) store.learn(record._learnKey, record.categoryId);
      sheet.hidden = true;
      toast('记下了 ' + records.length + ' 笔');
      render();
    });
    actions.appendChild(cancel);
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);

    sheet.appendChild(panel);
    sheet.hidden = false;
    sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.hidden = true; }, { once: true });
  }

  // ───────────────────────── 查询（数字全部本地算） ─────────────────────────

  function showAnswer(query) {
    const transactions = store.all();
    const range = JZ.rangeFor(query.rangeLabel, new Date());
    let rows = transactions.filter((t) => JZ.inRange(t, range));
    if (query.type) rows = rows.filter((t) => t.type === query.type);
    if (query.minMinor !== null) rows = rows.filter((t) => t.minor >= query.minMinor);
    if (query.maxMinor !== null) rows = rows.filter((t) => t.minor <= query.maxMinor);

    const box = $('answer');
    box.innerHTML = '';
    const budgetStatus = store.budget() ? JZ.budgetStatus(store.budget(), transactions, new Date()) : null;

    if (query.kind === 'budget' && budgetStatus) {
      box.appendChild(el('div', null,
        '本期预算 ' + money(budgetStatus.budgetMinor) + '，已花 ' + money(budgetStatus.spent) +
        '，剩 ' + money(budgetStatus.remaining) + '，今天还能花 ' + money(budgetStatus.dailyAvailable)));
    } else if (query.kind === 'budget') {
      box.appendChild(el('div', null, '还没设预算。右上角「设置」里可以定一个。'));
    } else {
      const total = JZ.sum(rows, query.type || null);
      const label = JZ.DATE_LABELS[query.rangeLabel] || '这段时间';
      box.appendChild(el('div', null,
        label + (query.type === 'income' ? '收入' : '支出') + '共 ' + rows.length + ' 笔，合计 ' + money(total)));
      if (rows.length) {
        const lines = el('div', 'rows');
        rows.slice(0, 5).forEach((item) => {
          lines.appendChild(el('div', null, dayLabel(item.occurredAt) + ' · ' + (item.merchant || item.note || '') + ' · ' + money(item.minor)));
        });
        if (rows.length > 5) lines.appendChild(el('div', null, '…… 还有 ' + (rows.length - 5) + ' 笔'));
        box.appendChild(lines);
      }
    }
    box.hidden = false;
  }

  // ───────────────────────── 设置 ─────────────────────────

  function showSettings() {
    const sheet = $('sheet');
    sheet.innerHTML = '';
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', null, '设置'));
    panel.appendChild(el('div', 'sub', '数据只存在这台手机里，不上传任何服务器。'));

    const budgetField = el('div', 'field');
    budgetField.appendChild(el('label', null, '每月预算（元）'));
    const budgetInput = document.createElement('input');
    budgetInput.type = 'number';
    budgetInput.inputMode = 'decimal';
    budgetInput.placeholder = '比如 3000，留空 = 不设';
    const budget = store.budget();
    if (budget) budgetInput.value = JZ.Money.format(budget.minor, { symbol: '', compact: true });
    budgetField.appendChild(budgetInput);
    panel.appendChild(budgetField);

    const aiField = el('div', 'field');
    aiField.appendChild(el('label', null, 'AI 判定服务地址（可选，留空则只用本地规则）'));
    const aiInput = document.createElement('input');
    aiInput.type = 'url';
    aiInput.placeholder = 'https://你的代理/jev';
    aiInput.value = store.settings().proxyUrl || '';
    aiField.appendChild(aiInput);
    const aiNote = el('div', 'sub', '浏览器直连 Jev 会被 CORS 拦掉，key 也不能放在页面里 —— 需要一层代理（免费额度够用）。没配也能用，分类走本地规则。');
    aiNote.style.marginTop = '6px';
    aiField.appendChild(aiNote);
    panel.appendChild(aiField);

    const actions = el('div', 'actions');
    const close = el('button', 'btn-ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', () => { sheet.hidden = true; });
    const save = el('button', 'btn-primary', '保存');
    save.type = 'button';
    save.addEventListener('click', () => {
      const minor = budgetInput.value.trim() ? JZ.Money.fromYuanText(budgetInput.value.trim()) : 0;
      if (budgetInput.value.trim() && (minor === null || minor < 0)) return toast('预算数字看不懂', true);
      store.setBudget(minor || 0);
      store.setSettings({ proxyUrl: aiInput.value.trim() });
      sheet.hidden = true;
      toast('已保存');
      render();
    });
    actions.appendChild(close);
    actions.appendChild(save);
    panel.appendChild(actions);

    const more = el('div', 'actions');
    const exportBtn = el('button', 'btn-ghost', '导出 CSV');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', () => {
      const csv = store.exportCsv();
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'jizhang-' + new Date().toISOString().slice(0, 10) + '.csv';
      link.click();
      URL.revokeObjectURL(link.href);
      toast('已导出');
    });
    const clearBtn = el('button', 'btn-danger', '清空全部数据');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', () => {
      if (!confirm('清空所有账单、预算和记忆？这个动作不能撤销。')) return;
      store.clearAll();
      sheet.hidden = true;
      toast('已清空');
      render();
    });
    more.appendChild(exportBtn);
    more.appendChild(clearBtn);
    panel.appendChild(more);

    sheet.appendChild(panel);
    sheet.hidden = false;
    sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.hidden = true; }, { once: true });
  }

  // ───────────────────────── 提示 ─────────────────────────

  let toastTimer = null;
  function toast(message, bad) {
    const box = $('toast');
    box.textContent = message;
    box.className = 'toast' + (bad ? ' bad' : '');
    box.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, bad ? 4200 : 2000);
  }

  boot();
})();
