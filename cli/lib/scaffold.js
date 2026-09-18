/**
 * 题目脚手架生成：抓题 -> 目录 -> meta.json / README.md / solution.js / acm.js / tests/cases.json / notes.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fetchQuestion, slugFromId, extractExamples, stripHtml } from './leetcode.js';
import { planFromMeta, splitExampleTestcases } from './codec.js';
import { guessCompareMode } from './compare.js';
import { parseConstraints } from './constraints.js';
import { roadmap, findRoadmapProblem, problemDir, ensureDir, todayISO } from './paths.js';

/**
 * @param {string} key 题号或 slug
 * @param {{topic?: string, force?: boolean}} opts
 */
export async function scaffold(key, opts = {}) {
  const rm = findRoadmapProblem(key);
  const slug = rm?.slug ?? (/^\d+$/.test(key) ? await slugFromId(key) : key);
  const q = await fetchQuestion(slug);

  if (q.isPaidOnly) {
    throw new Error(`第 ${q.questionFrontendId} 题是会员题，抓不到题面。手动建目录或换一道。`);
  }

  const meta = JSON.parse(q.metaData);
  const plan = planFromMeta(meta);
  const topic = opts.topic ?? rm?.topic ?? 'misc';
  const chapters = rm?.chapters ?? [];

  const problem = {
    id: q.questionFrontendId,
    slug: q.titleSlug,
    title: q.translatedTitle || q.title,
    titleEn: q.title,
    difficulty: q.difficulty,
    topic,
    chapters,
    tags: q.topicTags.map((t) => ({ slug: t.slug, name: t.translatedName || t.name })),
    url: `https://leetcode.cn/problems/${q.titleSlug}/`,
    createdAt: todayISO(),
    status: 'new',
    mastery: 0,
    kind: plan.kind,
    entry: plan.kind === 'design' ? plan.classname : plan.name,
    signature:
      plan.kind === 'design'
        ? { classname: plan.classname, methods: plan.methods.map((m) => m.name) }
        : { params: plan.paramNames, types: plan.paramTypes, return: plan.returnType },
    codec: { params: {}, return: null },
    compare: {
      mode: guessCompareMode(
        plan.kind === 'design' ? 'list' : plan.returnType,
        q.topicTags.map((t) => t.slug),
        stripHtml(q.translatedContent || q.content),
      ),
    },
    casesVerified: false,
    leetcodeMeta: meta,
  };

  const dir = problemDir(problem);
  if (fs.existsSync(path.join(dir, 'meta.json')) && !opts.force) {
    return { dir, meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')), created: false };
  }
  ensureDir(dir);
  ensureDir(path.join(dir, 'tests'));
  ensureDir(path.join(dir, 'attempts'));

  const cases = buildCases(q, plan);
  problem.casesVerified = false;

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(problem, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), renderReadme(q, problem, plan));
  fs.writeFileSync(path.join(dir, 'problem.html'), renderProblemHtml(q, problem, plan));
  await cacheStatementImages(dir, path.join(dir, 'problem.html'));
  fs.writeFileSync(path.join(dir, 'tests', 'cases.json'), JSON.stringify(cases, null, 2) + '\n');

  const solutionFile = path.join(dir, 'solution.js');
  if (!fs.existsSync(solutionFile) || opts.force) {
    fs.writeFileSync(solutionFile, renderSolution(q, problem, plan));
  }
  fs.writeFileSync(path.join(dir, 'acm.js'), renderAcm(problem, plan));

  // brute.js 是 L2/L3 的判定依据，属于「你的思考过程」，绝不覆盖已有内容
  ensureBruteSkeleton({ ...problem, dir });

  const notesFile = path.join(dir, 'notes.md');
  if (!fs.existsSync(notesFile)) fs.writeFileSync(notesFile, renderNotes(problem));

  problem.dir = dir;
  return { dir, meta: problem, created: true, cases };
}

/** 官方样例 -> cases.json；期望值来自题面，按输入值匹配，标记 verified:false */
function buildCases(q, plan) {
  const paramCount = plan.kind === 'design' ? 2 : plan.paramTypes.length;
  const inputs = splitExampleTestcases(q.exampleTestcases, paramCount);
  const examples = extractExamples(q.translatedContent || q.content);

  // 题面示例按「输入值」建索引。不能按下标对齐 —— exampleTestcases 的条数
  // 可能多于题面示例数，硬对齐会让所有期望值错位一格。
  // 两侧都归一成 JSON 文本再比较。注意两侧要用不同的归一函数：
  // 题面那侧是文本（要剥 `s = ` 前缀再解析），已解析值那侧直接 stringify——
  // 否则第 3 题这种入参本身就是字符串的题，会被当成题面文本二次解析而错配。
  const normStatement = (text) => {
    const s = text.replace(/^[A-Za-z_$][\w$]*\s*=\s*/, '').trim();
    try {
      return JSON.stringify(JSON.parse(s));
    } catch {
      return JSON.stringify(s);
    }
  };
  const normValue = (v) => JSON.stringify(v);

  /**
   * 题面的多参数输入有两种写法：换行分隔，或者同一行 `nums = [3,2,2,3], val = 3`。
   * 后者不能按裸逗号切（数组内部全是逗号），只能切「后面紧跟 `变量名 =` 」的那个逗号。
   */
  const splitAssignments = (text) =>
    text
      .split('\n')
      .flatMap((line) => line.split(/,\s*(?=[A-Za-z_$][\w$]*\s*=)/))
      .map((s) => s.trim())
      .filter(Boolean);

  const byInput = new Map();
  for (const ex of examples) {
    const key = splitAssignments(ex.input).map(normStatement).join('|');
    if (!byInput.has(key)) byInput.set(key, ex.output);
  }

  return {
    /** true 表示你已经人工核对过期望输出，algo test 才会把失败当真失败 */
    verified: false,
    /** 题面「提示」里的数据范围，分级自测按它生成合法输入。解析不出来是 null */
    constraints: parseConstraints(stripHtml(q.translatedContent || q.content)),
    cases: inputs.map((args, i) => {
      const raw = byInput.get(args.map(normValue).join('|')) ?? null;
      return {
        name: `官方样例 ${i + 1}`,
        input: args,
        expected: parseExpected(raw),
        expectedRaw: raw,
        source: 'leetcode',
      };
    }),
  };
}

function parseExpected(raw) {
  if (raw === undefined || raw === null) return null;
  let cleaned = String(raw).replace(/\s*[（(].*?[）)]\s*$/, '').trim();

  // 原地修改题的输出写成 `5, nums = [0,1,2,3,4,_,_,_,_,_]`：
  // 前面是返回值 k，后面是期望的前 k 个元素，`_` 是占位符（力扣声明不检查的部分）。
  // 判题器已经按 k 截断了实际结果，所以这里也只取前 k 个。
  const kForm = cleaned.match(/^(\d+)\s*,\s*[A-Za-z_$][\w$]*\s*=\s*(\[.*\])$/);
  if (kForm) {
    const k = Number(kForm[1]);
    try {
      const arr = JSON.parse(kForm[2].replace(/\b_\b/g, 'null'));
      return arr.slice(0, k);
    } catch {
      /* 落到下面的通用解析 */
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
    if (cleaned === 'null') return null;
    const n = Number(cleaned);
    if (cleaned !== '' && !Number.isNaN(n)) return n;
    return cleaned;
  }
}

function renderReadme(q, problem, plan) {
  const body = stripHtml(q.translatedContent || q.content);
  const rmData = roadmap();
  const chapterLines = problem.chapters
    .map((cid) => rmData.chapters.find((c) => c.id === cid))
    .filter(Boolean)
    .map((c) => `- [${c.group} / ${c.title}](${c.url})`);
  const hints = (JSON.parse(q.hints ? JSON.stringify(q.hints) : '[]') || []).map(
    (h, i) => `<details><summary>提示 ${i + 1}</summary>\n\n${stripHtml(h)}\n\n</details>`,
  );
  const similar = safeJson(q.similarQuestions, [])
    .slice(0, 6)
    .map(
      (s) =>
        `- [${s.translatedTitle || s.title}](https://leetcode.cn/problems/${s.titleSlug}/) · ${s.difficulty}`,
    );

  return `# ${problem.id}. ${problem.title}

> ${problem.difficulty} · ${problem.tags.map((t) => t.name).join(' / ')}
> [力扣原题](${problem.url})

## 题面

${body}

## 本地约定

- 解法写在 \`solution.js\`，导出 \`${problem.entry}\`；**内容可原样粘贴到力扣**。
- ${
    plan.kind === 'design'
      ? `设计题：导出 class \`${plan.classname}\`，方法 ${plan.methods.map((m) => `\`${m.name}\``).join('、')}。`
      : `函数签名：\`${plan.name}(${plan.paramNames.join(', ')})\` -> \`${plan.returnType}\`。`
  }
- \`algo test ${problem.id}\` 跑本地判题；\`algo test ${problem.id} --acm\` 走真实 stdin/stdout（笔试模式）。
- 样例的期望输出是从题面抠出来的，**首次判题会让你确认一次**。

${chapterLines.length ? `## 路线定位\n\n${chapterLines.join('\n')}\n` : ''}
${hints.length ? `## 官方提示\n\n${hints.join('\n\n')}\n` : ''}
${similar.length ? `## 相似题（可作为变式来源）\n\n${similar.join('\n')}\n` : ''}`;
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 把题面里的远程图片抓到本地 assets/，并把 HTML 里的 src 改成相对路径。
 * 二叉树、矩阵这类题的配图往往比文字更说明问题，断网或力扣图床挂掉时不该看不到。
 * 抓失败就保留原始 URL——有网时照样能看，不阻断建题。
 */
async function cacheStatementImages(dir, htmlFile) {
  let html = fs.readFileSync(htmlFile, 'utf8');
  const urls = [...new Set([...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]))];
  if (!urls.length) return;

  const assetsDir = path.join(dir, 'assets');
  ensureDir(assetsDir);

  await Promise.all(
    urls.map(async (url) => {
      const ext = (url.match(/\.(png|jpe?g|gif|svg|webp)(?:\?|$)/i)?.[1] ?? 'png').toLowerCase();
      const name = `${createHash('sha1').update(url).digest('hex').slice(0, 12)}.${ext}`;
      const file = path.join(assetsDir, name);
      try {
        if (!fs.existsSync(file)) {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) return;
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        }
        html = html.split(url).join(`./assets/${name}`);
      } catch {
        /* 抓不到就留远程 URL */
      }
    }),
  );
  fs.writeFileSync(htmlFile, html);
}

/**
 * 单文件题面 HTML，直接丢进浏览器看。
 *
 * 刻意保留力扣原始 HTML 而不是走 stripHtml：题面里的加粗、行内 code、表格和图片
 * 都是有信息量的（尤其是二叉树、矩阵类题的配图），拍平成纯文本就丢了。
 * 不引任何外部资源，离线可看。
 */
function renderProblemHtml(q, problem, plan) {
  const rmData = roadmap();
  const chapters = problem.chapters
    .map((cid) => rmData.chapters.find((c) => c.id === cid))
    .filter(Boolean);
  const hints = safeJson(q.hints ? JSON.stringify(q.hints) : '[]', []);
  const similar = safeJson(q.similarQuestions, []).slice(0, 8);
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const diffColor = { Easy: '#00b8a3', Medium: '#ffb800', Hard: '#ff375f' }[problem.difficulty] ?? '#888';

  const section = (title, inner) => (inner ? `<section><h2>${title}</h2>${inner}</section>` : '');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${problem.id}. ${esc(problem.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 80px;
    font: 15px/1.75 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    color: #1f2328; background: #fff;
  }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 12px; line-height: 1.4; }
  h2 {
    font-size: 14px; letter-spacing: .06em; text-transform: uppercase;
    color: #8b949e; margin: 36px 0 12px; font-weight: 600;
  }
  .meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
  .diff { color: #fff; background: ${diffColor}; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .tag { background: #f0f2f5; padding: 2px 10px; border-radius: 999px; font-size: 12px; color: #57606a; }
  a { color: #0969da; }
  code {
    background: #f0f2f5; padding: 2px 6px; border-radius: 4px;
    font: 13px/1.5 "SF Mono", ui-monospace, Menlo, monospace;
  }
  pre {
    background: #f6f8fa; padding: 14px 16px; border-radius: 8px;
    font: 13px/1.6 "SF Mono", ui-monospace, Menlo, monospace;
    /* 样例块里的「解释」往往很长，必须折行——横向滚动条会把它藏起来 */
    white-space: pre-wrap; word-break: break-word;
  }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; border-radius: 8px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #d0d7de; padding: 6px 12px; }
  ul { padding-left: 22px; }
  .statement strong { color: #0f1419; }
  details {
    background: #f6f8fa; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;
  }
  summary { cursor: pointer; font-weight: 600; font-size: 14px; }
  .cmds { background: #f6f8fa; border-radius: 8px; padding: 14px 16px; }
  .cmds div { font: 13px/2 "SF Mono", ui-monospace, Menlo, monospace; }
  .cmds span { color: #8b949e; }
  footer { margin-top: 48px; color: #8b949e; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    code, pre, details, .cmds { background: #161b22; }
    .tag { background: #21262d; color: #8b949e; }
    td, th { border-color: #30363d; }
    .statement strong { color: #fff; }
    a { color: #4493f8; }
  }
</style>
</head>
<body>
<main>
  <div class="meta">
    <span class="diff">${problem.difficulty}</span>
    ${problem.tags.map((t) => `<span class="tag">${esc(t.name)}</span>`).join('')}
  </div>
  <h1>${problem.id}. ${esc(problem.title)}</h1>
  <p><a href="${problem.url}" target="_blank">在力扣打开 →</a></p>

  <div class="statement">${q.translatedContent || q.content || ''}</div>

  ${section(
    '本地约定',
    `<div class="cmds">
      <div>${
        plan.kind === 'design'
          ? `导出 class <code>${plan.classname}</code>，方法 ${plan.methods.map((m) => `<code>${m.name}</code>`).join('、')}`
          : `<code>${plan.name}(${plan.paramNames.join(', ')})</code> → <code>${plan.returnType}</code>`
      }</div>
      <div>比较模式 <code>${problem.compare.mode}</code> <span>（不合适就改 meta.json）</span></div>
      <div>algo test ${problem.id} <span>本地判题</span></div>
      <div>algo test ${problem.id} --acm <span>笔试模式，真实 stdin/stdout</span></div>
      <div>algo submit ${problem.id} <span>力扣过了之后记一笔，排复习</span></div>
    </div>`,
  )}

  ${section(
    '路线定位',
    chapters.length
      ? `<ul>${chapters.map((c) => `<li><a href="${c.url}" target="_blank">${esc(c.group)} / ${esc(c.title)}</a></li>`).join('')}</ul>`
      : '',
  )}

  ${section(
    '官方提示',
    hints.length
      ? hints.map((h, i) => `<details><summary>提示 ${i + 1}</summary>${h}</details>`).join('')
      : '',
  )}

  ${section(
    '相似题',
    similar.length
      ? `<ul>${similar
          .map(
            (s) =>
              `<li><a href="https://leetcode.cn/problems/${s.titleSlug}/" target="_blank">${esc(s.translatedTitle || s.title)}</a> · ${s.difficulty}</li>`,
          )
          .join('')}</ul>`
      : '',
  )}

  <footer>由 algo new ${problem.id} 生成 · ${problem.createdAt ?? todayISO()}</footer>
</main>
</body>
</html>
`;
}

/**
 * 把题面正文折成注释块。写进 solution.js 的头部——写代码时不用切窗口看题。
 * 力扣题面里的「判题标准」那段伪代码对解题没用，反而占屏幕，剔掉。
 */
function statementComment(q) {
  const body = stripHtml(q.translatedContent || q.content)
    .replace(/\n?(?:判题标准|用户评测)[:：][\s\S]*?(?=\n\s*示例\s*1)/, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  // 折叠连续空行，避免注释块里出现大片留白
  const lines = [];
  for (const l of body) {
    if (l === '' && lines[lines.length - 1] === '') continue;
    lines.push(l);
  }
  while (lines[lines.length - 1] === '') lines.pop();

  return lines.map((l) => (l ? ` * ${l}` : ' *')).join('\n');
}

function renderSolution(q, problem, plan) {
  const snippet = q.codeSnippets.find((s) => s.langSlug === 'javascript')?.code ?? '';
  const header = `/**
 * ${problem.id}. ${problem.title}  [${problem.difficulty}]
 *
 * ${problem.tags.map((t) => t.name).join(' / ')}
 * ${problem.url}
 * 详细题面（含图）：./problem.html
 *
 * ────────────────────────────────────────────────────────────
${statementComment(q)}
 * ────────────────────────────────────────────────────────────
 *
 * 思路（写完再补，algo submit 会读这里）：
 * 时间复杂度：
 * 空间复杂度：
 */

`;
  if (plan.kind === 'design') {
    return `${header}${snippet}
export { ${plan.classname} };
`;
  }
  return `${header}${snippet}
export { ${plan.name} };
`;
}

/**
 * ACM 包装：从 stdin 读入，每行一个参数，按组调用解法，结果打到 stdout。
 * 这层是给「笔试要自己处理 I/O」的场景练手用的，本地判题默认不走它。
 */
function renderAcm(problem, plan) {
  if (plan.kind === 'design') {
    return `/**
 * ACM 模式包装（设计题）：stdin 两行——方法名数组、参数数组。
 * 用法：echo '["${plan.classname}","..."]\\n[[...],[...]]' | node acm.js
 */
import { ${plan.classname} } from './solution.js';
import { readStdin } from '../../../cli/lib/acm-runtime.js';
import { runDesign } from '../../../cli/lib/runner.js';

const [opsLine, argsLine] = (await readStdin()).split('\\n');
const ops = JSON.parse(opsLine);
const args = JSON.parse(argsLine);
console.log(JSON.stringify(runDesign(${plan.classname}, ops, args)));
`;
  }
  const decodeLines = plan.paramTypes
    .map((t, i) => `  ${JSON.stringify(t)},`)
    .join('\n');
  return `/**
 * ACM 模式包装：stdin 每行一个参数（JSON），共 ${plan.paramTypes.length} 行为一组。
 * 用法：printf '%s\\n' '[2,7,11,15]' '9' | node acm.js
 */
import { ${plan.name} } from './solution.js';
import { readStdin } from '../../../cli/lib/acm-runtime.js';
import { decodeArgs, encodeResult, parseArgLine } from '../../../cli/lib/codec.js';

const PARAM_TYPES = [
${decodeLines}
];
const RETURN_TYPE = ${JSON.stringify(plan.returnType)};

const lines = (await readStdin()).split('\\n').filter((l) => l.trim() !== '');
for (let i = 0; i + PARAM_TYPES.length <= lines.length; i += PARAM_TYPES.length) {
  const raw = lines.slice(i, i + PARAM_TYPES.length).map(parseArgLine);
  const args = decodeArgs(raw, PARAM_TYPES);
  const ret = ${plan.name}(...args);
  ${
    plan.outputParamIndex !== null
      ? `const out = encodeResult(args[${plan.outputParamIndex}], PARAM_TYPES[${plan.outputParamIndex}]);
  console.log(JSON.stringify(${plan.outputSizeFromReturn ? 'out.slice(0, ret)' : 'out'}));`
      : `console.log(JSON.stringify(encodeResult(ret, RETURN_TYPE)));`
  }
}
`;
}

/**
 * 暴力参考解骨架。
 *
 * 这是 L2/L3 自测的判定依据：生成的输入没有官方答案，只能靠一个「慢但显然正确」的
 * 实现来对拍。写它的收益不只是测试——能不能写出暴力解，本身就是你是否真读懂题的检验。
 * 没写就跑 L2/L3，只会验证「没崩」，不会验证「对不对」。
 */
/** 骨架标记：模板里那行注释，写完实现要删掉。runner 认同一套约定 */
const BRUTE_STUB_MARK = /ALGO_BRUTE_NOT_WRITTEN/;

/** 行首的 export 才算真导出（注释里的不算） */
const HAS_EXPORT = /^\s*export\b/m;

function renderBrute(problem, plan) {
  if (plan.kind === 'design') {
    return `/**
 * ${problem.id}. ${problem.title} —— 暴力参考解（可选）
 *
 * 设计题的对拍方式：用最朴素的数据结构重写一遍（比如 LRU 直接用数组线性查找），
 * 不追求复杂度，只追求「显然正确」，然后和你的高效实现跑同一串操作比对。
 *
 * 写好后 algo test --level 2/3 会自动用它对拍。不写就只验证不崩溃。
 */

// export class ${plan.classname} { ... }
// ALGO_BRUTE_NOT_WRITTEN —— 这行标记告诉判题器「还没写」，写好实现后删掉它
`;
  }
  return `/**
 * ${problem.id}. ${problem.title} —— 暴力参考解（可选，但强烈建议写）
 *
 * 用途：L2 边界 / L3 随机用例没有官方答案，靠这个「慢但显然正确」的实现对拍。
 * 要求：只求正确，不求效率。允许 O(n^2)、允许排序、允许开额外数组。
 *       越朴素越好——它要是也写错了，对拍就失去意义。
 *
 * 写好后：algo test ${problem.id} --level 2   会自动用它判定
 * 不写的话：L2/L3 只能报告「有没有崩」，报不了「对不对」
 *
 * 另一种选择：答案不唯一时（比如「返回任意一个合法解」），改写 tests/invariant.js
 * 断言性质，而不是比对具体值。
 */

/**
${plan.paramNames.map((n, i) => ` * @param {${plan.paramTypes[i]}} ${n}`).join('\n')}
 * @returns {${plan.returnType}}
 */
export function ${plan.name}(${plan.paramNames.join(', ')}) {
  // ALGO_BRUTE_NOT_WRITTEN —— 这行标记告诉判题器「还没写」，写好实现后删掉它
  throw new Error('暴力参考解还没写。写完 L2/L3 才能真判对错，否则只验证不崩溃。');
}
`;
}

/**
 * 补 tests/brute.js 骨架，并刷新「还认得出是骨架」的旧文件。
 *
 * 重写条件只有两个，都是为了不碰你写的实现：
 *   1. 带 ALGO_BRUTE_NOT_WRITTEN 标记——模板约定写完实现要删掉它；
 *   2. 整个文件没有任何 export——设计题的骨架只有注释，本来就导不出东西。
 * 真写了实现一定会导出 entry（runner 就是这么加载的），那种文件一个字节都不动。
 *
 * 这是 L2/L3 唯一判定依据的入口，`algo new` 与 `algo oracle` 共用同一份模板，
 * 避免两处各写一个版本后慢慢跑偏。
 *
 * @param {any} meta 含 dir / leetcodeMeta 的 meta.json
 * @returns {'created' | 'refreshed' | 'exists'}
 */
export function ensureBruteSkeleton(meta) {
  const file = path.join(meta.dir, 'tests', 'brute.js');
  ensureDir(path.join(meta.dir, 'tests'));
  const plan = planFromMeta(meta.leetcodeMeta, meta.codec ?? {});
  const body = renderBrute(meta, plan);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, body);
    return 'created';
  }
  const text = fs.readFileSync(file, 'utf8');
  // 必须看「行首的 export」：设计题的骨架里 `// export class X { ... }` 是注释，
  // 用 \bexport\b 会把注释当成真导出，于是骨架被判成已有实现。
  if (!BRUTE_STUB_MARK.test(text) && HAS_EXPORT.test(text)) return 'exists';
  if (text === body) return 'exists';
  fs.writeFileSync(file, body);
  return 'refreshed';
}

function renderNotes(problem) {
  return `---
problem: "${problem.id}"
pattern: ""        # 用到的模板：sliding-window / binary-search-left / backtrack / dp-1d ...
keyInsight: ""     # 一句话讲清这题的转折点
pitfalls: []       # 踩过的坑，每条一行
complexity: ""     # 例：O(n) / O(1)
confidence: 0      # 0-5，自评
---

## 思路

## 关键代码片段

## 为什么之前想不出来

## 同类题的共同套路
`;
}
