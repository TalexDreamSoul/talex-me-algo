#!/usr/bin/env bun
/**
 * algo — 个人算法刷题工作台
 */

import { c } from './lib/term.js';

const COMMANDS = {
  new: { file: './commands/new.js', fn: 'cmdNew', help: '抓一道题，生成目录/题面/骨架/用例，并在 Cursor 里打开' },
  test: { file: './commands/test.js', fn: 'cmdTest', help: '本地判题（--acm 走真实 stdin/stdout）' },
  submit: { file: './commands/submit.js', fn: 'cmdSubmit', help: '记为完成：快照代码 + 排下次复习' },
  list: { file: './commands/list.js', fn: 'cmdList', help: '列出路线题目及状态' },
  today: { file: './commands/list.js', fn: 'cmdToday', help: '今天该做什么：到期复习 + 下一批新题' },
  review: { file: './commands/review.js', fn: 'cmdReview', help: '复习：秒答 / 重写 / 变式' },
  stats: { file: './commands/stats.js', fn: 'cmdStats', help: '聚合分析：进度、模板覆盖、易错模式' },
  open: { file: './commands/open.js', fn: 'cmdOpen', help: '打开某题（--doc 在浏览器看题面）' },
  web: { file: './commands/web.js', fn: 'cmdWeb', help: '起本地看板（可写：改笔记、标状态、排复习）' },
  sync: { file: './commands/sync.js', fn: 'cmdSync', help: '把磁盘上的 meta.json 重新灌进 sqlite' },
  'git-setup': { file: './commands/git.js', fn: 'cmdGitSetup', help: '建 GitHub private 仓库并接上自动提交' },
  push: { file: './commands/git.js', fn: 'cmdPush', help: '补推积压的本地 commit' },
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.startsWith('no-') && !argv[i + 1]?.match(/^[^-]/)) {
        out[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage() {
  console.log('');
  console.log(c.bold('  algo') + c.gray(' — 算法刷题工作台'));
  console.log('');
  for (const [name, spec] of Object.entries(COMMANDS)) {
    console.log(`    ${c.cyan(name.padEnd(8))} ${spec.help}`);
  }
  console.log('');
  console.log(c.gray('    常用流程：algo today → algo new <题号> → 写码 → algo test → algo submit'));
  console.log('');
}

const [, , cmdName, ...rest] = process.argv;

if (!cmdName || cmdName === '-h' || cmdName === '--help' || cmdName === 'help') {
  usage();
  process.exit(0);
}

const spec = COMMANDS[cmdName];
if (!spec) {
  console.error(c.red(`未知命令 ${cmdName}`));
  usage();
  process.exit(1);
}

try {
  const mod = await import(spec.file);
  await mod[spec.fn](parseArgs(rest));
} catch (err) {
  console.error('');
  console.error(`  ${c.red('出错')} ${err.message}`);
  if (process.env.ALGO_DEBUG) console.error(err.stack);
  console.error('');
  process.exit(1);
}
