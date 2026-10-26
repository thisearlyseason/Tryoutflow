import { NativeModules } from 'react-native';
import { v4 as randomUUID } from 'uuid';
import { cacheDirectory, deleteAsync } from './files';

export async function printToFileAsync({ html }: { html: string }): Promise<{ uri: string }> {
  const name = `tryoutflow-report-${randomUUID()}.pdf`;
  try {
    const uri: string = await NativeModules.TryOutReports.printToFile(html, name);
    if (uri !== `${cacheDirectory}${name}`) throw new Error('Unexpected PDF location.');
    return { uri };
  } catch (error) {
    await deleteAsync(`${cacheDirectory}${name}`, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}
