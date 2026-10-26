import { afterEach, expect, test, vi } from 'vitest';
const native = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  deleteItem: vi.fn(),
  shareFile: vi.fn(),
  read: vi.fn(),
  unlink: vi.fn(),
  exists: vi.fn(),
  move: vi.fn(),
  write: vi.fn(),
}));
vi.mock('react-native', () => ({
  NativeModules: { TryOutSecureStore: native, TryOutReports: { shareFile: native.shareFile } },
  Platform: { OS: 'android' },
}));
vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      dirs: { CacheDir: '/private/cache' },
      ls: native.read,
      unlink: native.unlink,
      exists: native.exists,
      mv: native.move,
      writeFile: native.write,
    },
  },
}));
vi.mock('react-native-share', () => ({ default: { open: vi.fn() } }));
import * as Store from '../src/platform/secure-store';
import * as Files from '../src/platform/files';
import { shareAsync } from '../src/platform/sharing';
afterEach(() => vi.resetAllMocks());

test('a locked or unreadable native store fails without returning a missing session or deleting it', async () => {
  const failure = new Error('Native keystore locked');
  native.getItem.mockRejectedValue(failure);
  await expect(Store.getItemAsync('pending-purchase')).rejects.toBe(failure);
  expect(native.deleteItem).not.toHaveBeenCalled();
  expect(native.setItem).not.toHaveBeenCalled();
});

test('report cleanup and sharing cannot access sibling, traversed or unrelated private files', async () => {
  for (const uri of [
    'file:///private/cache/../session.json',
    'file:///private/cache-other/tryoutflow-report-00000000-0000-0000-0000-000000000000.pdf',
    'file:///private/cache/session.json',
  ]) {
    await expect(Files.deleteAsync(uri)).rejects.toThrow();
    await expect(shareAsync(uri, { mimeType: 'application/pdf' })).rejects.toThrow();
  }
  expect(native.unlink).not.toHaveBeenCalled();
  expect(native.shareFile).not.toHaveBeenCalled();
});

test('Android sharing waits for native activity completion before the caller can clean the report', async () => {
  let finish!: () => void;
  native.shareFile.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let returned = false;
  const share = shareAsync(
    'file:///private/cache/tryoutflow-report-00000000-0000-0000-0000-000000000000.pdf',
    { mimeType: 'application/pdf' },
  ).then(() => {
    returned = true;
  });
  await Promise.resolve();
  expect(returned).toBe(false);
  finish();
  await share;
  expect(returned).toBe(true);
});
