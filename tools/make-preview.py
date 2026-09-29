#!/usr/bin/env python3
"""从 index.html 生成 _preview.html：只多插一段「造数据 + 打开某个弹层」的脚本，
不再维护第二份 HTML 结构（两份结构一走偏，预览就骗人）。
用法：python tools/make-preview.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")

SEED = """<script>
/* 预览专用：造点假数据 + 按 ?open= 打开某个界面。这个文件不进部署。 */
(function () {
  window.addEventListener('error', function (event) {
    const out = document.createElement('pre');
    out.textContent = 'JS ERROR: ' + (event.message || '') + ' @ ' + (event.filename || '') + ':' + (event.lineno || '')
      + (event.error && event.error.stack ? '\\n' + event.error.stack : '');
    out.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#000;color:#0F0;'
      + 'font:11px/1.4 monospace;padding:6px;margin:0;white-space:pre-wrap';
    document.body.appendChild(out);
  });
  if (location.search.indexOf('diag') >= 0) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const wide = [];
        document.querySelectorAll('body *').forEach((node) => {
          const box = node.getBoundingClientRect();
          if (box.right > window.innerWidth + 0.5 || box.left < -0.5) {
            wide.push((node.className || node.tagName) + '[' + Math.round(box.left) + '\\u2192' + Math.round(box.right) + ']');
          }
        });
        const out = document.createElement('pre');
        out.textContent = 'DIAG inner=' + window.innerWidth + ' scroll=' + document.documentElement.scrollWidth
          + ' overflow=' + (wide.slice(0, 12).join(' ') || 'none');
        out.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#FFF;color:#000;'
          + 'font:10px/1.35 monospace;padding:4px;margin:0;white-space:pre-wrap;border-bottom:2px solid #000';
        document.body.appendChild(out);
      }, 600);
    });
  }

  if (location.search.indexOf('seed') >= 0 && !localStorage.getItem('jz.v1')) {
    const now = new Date();
    const at = (back, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m, 0).toISOString();
    function item(back, h, m, minor, type, categoryId, accountId, merchant, note) {
      const iso = at(back, h, m);
      return {
        id: 'x' + Math.random().toString(36).slice(2, 9), type, minor, occurredAt: iso,
        categoryId, accountId, merchant, note, source: 'web',
        fingerprint: JZ.dedupeKey(new Date(iso), minor, type, merchant),
        createdAt: new Date().toISOString()
      };
    }
    const list = [
      item(0, 7, 20, 360, 'expense', 'c-transport', 'a-wechat', '公交', '今天早上坐公交花了3.6'),
      item(0, 12, 40, 3500, 'expense', 'c-food', 'a-alipay', '午饭', '中午吃了碗面35'),
      item(0, 20, 10, 1800, 'expense', 'c-food', 'a-wechat', '奈雪', '奈雪18'),
      item(1, 9, 30, 2500, 'expense', 'c-transport', 'a-wechat', '打车', '打车25'),
      item(1, 19, 0, 12850, 'expense', 'c-shopping', 'a-alipay', '超市', '超市买菜128.5'),
      item(2, 13, 0, 5800, 'expense', 'c-fun', 'a-wechat', '电影', '电影票58'),
      item(2, 21, 0, 1600, 'expense', 'c-food', 'a-wechat', '奶茶', '奶茶16'),
      item(3, 15, 30, 29900, 'expense', 'c-shopping', 'a-alipay', '买鞋', '网上买鞋299'),
      item(5, 12, 0, 2200, 'expense', 'c-food', 'a-alipay', '外卖', '外卖22'),
      item(27, 10, 0, 800000, 'income', 'c-income', 'a-card', '工资', '这个月工资到账')
    ];
    localStorage.setItem('jz.v1', JSON.stringify({
      version: 1, transactions: list, categories: JZ.DEFAULT_CATEGORIES, accounts: JZ.DEFAULT_ACCOUNTS,
      memory: { '奈雪': 'c-food', '楼下小超市': 'c-shopping' },
      budget: { minor: 300000, start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
                end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString() },
      settings: { proxyUrl: '' }
    }));
  }

  if (location.search.indexOf('open=') >= 0) {
    const what = location.search.match(/open=([a-z]+)/)[1];
    setTimeout(() => {
      const fire = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (what === 'drawer') fire(document.getElementById('menuBtn'));
      else if (what === 'stats') fire(document.getElementById('statsBtn'));
      else if (what === 'composer') fire(document.getElementById('plusBtn'));
      else if (what === 'confirm') {
        document.getElementById('input').value = '早饭12 打车25';
        document.getElementById('form').requestSubmit();
      } else if (what === 'query') {
        document.getElementById('input').value = '本月单笔超过200元的账单';
        document.getElementById('form').requestSubmit();
      } else if (what === 'suggests') document.getElementById('suggests').hidden = false;
    }, 400);
  }
})();
</script>
"""

marker = '<script src="js/app.js"></script>'
assert marker in html, 'index.html 里找不到 app.js 的 script 标签'
out = html.replace(marker, SEED + marker).replace('<title>记账</title>', '<title>记账（预览）</title>')
(ROOT / '_preview.html').write_text(out, encoding='utf-8')
print('✓ 已生成 _preview.html（%d 字节）' % len(out.encode('utf-8')))
