import { listProblems } from '../lib/paths.js';
import { upsertProblem } from '../lib/db.js';
import { c } from '../lib/term.js';

/**
 * algo sync — 磁盘 meta.json 是真源，重新灌进 sqlite。
 * 用于：手改了 meta.json、从别的机器拉了 git、db 文件丢了。
 */
export function cmdSync() {
  const all = listProblems();
  for (const m of all) upsertProblem(m);
  console.log('');
  console.log(`  ${c.green('已同步')} ${all.length} 道题进 data/algo.db`);
  console.log('');
}
