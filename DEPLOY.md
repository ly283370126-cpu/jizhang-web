# 部署说明（网页版记账）

独立仓库：`ly283370126-cpu/jizhang-web`（公开 —— GitHub Pages 在私有库要付费）。
**不要**把网页版塞进「乾粮电子名片」仓库：那边的 `release.py` 是整树替换发布，下次发名片会被删掉。

## 地址

| 用途 | 地址 |
|------|------|
| 正式（自定义域名） | `https://jz.liyanzhixiangshuijiao.cn` |
| GitHub 直访（域名生效前/备用） | `https://ly283370126-cpu.github.io/jizhang-web/` |

## 还差一步：DNS 记录（只能域名主人在注册商/DNS 服务商处加）

| 主机记录 | 类型 | 记录值 | TTL |
|---------|------|--------|-----|
| `jz` | CNAME | `ly283370126-cpu.github.io` | 600 |

和现有 `card` 那条记录是同一个地方、同一种加法。加完等几分钟，`https://jz.liyanzhixiangshuijiao.cn` 就能打开；
GitHub 随后会自动签发 HTTPS 证书（首次访问若提示不安全，等 10 分钟再试）。

## 发布流程

源码在 `E:\记账软件\web`（和 App 侧同一个仓库，是唯一真源）。改完推两步：

```bash
# 1) 先在本机验证（三件事都能真跑）
cd "E:/记账软件/web"
node tests/core.test.js      # 金额/时间/切句/规则 63 项
node tests/store.test.js     # 本地库/原子写入/去重/损坏数据 30 项
node tools/check-wiring.js   # HTML 与 JS 的接线自检 27 项

# 2) 同步到部署仓库
rm -rf "$TMPDIR/jizhang-web-deploy" && git clone -q https://github.com/ly283370126-cpu/jizhang-web.git "$TMPDIR/jizhang-web-deploy"
cp -r "E:/记账软件/web/." "$TMPDIR/jizhang-web-deploy/"
cd "$TMPDIR/jizhang-web-deploy" && git add -A && git -c user.name=李闫 -c user.email=liyan@example.com commit -m "更新" && git push
```

Pages 会自动重建（约 30–60 秒）。

## 改过域名 / 出问题时的排查

```bash
TOK=$(sed -n 's|https://[^:]*:\([^@]*\)@github.com|\1|p' ~/.git-credentials | head -1)

# 看 Pages 状态（status 应为 built，cname 应为 jz.liyanzhixiangshuijiao.cn）
curl -s -H "Authorization: Bearer $TOK" https://api.github.com/repos/ly283370126-cpu/jizhang-web/pages

# 临时解绑自定义域名（用来直连 github.io 验证文件）：body 换成 {"cname":null,"source":{"branch":"main","path":"/"}}
# 验完记得绑回来（body 见上表 cname）

# DNS 是否生效（绕开本机缓存）
curl -s "https://dns.alidns.com/resolve?name=jz.liyanzhixiangshuijiao.cn&type=CNAME"
```

## 数据与密钥

- 账单只存浏览器 `localStorage`（键 `jz.v1`），不上传任何服务器。
- 页面里**没有**任何 API Key；Jev 无 CORS 允许头，浏览器直连会被拦 —— 要接 AI 判定必须自建一层代理（设置里填代理地址即可启用，留空则走本地规则）。
- `robots.txt` 全站 disallow，页面带 `noindex`，不进搜索引擎。
