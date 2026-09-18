/**
 * 力扣中国站抓取。全部走公开 GraphQL，不需要登录态。
 */

const GRAPHQL = 'https://leetcode.cn/graphql/';

const QUESTION_QUERY = `query q($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    translatedTitle
    titleSlug
    difficulty
    isPaidOnly
    translatedContent
    content
    metaData
    sampleTestCase
    exampleTestcases
    hints
    similarQuestions
    topicTags { name slug translatedName }
    codeSnippets { langSlug code }
  }
}`;

/**
 * 带超时和重试的 fetch。
 *
 * 力扣会对短时间内的密集请求限流——连着建十几道题时，某次请求可能一直挂着不返回，
 * 而 fetch 默认没有超时，会把整个进程卡死。这里给死线并对限流退避重试。
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{timeout?: number, retries?: number}} [opts]
 */
async function fetchWithRetry(url, init = {}, opts = {}) {
  const timeout = opts.timeout ?? 15000;
  const retries = opts.retries ?? 3;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 退避：1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      // 429/5xx 是可重试的；4xx 其他状态说明请求本身有问题，立刻失败
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`力扣返回 HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`请求力扣失败（已重试 ${retries} 次）：${lastErr?.message ?? lastErr}`);
}

/**
 * @param {string} slug
 * @returns {Promise<object>}
 */
export async function fetchQuestion(slug) {
  const res = await fetchWithRetry(GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: `https://leetcode.cn/problems/${slug}/`,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
    body: JSON.stringify({ query: QUESTION_QUERY, variables: { titleSlug: slug } }),
  });
  if (!res.ok) throw new Error(`力扣返回 HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`力扣 GraphQL 报错：${json.errors[0].message}`);
  const q = json.data?.question;
  if (!q) throw new Error(`题目不存在：${slug}`);
  return q;
}

/** 通过题号找 slug（用 roadmap 里没有的题时兜底查全量索引） */
export async function slugFromId(id) {
  // 全量题库索引有好几 MB，给更长的死线
  const res = await fetchWithRetry(
    'https://leetcode.cn/api/problems/all/',
    { headers: { 'user-agent': 'Mozilla/5.0' } },
    { timeout: 30000 },
  );
  if (!res.ok) throw new Error(`力扣题库索引返回 HTTP ${res.status}`);
  const json = await res.json();
  const hit = json.stat_status_pairs.find(
    (p) => String(p.stat.frontend_question_id) === String(id),
  );
  if (!hit) throw new Error(`题库里没有第 ${id} 题`);
  return hit.stat.question__title_slug;
}

/**
 * 从题面 HTML 抽「输入/输出」成对的示例。
 *
 * 力扣没有结构化的期望输出字段，只能从题面抠,因此结果一律标记为「待确认」。
 * 必须成对抽取而不是只抽输出:`exampleTestcases` 的条数和题面示例数并不总是一致
 * (94 题中序遍历就有 4 条 testcase 但只有 3 个示例),按下标硬对齐会让期望值整体错位。
 * @param {string} html
 * @returns {{input: string, output: string}[]}
 */
export function extractExamples(html) {
  if (!html) return [];
  const lines = stripHtml(html).split('\n');
  const out = [];
  /** @type {string[]} */
  let pendingInput = [];

  /** 读一个 `标签：值` 或 `标签` + 下一行值,返回 [值, 消耗的额外行数] */
  const readLabeled = (i, re) => {
    const line = lines[i].trim();
    const inline = line.match(re.inline);
    if (inline) return [inline[1].trim(), 0];
    if (re.alone.test(line)) {
      const next = (lines[i + 1] ?? '').trim();
      if (next) return [next, 1];
    }
    return [null, 0];
  };

  const IN = { inline: /^(?:输入|Input)\s*[：:]\s*(.+)$/, alone: /^(?:输入|Input)\s*[：:]?$/ };
  const OUT = { inline: /^(?:输出|Output)\s*[：:]\s*(.+)$/, alone: /^(?:输出|Output)\s*[：:]?$/ };

  for (let i = 0; i < lines.length; i++) {
    const [inVal, skipIn] = readLabeled(i, IN);
    if (inVal !== null) {
      pendingInput = [inVal];
      i += skipIn;
      // 输入会续在后面几行，两种形态：
      //   多参数题：`nums = [...]` 换行 `target = 9`
      //   设计题：  `["LRUCache","put",...]` 换行 `[[2],[1,1],...]`（裸数组，没有变量名）
      while (/^([A-Za-z_$][\w$]*\s*=|\[)/.test((lines[i + 1] ?? '').trim())) {
        pendingInput.push(lines[++i].trim());
      }
      continue;
    }
    const [outVal, skipOut] = readLabeled(i, OUT);
    if (outVal !== null) {
      out.push({ input: pendingInput.join('\n'), output: outVal });
      pendingInput = [];
      i += skipOut;
    }
  }
  return out;
}

/** HTML -> 纯文本，保留换行结构 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, '\n![图]($1)\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|pre|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<sup>(.*?)<\/sup>/gi, '^$1')
    .replace(/<sub>(.*?)<\/sub>/gi, '_$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
