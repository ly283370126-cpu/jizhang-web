/* 记账核心逻辑 —— 与 JiZhangCore(Swift) 同一套规则，浏览器里直接跑。
 *
 * 三条铁律（和 App 侧完全一致）：
 *   1. 金额只存整数「分」，永不出现浮点金额
 *   2. 金额与时间由本地确定性代码抽取，AI/规则只判「是什么」，不产生数字
 *   3. 本地库读写出错必须报错，绝不伪装成「没有消费」
 *
 * 没有构建步骤、没有依赖：index.html 直接 <script src="js/core.js">。
 * node 下也能用（挂在 globalThis.JZ），所以规则能被真跑测试。
 */
(function (global) {
  'use strict';

  // ───────────────────────── 金额：整数分 ─────────────────────────

  const Money = {
    /** 分 → 显示文本 */
    format(minor, opts) {
      const o = opts || {};
      const negative = minor < 0;
      const abs = Math.abs(minor);
      const yuan = Math.floor(abs / 100);
      const cents = abs % 100;
      let intPart = String(yuan);
      let out;
      if (o.compact && cents === 0) {
        out = intPart;
      } else {
        out = intPart + '.' + String(cents).padStart(2, '0');
      }
      if (o.group && yuan >= 10000) {
        out = out.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
      const symbol = o.symbol === undefined ? '¥' : o.symbol;
      return (negative ? '-' : '') + symbol + out;
    },
    /** 元（字符串或数字）→ 分。绝不走浮点：按小数点切开算 */
    fromYuanText(text) {
      const m = String(text).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
      if (!m) return null;
      const sign = m[1] === '-' ? -1 : 1;
      const yuan = parseInt(m[2], 10);
      const frac = (m[3] || '').padEnd(2, '0');
      return sign * (yuan * 100 + parseInt(frac || '0', 10));
    },
    sum(minors) {
      return minors.reduce((a, b) => a + b, 0);
    }
  };

  // ───────────────────── 金额抽取（确定性，可验证） ─────────────────────

  const CN_DIGITS = { '零': 0, '〇': 0, '一': 1, '壹': 1, '两': 2, '二': 2, '贰': 2, '三': 3, '叁': 3, '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6, '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9 };

  /** 中文数字串 → 数值：「三十五」35、「两百」200、「一百零五」105、「十二」12。解析不了返回 null */
  function chineseNumber(text) {
    if (!text) return null;
    if (/^\d+$/.test(text)) return parseInt(text, 10);
    if (/^[十拾]$/.test(text)) return 10;
    let total = 0, section = 0, number = 0, seen = false;
    for (const ch of text) {
      if (CN_DIGITS[ch] !== undefined) {
        number = CN_DIGITS[ch];
        seen = true;
      } else if (ch === '十' || ch === '拾') {
        section += (number === 0 ? 1 : number) * 10;
        number = 0;
        seen = true;
      } else if (ch === '百' || ch === '佰') {
        section += (number === 0 ? 1 : number) * 100;
        number = 0;
        seen = true;
      } else if (ch === '千' || ch === '仟') {
        section += (number === 0 ? 1 : number) * 1000;
        number = 0;
        seen = true;
      } else if (ch === '万') {
        total += (section + number) * 10000;
        section = 0;
        number = 0;
        seen = true;
      } else {
        return null;
      }
    }
    if (!seen) return null;
    return total + section + number;
  }

  /** 抽出「不该当金额看」的部分：日期、钟点、序号、量词、电话、纯数字订单号 */
  function maskNonAmounts(text) {
    return text
      // 年月日
      .replace(/\d{2,4}\s*年/g, (s) => ' '.repeat(s.length))
      .replace(/\d{1,2}\s*月/g, (s) => ' '.repeat(s.length))
      .replace(/\d{1,2}\s*[日号]/g, (s) => ' '.repeat(s.length))
      // 钟点 18:30 / 8点30 / 8点半
      .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, (s) => ' '.repeat(s.length))
      .replace(/\d{1,2}\s*点\s*\d{0,2}\s*分?/g, (s) => ' '.repeat(s.length))
      // 周几
      .replace(/[上下本这]?\s*[周星期礼拜]\s*[一二三四五六日天]/g, (s) => ' '.repeat(s.length))
      // 量词 / 序号（「3个」「第2次」「5杯」）—— 注意别把「块」收进来：那是钱（12块5）
      .replace(/\d+\s*[个个人次杯份件张只碗瓶台套斤克袋盒箱桶条支片]/g, (s) => ' '.repeat(s.length))
      .replace(/第\s*\d+/g, (s) => ' '.repeat(s.length))
      // 手机号 / 卡号
      .replace(/\b1\d{10}\b/g, (s) => ' '.repeat(s.length))
      .replace(/\b\d{12,}\b/g, (s) => ' '.repeat(s.length));
  }

  // 「3.6元」「12块5」「3块6角」「1元5分」「三十五元」
  // 四组捕获的含义：金额本身 / 角 / 分 / 元块后面直接跟着的尾数（「12块5」的 5）
  const AMOUNT_PATTERNS = [
    // 数字 + 元/块 + 可选角/分/尾数
    { re: /(\d+(?:\.\d{1,2})?)\s*[元块](?:\s*(\d{1,2})\s*[角])?(?:\s*(\d{1,2})\s*分)?(?:\s*(\d{1,2})(?!\s*[角分]))?/g, kind: 'numeric' },
    // 数字 + 角/分（没有元）
    { re: /(\d+(?:\.\d{1,2})?)\s*[角](?:\s*(\d{1,2})\s*分)?/g, kind: 'jiao' },
    { re: /(\d+(?:\.\d{1,2})?)\s*分/g, kind: 'fen' },
    // 中文数字 + 元/块 + 可选角/分/尾数
    { re: /([零〇一壹两二贰三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万]{1,8})\s*[元块](?:\s*([零〇一壹两二贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*[角])?(?:\s*([零〇一壹两二贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*分)?(?:\s*([零〇一壹两二贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})(?!\s*[角分]))?/g, kind: 'cn' },
    // 裸数字：句尾的（「早饭12」「打车 25」）
    { re: /(?:^|[^\d.])(\d+(?:\.\d{1,2})?)\s*$/g, kind: 'bare' },
    // 裸数字：夹在中间的（「早饭12午饭35」）
    { re: /(?:^|[^\d.])(\d+(?:\.\d{1,2})?)(?=[^\d]|$)/g, kind: 'bare' }
  ];

  /** 抽出全部金额。返回 [{minor, matchedText, index}]，同一处只算一次 */
  function extractAll(text) {
    const masked = maskNonAmounts(text);
    const found = [];
    const taken = new Array(masked.length).fill(false);

    for (const pattern of AMOUNT_PATTERNS) {
      pattern.re.lastIndex = 0;
      let m;
      while ((m = pattern.re.exec(masked)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        if (taken.slice(start, end).some(Boolean)) continue;   // 已被更长的匹配吃掉
        let minor = null;
        // 前导的单个非数字字符只是边界，不能算进金额文本里（否则「早饭12」会变成「饭12」）
        const valueStart = start + m[0].indexOf(m[1]);
        const valueText = masked.slice(Math.max(0, valueStart), end);

        if (pattern.kind === 'bare') {
          minor = Money.fromYuanText(m[1]);
          if (minor === null || minor <= 0) continue;
        } else if (pattern.kind === 'numeric') {
          const yuanText = m[1];
          const jiao = m[2] || null;
          const fen = m[3] || null;
          const trailing = m[4] || null;
          if (/\./.test(yuanText)) {
            minor = Money.fromYuanText(yuanText);
          } else {
            minor = parseInt(yuanText, 10) * 100;
            if (jiao) minor += parseInt(jiao, 10) * 10;
            if (fen) minor += parseInt(fen, 10);
            // 「12块5」一位=角；「3块20」两位=分（既定规则，有测试锁住）
            if (!jiao && !fen && trailing) {
              minor += trailing.length === 1 ? parseInt(trailing, 10) * 10 : parseInt(trailing, 10);
            }
          }
        } else if (pattern.kind === 'jiao') {
          if (/\./.test(m[1])) {
            const yuan = Money.fromYuanText(m[1]);
            minor = yuan === null ? null : Math.round(yuan / 10);   // 3.5角 不好表达，按元×10 折算
          } else {
            minor = parseInt(m[1], 10) * 10;
          }
          if (minor !== null && m[2]) minor += parseInt(m[2], 10);
        } else if (pattern.kind === 'fen') {
          minor = /\./.test(m[1]) ? Math.round(Money.fromYuanText(m[1]) / 100) : parseInt(m[1], 10);
        } else if (pattern.kind === 'cn') {
          const yuan = chineseNumber(m[1]);
          if (yuan === null) continue;
          minor = yuan * 100;
          if (m[2]) minor += (chineseNumber(m[2]) || 0) * 10;
          if (m[3]) minor += (chineseNumber(m[3]) || 0);
          // 「三块六」一位=角（60分）；「三块二十」两位=分
          if (!m[2] && !m[3] && m[4]) {
            const digits = chineseNumber(m[4]);
            if (digits !== null) minor += m[4].length === 1 ? digits * 10 : digits;
          }
        }

        if (minor === null || minor <= 0) continue;
        if (minor > 100000000000000) continue;     // 离谱数字不要
        for (let i = start; i < end; i++) taken[i] = true;
        found.push({ minor, matchedText: valueText, index: valueStart });
      }
    }
    return found.sort((a, b) => a.index - b.index);
  }

  function extractFirst(text) {
    const all = extractAll(text);
    return all.length ? all[0] : null;
  }

  // ───────────────────────── 时间解析（确定性） ─────────────────────────

  const DAY_WORDS = [['今天', 0], ['今日', 0], ['昨天', -1], ['昨日', -1], ['前天', -2], ['大前天', -3], ['明天', 1]];
  const TIME_WORDS = [
    ['凌晨', 2], ['一大早', 6], ['一早', 6], ['清晨', 6], ['早晨', 7], ['早上', 7], ['上午', 10],
    ['中午', 12], ['正午', 12], ['午后', 14], ['下午', 15], ['傍晚', 18], ['晚饭', 19],
    ['晚上', 20], ['今晚', 20], ['夜里', 21], ['半夜', 23], ['深夜', 23]
  ];
  const WEEKDAY = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  /** 没写时间时的中性默认：当天 12:00（与 Swift 侧 DateParser.defaultHour 同一条规则）。
   *  落「当前时刻」的话，半夜十一点记一句「早饭12」会被记成早饭发生在 23:50。 */
  function defaultNoon(d) { const x = startOfDay(d); x.setHours(12, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  /** 周一为一周之始 */
  function mondayOf(d) {
    const x = startOfDay(d);
    const wd = x.getDay() === 0 ? 7 : x.getDay();
    return addDays(x, -(wd - 1));
  }

  function resolvedDay(text, now) {
    for (const [word, offset] of DAY_WORDS) if (text.includes(word)) return addDays(startOfDay(now), offset);
    return startOfDay(now);
  }

  function resolvedHour(text, fallback) {
    for (const [word, hour] of TIME_WORDS) if (text.includes(word)) return hour;
    return fallback === undefined ? null : fallback;
  }

  /** 「晚上7点」= 19 点：只说 7 点会记到早上 7 点去 */
  function mergeTimeOfDay(hour, text) {
    if (hour >= 12) return hour;
    const hint = resolvedHour(text, null);
    return (hint !== null && hint >= 12) ? hour + 12 : hour;
  }

  /** 解析文本里的时间。返回 {date, matchedText, explicit} 或 null */
  function parseDate(text, now) {
    const all = parseDateAll(text, now);
    return all.length ? all[0] : null;
  }

  function parseDateAll(text, now) {
    const results = [];
    const push = (date, matchedText) => results.push({ date, matchedText, explicit: true });

    // 1) 显式钟点
    let m;
    const clockRe = /(\d{1,2})\s*[:：]\s*(\d{2})/g;
    while ((m = clockRe.exec(text)) !== null) {
      const rawHour = parseInt(m[1], 10), minute = parseInt(m[2], 10);
      if (rawHour >= 24 || minute >= 60) continue;
      const d = resolvedDay(text, now);
      d.setHours(mergeTimeOfDay(rawHour, text), minute, 0, 0);
      push(d, m[0]);
    }
    const dotRe = /(\d{1,2}|[一二三四五六七八九十]{1,3})\s*点\s*(\d{1,2})?\s*半?\s*分?/g;
    while ((m = dotRe.exec(text)) !== null) {
      const rawHour = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : chineseNumber(m[1]);
      if (rawHour === null || rawHour >= 24) continue;
      let minute = m[2] ? parseInt(m[2], 10) : 0;
      if (m[0].includes('半')) minute = 30;
      const d = resolvedDay(text, now);
      d.setHours(mergeTimeOfDay(rawHour, text), minute, 0, 0);
      push(d, m[0]);
    }

    // 2) 年月日 / 月日
    const fullRe = /(?:(\d{2,4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g;
    while ((m = fullRe.exec(text)) !== null) {
      const year = m[1] ? parseInt(m[1], 10) : now.getFullYear();
      const month = parseInt(m[2], 10), day = parseInt(m[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const d = new Date(year, month - 1, day, 12, 0, 0, 0);
      push(d, m[0]);
    }

    // 3) 只有日号：「28日」。「30日」而今天 9/28 → 未来的日号退到上个月（记账不记未来）
    const dayRe = /(?:^|[^\d])(\d{1,2})\s*[日号]/g;
    while ((m = dayRe.exec(text)) !== null) {
      if (m[0].match(/\d+\s*月/)) continue;
      const day = parseInt(m[1], 10);
      if (day < 1 || day > 31) continue;
      let d = new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0, 0);
      if (d > startOfDay(now)) d = new Date(now.getFullYear(), now.getMonth() - 1, day, 12, 0, 0, 0);
      d.setHours(resolvedHour(text, 12));
      push(d, m[0].trim());
    }

    // 4) 周几
    const weekRe = /(上|这|本|下)?\s*[周星期礼拜]\s*([一二三四五六日天])/g;
    while ((m = weekRe.exec(text)) !== null) {
      const modifier = m[1] || '';
      const target = WEEKDAY[m[2]];
      let d = addDays(mondayOf(now), target - 1);
      if (modifier === '上') d = addDays(d, -7);
      else if (modifier === '下') d = addDays(d, 7);
      else if (startOfDay(d) < startOfDay(now)) d = addDays(d, 7);
      d.setHours(resolvedHour(text, 12));
      push(d, m[0]);
    }

    // 5) 相对日 / 时段词
    if (!results.length) {
      const hasDayWord = DAY_WORDS.some(([w]) => text.includes(w));
      const hour = resolvedHour(text, null);
      if (hasDayWord || hour !== null) {
        const d = resolvedDay(text, now);
        d.setHours(hour === null ? 12 : hour, 0, 0, 0);
        const matched = DAY_WORDS.find(([w]) => text.includes(w));
        push(d, matched ? matched[0] : '');
      }
    }
    return results;
  }

  // ───────────────────────── 切句（确定性） ─────────────────────────

  const CONJUNCTIONS = ['还有', '加上', '另外', '以及', '再记一笔', '顺便'];

  /** 一段里是否已经抽到金额 */
  function hasAmount(text) { return extractAll(text).length > 0; }
  /** 纯单位词（「元」「块」「毛」）—— 要和前一段黏在一起，不能被空格切开 */
  function isUnitToken(token) { return /^(元|块|毛|角|分|钱)$/.test(token); }

  /**
   * 切句：先按标点切，再**按空格切**。
   * 空格切开时守住两条：① 还没抽到金额的片段继续吸收后面的词（「微信付的」+「早饭12」）；
   * ② 纯单位词永远黏回前一片段（「今天早上公交」+「3.6」+「元」）。
   * 这是「微信付的 早饭12 午饭35 打车25」和「今天早上公交 3.6 元」能同时成立的关键。
   */
  function segments(text) {
    if (!text || !text.trim()) return [];
    const out = [];
    for (const part of text.replace(/\r\n/g, '\n').split(/[，,、;；\n]+/)) {
      if (!part.trim()) continue;
      let pieces = [part];
      for (const conj of CONJUNCTIONS) {
        pieces = pieces.flatMap((p) => (p.includes(conj) ? p.split(conj) : [p]));
      }
      for (const piece of pieces) {
        let current = null;
        for (const token of piece.split(/\s+/).filter(Boolean)) {
          if (current === null) { current = token; continue; }
          if (!hasAmount(current) || isUnitToken(token)) current += token;
          else { out.push(current); current = token; }
        }
        if (current !== null) out.push(current);
      }
    }
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // ───────────────────────── 本地判定（规则引擎） ─────────────────────────

  const DEFAULT_CATEGORIES = [
    { id: 'c-food', name: '餐饮', icon: '🍚', type: 'expense' },
    { id: 'c-transport', name: '交通', icon: '🚌', type: 'expense' },
    { id: 'c-shopping', name: '购物', icon: '🛒', type: 'expense' },
    { id: 'c-home', name: '居住', icon: '🏠', type: 'expense' },
    { id: 'c-health', name: '医疗', icon: '💊', type: 'expense' },
    { id: 'c-fun', name: '娱乐', icon: '🎬', type: 'expense' },
    { id: 'c-telecom', name: '通讯', icon: '📱', type: 'expense' },
    { id: 'c-social', name: '人情', icon: '🎁', type: 'expense' },
    { id: 'c-income', name: '收入', icon: '💰', type: 'income' }
  ];

  const DEFAULT_ACCOUNTS = [
    { id: 'a-wechat', name: '微信', type: 'wechat' },
    { id: 'a-alipay', name: '支付宝', type: 'alipay' },
    { id: 'a-cash', name: '现金', type: 'cash' },
    { id: 'a-card', name: '信用卡', type: 'creditCard' }
  ];

  /** 关键词 → 分类。**最长匹配优先**（否则「早上公交」里的「早」会把公交判成餐饮） */
  const KEYWORD_RULES = [
    { keywords: ['早饭', '早餐', '早点', '午饭', '午餐', '晚饭', '晚餐', '夜宵', '外卖', '食堂', '奶茶', '咖啡', '喝', '吃', '饭', '餐'], category: '餐饮' },
    { keywords: ['打车', '滴滴', '出租', '公交', '地铁', '高铁', '火车', '机票', '加油', '停车', '过路费', '共享单车'], category: '交通' },
    { keywords: ['超市', '淘宝', '京东', '拼多多', '日用品', '买', '购'], category: '购物' },
    { keywords: ['房租', '水电', '物业', '宽带', '燃气', '暖气'], category: '居住' },
    { keywords: ['药', '医院', '挂号', '体检', '看病', '牙'], category: '医疗' },
    { keywords: ['电影', '游戏', '演出', '门票', '酒吧', 'KTV', '唱歌'], category: '娱乐' },
    { keywords: ['话费', '流量', '会员', '订阅', '云盘'], category: '通讯' },
    { keywords: ['红包', '随礼', '份子', '礼物'], category: '人情' }
  ];

  const INCOME_MARKERS = ['收入', '工资', '薪', '奖金', '报销', '退款', '兼职', '卖了', '赚', '到账'];
  const ACCOUNT_MARKERS = [['微信', '微信'], ['支付宝', '支付宝'], ['现金', '现金'], ['信用卡', '信用卡'], ['刷卡', '信用卡'], ['花呗', '支付宝']];

  /** 判定一条片段。规则优先，其次用用户自己改过的记忆（越用越准） */
  function judge(segmentText, opts) {
    const o = opts || {};
    const categories = o.categories || DEFAULT_CATEGORIES;
    const accounts = o.accounts || DEFAULT_ACCOUNTS;
    const memory = o.memory || {};        // { '奈雪': 'c-food' } 用户纠正沉淀
    const text = segmentText;

    const isIncome = INCOME_MARKERS.some((k) => text.includes(k));
    const type = isIncome ? 'income' : 'expense';
    // 账户常出现在整句开头（「微信付的 早饭12 午饭35」），所以片段里找不到就继承整句的判定
    const accountId = matchAccount(text, accounts) || o.defaultAccountId || null;

    // 1) 用户纠正过的记忆（最准）
    for (const key of Object.keys(memory)) {
      if (key && text.includes(key)) {
        const hit = categories.find((c) => c.id === memory[key]);
        if (hit) return { type, categoryId: hit.id, accountId, source: 'memory', confidence: 0.99 };
      }
    }
    // 2) 直接说了分类名
    let categoryId = null;
    for (const category of categories) {
      if (text.includes(category.name)) { categoryId = category.id; break; }
    }
    if (categoryId) return { type, categoryId, accountId, source: 'name', confidence: 0.95 };

    // 3) 关键词，最长匹配优先
    let best = null;
    for (const rule of KEYWORD_RULES) {
      let longest = null;
      for (const keyword of rule.keywords) {
        if (text.includes(keyword) && (longest === null || keyword.length > longest.length)) longest = keyword;
      }
      if (longest && (best === null || longest.length > best.length)) {
        const hit = categories.find((c) => c.name === rule.category);
        if (hit) best = { length: longest.length, categoryId: hit.id, keyword: longest };
      }
    }
    if (best) return { type, categoryId: best.categoryId, accountId, source: 'keyword:' + best.keyword, confidence: 0.8 };

    if (isIncome) {
      const income = categories.find((c) => c.type === 'income');
      return { type, categoryId: income ? income.id : null, accountId, source: 'income', confidence: 0.7 };
    }
    return { type, categoryId: null, accountId, source: 'none', confidence: 0.4 };
  }

  function matchAccount(text, accounts) {
    for (const [marker, name] of ACCOUNT_MARKERS) {
      if (text.includes(marker)) {
        const hit = accounts.find((a) => a.name === name);
        if (hit) return hit.id;
      }
    }
    for (const account of accounts) if (text.includes(account.name)) return account.id;
    return null;
  }

  /** 商户/事项：去掉金额与时间词之后剩下的那截 */
  function extractMerchant(text) {
    let cleaned = text;
    const amount = extractFirst(text);
    if (amount) cleaned = cleaned.split(amount.matchedText).join('');
    const words = ['今天', '今日', '昨天', '前天', '早上', '早晨', '上午', '中午', '下午', '晚上', '今晚', '凌晨', '微信', '支付宝', '付的', '花的', '花了', '买'];
    for (const w of words) cleaned = cleaned.split(w).join('');
    cleaned = cleaned.replace(/[，,。、；;:：\s]/g, '');
    return cleaned || null;
  }

  // ───────────────────────── 一句话 → 草稿 ─────────────────────────

  /**
   * 解析一句话 → { kind, drafts } | { kind:'query', query } | { kind:'empty' }
   * 注意：**这里不写库**。写入只发生在用户确认之后。
   */
  function parseInput(input, opts) {
    const o = opts || {};
    const now = o.now || new Date();
    const text = (input || '').trim();
    if (!text) return { kind: 'empty' };

    const queryKind = detectQuery(text);
    if (queryKind) return { kind: 'query', query: buildQuery(text, queryKind, now) };

    const segs = segments(text);
    const accounts = o.accounts || DEFAULT_ACCOUNTS;
    const judgeOpts = Object.assign({}, o, { accounts, defaultAccountId: matchAccount(text, accounts) });
    const drafts = [];
    for (const segment of segs) {
      const amounts = extractAll(segment);
      const units = amounts.length ? amounts : [];
      if (!units.length) continue;
      const verdict = judge(segment, judgeOpts);
      const dateInfo = parseDate(segment, now);
      const when = dateInfo ? dateInfo.date : defaultNoon(now);
      for (const amount of units) {
        const fingerprint = dedupeKey(when, amount.minor, verdict.type, extractMerchant(segment) || segment);
        drafts.push({
          id: 'd-' + Math.random().toString(36).slice(2, 10),
          type: verdict.type,
          minor: amount.minor,
          occurredAt: when.toISOString(),
          dateExplicit: !!(dateInfo && dateInfo.explicit),
          categoryId: verdict.categoryId,
          accountId: verdict.accountId,
          merchant: extractMerchant(segment),
          note: segment,
          rawSegment: segment,
          confidence: verdict.confidence,
          ruleSource: verdict.source,
          fingerprint,
          needsAttention: []
        });
      }
    }
    if (!drafts.length) {
      const queryFallback = detectQuery(text);
      if (queryFallback) return { kind: 'query', query: buildQuery(text, queryFallback, now) };
      return { kind: 'unknown', text };
    }
    for (const draft of drafts) {
      if (!draft.dateExplicit) draft.needsAttention.push('date');
      if (!draft.categoryId) draft.needsAttention.push('category');
      if (!draft.accountId) draft.needsAttention.push('account');
    }
    return { kind: 'drafts', drafts };
  }

  const QUERY_MARKERS = ['多少', '查', '统计', '一共', '总共', '几笔', '哪几', '超过', '最高', '排名', '看看', '花了多少钱', '剩多少'];
  const BUDGET_MARKERS = ['预算', '还能花', '可用'];

  function detectQuery(text) {
    if (BUDGET_MARKERS.some((k) => text.includes(k))) return 'budget';
    if (QUERY_MARKERS.some((k) => text.includes(k))) return 'transactions';
    return null;
  }

  function buildQuery(text, kind, now) {
    const amount = extractFirst(text);
    const query = { kind, rangeLabel: null, minMinor: null, maxMinor: null, type: null, text };
    if (text.includes('今天')) query.rangeLabel = 'today';
    else if (text.includes('昨天')) query.rangeLabel = 'yesterday';
    else if (text.includes('本周') || text.includes('这周')) query.rangeLabel = 'current_week';
    else if (text.includes('上个月') || text.includes('上月')) query.rangeLabel = 'last_month';
    else if (text.includes('本月') || text.includes('这个月')) query.rangeLabel = 'current_month';
    else if (text.includes('今年')) query.rangeLabel = 'current_year';
    else if (text.includes('最近7') || text.includes('最近一周')) query.rangeLabel = 'last_7_days';
    else if (text.includes('最近')) query.rangeLabel = 'last_30_days';
    if (amount) {
      if (['超过', '大于', '多于', '以上', '高于'].some((k) => text.includes(k))) query.minMinor = amount.minor;
      else if (['低于', '小于', '不到', '以下', '少于'].some((k) => text.includes(k))) query.maxMinor = amount.minor;
    }
    if (INCOME_MARKERS.some((k) => text.includes(k))) query.type = 'income';
    else if (['支出', '花', '消费'].some((k) => text.includes(k))) query.type = 'expense';
    query.rangeLabel = query.rangeLabel || 'current_month';
    return query;
  }

  /** 日期区间（半开：[start, end)），周一为一周之始 */
  function rangeFor(label, now) {
    const today = startOfDay(now);
    switch (label) {
      case 'today': return { start: today, end: addDays(today, 1) };
      case 'yesterday': return { start: addDays(today, -1), end: today };
      case 'current_week': { const m = mondayOf(now); return { start: m, end: addDays(m, 7) }; }
      case 'last_month': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start: s, end: new Date(now.getFullYear(), now.getMonth(), 1) }; }
      case 'current_year': { const s = new Date(now.getFullYear(), 0, 1); return { start: s, end: new Date(now.getFullYear() + 1, 0, 1) }; }
      case 'last_7_days': return { start: addDays(today, -6), end: addDays(today, 1) };
      case 'last_30_days': return { start: addDays(today, -29), end: addDays(today, 1) };
      case 'current_month':
      default: { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: s, end: new Date(now.getFullYear(), now.getMonth() + 1, 1) }; }
    }
  }

  /** 截图/重复录入去重指纹：分钟精度 + 金额 + 方向 + 归一化商户 */
  function dedupeKey(date, minor, type, merchantOrNote) {
    const d = new Date(date);
    const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join('-');
    const normalized = (merchantOrNote || '').replace(/\s/g, '').toLowerCase();
    return stamp + '|' + type + '|' + minor + '|' + normalized;
  }

  // ───────────────────────── 统计（数字只来自本地） ─────────────────────────

  function inRange(tx, range) {
    const t = new Date(tx.occurredAt).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
  }

  function sum(txs, type) {
    return txs.filter((t) => !type || t.type === type).reduce((acc, t) => acc + t.minor, 0);
  }

  function byCategory(txs, categories, type) {
    const buckets = new Map();
    for (const tx of txs) {
      if (type && tx.type !== type) continue;
      const key = tx.categoryId || '__none__';
      buckets.set(key, (buckets.get(key) || 0) + tx.minor);
    }
    return Array.from(buckets.entries())
      .map(([categoryId, minor]) => ({
        categoryId: categoryId === '__none__' ? null : categoryId,
        name: (categories.find((c) => c.id === categoryId) || { name: '未分类' }).name,
        minor
      }))
      .sort((a, b) => b.minor - a.minor);
  }

  function dailyTotals(txs, since, days, now) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = addDays(startOfDay(now), -i);
      const range = { start: day, end: addDays(day, 1) };
      const slice = txs.filter((t) => inRange(t, range));
      out.push({ day, expense: sum(slice, 'expense'), income: sum(slice, 'income') });
    }
    return out;
  }

  function budgetStatus(budget, txs, now) {
    if (!budget) return null;
    // 时间一律按时间戳比较：occurredAt 存的是 ISO 字符串，直接和 Date 比会静默变成 false
    const start = new Date(budget.start).getTime();
    const end = new Date(budget.end).getTime();
    const spent = sum(
      txs.filter((t) => t.type === 'expense' && !t.excludedFromBudget
        && new Date(t.occurredAt).getTime() >= start
        && new Date(t.occurredAt).getTime() < end),
      'expense'
    );
    const remaining = budget.minor - spent;
    const endDay = startOfDay(new Date(budget.end));
    const daysRemaining = Math.max(1, Math.round((endDay - startOfDay(now)) / 86400000) + 1);
    return {
      budgetMinor: budget.minor,
      spent,
      remaining,
      daysRemaining,
      dailyAvailable: remaining > 0 ? Math.floor(remaining / daysRemaining) : 0,
      over: remaining < 0
    };
  }

  const DATE_LABELS = {
    today: '今天', yesterday: '昨天', current_week: '本周', current_month: '本月',
    last_month: '上月', current_year: '今年', last_7_days: '最近 7 天', last_30_days: '最近 30 天'
  };

  const JZ = {
    Money, chineseNumber, maskNonAmounts, extractAll, extractFirst,
    parseDate, parseDateAll, segments, judge, extractMerchant, parseInput,
    detectQuery, buildQuery, rangeFor, dedupeKey, inRange, sum, byCategory,
    dailyTotals, budgetStatus, DATE_LABELS, startOfDay, addDays, mondayOf,
    DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS, KEYWORD_RULES
  };

  global.JZ = JZ;
  if (typeof module !== 'undefined' && module.exports) module.exports = JZ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
