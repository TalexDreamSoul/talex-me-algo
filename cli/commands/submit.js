import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mustResolve } from './test.js';
import { cmdTest } from './test.js';
import {
  recordAttempt,
  upsertProblem,
  countRunsSinceLastAttempt,
  getReview,
  lastAttempt,
} from '../lib/db.js';
import { schedule } from '../lib/srs.js';
import { c, promptRating } from '../lib/term.js';
import { archiveProblem } from '../lib/git.js';

/**
 * algo submit [题号] [--rating 4] [--minutes 25] [--mode first|rewrite|variant]
 *             [--level 3] [--skip-test]
 *
 * 语义：「我在力扣上过了」——这是正式提交。
 * 和自测的区别：默认走满级（L3）把关，而不是只跑官方样例。
 * 官方样例过了不代表解法对，边界和随机对拍才是真门槛。
 */
export async function cmdSubmit(args) {
  const meta = mustResolve(args._[0]);

  if (!args['skip-test']) {
    const level = Number(args.level ?? 3);
    console.log(c.gray(`\n  正式提交前先跑 L${level} 全量自测…`));
    const verdict = await cmdTest({ _: [meta.id], yes: true, level });
    if (!verdict.ok) {
      console.log(c.red('  全量自测没过。确定要记为完成就加 --skip-test。'));
      return;
    }
    // ok 只说明「没有判错的」。未判定的用例一条都没判过对错，放行等于把 L3
    // 降级成 L1——那分级自测就白做了。两种情况都要拦：整阶段缺 oracle（oracle 为
    // null），以及生成用例里出现 ok:null（oracle 是骨架，或者 brute 自己崩了）。
    const unjudgedGenerated = verdict.unjudgedGenerated;
    if (verdict.missingOracle.length || unjudgedGenerated > 0) {
      console.log('');
      console.log(
        c.red(
          unjudgedGenerated
            ? `  ${unjudgedGenerated} 条生成用例未判定对错，不能算正式通过。`
            : '  边界/随机用例一条都没判过对错，不能算正式通过。',
        ),
      );
      if (verdict.missingOracle.length) {
        console.log(c.gray(`  缺 oracle 的阶段：${verdict.missingOracle.join('、')}`));
      }
      console.log('');
      console.log(`  写 ${c.bold('tests/brute.js')} 的暴力参考解，L2/L3 才有判定依据。`);
      const note = verdict.stages?.find((s) => s.oracleNote)?.oracleNote;
      console.log(
        c.gray(note ? `  ${note}——删掉那行 throw，写出实现` : `  没有骨架先补：algo oracle ${meta.id}`),
      );
      console.log(c.gray('  答案不唯一的题改写 tests/invariant.js 断言性质。'));
      console.log(c.gray('  就是要跳过：algo submit --skip-test。'));
      console.log('');
      return;
    }
  }

  const solutionPath = path.join(meta.dir, 'solution.js');
  const code = fs.readFileSync(solutionPath, 'utf8');
  const sha = crypto.createHash('sha256').update(code).digest('hex').slice(0, 12);

  const notes = readNotes(meta.dir);
  // 自评优先级：命令行 --rating > notes.md 的 confidence > 问你。
  // notes.md 里已经写了 confidence 就别再问一遍——顺带逼着你先写笔记。
  const presetRating = args.rating ?? (notes.confidence > 0 ? notes.confidence : undefined);
  const rating = await promptRating(
    `  ${c.bold('自评掌握度')} ${c.gray('0=瞎蒙 5=秒杀')} [0-5] `,
    presetRating,
  );
  if (presetRating !== undefined && args.rating === undefined) {
    console.log(c.gray(`  自评 ${rating}/5（取自 notes.md 的 confidence）`));
  }
  const minutes = args.minutes ? Number(args.minutes) : null;

  // 代码一个字没变的重复提交不是一次新的完成。放行的话，误操作重跑一次
  // submit 就能把复习间隔往后推一档，这题会直接从复习队列里消失。
  const prev = lastAttempt(meta.id);
  const duplicate = prev?.code_sha === sha;
  if (duplicate && !args.force) {
    console.log('');
    console.log(c.yellow(`  这份代码和上次提交完全一样（${sha}），不记为新的一次完成。`));
    console.log(c.gray(`  上次 ${prev.submitted_at.slice(0, 16).replace('T', ' ')} · ${prev.mode} · 自评 ${prev.self_rating}/5`));
    console.log(c.gray('  复习请走 algo review；真要重复记一次加 --force。'));
    console.log('');
    return;
  }

  const mode = args.mode ?? (prev ? 'rewrite' : 'first');

  // 代码快照：每次完成留一份，复习时可以 diff 看自己写法的演化
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapDir = path.join(meta.dir, 'attempts');
  fs.mkdirSync(snapDir, { recursive: true });
  const snapPath = path.join(snapDir, `${stamp}_${mode}_r${rating}_${sha}.js`);
  fs.writeFileSync(snapPath, code);

  const localRuns = countRunsSinceLastAttempt(meta.id);

  recordAttempt({
    problemId: meta.id,
    mode,
    durationMin: minutes,
    selfRating: rating,
    approach: notes.pattern || null,
    complexity: notes.complexity || null,
    pitfalls: notes.pitfalls?.length ? JSON.stringify(notes.pitfalls) : null,
    codeSha: sha,
    codePath: path.relative(meta.dir, snapPath),
    localRuns,
  });

  const srs = schedule({
    problemId: meta.id,
    difficulty: meta.difficulty,
    mode: mode === 'first' ? 'rewrite' : mode,
    quality: rating,
  });

  // mastered 不能只凭一次自评。第一次做完就说「掌握了」是没有依据的——
  // 真正的证据是隔几天回来还能重新写出来，所以要求至少经历 2 轮。
  meta.status =
    rating >= 4 && srs.reps >= 2 ? 'mastered' : rating >= 3 ? 'solved' : 'shaky';
  meta.mastery = rating;
  meta.lastDoneAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(meta.dir, 'meta.json'), JSON.stringify(stripDir(meta), null, 2) + '\n');
  upsertProblem(meta);

  console.log('');
  console.log(`  ${c.green('已记录')} ${meta.id}. ${meta.title}  自评 ${rating}/5`);
  console.log(c.gray(`  代码快照 attempts/${path.basename(snapPath)}`));
  if (localRuns === 0) {
    console.log(
      c.yellow(`  这题本地一遍都没跑过就记成完成了——力扣过了不代表你的边界情况都想清楚了。`),
    );
  } else {
    console.log(c.gray(`  这次提交前本地跑了 ${localRuns} 遍`));
  }
  if (rating >= 4 && srs.reps < 2) {
    console.log(
      c.gray(`  自评 ${rating} 但只做过 ${srs.reps} 轮，先记 solved；复习一轮还能写出来才算 mastered。`),
    );
  }
  if (!notes.pattern) {
    console.log(
      c.yellow(`  notes.md 的 pattern 还空着——不写清用了哪个模板，复习时没法聚合。`),
    );
  }
  console.log('');
  console.log(
    `  ${c.bold('下次复习')} ${c.cyan(srs.dueOn)} ${c.gray(`(${srs.intervalDay} 天后，第 ${srs.reps} 轮)`)}`,
  );
  if (rating < 3) {
    console.log(c.red('  自评 <3，间隔已重置为 1 天。明天再来一遍。'));
  }
  console.log('');

  // 归档到 git：attempts/ 的快照只躺在本地磁盘等于没备份
  if (!args['no-git']) {
    const res = await archiveProblem(meta, {
      rating,
      mode,
      snapshot: path.relative(meta.dir, snapPath),
    });
    if (!res.ok) {
      console.log(c.yellow(`  git 归档失败（${res.step}）：${res.message}`));
      console.log(c.gray('  提交记录已经落盘了，跑 algo git-setup 配好仓库后 algo push 补推。'));
    } else if (res.step === 'skip') {
      console.log(c.gray(`  git ${res.message}`));
    } else if (res.pushed) {
      console.log(c.gray(`  已提交并推送 ${res.sha}`));
    } else {
      console.log(c.yellow(`  已提交 ${res.sha}，但没推送：${res.message}`));
    }
    console.log('');
  }
}

function stripDir(meta) {
  const { dir, ...rest } = meta;
  return rest;
}

/** 解析 notes.md 的 frontmatter */
export function readNotes(dir) {
  const p = path.join(dir, 'notes.md');
  if (!fs.existsSync(p)) return {};
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { body: text };
  const out = { body: text.slice(m[0].length).trim() };
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, rawV] = kv;
    // 模板注释 `pattern: ""   # 说明文字` 里的 # 之后全部丢掉，
    // 否则空值会被当成一个真实的 pattern 参与聚合统计。
    let v = rawV.replace(/\s+#.*$/, '').trim();
    if (v.startsWith('[') || v.startsWith('{')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* 保持字符串 */
      }
    } else if (v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1);
    } else if (/^\d+$/.test(v)) {
      v = Number(v);
    }
    out[k] = v;
  }
  return out;
}
