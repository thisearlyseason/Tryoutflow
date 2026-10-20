import { createHash } from 'node:crypto';

import sharp from 'sharp';

const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_ENCODED_BYTES = 350_000;
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type NormalizedOrganizationLogo = Readonly<{
  base64: string;
  sha256: string;
  byteLength: number;
}>;

export type OrganizationLogoNormalizationErrorCode = 'invalid_file' | 'too_large' | 'unavailable';

export class OrganizationLogoNormalizationError extends Error {
  readonly code: OrganizationLogoNormalizationErrorCode;

  constructor(code: OrganizationLogoNormalizationErrorCode) {
    super('Organization logo could not be normalized');
    this.name = 'OrganizationLogoNormalizationError';
    this.code = code;
  }
}

function hasAcceptedMagic(bytes: Uint8Array) {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return isPng || isJpeg || isWebp;
}

export async function normalizeOrganizationLogo(file: File): Promise<NormalizedOrganizationLogo> {
  if (file.size === 0 || !ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new OrganizationLogoNormalizationError('invalid_file');
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new OrganizationLogoNormalizationError('too_large');
  }

  let input: ArrayBuffer;
  try {
    input = await file.arrayBuffer();
  } catch {
    throw new OrganizationLogoNormalizationError('unavailable');
  }
  if (!hasAcceptedMagic(new Uint8Array(input))) {
    throw new OrganizationLogoNormalizationError('invalid_file');
  }

  let normalized: Buffer;
  try {
    normalized = await sharp(input, { failOn: 'warning', limitInputPixels: 16_000_000 })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
  } catch {
    throw new OrganizationLogoNormalizationError('invalid_file');
  }
  if (normalized.byteLength > MAX_ENCODED_BYTES) {
    throw new OrganizationLogoNormalizationError('too_large');
  }

  return {
    base64: normalized.toString('base64'),
    sha256: createHash('sha256').update(normalized).digest('hex'),
    byteLength: normalized.byteLength,
  };
}
