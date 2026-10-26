// Offline-only entry for simulator/device validation. Never imported by index.ts.
// Build explicitly with ENTRY_FILE=tests/platform-native-smoke.tsx.
import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { AppRegistry, Platform, Text, View } from 'react-native';
import BlobUtil from 'react-native-blob-util';
import { v4 as uuid } from 'uuid';
import * as Store from '../src/platform/secure-store';
import * as Reports from '../src/platform/reports';
import * as Files from '../src/platform/files';

function Smoke() {
  const [message, setMessage] = useState('Checking fictional offline data…');
  useEffect(() => {
    void (async () => {
      const key = `native-migration-smoke-${uuid()}`;
      let uri: string | undefined;
      let failure: string | undefined;
      const checks: string[] = [];
      try {
        if (Platform.OS === 'android') {
          for (const format of ['old', 'current']) {
            const legacyKey = `native-migration-legacy-${format}`;
            try {
              if ((await Store.getItemAsync(legacyKey)) !== `fictional-legacy-${format}`)
                throw new Error(`Legacy ${format} secure-store read`);
              await Store.setItemAsync(legacyKey, `fictional-updated-${format}`);
              if ((await Store.getItemAsync(legacyKey)) !== `fictional-updated-${format}`)
                throw new Error(`Legacy ${format} secure-store update`);
            } finally {
              await Store.deleteItemAsync(legacyKey);
            }
          }
          checks.push('legacy Expo Android encryption formats read/update/delete');
        }
        if ((await Store.getItemAsync(key)) !== null)
          throw new Error('Unexpected existing fixture');
        const value = `fictional-${uuid()}`;
        await Store.setItemAsync(key, value);
        if ((await Store.getItemAsync(key)) !== value) throw new Error('Storage readback');
        await Store.setItemAsync(key, `${value}-updated`);
        if ((await Store.getItemAsync(key)) !== `${value}-updated`)
          throw new Error('Storage update');
        await Store.deleteItemAsync(key);
        if ((await Store.getItemAsync(key)) !== null) throw new Error('Storage delete');
        checks.push('native secure-store create/read/update/delete');
        ({ uri } = await Reports.printToFileAsync({
          html: '<html><body><h1>Fictional native migration report</h1><p>No account, player, payment or production data.</p><div style="page-break-before:always"><h2>Second page</h2></div></body></html>',
        }));
        const pdf = await BlobUtil.fs.readFile(uri.slice('file://'.length), 'base64');
        if (!pdf.startsWith('JVBER')) throw new Error('PDF header');
        const preview = `${BlobUtil.fs.dirs.CacheDir}/native-migration-smoke-preview.pdf`;
        if (await BlobUtil.fs.exists(preview)) await BlobUtil.fs.unlink(preview);
        await BlobUtil.fs.cp(uri.slice('file://'.length), preview);
        checks.push('native private-cache PDF generated');
        await Files.deleteAsync(uri, { idempotent: true });
        if (await BlobUtil.fs.exists(uri.slice('file://'.length))) throw new Error('PDF cleanup');
        checks.push('native PDF cleanup');
      } catch (error) {
        failure = String(error);
      } finally {
        try {
          await Store.deleteItemAsync(key);
          if (uri) await Files.deleteAsync(uri, { idempotent: true });
        } catch (error) {
          failure ??= `Cleanup failed: ${String(error)}`;
        }
      }
      await BlobUtil.fs.writeFile(
        `${BlobUtil.fs.dirs.CacheDir}/native-migration-smoke.json`,
        JSON.stringify({ passed: !failure, at: new Date().toISOString(), checks, error: failure }),
        'utf8',
      );
      setMessage(failure ? 'Offline native smoke failed' : 'Offline native smoke passed');
    })();
  }, []);
  return (
    <View>
      <Text>{message}</Text>
    </View>
  );
}
AppRegistry.registerComponent('main', () => Smoke);
