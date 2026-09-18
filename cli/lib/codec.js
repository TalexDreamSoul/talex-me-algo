/**
 * 力扣 metaData 类型 <-> JS 值的编解码。
 *
 * 力扣的测试用例永远是「每个参数一行 JSON」的纯数据形式，而解法函数要拿到的却可能是
 * ListNode / TreeNode 对象。这一层负责在两者之间翻译，并把返回值翻译回可比较的纯数据。
 */

import {
  buildList,
  listToArray,
  buildTree,
  treeToArray,
  buildNaryTree,
  naryTreeToArray,
  buildGraph,
  graphToAdj,
} from './structs.js';

/** metaData 里出现过的、需要特殊处理的类型名 */
const NODE_TYPES = {
  ListNode: { decode: buildList, encode: listToArray },
  'ListNode[]': {
    decode: (v) => v.map(buildList),
    encode: (v) => v.map(listToArray),
  },
  TreeNode: { decode: buildTree, encode: treeToArray },
  'TreeNode[]': {
    decode: (v) => v.map(buildTree),
    encode: (v) => v.map(treeToArray),
  },
  NaryNode: { decode: buildNaryTree, encode: naryTreeToArray },
  GraphNode: { decode: buildGraph, encode: graphToAdj },
};

/**
 * 解析 metaData，得到 runner 需要的执行计划。
 * @param {object} meta 力扣 metaData（已 JSON.parse）
 * @param {object} [override] meta.json 里的 codec 覆盖，形如 { params: ["TreeNode"], return: "TreeNode" }
 */
export function planFromMeta(meta, override = {}) {
  if (meta.systemdesign) {
    return {
      kind: 'design',
      classname: meta.classname,
      constructorParams: meta.constructor?.params ?? [],
      methods: meta.methods ?? [],
    };
  }
  const paramTypes = (meta.params ?? []).map((p, i) => override.params?.[i] ?? p.type);
  return {
    kind: 'function',
    name: meta.name,
    paramNames: (meta.params ?? []).map((p) => p.name),
    paramTypes,
    returnType: override.return ?? meta.return?.type ?? 'void',
    /** 原地修改题：真正的答案是第 N 个入参改完之后的样子 */
    outputParamIndex: meta.output?.paramindex ?? null,
    /** removeDuplicates 那类：返回值 k 表示只看前 k 个元素 */
    outputSizeFromReturn: meta.output?.size === 'ret',
  };
}

/**
 * 力扣类型名 -> 这个参数是不是需要构造成节点对象。
 * @param {string} type
 */
export function nodeTypeOf(type) {
  if (!type) return null;
  // 力扣对多叉树/图题把 metaData 的 param type 写成 integer，但 manual:true。
  // 这种情况必须靠 meta.json 的 codec.params 显式覆盖，这里只认标准名字。
  return NODE_TYPES[type] ?? null;
}

/**
 * 把一行 JSON 文本解析成 JS 值。力扣的字符串参数带引号，字符参数也带引号。
 * @param {string} line
 */
export function parseArgLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // 少数老题的字符串参数没加引号，例如 `abc`
    return trimmed;
  }
}

/**
 * 把纯数据入参解码成解法函数真正需要的参数。
 *
 * 必须深拷贝：原地修改题（26、27、283…）会直接改写传进来的数组，
 * 不拷贝的话 cases.json 里的 input 会被解法改掉，失败报告打印的
 * 「输入」就是被污染后的样子——看着像判题器发疯，其实是自己改的。
 * 对拍时暴力解和待测解也必须各拿一份，否则互相污染。
 *
 * @param {unknown[]} rawArgs
 * @param {string[]} paramTypes
 */
export function decodeArgs(rawArgs, paramTypes) {
  return rawArgs.map((v, i) => {
    const codec = nodeTypeOf(paramTypes[i]);
    // 链表/树的 decode 本身就在造新对象，无需再拷
    return codec ? codec.decode(v) : structuredClone(v);
  });
}

/**
 * 把解法返回值编码回可与期望值比较的纯数据。
 * @param {unknown} value
 * @param {string} returnType
 */
export function encodeResult(value, returnType) {
  const codec = nodeTypeOf(returnType);
  if (codec) return codec.encode(value);
  return normalizeNumbers(value);
}

/** 把 -0 归一成 0，避免 JSON.stringify 出现 `-0` 造成假失败 */
function normalizeNumbers(v) {
  if (Object.is(v, -0)) return 0;
  if (Array.isArray(v)) return v.map(normalizeNumbers);
  return v;
}

/**
 * 从 exampleTestcases（每行一个参数，按 paramCount 分组）切出用例的入参数组。
 * @param {string} raw
 * @param {number} paramCount
 * @returns {unknown[][]}
 */
export function splitExampleTestcases(raw, paramCount) {
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  if (paramCount <= 0) return [];
  const groups = [];
  for (let i = 0; i + paramCount <= lines.length; i += paramCount) {
    groups.push(lines.slice(i, i + paramCount).map(parseArgLine));
  }
  return groups;
}
