// Offline-only entry for simulator/device validation. Never imported by index.ts.
// Build explicitly with ENTRY_FILE=tests/platform-native-smoke.tsx.
import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
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
      const checks: string[] = [];
      try {
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
        checks.push('native private-cache PDF generated');
        await Files.deleteAsync(uri, { idempotent: true });
        if (await BlobUtil.fs.exists(uri.slice('file://'.length))) throw new Error('PDF cleanup');
        checks.push('native PDF cleanup');
        await BlobUtil.fs.writeFile(
          `${BlobUtil.fs.dirs.CacheDir}/native-migration-smoke.json`,
          JSON.stringify({ passed: true, checks }),
          'utf8',
        );
        setMessage('Offline native smoke passed');
      } catch (error) {
        const result = { passed: false, checks, error: String(error) };
        await BlobUtil.fs.writeFile(
          `${BlobUtil.fs.dirs.CacheDir}/native-migration-smoke.json`,
          JSON.stringify(result),
          'utf8',
        );
        setMessage('Offline native smoke failed');
      } finally {
        await Store.deleteItemAsync(key);
        if (uri) await Files.deleteAsync(uri, { idempotent: true });
      }
    })();
  }, []);
  return (
    <View>
      <Text>{message}</Text>
    </View>
  );
}
AppRegistry.registerComponent('main', () => Smoke);
