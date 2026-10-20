import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import test from 'node:test';
const local = createRequire(import.meta.resolve('@tryoutflow/next-lint-compat'));
const braces = local('./utils/directory-walker/bounded-braces');
const guardMessage = /Next lint brace pattern exceeds safe AST depth or size/;
const results = [];
const check = (name, fn) =>
  test(name, () => {
    fn();
    results.push(name);
  });

for (const method of ['expand', 'compile', 'stringify']) {
  for (const [name, pattern] of [
    ['nested braces', '{'.repeat(3000) + 'a,b' + '}'.repeat(3000)],
    ['nested parentheses', '('.repeat(3000) + 'a' + ')'.repeat(3000)],
    ['unclosed nested braces', '{'.repeat(3000) + 'a,b'],
    ['mixed nesting', '{('.repeat(1500) + 'a,b' + ')}'.repeat(1500)],
  ])
    check(`${method}: ${name} fails before recursion`, () =>
      assert.throws(() => braces[method](pattern), guardMessage),
    );

  check(`${method}: deeply nested direct AST`, () => {
    let ast = { type: 'text', value: 'x' };
    for (let i = 0; i < 10000; i++) ast = { type: 'root', nodes: [ast] };
    assert.throws(() => braces[method](ast), guardMessage);
  });
  check(`${method}: cyclic child AST`, () => {
    const ast = { type: 'root', nodes: [] };
    ast.nodes.push(ast);
    assert.throws(() => braces[method](ast), guardMessage);
  });
  check(`${method}: cyclic parent AST`, () => {
    const ast = { type: 'paren', nodes: [] };
    ast.parent = ast;
    assert.throws(() => braces[method](ast), guardMessage);
  });
  check(`${method}: non-array iterable child collection`, () => {
    const ast = { type: 'root' };
    ast.nodes = new Set([ast]);
    assert.throws(() => braces[method](ast), guardMessage);
  });
  check(`${method}: wide AST rejected before recursive traversal`, () => {
    const ast = {
      type: 'root',
      nodes: Array.from({ length: 65536 }, () => ({ type: 'text', value: 'x' })),
    };
    assert.throws(() => braces[method](ast), guardMessage);
  });
  check(`${method}: valid parsed parent backlinks accepted`, () => {
    const ast = braces.parse('apps/{alpha,beta}/pages');
    assert.doesNotThrow(() => braces[method](ast));
  });
}

check('in-bound nested braces retain expansion', () => {
  const pattern = '{'.repeat(50) + 'a,b' + '}'.repeat(50);
  assert.doesNotThrow(() => braces.expand(pattern));
});
check('escaped nested braces remain literal rather than counted as AST levels', () => {
  const pattern = '\\{'.repeat(1000) + 'x' + '\\}'.repeat(1000);
  assert.doesNotThrow(() => braces.expand(pattern));
});
check('quoted nested braces remain literal', () => {
  const pattern = '"' + '{'.repeat(1000) + 'x' + '}'.repeat(1000) + '"';
  assert.doesNotThrow(() => braces.expand(pattern));
});
check('original range bound remains explicit; no truncated roots', () => {
  assert.throws(() => braces.expand('{1..1001}'), /range limit/);
  assert.equal(braces.expand('{1..1000}').length, 1000);
});
check('original maximum source length remains enforced', () =>
  assert.throws(() => braces.expand('a'.repeat(10001)), /max characters/),
);
check('depth guard cannot be raised by an option', () =>
  assert.throws(
    () => braces.expand('{'.repeat(1000) + 'a' + '}'.repeat(1000), { maxDepth: Infinity }),
    guardMessage,
  ),
);

for (const depth of [125, 126, 127, 128, 129]) {
  check(`direct parse boundary at ${depth} brace levels`, () => {
    const pattern = '{'.repeat(depth) + 'a,b' + '}'.repeat(depth);
    if (depth <= 126) assert.doesNotThrow(() => braces.parse(pattern));
    else assert.throws(() => braces.parse(pattern), guardMessage);
  });
}
check('direct parser rejects deep parentheses before recursion', () =>
  assert.throws(() => braces.parse('('.repeat(3000) + 'x' + ')'.repeat(3000)), guardMessage),
);
