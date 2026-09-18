import { setupRepo, pushPending, repoState } from '../lib/git.js';
import { c } from '../lib/term.js';

/**
 * algo git-setup [--name 仓库名] [--public]
 *
 * 初始化本地仓库 + 在 GitHub 建仓 + 首次推送。依赖已登录的 gh。
 */
export async function cmdGitSetup(args) {
  const before = await repoState();
  console.log('');
  if (before.remote) {
    console.log(c.gray(`  origin 已配好：${before.remote}`));
  }

  const res = await setupRepo({ name: args.name, private: !args.public });
  for (const s of res.steps) console.log(`  ${c.green('✓')} ${s}`);

  if (!res.ok) {
    console.log(c.red(`  ${res.message}`));
    console.log('');
    return;
  }
  console.log('');
  console.log(`  ${c.bold('仓库')} ${c.cyan(res.remote ?? '(仅本地)')}`);
  console.log(c.gray('  之后每次 algo submit 会自动 commit + push。'));
  console.log('');
}

/**
 * algo push —— 手动推送积压的本地 commit（submit 时推送失败的补救）
 */
export async function cmdPush() {
  const res = await pushPending();
  console.log('');
  if (!res.ok) {
    console.log(c.red(`  推送失败：${res.message}`));
    console.log('');
    return;
  }
  console.log(`  ${c.green('已推送')} ${res.count ? `${res.count} 个 commit` : '(已是最新)'} → ${res.branch}`);
  console.log('');
}
