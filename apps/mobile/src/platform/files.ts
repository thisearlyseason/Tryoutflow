import BlobUtil from 'react-native-blob-util';

export const cacheDirectory = `file://${BlobUtil.fs.dirs.CacheDir}/`;
export const EncodingType = { Base64: 'base64' } as const;
function path(uri: string): string {
  if (
    !uri.startsWith(cacheDirectory) ||
    uri.slice(cacheDirectory.length).includes('/') ||
    !/^tryoutflow-report-[a-f0-9-]{36}\.(csv|json|pdf)$/.test(uri.slice(cacheDirectory.length))
  ) {
    throw new Error('Report file is outside the private cache.');
  }
  return uri.slice('file://'.length);
}
export async function readDirectoryAsync(directory: string): Promise<string[]> {
  if (directory !== cacheDirectory) throw new Error('Unexpected report directory.');
  return BlobUtil.fs.ls(BlobUtil.fs.dirs.CacheDir);
}
export async function deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void> {
  const file = path(uri);
  if (options?.idempotent && !(await BlobUtil.fs.exists(file))) return;
  await BlobUtil.fs.unlink(file);
}
export async function moveAsync({ from, to }: { from: string; to: string }): Promise<void> {
  await BlobUtil.fs.mv(path(from), path(to));
}
export async function writeAsStringAsync(
  uri: string,
  data: string,
  options: { encoding: 'base64' },
): Promise<void> {
  await BlobUtil.fs.writeFile(path(uri), data, options.encoding);
}
