/**
 * 刷题记录的 git 自动归档。
 *
 * 为什么要：attempts/ 的代码快照是唯一一份「你当时怎么写的」的证据，
 * 只存在本地磁盘上等于没有备份。一道题一个 commit，提交历史顺带就是刷题流水账。
 *
 * 只提交题目和代码，data/algo.db 由 .gitignore 挡掉——
 * 状态、掌握度、复习日期都在各题的 meta.json 里，algo sync 能从磁盘重建整个 db。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

/**
 * 跑一条 git 命令。失败不抛异常，返回结构化结果——
 * 归档失败绝不能把已经成功的 submit 整个搞砸。
 * @param {string[]} args
 * @param {number} [timeoutMs]
 */
async function git(args, timeoutMs = 20000) {
  const proc = Bun.spawn(['git', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** 仓库是否已初始化且有至少一个 commit */
export async function repoState() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return { inited: false, hasCommit: false, remote: null };
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  const remote = await git(['remote', 'get-url', 'origin']);
  return {
    inited: true,
    hasCommit: head.ok,
    remote: remote.ok ? remote.stdout : null,
  };
}

/**
 * 归档一道题：只 add 这道题的目录，避免把你正在改的别的文件裹进来。
 * @param {object} meta 题目 meta
 * @param {{rating: number, mode: string, snapshot: string}} info
 * @returns {Promise<{ok: boolean, step: string, message?: string, sha?: string, pushed?: boolean}>}
 */
export async function archiveProblem(meta, info) {
  const state = await repoState();
  if (!state.inited) return { ok: false, step: 'init', message: '还没 git init，跑 algo git-setup' };

  const rel = path.relative(ROOT, meta.dir);
  // 开源后的工具仓库一般把 problems/ 排除在版本控制外（那是个人数据）；
  // 被 ignore 就直接跳过归档，别拿一条 add 失败去烦人
  const ignored = await git(['check-ignore', '--quiet', '--', rel]);
  if (ignored.ok) {
    return {
      ok: true,
      step: 'ignored',
      message: '题目目录被 .gitignore 排除（个人数据不进工具仓库），跳过归档',
    };
  }
  const add = await git(['add', '--', rel]);
  if (!add.ok) return { ok: false, step: 'add', message: add.stderr };

  // 没有变更就不空转出一个 commit
  const staged = await git(['diff', '--cached', '--quiet', '--', rel]);
  if (staged.ok) return { ok: true, step: 'skip', message: '这道题没有变化，没生成 commit' };

  const MODE_CN = { first: '首次', rewrite: '重写', variant: '变式' };
  const subject = `${meta.id}. ${meta.title} · ${MODE_CN[info.mode] ?? info.mode} · 自评 ${info.rating}/5`;
  const body = [
    `难度 ${meta.difficulty}`,
    `分类 ${meta.topic}`,
    `标签 ${meta.tags.map((t) => t.name).join(' / ')}`,
    `快照 ${info.snapshot}`,
    meta.url,
  ].join('\n');

  const commit = await git(['commit', '-m', subject, '-m', body]);
  if (!commit.ok) return { ok: false, step: 'commit', message: commit.stderr };

  const sha = (await git(['rev-parse', '--short', 'HEAD'])).stdout;
  if (!state.remote) {
    return { ok: true, step: 'commit', sha, pushed: false, message: '没配 origin，只提交到本地' };
  }

  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout || 'master';
  const push = await git(['push', '-u', 'origin', branch], 60000);
  if (!push.ok) {
    return { ok: true, step: 'push-failed', sha, pushed: false, message: push.stderr.split('\n')[0] };
  }
  return { ok: true, step: 'push', sha, pushed: true };
}

/**
 * 初始化仓库并在 GitHub 上建 private 仓库。
 * @param {{name?: string, private?: boolean}} [opts]
 */
export async function setupRepo(opts = {}) {
  const steps = [];
  const state = await repoState();

  if (!state.inited) {
    const r = await git(['init', '-b', 'main']);
    if (!r.ok) return { ok: false, steps, message: `git init 失败：${r.stderr}` };
    steps.push('git init');
  }

  // 首次提交把现有题目一次性收进去
  const add = await git(['add', '-A']);
  if (!add.ok) return { ok: false, steps, message: add.stderr };
  const dirty = await git(['diff', '--cached', '--quiet']);
  if (!dirty.ok) {
    const r = await git(['commit', '-m', 'chore: 算法刷题工作台']);
    if (!r.ok) return { ok: false, steps, message: `首次提交失败：${r.stderr}` };
    steps.push('首次提交');
  }

  if (state.remote) {
    steps.push(`origin 已存在：${state.remote}`);
    return { ok: true, steps, remote: state.remote };
  }

  const name = opts.name ?? path.basename(ROOT);
  const visibility = opts.private === false ? '--public' : '--private';
  const proc = Bun.spawn(['gh', 'repo', 'create', name, visibility, '--source', '.', '--push'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    return { ok: false, steps, message: `gh repo create 失败：${(err || out).trim()}` };
  }
  steps.push(`已建 ${visibility.slice(2)} 仓库并推送`);
  const remote = (await git(['remote', 'get-url', 'origin'])).stdout;
  return { ok: true, steps, remote };
}

/** 手动推送积压的本地 commit */
export async function pushPending() {
  const state = await repoState();
  if (!state.remote) return { ok: false, message: '没配 origin，先跑 algo git-setup' };
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout || 'main';
  const ahead = await git(['rev-list', '--count', `origin/${branch}..HEAD`]);
  const push = await git(['push', 'origin', branch], 60000);
  if (!push.ok) return { ok: false, message: push.stderr.split('\n')[0] };
  return { ok: true, count: Number(ahead.stdout || 0), branch };
}
