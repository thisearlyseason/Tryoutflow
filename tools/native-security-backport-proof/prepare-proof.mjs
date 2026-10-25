import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function treeHash(root) {
  const files = [];
  function visit(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === 'SOURCE-PROVENANCE.json') continue;
      const info = lstatSync(join(root, path));
      if (info.isSymbolicLink()) throw new Error('Unexpected source symlink');
      if (info.isDirectory()) visit(path);
      else if (info.isFile())
        files.push({
          path,
          sha256: createHash('sha256')
            .update(readFileSync(join(root, path)))
            .digest('hex'),
        });
      else throw new Error('Unexpected source object');
    }
  }
  visit();
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

export function patchForge(text) {
  const anchor = 'obj.value.length !== 2) {';
  if (text.split(anchor).length !== 2) throw new Error('Unexpected Forge source');
  return text.replace(
    anchor,
    `obj.value.length !== 2 ||
            !Array.isArray(obj.value[0].value) ||
            obj.value[0].value.length < 1 || obj.value[0].value.length > 2 ||
            (obj.value[0].value.length === 2 &&
              (obj.value[0].value[1].tagClass !== asn1.Class.UNIVERSAL ||
               obj.value[0].value[1].type !== asn1.Type.NULL ||
               obj.value[0].value[1].constructed ||
               obj.value[0].value[1].value !== ''))) {`,
  );
}

export function patchZod(text, invalid) {
  for (const [field, statement] of [
    ['exactLength', `status.dirty();\n$2if (tooBig) return ${invalid};`],
    ['maxLength', `return ${invalid};`],
    ['maxSize', `return ${invalid};`],
  ]) {
    const pattern = new RegExp(
      `(message: def\\.${field}\\.message,\\s*\\}\\);\\n)(\\s*)status\\.dirty\\(\\);`,
      'g',
    );
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`Unexpected Zod ${field} source`);
    text = text.replace(pattern, `$1$2${statement}`);
  }
  return text;
}

export function prepare(source, output) {
  const spec = JSON.parse(readFileSync(new URL('./source-spec.json', import.meta.url)));
  if (existsSync(output)) throw new Error('Refusing to overwrite an existing proof directory');
  // Complete official source-tree identity is checked before any package is copied or run.
  for (const item of spec.packages) {
    const directory = join(source, item.directory);
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json')));
    if (
      metadata.name !== item.name ||
      metadata.version !== item.version ||
      treeHash(directory) !== item.sourceTreeSHA256
    )
      throw new Error(`Unrecognized package source: ${item.name}`);
  }
  mkdirSync(output);
  const results = [];
  for (const item of spec.packages) {
    const destination = join(output, item.directory);
    cpSync(join(source, item.directory), destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    for (const path of item.patchFiles) {
      const target = join(destination, path);
      const before = readFileSync(target, 'utf8');
      const after =
        item.name === 'node-forge'
          ? patchForge(before)
          : patchZod(before, path.endsWith('.cjs') ? 'parseUtil_js_1.INVALID' : 'INVALID');
      writeFileSync(target, after);
    }
    results.push({
      name: item.name,
      version: item.version,
      sourceTreeSHA256: item.sourceTreeSHA256,
      patchedTreeSHA256: treeHash(destination),
      changedFiles: item.patchFiles,
    });
  }
  const result = {
    mode: 'LOCAL_SOURCE_BACKPORT_PROOF_ONLY',
    packageNamesAndVersionsUnchanged: true,
    nativeDependencyIntegration: false,
    registryAuditExpectedStillAffected: true,
    packages: results,
  };
  writeFileSync(join(output, 'PROOF-PROVENANCE.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4)
    throw new Error('Usage: prepare-proof.mjs VERIFIED_SOURCE_DIRECTORY NEW_PROOF_DIRECTORY');
  console.log(JSON.stringify(prepare(resolve(process.argv[2]), resolve(process.argv[3])), null, 2));
}
