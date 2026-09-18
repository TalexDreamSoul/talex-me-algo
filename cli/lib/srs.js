/**
 * 间隔复习排期（SM-2 变体）。
 *
 * 与背单词的差别：算法题的「记住」没有意义，要的是「能重新推出来」。
 * 所以复习分三档，每档对间隔的影响不同：
 *   recall  秒答——只问模板名/复杂度，30 秒，间隔小幅拉长
 *   rewrite 重写——清空代码限时重写，间隔正常拉长
 *   variant 变式——改约束后重做，间隔大幅拉长（真掌握了才做得动）
 */

import { getReview, upsertReview } from './db.js';

/** @typedef {'recall'|'rewrite'|'variant'} ReviewMode */

/** 复习模式对间隔的乘数 */
const MODE_FACTOR = { recall: 0.8, rewrite: 1.0, variant: 1.4 };

/** 首次完成后的初始间隔（天），按难度区分 */
const FIRST_INTERVAL = { Easy: 3, Medium: 2, Hard: 1 };

/**
 * 记录一次完成，算出下次复习日期。
 * @param {{problemId: string, difficulty: string, mode: ReviewMode, quality: number}} input
 *   quality: 0-5 自评。<3 视为没掌握，间隔重置。
 * @returns {{dueOn: string, intervalDay: number, ease: number, reps: number, lapses: number}}
 */
export function schedule({ problemId, difficulty, mode, quality }) {
  const prev = getReview(problemId);
  const q = clamp(quality, 0, 5);

  let ease = prev?.ease ?? 2.5;
  let reps = prev?.reps ?? 0;
  let lapses = prev?.lapses ?? 0;
  let interval;

  if (q < 3) {
    // 没掌握：打回重来，间隔归 1 天，ease 下调
    lapses += 1;
    reps = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    ease = clamp(ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3, 2.8);
    reps += 1;
    if (reps === 1) {
      interval = FIRST_INTERVAL[difficulty] ?? 2;
    } else if (reps === 2) {
      interval = Math.round((FIRST_INTERVAL[difficulty] ?? 2) * 2.5);
    } else {
      interval = Math.round((prev?.interval_day ?? 2) * ease);
    }
    interval = Math.round(interval * (MODE_FACTOR[mode] ?? 1));
  }
  interval = clamp(interval, 1, 180);

  const dueOn = addDays(new Date(), interval).toISOString().slice(0, 10);
  const row = {
    problemId,
    dueOn,
    intervalDay: interval,
    ease,
    reps,
    lapses,
    lastMode: mode,
    lastDone: new Date().toISOString().slice(0, 10),
  };
  upsertReview(row);
  return row;
}

/**
 * 根据掌握程度决定下次该用哪种复习模式。
 * 刚做完 -> recall；回想没问题 -> rewrite；重写顺畅 -> variant。
 * @param {{reps?: number, lapses?: number, last_mode?: string}|null} review
 * @returns {ReviewMode}
 */
export function nextMode(review) {
  if (!review || review.reps === 0) return 'recall';
  if (review.lapses > 0 && review.last_mode !== 'rewrite') return 'rewrite';
  const order = ['recall', 'rewrite', 'variant'];
  const i = order.indexOf(review.last_mode ?? 'recall');
  return order[Math.min(i + 1, order.length - 1)];
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
