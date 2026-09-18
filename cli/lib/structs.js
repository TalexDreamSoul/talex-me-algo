/**
 * 力扣内置数据结构的本地实现。
 * solution.js 不需要 import 这些类——runner 会把参数按题目 metaData 解码成真实节点对象后传进去。
 * 只有当你想在 solution.js 里 `new ListNode(...)` 时才需要 import。
 */

export class ListNode {
  /** @param {number} [val] @param {ListNode|null} [next] */
  constructor(val, next) {
    this.val = val === undefined ? 0 : val;
    this.next = next === undefined ? null : next;
  }
}

export class TreeNode {
  /** @param {number} [val] @param {TreeNode|null} [left] @param {TreeNode|null} [right] */
  constructor(val, left, right) {
    this.val = val === undefined ? 0 : val;
    this.left = left === undefined ? null : left;
    this.right = right === undefined ? null : right;
  }
}

/** 多叉树节点（力扣里叫 Node） */
export class NaryNode {
  /** @param {number} [val] @param {NaryNode[]} [children] */
  constructor(val, children) {
    this.val = val === undefined ? 0 : val;
    this.children = children === undefined ? [] : children;
  }
}

/** 图节点（力扣 clone-graph 里叫 Node） */
export class GraphNode {
  /** @param {number} [val] @param {GraphNode[]} [neighbors] */
  constructor(val, neighbors) {
    this.val = val === undefined ? 0 : val;
    this.neighbors = neighbors === undefined ? [] : neighbors;
  }
}

/* ---------------- 链表 ---------------- */

/** @param {number[]} arr @returns {ListNode|null} */
export function buildList(arr) {
  if (!Array.isArray(arr)) return null;
  let head = null;
  for (let i = arr.length - 1; i >= 0; i--) head = new ListNode(arr[i], head);
  return head;
}

/** @param {ListNode|null} head @returns {number[]} */
export function listToArray(head) {
  const out = [];
  let guard = 0;
  for (let p = head; p; p = p.next) {
    out.push(p.val);
    if (++guard > 1e6) throw new Error('链表疑似成环，无法序列化（超过 1e6 个节点）');
  }
  return out;
}

/* ---------------- 二叉树 ---------------- */

/**
 * 力扣的层序数组表示 -> 二叉树。
 * @param {(number|null)[]} arr
 * @returns {TreeNode|null}
 */
export function buildTree(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr[0] === null) return null;
  const root = new TreeNode(arr[0]);
  const queue = [root];
  let i = 1;
  while (queue.length && i < arr.length) {
    const node = queue.shift();
    if (i < arr.length) {
      const v = arr[i++];
      if (v !== null && v !== undefined) {
        node.left = new TreeNode(v);
        queue.push(node.left);
      }
    }
    if (i < arr.length) {
      const v = arr[i++];
      if (v !== null && v !== undefined) {
        node.right = new TreeNode(v);
        queue.push(node.right);
      }
    }
  }
  return root;
}

/**
 * 二叉树 -> 力扣层序数组（裁掉尾部 null）。
 * @param {TreeNode|null} root
 * @returns {(number|null)[]}
 */
export function treeToArray(root) {
  if (!root) return [];
  const out = [];
  const queue = [root];
  while (queue.length) {
    const node = queue.shift();
    if (node === null) {
      out.push(null);
      continue;
    }
    out.push(node.val);
    queue.push(node.left ?? null, node.right ?? null);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/* ---------------- 多叉树 ---------------- */

/**
 * 力扣多叉树表示：[1,null,3,2,4,null,5,6]，null 作为「该层子节点结束」分隔符。
 * @param {(number|null)[]} arr
 * @returns {NaryNode|null}
 */
export function buildNaryTree(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr[0] === null) return null;
  const root = new NaryNode(arr[0]);
  const queue = [root];
  let i = 1;
  if (arr[i] === null) i++; // 跳过根后面的分隔符
  while (queue.length && i < arr.length) {
    const parent = queue.shift();
    while (i < arr.length && arr[i] !== null) {
      const child = new NaryNode(arr[i++]);
      parent.children.push(child);
      queue.push(child);
    }
    i++; // 跳过分隔符
  }
  return root;
}

/** @param {NaryNode|null} root @returns {(number|null)[]} */
export function naryTreeToArray(root) {
  if (!root) return [];
  const out = [root.val, null];
  const queue = [root];
  while (queue.length) {
    const node = queue.shift();
    for (const child of node.children) {
      out.push(child.val);
      queue.push(child);
    }
    if (node.children.length) out.push(null);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/* ---------------- 图 ---------------- */

/**
 * 邻接表（1-indexed）-> 图节点，返回 1 号节点。
 * @param {number[][]} adj
 * @returns {GraphNode|null}
 */
export function buildGraph(adj) {
  if (!Array.isArray(adj) || adj.length === 0) return null;
  const nodes = adj.map((_, i) => new GraphNode(i + 1));
  adj.forEach((neighbors, i) => {
    for (const n of neighbors) nodes[i].neighbors.push(nodes[n - 1]);
  });
  return nodes[0];
}

/** @param {GraphNode|null} node @returns {number[][]} */
export function graphToAdj(node) {
  if (!node) return [];
  const seen = new Map();
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur.val)) continue;
    seen.set(cur.val, cur);
    for (const n of cur.neighbors) if (!seen.has(n.val)) stack.push(n);
  }
  const maxVal = Math.max(...seen.keys());
  const out = [];
  for (let v = 1; v <= maxVal; v++) {
    const cur = seen.get(v);
    out.push(cur ? cur.neighbors.map((n) => n.val) : []);
  }
  return out;
}
