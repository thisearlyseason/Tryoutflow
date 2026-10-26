import Share from 'react-native-share';
import { NativeModules, Platform } from 'react-native';
import { cacheDirectory } from './files';

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}
export async function shareAsync(
  uri: string,
  options: { mimeType: string; UTI?: string },
): Promise<void> {
  if (
    !uri.startsWith(cacheDirectory) ||
    !/^tryoutflow-report-[a-f0-9-]{36}\.(csv|json|pdf)$/.test(uri.slice(cacheDirectory.length))
  ) {
    throw new Error('Only private report files can be shared.');
  }
  if (Platform.OS === 'android') {
    // Wait for the receiving activity to return before Workspace removes the file.
    // A chooser-target callback alone can fire before the receiver reads it.
    await NativeModules.TryOutReports.shareFile(uri, options.mimeType);
  } else {
    await Share.open({
      url: uri,
      type: options.mimeType,
      failOnCancel: false,
      useInternalStorage: true,
    });
  }
}
