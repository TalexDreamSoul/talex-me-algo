/** ACM 模式的 stdin 读取，node 与 bun 都能跑 */
export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c) : c))).toString('utf8');
}
