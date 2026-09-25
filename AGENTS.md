# talex-me-algo — agent 约定

老板的算法刷题工作台。项目全貌看 `README.md`，这里只写进这个仓库必须守的规矩。

## 这是练题环境，不是产品

- `solution.js` 是**老板自己写的**。不要代写、不要补全、不要改他的实现。
- 判题失败只做定位：给出失败输入、错在哪一步、该守的不变式、反例。
  细节见 skill `talex-me-algo-failure-triage`。

## oracle（`tests/brute.js`）的生成时机

L2/L3 的对拍、以及 `algo submit` 的默认门禁，都靠 `tests/brute.js`。
它是判定依据，所以**生成时机就是泄题边界**：

| 时机 | 做不做 |
|---|---|
| 题目刚抓下来、老板还在写 | **不要生成** —— 那是一份能跑通的参考实现 |
| 老板说「过了」「提交了」，或 `algo submit` 之后 | 可以生成 |

生成时必须满足：

1. **走和主解不同的实现路径**。递归主解配迭代 oracle，反之亦然。
   两边错在同一处时对拍会给出假绿灯——那比没有 oracle 更糟。
2. 这题写不出更慢的「暴力」版本时（589 就是 O(n) 遍历），用另一种独立思路顶上，
   并在文件头写清为什么。
3. 生成后跑 `algo test <题号> --level 3` 复核，全过才算这颗 oracle 可信。

答案不唯一的题不用 oracle，改 `tests/invariant.js` 断言性质。

## 跑命令的副作用

- `algo test` / `algo submit` 每次都会往 `data/algo.db` 的 `runs` 表插行。
  为了排查跑过它，要主动报出插入的 id，并问是否清掉——否则聚合统计被假运行污染。
- 要复现判题、看解码结果时，直接调 `cli/lib/runner.js` 或 `cli/lib/codec.js`，
  不要在 `/tmp` 之外建副本，也不要改老板的 `solution.js`。
