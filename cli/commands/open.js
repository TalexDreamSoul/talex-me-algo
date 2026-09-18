import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProblem } from '../lib/paths.js';
import { openInCursor, openBrowser } from '../lib/editor.js';
import { c } from '../lib/term.js';

/**
 * algo open <题号> [--doc] [--readme] [--notes] [--leetcode]
 */
export function cmdOpen(args) {
  const key = args._[0];
  if (!key) throw new Error('用法：algo open <题号|slug>');
  const meta = resolveProblem(key);
  if (!meta) throw new Error(`找不到题目 ${key}。先跑 algo new ${key}。`);

  if (args.leetcode) {
    console.log(c.gray(`  ${meta.url}`));
    openBrowser(meta.url);
    return;
  }
  // 题面 HTML 交给浏览器，不是编辑器——图和排版才有意义
  if (args.doc) {
    const html = path.join(meta.dir, 'problem.html');
    console.log(c.gray(`  ${path.relative(process.cwd(), html)}`));
    openBrowser(pathToFileURL(html).href);
    return;
  }
  const file = args.readme ? 'README.md' : args.notes ? 'notes.md' : 'solution.js';
  const target = path.join(meta.dir, file);
  console.log(c.gray(`  ${path.relative(process.cwd(), target)}`));
  openInCursor(target, 1);
}
