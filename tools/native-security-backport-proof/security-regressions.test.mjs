import assert from 'node:assert/strict';
import {
  constants,
  createHash,
  generateKeyPairSync,
  privateEncrypt,
  sign,
  verify,
} from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { patchForge, patchZod, prepare } from './prepare-proof.mjs';
const require = createRequire(import.meta.url);
const originalRoot = resolve('evidence/package-fixtures');
const patchedRoot = resolve('evidence/patched-fixtures');
const originalForge = require(join(originalRoot, 'node-forge-1.4.0'));
const patchedForge = require(join(patchedRoot, 'node-forge-1.4.0'));
const originalZod = require(join(originalRoot, 'zod-3.25.76/v3/index.cjs')).z;
const patchedZod = require(join(patchedRoot, 'zod-3.25.76/v3/index.cjs')).z;
const esmZod = (await import(pathToFileURL(join(patchedRoot, 'zod-3.25.76/v3/index.js')).href)).z;

// Mathematical test material only: in memory, never saved, registered or transmitted.
// These keys give no access to any account, device, signing identity or service.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
const publicPEM = keys.publicKey.export({ format: 'pem', type: 'spki' });
const privatePEM = keys.privateKey.export({ format: 'pem', type: 'pkcs8' });
const message = Buffer.from('fictional native toolchain regression');
const originalPublic = originalForge.pki.publicKeyFromPem(publicPEM);
const patchedPublic = patchedForge.pki.publicKeyFromPem(publicPEM);
const A = originalForge.asn1;
const oid = (algorithm) =>
  A.create(
    A.Class.UNIVERSAL,
    A.Type.OID,
    false,
    A.oidToDer(originalForge.oids[algorithm]).getBytes(),
  );
const nullParameter = () => A.create(A.Class.UNIVERSAL, A.Type.NULL, false, '');
const garbage = () => A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, 'synthetic garbage');
function signatureFor(
  algorithm,
  parameters = [nullParameter()],
  extraOuter = [],
  algorithmChildren,
) {
  const digest = createHash(algorithm).update(message).digest();
  const info = A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, [
    A.create(
      A.Class.UNIVERSAL,
      A.Type.SEQUENCE,
      true,
      algorithmChildren ?? [oid(algorithm), ...parameters],
    ),
    A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, digest.toString('binary')),
    ...extraOuter,
  ]);
  const signature = privateEncrypt(
    { key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(A.toDer(info).getBytes(), 'binary'),
  );
  return { digest: digest.toString('binary'), signature: signature.toString('binary') };
}
for (const [label, parameters] of [
  ['extra child after NULL', [nullParameter(), garbage()]],
  ['extra NULL child', [nullParameter(), nullParameter()]],
  ['non-NULL optional parameter', [garbage()]],
  ['non-empty NULL parameter', [A.create(A.Class.UNIVERSAL, A.Type.NULL, false, 'x')]],
])
  test(`Forge baseline reproduces, backport rejects ${label}`, () => {
    const value = signatureFor('sha256', parameters);
    assert.equal(
      originalPublic.verify(value.digest, value.signature),
      true,
      'original defect must reproduce',
    );
    assert.throws(() => patchedPublic.verify(value.digest, value.signature), /DigestInfo/u);
  });
for (const algorithm of [
  'md5',
  'sha1',
  'sha224',
  'sha256',
  'sha384',
  'sha512',
  'sha512-224',
  'sha512-256',
]) {
  for (const parameters of algorithm === 'md5' ? [[nullParameter()]] : [[nullParameter()], []])
    test(`Forge preserves valid ${algorithm}, NULL=${parameters.length > 0}`, () => {
      const value = signatureFor(algorithm, parameters);
      assert.equal(originalPublic.verify(value.digest, value.signature), true);
      assert.equal(patchedPublic.verify(value.digest, value.signature), true);
    });
}
test('Forge preserves MD5 required NULL parameter rejection', () => {
  const value = signatureFor('md5', []);
  assert.throws(() => originalPublic.verify(value.digest, value.signature), /NULL/u);
  assert.throws(() => patchedPublic.verify(value.digest, value.signature), /NULL/u);
});
test('Forge still rejects an extra outer DigestInfo child', () => {
  const value = signatureFor('sha256', [nullParameter()], [garbage()]);
  assert.throws(() => patchedPublic.verify(value.digest, value.signature), /DigestInfo/u);
});
test('Forge wrong digest remains invalid', () => {
  const value = signatureFor('sha256');
  assert.equal(patchedPublic.verify('0'.repeat(32), value.signature), false);
});
test('Forge RSA-PSS behavior remains valid', () => {
  const signature = sign('sha256', message, {
    key: keys.privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });
  for (const forge of [originalForge, patchedForge]) {
    const scheme = forge.pss.create({
      md: forge.md.sha256.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
      saltLength: 32,
    });
    assert.equal(
      forge.pki
        .publicKeyFromPem(publicPEM)
        .verify(
          createHash('sha256').update(message).digest('binary'),
          signature.toString('binary'),
          scheme,
        ),
      true,
    );
  }
});

for (const [label, z] of [
  ['CJS', patchedZod],
  ['ESM', esmZod],
]) {
  for (const bound of ['max', 'length'])
    test(`Zod ${label} ${bound} rejects before visiting oversized array elements`, async () => {
      let visits = 0;
      const schema = z
        .array(
          z.preprocess((value) => {
            visits++;
            return value;
          }, z.string()),
        )
        [bound](1);
      for (const parse of [
        (value) => schema.safeParse(value),
        (value) => schema.safeParseAsync(value),
      ]) {
        visits = 0;
        const value = await parse(Array(64).fill(1));
        assert.equal(value.success, false);
        assert.equal(visits, 0);
        assert.equal(value.error.issues.length, 1);
        assert.equal(value.error.issues[0].code, 'too_big');
      }
    });
  test(`Zod ${label} set maximum rejects before visiting elements`, async () => {
    let visits = 0;
    const schema = z
      .set(
        z.preprocess((value) => {
          visits++;
          return value;
        }, z.string()),
      )
      .max(1);
    const value = await schema.safeParseAsync(new Set([1, 2, 3, 4]));
    assert.equal(value.success, false);
    assert.equal(visits, 0);
    assert.equal(value.error.issues.length, 1);
  });
  test(`Zod ${label} preserves valid data, transformations, nested paths and lower-bound diagnostics`, async () => {
    for (const library of [originalZod, z]) {
      assert.deepEqual(
        await library
          .array(library.number().transform((n) => n + 1))
          .max(2)
          .parseAsync([1, 2]),
        [2, 3],
      );
      const failure = library
        .object({ values: library.array(library.string()).max(1) })
        .safeParse({ values: [1, 2] });
      assert.deepEqual(failure.error.issues[0].path, ['values']);
      assert.equal(
        library.array(library.string()).min(2).safeParse([]).error.issues[0].code,
        'too_small',
      );
      assert.equal(
        library.array(library.string()).length(2).safeParse([]).error.issues[0].code,
        'too_small',
      );
      assert.deepEqual(
        library
          .set(library.number())
          .size(2)
          .parse(new Set([1, 2])),
        new Set([1, 2]),
      );
    }
  });
}
test('Zod original bounded-array defect reproduces without a large input', () => {
  let visits = 0;
  const result = originalZod
    .array(
      originalZod.preprocess((value) => {
        visits++;
        return value;
      }, originalZod.string()),
    )
    .max(1)
    .safeParse(Array(64).fill(1));
  assert.equal(visits, 64);
  assert.equal(result.error.issues.length, 65);
});

const consumers = JSON.parse(readFileSync(new URL('./consumer-spec.json', import.meta.url))).files;
function loadConsumer(relative, dependencyMap) {
  const spec = consumers.find((entry) => entry.path === relative);
  assert(spec, 'unrecognized consumer');
  const source = readFileSync(resolve(relative), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), spec.sha256);
  const exports = {};
  const factory = vm.runInThisContext(`(function(require, exports) {${source}\n})`, {
    filename: relative,
  });
  factory((name) => {
    if (!Object.hasOwn(dependencyMap, name))
      throw new Error(`Unrecognized test dependency ${name}`);
    return dependencyMap[name];
  }, exports);
  return exports;
}
const consumerBase = 'evidence/upstream-inspection/expo-cli/';
const schemaFile = consumerBase + 'package__build__src__start__server__DevToolsPlugin.schema.js';
const mcpFile =
  consumerBase + 'package__build__src__start__server__createMCPDevToolsExtensionSchema.js';
const plugin = {
  packageName: 'fictional-plugin',
  packageRoot: '/fictional/plugin',
  cliExtensions: {
    description: 'Fictional plugin',
    entryPoint: './test.js',
    commands: [
      {
        name: 'inspect',
        title: 'Inspect',
        environments: ['cli', 'mcp'],
        parameters: [{ name: 'enabled', type: 'confirm' }],
      },
    ],
  },
};
test('published Expo plugin schemas retain positive and negative validation behavior', () => {
  for (const z of [originalZod, patchedZod]) {
    const schema = loadConsumer(schemaFile, { zod: { z } });
    assert.equal(schema.PluginSchema.safeParse(plugin).success, true);
    assert.equal(schema.PluginSchema.safeParse({ ...plugin, packageName: '' }).success, false);
    assert.equal(
      schema.PluginSchema.safeParse({
        ...plugin,
        cliExtensions: { ...plugin.cliExtensions, commands: [] },
      }).success,
      false,
    );
    assert.equal(
      schema.DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 'ok', level: 'info' }])
        .success,
      true,
    );
    assert.equal(
      schema.DevToolsPluginOutputSchema.safeParse([{ type: 'image', url: 'not a URL' }]).success,
      false,
    );
  }
});
test('published Expo MCP command schema preserves strict command/parameter handling', () => {
  for (const z of [originalZod, patchedZod]) {
    const { createMCPDevToolsExtensionSchema } = loadConsumer(mcpFile, { zod: { z } });
    const schema = createMCPDevToolsExtensionSchema(plugin);
    assert.deepEqual(schema.parse({ command: 'inspect', enabled: true }), {
      command: 'inspect',
      enabled: true,
    });
    for (const value of [
      { command: 'unknown' },
      { command: 'inspect', enabled: 'yes' },
      { command: 'inspect', unexpected: 1 },
    ])
      assert.equal(schema.safeParse(value).success, false);
  }
});
const certBase = 'evidence/upstream-inspection/expo-code-signing-certificates/';
function certificates(forge) {
  const utils = loadConsumer(certBase + 'package__build__utils.js', {
    assert: require('node:assert'),
  });
  return loadConsumer(certBase + 'package__build__main.js', {
    assert: require('node:assert'),
    'node-forge': forge,
    './utils': utils,
  });
}
for (const [label, forge] of [
  ['original', originalForge],
  ['patched', patchedForge],
]) {
  test(`published Expo certificate/CSR/signing APIs remain synchronous and valid: ${label}`, () => {
    const library = certificates(forge);
    const pair = library.convertKeyPairPEMToKeyPair({
      publicKeyPEM: publicPEM,
      privateKeyPEM: privatePEM,
    });
    const certificate = library.generateSelfSignedCodeSigningCertificate({
      keyPair: pair,
      commonName: 'Fictional local proof',
      validityNotBefore: new Date(Date.now() - 60_000),
      validityNotAfter: new Date(Date.now() + 60_000),
    });
    library.validateSelfSignedCertificate(certificate, pair);
    const pem = library.convertCertificateToCertificatePEM(certificate);
    const roundTrip = library.convertCertificatePEMToCertificate(pem);
    library.validateSelfSignedCertificate(roundTrip, pair);
    assert.equal(
      verify(
        'sha256',
        message,
        keys.publicKey,
        Buffer.from(
          library.signBufferRSASHA256AndVerify(pair.privateKey, certificate, message),
          'base64',
        ),
      ),
      true,
    );
    const csr = library.generateCSR(pair, 'Fictional CSR');
    const parsed = library.convertCSRPEMToCSR(library.convertCSRToCSRPEM(csr));
    const development = library.generateDevelopmentCertificateFromCSR(
      pair.privateKey,
      certificate,
      parsed,
      '00000000-0000-4000-8000-000000000000',
      '@fictional/project',
    );
    assert.equal(certificate.verify(development), true);
    assert.equal(
      development.getExtension({ id: library.expoProjectInformationOID }).value,
      '00000000-0000-4000-8000-000000000000,@fictional/project',
    );
    certificate.validity.notAfter = new Date(0);
    assert.throws(() => library.validateSelfSignedCertificate(certificate, pair), /expired/u);
  });
}
test('proof keeps genuine package versions and never integrates a dependency override', () => {
  for (const [name, version] of [
    ['node-forge', '1.4.0'],
    ['zod', '3.25.76'],
  ]) {
    assert.equal(
      readFileSync(join(originalRoot, `${name}-${version}/package.json`), 'utf8'),
      readFileSync(join(patchedRoot, `${name}-${version}/package.json`), 'utf8'),
    );
  }
  const proof = JSON.parse(readFileSync(join(patchedRoot, 'PROOF-PROVENANCE.json')));
  assert.equal(proof.nativeDependencyIntegration, false);
  assert.equal(proof.registryAuditExpectedStillAffected, true);
});
test('patch application refuses unrecognized source, altered source anchors and existing destinations', () => {
  assert.throws(() => patchForge('unexpected source'), /Unexpected/u);
  assert.throws(() => patchZod('unexpected source', 'INVALID'), /Unexpected/u);
  assert.throws(() => prepare(originalRoot, patchedRoot), /overwrite/u);
  const root = mkdtempSync(join(tmpdir(), 'tryoutflow-backport-source-'));
  try {
    assert.throws(() => prepare(root, join(root, 'out')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reproducible patch output matches every reviewed changed file', () => {
  const spec = JSON.parse(readFileSync(new URL('./source-spec.json', import.meta.url)));
  for (const item of spec.packages)
    for (const path of item.patchFiles) {
      const before = readFileSync(join(originalRoot, item.directory, path), 'utf8');
      const expected =
        item.name === 'node-forge'
          ? patchForge(before)
          : patchZod(before, path.endsWith('.cjs') ? 'parseUtil_js_1.INVALID' : 'INVALID');
      assert.equal(readFileSync(join(patchedRoot, item.directory, path), 'utf8'), expected);
    }
});

for (const [label, parameter] of [
  ['constructed NULL', A.create(A.Class.UNIVERSAL, A.Type.NULL, true, [])],
  ['wrong parameter class', A.create(A.Class.CONTEXT_SPECIFIC, A.Type.NULL, false, '')],
])
  test(`Forge backport rejects ${label}`, () => {
    const value = signatureFor('sha256', [parameter]);
    assert.throws(() => patchedPublic.verify(value.digest, value.signature), /DigestInfo/u);
  });
test('Forge empty algorithm sequence remains invalid', () => {
  const value = signatureFor('sha256', [], [], []);
  assert.throws(() => originalPublic.verify(value.digest, value.signature));
  assert.throws(() => patchedPublic.verify(value.digest, value.signature));
});
for (const field of ['commands', 'parameters', 'environments', 'output']) {
  test(`known unresolved Expo boundary stays visible: unbounded ${field}`, () => {
    const schemas = loadConsumer(schemaFile, { zod: { z: patchedZod } });
    const data = structuredClone(plugin);
    if (field === 'commands') data.cliExtensions.commands = Array(64).fill(1);
    if (field === 'parameters') data.cliExtensions.commands[0].parameters = Array(64).fill(1);
    if (field === 'environments') data.cliExtensions.commands[0].environments = Array(64).fill(1);
    const result =
      field === 'output'
        ? schemas.DevToolsPluginOutputSchema.safeParse(Array(64).fill(1))
        : schemas.PluginSchema.safeParse(data);
    assert.equal(result.success, false);
    assert.equal(
      result.error.issues.length,
      64,
      'this backport must not be misrepresented as fixing unbounded Expo input',
    );
  });
}
