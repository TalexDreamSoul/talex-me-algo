import { spawn } from 'node:child_process';
import { ROOT } from './paths.js';
import { c } from './term.js';

/**
 * 在 Cursor 里打开文件并把光标定位到指定行。
 * 复用已有窗口（-r），第一次会顺便把工作区根目录加进去。
 * @param {string} file
 * @param {number} [line]
 */
export function openInCursor(file, line = 1) {
  const bin = process.env.ALGO_EDITOR ?? 'cursor';
  try {
    spawn(bin, ['-r', ROOT, '-g', `${file}:${line}:5`], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch (err) {
    console.log(c.yellow(`  打不开编辑器（${err.message}），手动开：${file}:${line}`));
  }
}

/** 用系统默认浏览器打开 URL */
export function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* 打不开就算了，URL 已经打印出来了 */
  }
}
