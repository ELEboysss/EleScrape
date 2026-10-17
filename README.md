# EleScrape

> 零依赖的浏览器抓包工具：一行命令把页面里的每个请求、响应头和响应体完整落盘，结果可以用脚本再次查询、过滤、导出和复放。

基于 **Chrome DevTools Protocol**，不需要装代理证书、不需要改系统代理、不需要 `npm install` 任何东西。CLI 和库两种用法，可嵌进任意 Node 脚本或 CI 流水线。

```bash
node bin/elescrape.js capture --url http://127.0.0.1:8089/ --filter "/api/" --duration 15
node bin/elescrape.js list .elescrape/20261017-094500-abcd --status 2xx
node bin/elescrape.js export .elescrape/20261017-094500-abcd --format csv --out requests.csv
```

---

## 特性

| | |
|---|---|
| **零运行时依赖** | 只用 Node 内置模块，Node ≥ 22 直接跑，无需 `npm install` |
| **完整响应体** | 不只记录 URL，正文、响应头、POST 数据、耗时、来源页面全部保留 |
| **HTTP + HTTPS 通吃** | 走浏览器自身的网络栈，HTTPS 天然可见，**不用装根证书** |
| **自动处理 GBK** | 没有声明 charset 的中文响应会尝试 GBK/GB18030 解码 |
| **密码默认脱敏** | `password` / `pwd` / `mm` 等表单字段在落盘时替换为 `<redacted>` |
| **沙箱友好** | 浏览器可以由外部启动，工具用 `--attach` 连上去（见[下文](#受限沙箱里怎么用)） |
| **结构化输出** | `requests.jsonl` + `bodies/` 目录，天然适合 `jq`、pandas、脚本二次处理 |
| **可复放** | 记录下来的请求可以原样（含 Cookie）再发一次，方便调接口 |

## 为什么用 CDP 而不是代理

传统抓包靠中间人代理（Fiddler / mitmproxy），代价是装证书、改代理设置、处理证书固定。这不是必须的：浏览器本来就能被调试协议驱动，**让浏览器自己告诉我们它发了什么**，语义更准（能看到资源类型、发起页面、缓存命中），也不用碰任何系统配置。

代价是必须有一个 Chromium 内核的浏览器，并且它得带着 `--remote-debugging-port` 启动。这正是 `launch` 和 `attach` 两种模式的由来。

## 安装

```bash
# 直接用（不需要安装）
git clone https://github.com/ELEboysss/EleScrape.git elescrape
cd elescrape
node bin/elescrape.js --help

# 或者链接成全局命令
npm link          # 之后可以直接用 `elescrape`
```

要求 **Node.js ≥ 22**（需要内置的全局 `WebSocket`）。用 `node --version` 确认。

## 快速开始

```bash
# 1. 起一个本地演示站点
node examples/demo-server.js        # http://127.0.0.1:8089/

# 2. 抓 15 秒，只记录 /api/ 下的请求
node bin/elescrape.js capture --url http://127.0.0.1:8089/ --filter "/api/" --duration 15

# 3. 看结果
node bin/elescrape.js list .elescrape/<session-id>
node bin/elescrape.js show .elescrape/<session-id> --id 3 --body
node bin/elescrape.js export .elescrape/<session-id> --format csv --out requests.csv
```

`capture` 默认会自己拉起一个 Chrome，用一个独立 profile（不动你日常的浏览器资料），抓完关窗口就结束。

## 命令

### `capture`

把流量记录进一个 session 目录。

```bash
elescrape capture --url https://example.com [options]
```

| 选项 | 说明 | 默认 |
|---|---|---|
| `-u, --url <url>` | 起始地址，连上后自动打开 | `about:blank` |
| `-p, --port <n>` | DevTools 端口 | `9333` |
| `-o, --out <dir>` | 指定 session 目录 | `<base-dir>/<时间戳>-<随机>` |
| `--base-dir <dir>` | 自动命名 session 的父目录 | `.elescrape` |
| `--browser <path>` | 指定浏览器可执行文件 | 自动探测 |
| `--profile <dir>` | 浏览器 profile 目录 | `<session>/profile` |
| `--attach` | 不启动浏览器，等外部浏览器就绪 | `false` |
| `--headless` | 无头模式（仅 launch 模式有效） | `false` |
| `--no-navigate` | 不自动打开 `--url` | 会自动打开 |
| `--filter <re>` | 只记录 URL 匹配的请求，可重复 | 全部 |
| `--exclude <re>` | 跳过 URL 匹配的请求，可重复 | 无 |
| `--type <t>` | 只记录指定资源类型（`XHR`/`Fetch`/`Document`…），可重复 | 全部 |
| `--no-bodies` | 不抓响应体 | 会抓 |
| `--max-body <size>` | 单个响应体上限，可写 `512kb`/`20mb` | `20mb` |
| `--no-redact` | 关闭密码脱敏（**谨慎**） | 会脱敏 |
| `--duration <s>` | N 秒后自动停止 | 不限 |
| `--idle <s>` | 连续 N 秒无新请求就停止 | 关闭 |
| `--attach-timeout <s>` | 等外部浏览器多久 | `300` |
| `--json` | stdout 输出 NDJSON，便于管道处理 | 关闭 |
| `-v, --verbose` | 调试日志 | 关闭 |
| `--quiet` | 静默，只留最终摘要 | 关闭 |

停止方式：关掉浏览器窗口 / `--duration` / `--idle` / `Ctrl+C`。

**退出码**：`0` 正常，`1` 运行错误，`2` 参数错误。

### `launch`

单独启动一个带调试端口的浏览器，然后由别的命令/脚本去连。适合把"浏览器生命周期"和"抓包"拆开。

```bash
elescrape launch --port 9333 --url http://example.com
elescrape launch --list-browsers          # 看看探测到了哪些浏览器
```

### `list`

按表格（或 JSON）列出记录。

```bash
elescrape list <session>
elescrape list <session> --filter "/api/" --status 2xx --type XHR
elescrape list <session> --format jsonl | jq -r 'select(.status>=400) | .url'
```

`--status` 支持 `200`、`2xx`、`>=400`、`300-399`。

### `show`

打印单条请求的完整信息，加 `--body` 直接看响应正文。

```bash
elescrape show <session> --id 12 --body
elescrape show <session> --id 12 --json | jq .postData
```

### `export`

导出成 JSON / JSONL / CSV。

```bash
elescrape export <session> --format csv --out requests.csv
elescrape export <session> --filter "/api/" --format jsonl
elescrape export <session> --format csv --bom --fields id,method,url,status,postData
```

CSV 默认不带 BOM（对 `grep`/`awk` 友好）；要让 Excel 正确识别中文就加 `--bom`。

### `replay`

把记录下来的请求原样再发一次，复用的是记录里的头部（含 Cookie）。

```bash
elescrape replay <session> --id 139 --dry-run           # 只看不发
elescrape replay <session> --id 139 --set page=1 --set rows=1000
```

> 这会向真实服务器发请求。`--dry-run` 先看清楚再决定。

## 输出结构

```
.elescrape/20261017-094500-abcd/
├── meta.json         # 参数、浏览器版本、起止时间、最终统计
├── requests.jsonl    # 每条请求一行 JSON
├── summary.json      # 收尾汇总，脚本里最好读
└── bodies/
    ├── 0001-POST_api_login.bin     # 响应原始字节
    ├── 0001-POST_api_login.txt     # 解码后的 UTF-8 文本（文本类才有）
    └── ...
```

`requests.jsonl` 单条记录：

```json
{
  "id": 1,
  "time": "2026-10-17T01:50:22.153Z",
  "method": "POST",
  "url": "http://127.0.0.1:8089/api/users",
  "type": "XHR",
  "documentURL": "http://127.0.0.1:8089/",
  "requestHeaders": { "content-type": "application/x-www-form-urlencoded" },
  "postData": "page=1&rows=10",
  "status": 200,
  "statusText": "OK",
  "mimeType": "application/json",
  "responseHeaders": { "content-type": "application/json; charset=utf-8" },
  "durationMs": 12,
  "fromCache": false,
  "body": {
    "file": "bodies/0001-POST_api_users.bin",
    "textFile": "bodies/0001-POST_api_users.txt",
    "bytes": 412,
    "truncated": false,
    "sha256": "…"
  }
}
```

失败或没有响应体的请求会带 `error` / `bodyError` 字段，记录本身不会丢。

## 作为库使用

```js
import { capture } from 'elescrape';

const { summary, dir } = await capture({
  url: 'http://127.0.0.1:8089/',
  out: '.elescrape/scripted',
  include: [/\/api\//],
  duration: 15,
  onRecord: (r) => console.log(r.status, r.method, r.url),
});

console.log(summary.requests, 'requests captured into', dir);
```

需要更细粒度控制时，直接用底层组件：

```js
import { Session, Recorder, TargetWatcher, CdpConnection } from 'elescrape';

const session = Session.create({ dir: '.elescrape/manual' });
const recorder = new Recorder({ session, options: { include: [/api/] } });
const watcher = new TargetWatcher({ port: 9333 });

watcher.on('attach', (connection, target) => recorder.bind(connection, target));
await watcher.start();
// … 自己决定什么时候停
await watcher.stop();
console.log(await session.close());
```

| 导出 | 作用 |
|---|---|
| `capture()` | 端到端抓包，含浏览器生命周期与停止条件 |
| `Session` | session 目录读写 |
| `Recorder` | CDP 事件 → 记录落盘（可单独测试） |
| `TargetWatcher` | 发现标签页并维持连接（新增标签/弹窗自动挂上） |
| `CdpConnection` | 极简 CDP 客户端 |
| `discoverBrowsers()` / `resolveBrowser()` | 浏览器探测 |
| `decodeBuffer()` / `redactFormData()` | 编码与脱敏工具 |

## 受限沙箱里怎么用

有些环境不允许工具自己拉起浏览器。最典型的是 Windows 的 AppContainer 类沙箱：Chromium 需要命名管道做进程间通信，被拒后会在启动阶段自杀，日志里是

```
ERROR crashpad_client_win.cc: OpenProcess: 拒绝访问 (0x5)
FATAL platform_channel.cc: Check failed
```

这种情况用 `--attach`：**浏览器在沙箱外启动，工具在沙箱内连接**（回环地址通常是通的）。

```bash
# 沙箱外：手工或脚本启动浏览器
chrome.exe --remote-debugging-port=9333 --user-data-dir=D:\tmp\profile ^
           --no-first-run --no-default-browser-check about:blank

# 沙箱内：连上去抓
node bin/elescrape.js capture --attach --port 9333 --url http://example.com
```

`--attach` 模式下工具不会碰浏览器进程，也不会自动关它——你关窗口它就结束。

## 常见问题

**连不上调试端口 / 端口没反应？**
如果同 profile 的 Chrome 已经在跑，新进程会复用它并**忽略** `--remote-debugging-port`。用一个独立 `--user-data-dir`，或者先关掉已有实例。`elescrape launch` 默认就给独立 profile。

**为什么没抓到登录密码？**
两种情况：一是走了统一身份认证，密码提交在另一个域的 HTTPS 表单里；二是工具默认把 `password`/`pwd`/`mm` 等字段替换成 `<redacted>`。确认需要原始值时用 `--no-redact`，但别把结果提交进仓库。

**响应体是空的 / `bodyError`？**
重定向响应、`204`、以及已经被浏览器回收的资源拿不到正文，属正常现象。`--max-body` 设太小也会截断，记录里会有 `truncated: true`。

**中文乱码？**
文本响应会自动尝试 GBK。若仍乱码，用 `show --raw` 拿原始字节自行解码。

**怎么抓分页接口的全部数据？**
`list` 里确认分页参数（`page` / `rows`、`offset` / `limit` 之类），再用 `replay` 把 `rows` 调大一次取完，比翻页省事：

```bash
elescrape list <session> --filter "/api/" --format jsonl | jq -c '.[] | {id, url, postData}'
elescrape replay <session> --id 139 --set rows=1000
```

## 开发

```bash
npm test              # 单元 + CLI 集成测试（node:test）
npm run test:in-process   # 环境禁止子进程时用这个
node scripts/check-syntax.js
```

测试不需要浏览器：CDP 客户端被一个 `FakeConnection` 替身接管，覆盖面在 `test/recorder.test.js` 和 `test/cli-session.test.js`。

目录：

```
bin/       CLI 入口
src/core/  CDP 连接、目标挂接、录制器、session 存储、浏览器生命周期
src/util/  编码、脱敏、日志、参数解析、错误类型
src/cli/   子命令
test/      单元与集成测试
examples/  演示站点与脚本示例
```

## License

MIT
