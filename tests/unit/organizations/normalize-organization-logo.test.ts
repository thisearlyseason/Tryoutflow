import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  normalizeOrganizationLogo,
  OrganizationLogoNormalizationError,
} from '../../../src/modules/organizations/application/normalize-organization-logo';
import {
  updateOrganizationLogo,
  type OrganizationLogoGateway,
} from '../../../src/modules/organizations/application/update-organization-logo';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const actorUserId = '11111111-1111-4111-8111-111111111111' as UserId;

function authorization(role: 'owner' | 'administrator' | 'member'): AuthorizationContext {
  return {
    userId: actorUserId,
    organizationId,
    organizationRole: role,
    membershipStatus: 'active',
    assignments: [],
  };
}

function file(bytes: Uint8Array, type: string, name = 'untrusted-upload.bin') {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

async function pngFile({
  width,
  height,
  withMetadata = false,
}: {
  width: number;
  height: number;
  withMetadata?: boolean;
}) {
  let pipeline = sharp({
    create: { width, height, channels: 4, background: { r: 32, g: 105, b: 180, alpha: 1 } },
  }).png();
  if (withMetadata) pipeline = pipeline.withMetadata({ orientation: 6 });
  return file(new Uint8Array(await pipeline.toBuffer()), 'image/png', 'ignored-name.png');
}

function hostileFile(type: string) {
  return file(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), type);
}

function gateway(overrides: Partial<OrganizationLogoGateway> = {}): OrganizationLogoGateway {
  return {
    upsert: vi.fn(async () => 'updated'),
    remove: vi.fn(async () => 'removed'),
    ...overrides,
  };
}

describe('normalizeOrganizationLogo', () => {
  it('normalizes a valid PNG to bounded metadata-free WebP', async () => {
    const result = await normalizeOrganizationLogo(
      await pngFile({ width: 900, height: 300, withMetadata: true }),
    );
    const normalized = Buffer.from(result.base64, 'base64');
    const metadata = await sharp(normalized).metadata();

    expect(result.byteLength).toBeLessThanOrEqual(350_000);
    expect(result.byteLength).toBe(normalized.byteLength);
    expect(normalized.subarray(8, 12).toString()).toBe('WEBP');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.sha256).toBe(createHash('sha256').update(normalized).digest('hex'));
    expect(metadata).toMatchObject({ format: 'webp', width: 171, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it.each([
    ['an empty image', file(new Uint8Array(), 'image/png'), 'invalid_file'],
    ['a raw image over 2 MiB', file(new Uint8Array(2 * 1024 * 1024 + 1), 'image/png'), 'too_large'],
    ['an SVG MIME type', hostileFile('image/svg+xml'), 'invalid_file'],
    ['a PDF MIME type', hostileFile('application/pdf'), 'invalid_file'],
    ['spoofed PNG bytes', hostileFile('image/png'), 'invalid_file'],
    [
      'malformed bytes after a PNG signature',
      file(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]), 'image/png'),
      'invalid_file',
    ],
  ])('rejects %s without exposing decoder details', async (_description, candidate, code) => {
    await expect(normalizeOrganizationLogo(candidate)).rejects.toEqual(
      expect.objectContaining({ code }),
    );
  });

  it('rejects normalized output above the encoded database ceiling', async () => {
    const bytes = new Uint8Array(512 * 512 * 4);
    let state = 0x12345678;
    for (let index = 0; index < bytes.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[index] = state & 0xff;
    }
    const png = await sharp(bytes, {
      raw: { width: 512, height: 512, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(normalizeOrganizationLogo(file(new Uint8Array(png), 'image/png'))).rejects.toEqual(
      expect.objectContaining({ code: 'too_large' }),
    );
  });
});

describe('updateOrganizationLogo', () => {
  it.each(['image/svg+xml', 'application/pdf'])(
    'rejects %s without calling the RPC',
    async (type) => {
      const logoGateway = gateway();
      const result = await updateOrganizationLogo(
        { organizationId, file: hostileFile(type) },
        { userId: actorUserId, authorization: authorization('owner') },
        { gateway: logoGateway },
      );

      expect(result).toEqual({ ok: false, error: { code: 'invalid_file' } });
      expect(logoGateway.upsert).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'administrator'] as const)(
    'lets an active %s normalize and upsert a logo',
    async (role) => {
      const logoGateway = gateway();
      const result = await updateOrganizationLogo(
        { organizationId, file: await pngFile({ width: 240, height: 240 }) },
        { userId: actorUserId, authorization: authorization(role) },
        { gateway: logoGateway },
      );

      expect(result).toEqual({
        ok: true,
        value: {
          kind: 'updated',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          byteLength: expect.any(Number),
        },
      });
      expect(logoGateway.upsert).toHaveBeenCalledWith({
        organizationId,
        base64: expect.any(String),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
    },
  );

  it('denies a member before processing bytes or invoking either RPC', async () => {
    const logoGateway = gateway();
    const normalize = vi.fn();

    await expect(
      updateOrganizationLogo(
        { organizationId, file: hostileFile('image/png') },
        { userId: actorUserId, authorization: authorization('member') },
        { gateway: logoGateway, normalize },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    await expect(
      updateOrganizationLogo(
        { organizationId, remove: true },
        { userId: actorUserId, authorization: authorization('member') },
        { gateway: logoGateway, normalize },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(normalize).not.toHaveBeenCalled();
    expect(logoGateway.upsert).not.toHaveBeenCalled();
    expect(logoGateway.remove).not.toHaveBeenCalled();
  });

  it('uses the same guarded upsert for replacement and returns the new digest only', async () => {
    const logoGateway = gateway();
    const first = {
      base64: Buffer.from('first normalized logo').toString('base64'),
      sha256: '1'.repeat(64),
      byteLength: 21,
    };
    const replacement = {
      base64: Buffer.from('replacement normalized logo').toString('base64'),
      sha256: '2'.repeat(64),
      byteLength: 27,
    };
    const normalize = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
    const actor = { userId: actorUserId, authorization: authorization('owner') };

    await updateOrganizationLogo(
      { organizationId, file: file(new Uint8Array([1]), 'image/png') },
      actor,
      { gateway: logoGateway, normalize },
    );
    await expect(
      updateOrganizationLogo(
        { organizationId, file: file(new Uint8Array([2]), 'image/png') },
        actor,
        { gateway: logoGateway, normalize },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { kind: 'updated', sha256: replacement.sha256, byteLength: 27 },
    });
    expect(logoGateway.upsert).toHaveBeenNthCalledWith(2, {
      organizationId,
      base64: replacement.base64,
      sha256: replacement.sha256,
    });
  });

  it.each(['owner', 'administrator'] as const)('lets an active %s remove a logo', async (role) => {
    const logoGateway = gateway();

    await expect(
      updateOrganizationLogo(
        { organizationId, remove: true },
        { userId: actorUserId, authorization: authorization(role) },
        { gateway: logoGateway },
      ),
    ).resolves.toEqual({ ok: true, value: { kind: 'removed' } });
    expect(logoGateway.remove).toHaveBeenCalledWith({ organizationId });
    expect(logoGateway.upsert).not.toHaveBeenCalled();
  });

  it('maps RPC conflicts and failures to unavailable without exposing details', async () => {
    const actor = { userId: actorUserId, authorization: authorization('owner') };
    const normalize = vi.fn(async () => ({
      base64: 'bm9ybWFsaXplZA==',
      sha256: '3'.repeat(64),
      byteLength: 10,
    }));

    await expect(
      updateOrganizationLogo(
        { organizationId, file: file(new Uint8Array([1]), 'image/png') },
        actor,
        { gateway: gateway({ upsert: vi.fn(async () => 'conflict') }), normalize },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'unavailable' } });
    await expect(
      updateOrganizationLogo({ organizationId, remove: true }, actor, {
        gateway: gateway({ remove: vi.fn(async () => Promise.reject(new Error('rpc detail'))) }),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'unavailable' } });
  });

  it('retains the old logo by never upserting when processing fails', async () => {
    const logoGateway = gateway();
    const normalize = vi.fn(async () => {
      throw new OrganizationLogoNormalizationError('invalid_file');
    });

    await expect(
      updateOrganizationLogo(
        { organizationId, file: file(new Uint8Array([1]), 'image/png') },
        { userId: actorUserId, authorization: authorization('owner') },
        { gateway: logoGateway, normalize },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_file' } });
    expect(logoGateway.upsert).not.toHaveBeenCalled();
    expect(logoGateway.remove).not.toHaveBeenCalled();
  });
});
