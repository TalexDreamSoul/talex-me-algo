# talex-me-algo

个人算法刷题工作台。labuladong 速成路线驱动 + 力扣抓题 + 本地判题 + 间隔复习 + 聚合看板。
解法一律 **JavaScript**，写完可原样粘贴到力扣提交。

## 日常流程

```bash
bun cli/index.js today          # 今天做什么：到期复习 + 路线上的下一批新题
bun cli/index.js new 3          # 抓题、建目录、生成骨架和用例，并在 Cursor 里定位光标
#  ...写代码...
bun cli/index.js test 3         # 本地判题
bun cli/index.js test 3 --acm   # 走真实 stdin/stdout（笔试模式）
#  ...去力扣提交...
bun cli/index.js submit 3       # 记为完成：快照代码 + 按 SM-2 排下次复习
bun cli/index.js web            # 打开看板
```

建议做个 alias：`alias algo='bun ~/Workspace/Projects/talex-me-algo/cli/index.js'`。

## 命令

| 命令 | 作用 |
|---|---|
| `new <题号\|slug>` | 抓题并生成完整题目目录。`--topic` 指定分类，`--force` 覆盖重建，`--no-open` 不开编辑器 |
| `test [题号\|路径]` | 本地判题。`--acm` 走子进程 I/O，`--case 1,3` 只跑指定用例，`--yes` 跳过期望值确认 |
| `submit [题号]` | 记为完成。`--rating 0-5` 自评，`--minutes` 用时，`--mode first\|rewrite\|variant` |
| `today` | 到期复习 + 路线上接下来的新题 |
| `list` | 路线题目及状态。`--topic`、`--status`、`--todo`、`--limit` |
| `review [题号]` | 复习。`--mode recall\|rewrite\|variant` |
| `stats` | 终端里的聚合分析 |
| `open <题号>` | 默认在 Cursor 里打开解法。`--doc` 浏览器看题面、`--readme`、`--notes`、`--leetcode` |
| `web` | 本地看板（可写）。`--port`、`--build`、`--no-open` |
| `sync` | 把磁盘上的 meta.json 重新灌进 sqlite |

`test` / `submit` 的题目参数可以是题号、slug、目录名，也可以是题目目录或其中任意文件的路径 ——
所以在 Cursor 里对着 `solution.js` 按 `⌘⇧B` 就能直接判当前这题。

## 目录结构

```
data/roadmap.json           labuladong 速成路线：99 章节 / 254 道题
data/algo.db                sqlite：判题记录、完成记录、复习排期
problems/<分类>/<题号>-<slug>/
  meta.json                 题目元信息、比较策略、状态、掌握度（真源，可 git diff）
  solution.js               你的解法。文件头就是完整题面，写码不用切窗口
  problem.html              完整题面，浏览器打开看。配图已抓到本地，离线可看
  assets/                   题面配图
  README.md                 题面纯文本 + 路线定位 + 官方提示 + 相似题
  acm.js                    自动生成的 stdin/stdout 包装
  tests/cases.json          官方样例（可自己加边界用例）
  tests/checker.js          可选，compare.mode = custom 时的自定义判定
  notes.md                  你的总结，frontmatter 会被聚合
  attempts/                 每次完成的代码快照
cli/                        CLI
web/                        看板前端（Vue 3 + @talex-touch/tuffex）
```

## 判题

`test` 默认在本进程内 import `solution.js` 直接调函数，快且栈信息完整。
入参会按力扣 `metaData` 解码成真实对象再传进去，返回值再编码回可比较的纯数据：

- `ListNode` / `TreeNode` / 多叉树 / 图节点 ↔ 力扣的数组表示
- 原地修改题（`moveZeroes`、`rotate`）自动比对被改过的那个入参
- `removeDuplicates` 那类只比对返回值 k 之前的部分
- 设计题（`LRUCache`）按 `["方法名"...]` + `[[参数]...]` 回放

### 比较策略

答案不唯一的题一律 deepEqual 会造成大量假失败。策略写在 `meta.json` 的 `compare.mode`，
建题时会根据返回类型、标签和**题面措辞**（「顺序可能发生改变」「任意顺序」）自动猜一个初值：

| 模式 | 用途 |
|---|---|
| `exact` | 严格相等（默认） |
| `unordered` | 一维数组忽略顺序 |
| `unorderedDeep` | 二维数组外层无序、内层有序（全排列、组合、子集） |
| `set` | 二维数组内外层都无序（nSum 的三元组） |
| `float` | 浮点，默认 eps 1e-5，可配 `compare.eps` |
| `anyOf` | `expected` 是若干合法答案，命中任一即可 |
| `custom` | 自己写 `tests/checker.js`，导出 `check(actual, expected, input)` |

### 期望输出是抠出来的

力扣没有结构化的期望输出字段，只能从题面正则抓「输出：」行。
所以新题第一次 `test` 会把每组用例的期望值列出来让你确认一次，确认后写 `tests/cases.json` 的
`verified: true`，之后不再问。**抓错了就直接改那个文件。**

## 复习

`submit` 时的自评（0-5）驱动 SM-2 变体排期。自评 < 3 视为没掌握，间隔重置为 1 天。
复习分三档，对间隔的影响不同：

- **recall（秒答）** — 只问「用哪个模板 / 复杂度 / 最易错的一步」，不写代码
- **rewrite（重写）** — 备份并掏空 `solution.js` 的函数体（保留签名），限时重写
- **variant（变式）** — 生成一条真正改变解法结构的新约束写进 `VARIANT.md`，再掏空重写

变式约束按题目 tag 挑选，例如二分搜索会让你改成左闭右开或求右边界，动态规划会让你把二维 dp
压成滚动数组或还原具体方案 —— 不是改改变量名的假变式。

## 看板

`bun cli/index.js web` 起在 5177。前端是 Vue 3 + `@talex-touch/tuffex`，
产物缺失或源码更新时会自动构建。三个视图：

- **路线** — 按分类折叠的进度，搜索 + 过滤，点卡片开抽屉
- **复习** — 到期排期表，逾期天数、轮次、失手次数、模板
- **洞察** — 难度分布、判题活跃度、分类缺口（覆盖率最低的排最前）、模板覆盖

抽屉里可以：改状态、调掌握度（同时重排复习）、手动排复习、编辑笔记（⌘S 保存）、
看判题与完成历史、看当前解法、一键在 Cursor 里打开对应文件。**所有写操作直接落到
`meta.json` 和 sqlite**，和 CLI 共用同一份真源。

前端源码改完后跑 `bunx vite build`，或 `bun cli/index.js web --build`。
开发模式 `bunx vite`（5178，API 代理到 5177）。

## 笔记 frontmatter

`notes.md` 顶部的字段会被 `stats` 和看板聚合，值得认真填：

```yaml
---
problem: "3"
pattern: "sliding-window"     # 用到的模板，这是聚合的主维度
keyInsight: "窗口内维护字符计数，出现重复就收缩左边界"
pitfalls: ["长度算的是 right - left + 1，漏掉 +1 最常见"]
complexity: "O(n) / O(k)"
confidence: 4
---
```

`pitfalls` 里出现两次以上的条目会在 `stats` 里被单独列成「反复踩的坑」。

## 路线数据

`data/roadmap.json` 从 [labuladong 速成目录](https://labuladong.online/zh/algo/intro/quick-learning-plan/)
抓取：99 个章节节点、254 道唯一题目（Easy 46 / Medium 182 / Hard 26），
每道题带所属章节和分类。手动 `algo new` 路线外的题也支持，会落到 `misc` 分类并在看板里标出。
