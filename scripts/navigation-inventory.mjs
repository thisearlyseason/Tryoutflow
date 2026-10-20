import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

export function appRoute(file) {
  const normalized = file.replaceAll('\\', '/');
  const relative = normalized.split('src/app/')[1];
  if (!relative || !/(?:^|\/)(?:page|route)\.[cm]?[jt]sx?$/.test(relative)) return null;
  return (
    '/' +
    relative
      .split('/')
      .slice(0, -1)
      .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'))
      .join('/')
  );
}

export function hasRoute(destination, routes) {
  const pathname = destination.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  return routes.some((route) => {
    const pattern = route
      .split('/')
      .map((segment) => {
        if (segment.startsWith('[[...')) return '(?:/.*)?';
        if (segment.startsWith('[...')) return '/.+';
        if (segment.startsWith('[')) return '/[^/]+';
        return '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .slice(1)
      .join('');
    return new RegExp('^' + (pattern || '/') + '$').test(pathname);
  });
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function staticText(node, source) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    return node.quasis
      .map(
        (part, index) =>
          part.value.cooked +
          (node.expressions[index]
            ? `__${source.slice(node.expressions[index].start, node.expressions[index].end).replace(/\W/g, '')}__`
            : ''),
      )
      .join('');
  }
  return null;
}

// This is an inventory check, not an authorization or dynamic-link correctness proof.
export function auditNavigation(root, inventoryFiles) {
  const files =
    inventoryFiles ?? walk(path.join(root, 'src')).map((file) => path.relative(root, file));
  const routes = files.map(appRoute).filter(Boolean);
  const checked = [];
  const unresolved = [];
  const missing = [];
  for (const relative of files.filter(
    (file) => file.startsWith('src/') && /\.[jt]sx?$/.test(file),
  )) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const tree = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
    const baseValues = new Map();
    const collectBases = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'VariableDeclarator' && ['base', 'basePath'].includes(node.id?.name)) {
        const value = staticText(node.init, source);
        if (value?.startsWith('/')) {
          const values = baseValues.get(node.id.name) ?? new Set();
          values.add(value);
          baseValues.set(node.id.name, values);
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(collectBases);
        else if (child && typeof child === 'object') collectBases(child);
      }
    };
    collectBases(tree);
    const inspect = (node) => {
      if (!node || typeof node !== 'object') return;
      let expression;
      if (node.type === 'JSXAttribute' && node.name.name === 'href')
        expression =
          node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
      if (node.type === 'ObjectProperty' && (node.key.name === 'href' || node.key.value === 'href'))
        expression = node.value;
      if (expression) {
        const value = staticText(expression, source);
        const location = { file: relative, line: node.loc.start.line };
        if (value === null || (value.startsWith('__') && !/^__base(?:Path)?__/.test(value)))
          unresolved.push({
            ...location,
            expression: source.slice(expression.start, expression.end),
          });
        else if (value.startsWith('/') || /^__base(?:Path)?__/.test(value)) {
          let destination = value.replace(/__(?:query|queryString)__$/, '');
          const base = destination.match(/^__(base(?:Path)?)__/);
          const candidates = base && baseValues.get(base[1]);
          if (base && candidates?.size === 1)
            destination = destination.replace(base[0], [...candidates][0]);
          else if (base) {
            unresolved.push({
              ...location,
              expression: source.slice(expression.start, expression.end),
              reason: 'Shared base has no unique static declaration in this file',
            });
            return;
          }
          const tail = destination.split(/[?#]/)[0].split('/').at(-1);
          if (
            /^__(?:segment|path|links|milestonePaths)/.test(tail ?? '') ||
            /\.(?:webp|png|jpg|jpeg|svg)$/.test(destination)
          ) {
            unresolved.push({
              ...location,
              expression: source.slice(expression.start, expression.end),
              reason: 'Computed final segment or asset destination requires separate coverage',
            });
          } else {
            const record = { ...location, destination };
            checked.push(record);
            if (!hasRoute(destination, routes)) missing.push(record);
          }
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(inspect);
        else if (child && typeof child === 'object') inspect(child);
      }
    };
    inspect(tree);
  }
  // EventNavigation constructs these hrefs from role-filtered tuples.
  const eventLayout = files.find((file) => file.endsWith('tryouts/[tryoutId]/layout.tsx'));
  if (eventLayout) {
    const source =
      fs
        .readFileSync(path.join(root, eventLayout), 'utf8')
        .split('const links =')[1]
        ?.split('return (')[0] ?? '';
    for (const match of source.matchAll(/\[\s*['"]([a-z/-]+)['"]\s*,\s*['"][^'"]+['"]\s*\]/g)) {
      const record = {
        file: eventLayout,
        destination: `/app/__organization__/tryouts/__tryout__/${match[1]}`,
        generatedTuple: true,
      };
      checked.push(record);
      if (!hasRoute(record.destination, routes)) missing.push(record);
    }
  }
  return {
    routeCount: routes.length,
    routes: [...new Set(routes)].sort(),
    checked,
    missing,
    unresolved,
    limit:
      'Computed hrefs, identifiers and runtime-selected values require targeted tests/browser verification; unresolved entries are explicitly retained.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? '.');
  const inventory = process.argv[3]
    ? Object.keys(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).files)
    : undefined;
  const result = auditNavigation(root, inventory);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.missing.length ? 1 : 0;
}
