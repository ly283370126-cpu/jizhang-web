/* 记账 · 界面逻辑（对齐 Codex 的 App/ContentView.swift 与 docs/ui-motion-spec.md）
   三条不变的东西：金额与统计只由本地代码算；AI 是可选加速器；确认之后才入账。 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const { createStore } = window.JZStore;

  let store = null;
  let keyword = '';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pad2 = (n) => String(n).padStart(2, '0');

  const ICON_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h10l1 11.2a1.5 1.5 0 01-1.5 1.6h-9A1.5 1.5 0 016 19.2z"/><path d="M9.2 8V6.5a2.8 2.8 0 015.6 0V8"/></svg>';
  const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 8.4v7.2M8.6 12h6.8"/></svg>';

  const plain = (minor) => {
    const text = JZ.Money.format(minor, { symbol: '' });
    const dot = text.indexOf('.');
    const integer = dot >= 0 ? text.slice(0, dot) : text;
    const rest = dot >= 0 ? text.slice(dot) : '';
    const neg = integer[0] === '-' ? '-' : '';
    const digits = neg ? integer.slice(1) : integer;
    return neg + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
  };
  const yuan = (minor) => '¥' + plain(minor);
  const signed = (tx) => (tx.type === 'income' ? '+' : '−') + yuan(tx.minor);

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function dayTitle(date) {
    const today = JZ.startOfDay(new Date());
    const diff = Math.round((today - JZ.startOfDay(date)) / 86400000);
    const stamp = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    const head = diff === 0 ? '今天 ' : diff === 1 ? '昨天 ' : diff === 2 ? '前天 ' : '';
    return head + stamp + ' ' + WEEK[date.getDay()];
  }

  /** 缺哪一项就说哪一项，别让用户对着「信息不完整」猜 */
  const ATTENTION_WORD = { date: '时间', category: '分类', account: '账户' };

  /** 占比四舍五入后仍正好合成 100（最大余额法） */
  function percentShares(values, total) {
    if (!total) return values.map(() => 0);
    const raw = values.map((v) => (v / total) * 100);
    const out = raw.map(Math.floor);
    let rest = 100 - out.reduce((a, b) => a + b, 0);
    raw.map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac)
      .forEach((item) => { if (rest > 0) { out[item.i]++; rest--; } });
    return out;
  }

  // ───────────────────────── 启动 ─────────────────────────

  function boot() {
    try {
      store = createStore(window.localStorage);
      store.all();                    // 立刻读一次：数据坏了就在这里报，不装作空账本
    } catch (error) {
      return showFatal(error.message);
    }
    bind();
    render();
  }

  function showFatal(message) {
    document.querySelector('main').innerHTML = '';
    const box = el('div', 'empty');
    box.appendChild(el('div', 'empty-title', '账本读不出来'));
    box.appendChild(el('div', 'empty-sub', message + '\n数据没有被清掉。先别继续记账，把这条信息发给我。'));
    box.querySelector('.empty-sub').style.whiteSpace = 'pre-line';
    document.querySelector('main').appendChild(box);
    document.querySelector('.composer').hidden = true;
  }

  function bind() {
    $('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = $('input').value.trim();
      if (!text) return;
      $('input').value = '';
      $('suggests').hidden = true;
      submit(text);
    });
    $('menuBtn').addEventListener('click', openDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    $('ledgerPill').addEventListener('click', openLedgerSheet);
    $('statsBtn').addEventListener('click', openStats);
    $('plusBtn').addEventListener('click', () => openComposer());
    $('input').addEventListener('focus', () => { $('suggests').hidden = false; });
    $('input').addEventListener('blur', () => { setTimeout(() => { $('suggests').hidden = true; }, 180); });
    const syncSend = () => { $('sendBtn').disabled = !$('input').value.trim(); };
    $('input').addEventListener('input', syncSend);
    syncSend();
    $('suggests').addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-q]');
      if (!chip) return;
      $('suggests').hidden = true;
      submit(chip.dataset.q);
    });
    $('searchInput').addEventListener('input', (event) => {
      keyword = event.target.value.trim();
      renderDays();
    });
    $('drawer').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      closeDrawer();
      const act = button.dataset.act;
      if (act === 'stats') openStats();
      else if (act === 'budget') openBudgetSheet();
      else if (act === 'compose') openComposer();
      else if (act === 'export') exportCsv();
      else if (act === 'learn') openLearnSheet();
      else if (act === 'ledger') openLedgerSheet();
      else if (act === 'settings') openSettings();
      else if (act === 'about') openAbout();
      else if (act === 'clear') openClearConfirm();
    });
  }

  // ───────────────────────── 渲染 ─────────────────────────

  function render() {
    renderBudget();
    renderBalance();
    renderDays();
    renderDrawerStats();
  }

  function renderBudget() {
    const box = $('budgetCard');
    box.innerHTML = '';
    const now = new Date();
    const transactions = store.all();
    const budget = store.budget();
    const status = budget ? JZ.budgetStatus(budget, transactions, now) : null;

    const head = el('div', 'card-row');
    head.appendChild(el('div', 'k', now.getFullYear() + '.' + (now.getMonth() + 1) + ' · 本月'));
    const setBtn = el('button', 'link-btn', '设置预算');
    setBtn.type = 'button';
    setBtn.addEventListener('click', openBudgetSheet);
    head.appendChild(setBtn);
    box.appendChild(head);

    if (!status) {
      const wrap = el('div', 'big-wrap');
      const big = el('div', 'big num');
      big.appendChild(el('span', 'cur', '¥'));
      big.appendChild(document.createTextNode('未设置'));
      wrap.appendChild(big);
      box.appendChild(el('div', 'k', '月预算剩余'));
      box.appendChild(wrap);
      box.appendChild(el('div', 'caption', '设一个月预算，我就告诉你今天还能花多少。'));
      return;
    }

    const ratio = Math.min(1, Math.max(0, status.spent / status.budgetMinor));
    box.appendChild(el('div', 'k', status.over ? '月预算已超' : '月预算剩余'));
    const row = el('div', 'card-row');
    const wrap = el('div', 'big-wrap');
    const big = el('div', 'big num');
    big.appendChild(el('span', 'cur', '¥'));
    big.appendChild(document.createTextNode(plain(Math.abs(status.remaining))));
    wrap.appendChild(big);
    row.appendChild(wrap);

    const todayRange = JZ.rangeFor('today', now);
    const todaySpent = JZ.sum(transactions.filter((t) => JZ.inRange(t, todayRange)), 'expense');
    const quota = Math.max(0, status.dailyAvailable) + todaySpent;
    const ringRatio = quota > 0 ? Math.min(1, todaySpent / quota) : 0;
    const circumference = 2 * Math.PI * 32;
    const ring = el('div', 'ring-wrap');
    ring.innerHTML =
      '<svg width="78" height="78" viewBox="0 0 78 78">' +
      '<circle cx="39" cy="39" r="32" fill="none" stroke="rgba(51,102,230,.5)" stroke-width="5"/>' +
      '<circle cx="39" cy="39" r="32" fill="none" stroke="' + (status.over ? '#E8952F' : '#3366E6') + '" stroke-width="5" stroke-linecap="round" ' +
      'stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + (circumference * (1 - ringRatio)).toFixed(1) + '"/></svg>';
    const ringText = el('div', 'ring-txt');
    ringText.appendChild(el('div', 'k', '今日可用'));
    ringText.appendChild(el('div', 'v num', yuan(Math.max(0, status.dailyAvailable))));
    ring.appendChild(ringText);
    row.appendChild(ring);
    box.appendChild(row);

    const track = el('div', 'track' + (status.over ? ' warn' : ''));
    const fill = el('i');
    fill.style.width = (ratio * 100).toFixed(1) + '%';
    track.appendChild(fill);
    box.appendChild(track);
    box.appendChild(el('div', 'caption',
      '已用 ' + yuan(status.spent) + ' / ' + yuan(status.budgetMinor)
      + ' · 本月还剩 ' + status.daysRemaining + ' 天'));
  }

  function renderBalance() {
    const box = $('assetCard');
    box.innerHTML = '';
    const transactions = store.all();
    const income = JZ.sum(transactions, 'income');
    const expense = JZ.sum(transactions, 'expense');
    const balance = income - expense;
    box.appendChild(el('div', 'k', '累计收支结余'));
    const big = el('div', 'big num');
    if (balance < 0) big.appendChild(document.createTextNode('−'));
    big.appendChild(el('span', 'cur', '¥'));
    big.appendChild(document.createTextNode(plain(Math.abs(balance))));
    box.appendChild(big);
    box.appendChild(el('div', 'caption', '收入减支出，未包含期初资产 · 共 ' + transactions.length + ' 笔'));
  }

  function renderDays() {
    const wrap = $('groups');
    wrap.innerHTML = '';
    const empty = $('empty');
    const all = store.all();
    const rows = all.filter((tx) => {
      if (!keyword) return true;
      const hay = (tx.note || '') + (tx.merchant || '');
      return hay.indexOf(keyword) >= 0;
    });

    if (!rows.length) {
      empty.hidden = false;
      empty.querySelector('.empty-title').textContent = all.length ? '没找到' : '还没有账单';
      empty.querySelector('.empty-sub').textContent = all.length
        ? '换个词再搜搜，或者先清掉搜索框。'
        : '在底部输入一笔消费，确认后就会出现在这里。';
      return;
    }
    empty.hidden = true;

    const categories = store.categories();
    const byDay = new Map();
    for (const tx of rows) {
      const key = JZ.startOfDay(new Date(tx.occurredAt)).getTime();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(tx);
    }
    Array.from(byDay.keys()).sort((a, b) => b - a).forEach((key) => {
      const items = byDay.get(key);
      const card = el('div', 'day-card');
      card.appendChild(el('div', 'day-head', dayTitle(new Date(key))));
      for (const tx of items) {
        const category = categories.find((c) => c.id === tx.categoryId);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'trow';
        const cup = el('div', 'cup');
        // 有分类图标就用分类图标：餐饮/交通/购物一眼能分开，不用读文字
        if (category && category.icon) { cup.classList.add('emoji'); cup.textContent = category.icon; }
        else cup.innerHTML = tx.type === 'income' ? ICON_IN : ICON_BAG;
        row.appendChild(cup);
        const mid = el('div', 'mid');
        mid.appendChild(el('div', 't1', (category ? category.name : '未分类')));
        const at = new Date(tx.occurredAt);
        mid.appendChild(el('div', 't2',
          pad2(at.getHours()) + ':' + pad2(at.getMinutes()) + ' · ' + (tx.note || tx.merchant || '')));
        row.appendChild(mid);
        row.appendChild(el('div', 'amt num', signed(tx)));
        row.addEventListener('click', () => openRowSheet(tx.id));
        // 长按 = 删除（对齐 Codex 的 contextMenu）
        let timer = null;
        const start = () => { timer = setTimeout(() => { timer = null; askDelete(tx); }, 520); };
        const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
        row.addEventListener('pointerdown', start);
        row.addEventListener('pointerup', stop);
        row.addEventListener('pointercancel', stop);
        row.addEventListener('pointerleave', stop);
        card.appendChild(row);
      }
      wrap.appendChild(card);
    });
  }

  function renderDrawerStats() {
    const box = $('statCard');
    box.innerHTML = '';
    const transactions = store.all();
    const dayKeys = new Set(transactions.map((t) => JZ.startOfDay(new Date(t.occurredAt)).getTime()));
    let streak = 0;
    let cursor = JZ.startOfDay(new Date()).getTime();
    if (!dayKeys.has(cursor)) cursor -= 86400000;
    while (dayKeys.has(cursor)) { streak++; cursor -= 86400000; }
    [['记录天数', dayKeys.size], ['总记录', transactions.length], ['连续天数', streak]].forEach(([label, value]) => {
      const cell = el('div');
      cell.appendChild(el('div', 'v num', String(value)));
      cell.appendChild(el('div', 'k', label));
      box.appendChild(cell);
    });
  }

  // ───────────────────────── 记一笔 / 查一句 ─────────────────────────

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
    if (result.kind === 'query') return openQuery(result.query);
    if (result.kind === 'drafts') return openComposer(text, result.drafts);
    openComposer(text, []);
  }

  const sheet = () => $('sheet');

  function openSheet(panel) {
    const box = sheet();
    box.innerHTML = '';
    box.appendChild(panel);
    box.hidden = false;
  }
  function closeSheet() { sheet().hidden = true; }

  function sheetPanel(title, sub) {
    const panel = el('div', 'panel');
    if (title) panel.appendChild(el('h2', null, title));
    if (sub) panel.appendChild(el('div', 'sub', sub));
    return panel;
  }

  /* 「记一笔 · 问一问」——对齐 Codex 的 composer */
  function openComposer(text, drafts) {
    drafts = drafts || [];
    const panel = sheetPanel('记一笔 · 问一问', null);
    const note = el('div', 'caption',
      store.settings().proxyUrl ? '已配置云端 AI 判定 · 金额仍由本地计算' : '本地规则识别模式 · 尚未配置云端 AI');
    panel.appendChild(note);

    const chips = el('div', 'chips');
    ['今天花了多少？', '本月超过 200 元的账单'].forEach((question) => {
      const button = el('button', null, question);
      button.type = 'button';
      button.addEventListener('click', () => {
        input.value = question;
        run();
      });
      chips.appendChild(button);
    });
    panel.appendChild(chips);

    const input = document.createElement('textarea');
    input.className = 'field wide';
    input.rows = 2;
    input.placeholder = '例如：早餐12，公交3.6元';
    input.value = text || '';
    panel.appendChild(input);

    const state = { drafts: drafts.map((d) => Object.assign({}, d)) };
    const listBox = el('div');
    listBox.style.marginTop = '16px';
    panel.appendChild(listBox);

    const renderDrafts = () => {
      listBox.innerHTML = '';
      state.drafts.forEach((draft, index) => {
        const card = el('div', 'draft');
        const top = el('div', 'top');
        const amount = el('div', 'amt num');
        amount.appendChild(el('span', 'cur', '¥'));
        amount.appendChild(document.createTextNode(plain(draft.minor)));
        top.appendChild(amount);
        const tools = el('div', 'draft-tools');
        const edit = el('button', 'link-btn', '改一下');
        edit.type = 'button';
        edit.addEventListener('click', () => editDraft(draft, index, renderDrafts));
        tools.appendChild(edit);
        if (state.drafts.length > 1) {          // 只记一笔时不给「去掉」，免得点成空手
          const drop = el('button', 'link-btn danger', '去掉这笔');
          drop.type = 'button';
          drop.addEventListener('click', () => {
            state.drafts.splice(index, 1);
            renderDrafts();
          });
          tools.appendChild(drop);
        }
        top.appendChild(tools);
        card.appendChild(top);
        const category = store.categories().find((c) => c.id === draft.categoryId);
        card.appendChild(el('div', 'tell',
          (draft.type === 'income' ? '收入' : '支出') + ' · ' + (category ? category.name : '未分类')));
        const at = new Date(draft.occurredAt);
        card.appendChild(el('div', 'meta',
          (at.getMonth() + 1) + '月' + at.getDate() + '日 ' + pad2(at.getHours()) + ':' + pad2(at.getMinutes())
          + ' · ' + draft.rawSegment));
        if (draft.needsAttention.length) {
          const missing = draft.needsAttention.map((field) => ATTENTION_WORD[field] || field).join('、');
          card.appendChild(el('div', 'warn', '这笔的' + missing + '拿不准，点「改一下」确认'));
        }
        listBox.appendChild(card);
      });
      if (state.drafts.length) {
        const total = state.drafts.reduce((acc, draft) => acc + draft.minor, 0);
        listBox.appendChild(el('div', 'draft-sum',
          '这 ' + state.drafts.length + ' 笔，合计 ¥' + plain(total) + '，对吗？'));
      }
      saveBtn.hidden = !state.drafts.length;
    };

    const actions = el('div', 'action-col');
    const runBtn = el('button', 'row-btn ghost', '识别 / 查询');
    runBtn.type = 'button';
    runBtn.addEventListener('click', run);
    actions.appendChild(runBtn);

    function run() {
      const value = input.value.trim();
      if (!value) return;
      let result;
      try {
        result = JZ.parseInput(value, {
          now: new Date(), categories: store.categories(),
          accounts: store.accounts(), memory: store.memory()
        });
      } catch (error) {
        return toast('本地解析出错：' + error.message, true);
      }
      if (result.kind === 'query') { closeSheet(); return openQuery(result.query); }
      if (result.kind !== 'drafts') {
        state.drafts = [];
        renderDrafts();
        return toast('没听出金额。试试「早餐12」这样。', true);
      }
      state.drafts = result.drafts;
      renderDrafts();
      saveBtn.hidden = false;
    }

    const saveBtn = el('button', 'row-btn', '确认并保存');
    saveBtn.type = 'button';
    saveBtn.hidden = !state.drafts.length;
    renderDrafts();
    saveBtn.addEventListener('click', () => {
      const records = state.drafts.map((draft) => {
        const before = drafts.find((d) => d.id === draft.id);
        return {
          type: draft.type, minor: draft.minor, occurredAt: draft.occurredAt,
          categoryId: draft.categoryId, accountId: draft.accountId,
          merchant: draft.merchant, note: draft.rawSegment, source: 'web',
          fingerprint: draft.fingerprint,
          _learn: before && before.categoryId !== draft.categoryId ? (draft.merchant || draft.rawSegment) : null
        };
      });
      const result = store.addTransactions(records);
      if (!result.ok) return toast(result.detail || '没记上', true);
      for (const record of records) if (record._learn && record.categoryId) store.learn(record._learn, record.categoryId);
      closeSheet();
      toast('记下了 ' + records.length + ' 笔');
      render();
    });
    actions.appendChild(saveBtn);
    panel.appendChild(actions);
    openSheet(panel);
    if (!drafts.length) setTimeout(() => input.focus(), 120);
  }

  function editDraft(draft, index, rerender) {
    const panel = sheetPanel('改这笔', '金额和分类都能改，改过的分类我会记住。');
    const amount = document.createElement('input');
    amount.className = 'field num';
    amount.inputMode = 'decimal';
    amount.value = plain(draft.minor);
    panel.appendChild(amount);

    const category = document.createElement('select');
    category.className = 'field';
    category.style.marginTop = '10px';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '未分类';
    category.appendChild(none);
    for (const item of store.categories()) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.icon + ' ' + item.name;
      if (item.id === draft.categoryId) option.selected = true;
      category.appendChild(option);
    }
    panel.appendChild(category);

    const when = document.createElement('input');
    when.type = 'datetime-local';
    when.className = 'field';
    when.style.marginTop = '10px';
    const at = new Date(draft.occurredAt);
    when.value = at.getFullYear() + '-' + pad2(at.getMonth() + 1) + '-' + pad2(at.getDate()) + 'T' + pad2(at.getHours()) + ':' + pad2(at.getMinutes());
    panel.appendChild(when);

    const actions = el('div', 'action-col');
    const back = el('button', 'row-btn ghost', '返回');
    back.type = 'button';
    back.addEventListener('click', () => openComposer('', []));
    const save = el('button', 'row-btn', '改好了');
    save.type = 'button';
    save.addEventListener('click', () => {
      const minor = JZ.Money.fromYuanText(amount.value.trim());
      if (minor === null || minor <= 0) return toast('金额看不懂', true);
      const parsed = new Date(when.value);
      draft.minor = minor;
      draft.categoryId = category.value || null;
      draft.occurredAt = isNaN(parsed.getTime()) ? draft.occurredAt : parsed.toISOString();
      draft.fingerprint = JZ.dedupeKey(new Date(draft.occurredAt), draft.minor, draft.type, draft.merchant || draft.rawSegment);
      draft.needsAttention = draft.needsAttention.filter((f) => f !== 'amount' && f !== 'date');
      closeSheet();
      toast('改好了');
      rerender();
    });
    actions.appendChild(back);
    actions.appendChild(save);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openRowSheet(id) {
    const tx = store.all().find((t) => t.id === id);
    if (!tx) return toast('没找到这条记录', true);
    const panel = sheetPanel('这一笔', tx.note || '');
    const card = el('div', 'draft');
    const amount = el('div', 'amt num');
    amount.appendChild(el('span', 'cur', '¥'));
    amount.appendChild(document.createTextNode(plain(tx.minor)));
    card.appendChild(amount);
    const category = store.categories().find((c) => c.id === tx.categoryId);
    card.appendChild(el('div', 'tell', category ? category.icon + ' ' + category.name : '未分类'));
    const at = new Date(tx.occurredAt);
    card.appendChild(el('div', 'meta', (at.getMonth() + 1) + '月' + at.getDate() + '日 '
      + pad2(at.getHours()) + ':' + pad2(at.getMinutes()) + (tx.accountId ? ' · ' + ((store.accounts().find((a) => a.id === tx.accountId) || {}).name || '') : '')));
    panel.appendChild(card);

    const select = document.createElement('select');
    select.className = 'field';
    for (const item of store.categories()) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.icon + ' ' + item.name;
      if (item.id === tx.categoryId) option.selected = true;
      select.appendChild(option);
    }
    panel.appendChild(select);

    const actions = el('div', 'action-col');
    const save = el('button', 'row-btn', '改分类');
    save.type = 'button';
    save.addEventListener('click', () => {
      const categoryId = select.value || null;
      const result = store.updateTransaction(tx.id, { categoryId });
      if (!result.ok) return toast(result.detail, true);
      if (categoryId && categoryId !== tx.categoryId) store.learn(tx.merchant || tx.note || '', categoryId);
      closeSheet();
      toast('改好了，下次自动用这个分类');
      render();
    });
    const remove = el('button', 'row-btn ghost', '删除这笔');
    remove.type = 'button';
    remove.style.color = 'var(--danger)';
    remove.addEventListener('click', () => { closeSheet(); askDelete(tx); });
    actions.appendChild(save);
    actions.appendChild(remove);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function askDelete(tx) {
    if (!window.confirm('删掉这笔「' + plain(tx.minor) + ' 元 ' + (tx.note || '') + '」？')) return;
    const result = store.removeTransaction(tx.id);
    if (!result.ok) return toast(result.detail, true);
    toast('已删掉');
    render();
  }

  // ───────────────────────── 查询 ─────────────────────────

  function openQuery(query) {
    const panel = sheetPanel('查到了', '数字都是这台手机本地算的。');
    const transactions = store.all();
    const type = query.type || 'expense';
    const range = JZ.rangeFor(query.rangeLabel, new Date());
    let rows = transactions.filter((t) => JZ.inRange(t, range) && t.type === type);
    if (query.minMinor !== null) rows = rows.filter((t) => t.minor >= query.minMinor);
    if (query.maxMinor !== null) rows = rows.filter((t) => t.minor <= query.maxMinor);
    const budget = store.budget();
    const status = budget ? JZ.budgetStatus(budget, transactions, new Date()) : null;

    if (query.kind === 'budget') {
      const card = el('div', 'card');
      if (!status) {
        card.appendChild(el('div', 'k', '还没设预算'));
        card.appendChild(el('div', 'caption', '点下面去设一个，我就知道该提醒你什么。'));
      } else {
        [['预算', yuan(status.budgetMinor)], ['已花', yuan(status.spent)], ['剩余', yuan(status.remaining)],
          ['今日可用', yuan(status.dailyAvailable)], ['本月还剩', status.daysRemaining + ' 天']].forEach(([k, v]) => {
          const line = el('div', 'kv');
          line.appendChild(el('div', 'k', k));
          line.appendChild(el('div', 'v num', v));
          card.appendChild(line);
        });
      }
      panel.appendChild(card);
    } else {
      const card = el('div', 'card');
      card.appendChild(el('div', 'k', (JZ.DATE_LABELS[query.rangeLabel] || '这段时间') + (type === 'income' ? '收入' : '支出') + ' · ' + rows.length + ' 笔'));
      const big = el('div', 'big num');
      big.appendChild(el('span', 'cur', '¥'));
      big.appendChild(document.createTextNode(plain(JZ.sum(rows, type))));
      card.appendChild(big);
      for (const tx of rows.slice(0, 8)) {
        const line = el('div', 'kv');
        const at = new Date(tx.occurredAt);
        line.appendChild(el('div', 'k', (at.getMonth() + 1) + '月' + at.getDate() + '日 · ' + (tx.note || tx.merchant || '未分类')));
        line.appendChild(el('div', 'v num', signed(tx)));
        card.appendChild(line);
      }
      if (rows.length > 8) card.appendChild(el('div', 'caption', '…… 还有 ' + (rows.length - 8) + ' 笔'));
      if (!rows.length) card.appendChild(el('div', 'caption', '这段时间没有符合条件的记录。'));
      panel.appendChild(card);
    }

    const actions = el('div', 'action-col');
    if (query.kind === 'budget' && !status) {
      const go = el('button', 'row-btn', '去设置预算');
      go.type = 'button';
      go.addEventListener('click', () => { closeSheet(); openBudgetSheet(); });
      actions.appendChild(go);
    }
    const close = el('button', 'row-btn ghost', '知道了');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    panel.appendChild(actions);
    openSheet(panel);
  }

  // ───────────────────────── 统计 / 设置 ─────────────────────────

  function openStats() {
    const panel = sheetPanel('图表统计', '全部由本地计算，不经过任何服务器。');
    const transactions = store.all();
    const now = new Date();
    const monthTx = transactions.filter((t) => {
      const at = new Date(t.occurredAt);
      return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
    });
    const expense = monthTx.filter((t) => t.type === 'expense');
    const totalExpense = JZ.sum(monthTx, 'expense');

    const card1 = el('div', 'card');
    card1.appendChild(el('div', 'k', '本月支出分布'));
    if (!expense.length) {
      card1.appendChild(el('div', 'caption', '本月还没有支出记录。'));
    } else {
      const byCategory = JZ.byCategory(expense, store.categories(), 'expense');
      const shares = percentShares(byCategory.map((x) => x.minor), totalExpense);
      const max = Math.max.apply(null, byCategory.map((x) => x.minor));
      const rank = el('div', 'rank');
      rank.style.marginTop = '12px';
      byCategory.slice(0, 8).forEach((entry, index) => {
        const category = store.categories().find((c) => c.id === entry.categoryId);
        const item = el('div', 'item');
        item.appendChild(el('div', 'cup', category ? category.icon : '❔'));
        const mid = el('div', 'mid');
        const name = el('div', 'name');
        name.appendChild(el('span', null, entry.name + ' · ' + shares[index] + '%'));
        name.appendChild(el('span', 'v num', yuan(entry.minor)));
        mid.appendChild(name);
        const track = el('div', 'track');
        const fill = el('i');
        fill.style.width = Math.max(4, Math.round((entry.minor / max) * 100)) + '%';
        track.appendChild(fill);
        mid.appendChild(track);
        item.appendChild(mid);
        rank.appendChild(item);
      });
      card1.appendChild(rank);
    }
    panel.appendChild(card1);

    const card2 = el('div', 'card');
    card2.appendChild(el('div', 'k', '近 7 天'));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0);
      const next = new Date(day.getTime() + 86400000);
      const sum = JZ.sum(transactions.filter((t) => {
        const at = new Date(t.occurredAt).getTime();
        return t.type === 'expense' && at >= day.getTime() && at < next.getTime();
      }), 'expense');
      days.push({ label: (day.getMonth() + 1) + '.' + day.getDate(), sum, today: i === 0 });
    }
    const max = Math.max.apply(null, days.map((d) => d.sum).concat([1]));
    const bestDay = days.reduce((a, b) => (b.sum > a.sum ? b : a), days[0]);
    const bars = el('div', 'bars');
    for (const day of days) {
      const bar = el('div', 'b' + (day.today ? ' on' : '') + (day === bestDay && day.sum > 0 ? ' best' : ''));
      const fill = el('i');
      fill.style.height = Math.max(day.sum ? 6 : 3, Math.round((day.sum / max) * 74)) + 'px';
      bar.appendChild(fill);
      bar.appendChild(el('span', 'k', day.today ? '今天' : day.label));
      bars.appendChild(bar);
    }
    card2.appendChild(bars);
    const weekTotal = days.reduce((acc, d) => acc + d.sum, 0);
    card2.appendChild(el('div', 'caption', '近 7 天合计 ' + yuan(weekTotal)
      + (weekTotal ? ' · 最多的一天 ' + bestDay.label + ' ' + yuan(bestDay.sum) : '')));
    panel.appendChild(card2);

    const actions = el('div', 'action-col');
    const close = el('button', 'row-btn ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openBudgetSheet() {
    const panel = sheetPanel('预算管理', '填个数字，我就告诉你每天还能花多少。');
    const input = document.createElement('input');
    input.className = 'field num';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = '每月预算（元）';
    const budget = store.budget();
    if (budget) input.value = plain(budget.minor);
    panel.appendChild(input);
    panel.appendChild(el('div', 'caption', '留空保存 = 取消预算。'));

    const actions = el('div', 'action-col');
    const cancel = el('button', 'row-btn ghost', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', closeSheet);
    const save = el('button', 'row-btn', '保存');
    save.type = 'button';
    save.addEventListener('click', () => {
      const text = input.value.trim();
      const minor = text ? JZ.Money.fromYuanText(text) : 0;
      if (text && (minor === null || minor < 0)) return toast('预算数字看不懂', true);
      store.setBudget(minor || 0);
      closeSheet();
      toast(minor ? '预算设好了' : '已取消预算');
      render();
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openLearnSheet() {
    const panel = sheetPanel('常用商户', '你改过分类的商户，我会记下来，下次自动用。');
    const memory = store.memory();
    const keys = Object.keys(memory);
    if (!keys.length) {
      panel.appendChild(el('div', 'caption', '还没有。改一次分类就会有一条。'));
    } else {
      const card = el('div', 'card');
      for (const key of keys) {
        const category = store.categories().find((c) => c.id === memory[key]);
        const line = el('div', 'kv');
        line.appendChild(el('div', 'k', key));
        const right = el('div', 'v');
        right.textContent = category ? category.icon + ' ' + category.name : '未分类';
        const forget = el('button', 'link-btn', '忘掉');
        forget.type = 'button';
        forget.style.marginLeft = '10px';
        forget.addEventListener('click', () => {
          store.forget(key);
          closeSheet();
          toast('已经忘掉');
          render();
        });
        right.appendChild(forget);
        line.appendChild(right);
        card.appendChild(line);
      }
      panel.appendChild(card);
    }
    const actions = el('div', 'action-col');
    const close = el('button', 'row-btn ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openLedgerSheet() {
    const panel = sheetPanel('账本管理', '现在是单账本，够用；多账本以后再加。');
    const card = el('div', 'card');
    const line = el('div', 'kv');
    line.appendChild(el('div', 'k', '总账本'));
    line.appendChild(el('div', 'v', '✓ 正在用'));
    card.appendChild(line);
    panel.appendChild(card);
    const actions = el('div', 'action-col');
    const close = el('button', 'row-btn ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openSettings() {
    const panel = sheetPanel('设置', '数据只存在这台手机里，不上传任何服务器。');
    const field = el('div', 'field');
    field.style.padding = '0';
    field.appendChild(el('div', 'k', 'AI 判定服务地址（可选，留空就只用本地规则）'));
    const input = document.createElement('input');
    input.className = 'field';
    input.type = 'url';
    input.placeholder = 'https://你的代理/jev';
    input.value = store.settings().proxyUrl || '';
    input.style.marginTop = '8px';
    field.appendChild(input);
    panel.appendChild(field);
    panel.appendChild(el('div', 'caption', '浏览器直连 Jev 会被跨域拦截，key 也不能放在页面里 —— 要接 AI 得先有一层代理。没配也能用，分类走本地词表。'));

    const actions = el('div', 'action-col');
    const cancel = el('button', 'row-btn ghost', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', closeSheet);
    const save = el('button', 'row-btn', '保存');
    save.type = 'button';
    save.addEventListener('click', () => {
      store.setSettings({ proxyUrl: input.value.trim() });
      closeSheet();
      toast('已保存');
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openAbout() {
    const panel = sheetPanel('关于', '记账 · 说一句就记好');
    const card = el('div', 'card');
    [['数据在哪', '只在这台手机的浏览器里，不上传服务器'],
      ['金额怎么算', '本地代码算，AI 不参与任何金额与统计'],
      ['识别错了', '入账前一定先给你确认，改过的分类会记住'],
      ['导出去', '侧栏「导出数据」给你 CSV，随时能带走'],
      ['版本', '网页版 v1 · 与 iPhone 版共用同一套规则']].forEach(([k, v]) => {
      const line = el('div', 'kv');
      line.appendChild(el('div', 'k', k));
      line.appendChild(el('div', 'v', v));
      card.appendChild(line);
    });
    panel.appendChild(card);
    const actions = el('div', 'action-col');
    const close = el('button', 'row-btn ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function openClearConfirm() {
    const panel = sheetPanel('清空数据', '账单、预算和记住的商户都会删掉，不能撤销。');
    const actions = el('div', 'action-col');
    const cancel = el('button', 'row-btn ghost', '算了');
    cancel.type = 'button';
    cancel.addEventListener('click', closeSheet);
    const go = el('button', 'row-btn', '确认清空');
    go.type = 'button';
    go.style.background = 'var(--danger)';
    go.addEventListener('click', () => {
      store.clearAll();
      closeSheet();
      toast('已清空');
      render();
    });
    actions.appendChild(cancel);
    actions.appendChild(go);
    panel.appendChild(actions);
    openSheet(panel);
  }

  function exportCsv() {
    try {
      const blob = new Blob(['\ufeff' + store.exportCsv()], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'jizhang-' + new Date().toISOString().slice(0, 10) + '.csv';
      link.click();
      URL.revokeObjectURL(link.href);
      toast('已导出 CSV');
    } catch (error) {
      toast('导出失败：' + error.message, true);
    }
  }

  function openDrawer() {
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    renderDrawerStats();
  }
  function closeDrawer() {
    $('drawer').hidden = true;
    $('scrim').hidden = true;
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

  window.JZApp = { render, toast, openComposer, openStats, openDrawer };
  boot();
})();
