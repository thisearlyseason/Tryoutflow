'use strict';

// Private fix for GHSA-vfj7-8cjw-p6xm. Never accept an option that raises this
// bound: all recursive walkers are reached only after this iterative check.
const MAX_DEPTH = 128;
const MAX_NODES = 65536;
const fail = () => { throw new RangeError('Next lint brace pattern exceeds safe AST depth or size'); };
exports.assertStackCapacity = stack => { if (stack.length >= MAX_DEPTH) fail(); };
exports.assertTreeDepth = ast => {
  const pending = [[ast, 1]];
  const seen = new WeakSet();
  let scheduled = 1;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > MAX_DEPTH || seen.has(node)) fail();
    seen.add(node);
    // expand follows parent links separately from the child-tree walk. Valid
    // parsed backlinks terminate at the root; malformed AST parent cycles must
    // fail before either of expand's parent loops starts.
    const parents = new WeakSet();
    let parent = node;
    let parentDepth = 0;
    while (parent && typeof parent === 'object') {
      if (++parentDepth > MAX_DEPTH || parents.has(parent)) fail();
      parents.add(parent);
      parent = parent.parent;
    }
    if (node.nodes !== undefined && !Array.isArray(node.nodes)) fail();
    if (Array.isArray(node.nodes)) for (const child of node.nodes) {
      if (++scheduled > MAX_NODES) fail();
      pending.push([child, depth + 1]);
    }
  }
};
