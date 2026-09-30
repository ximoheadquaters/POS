import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ReportExportFormat = 'pdf' | 'xlsx' | 'csv';
export type ReportSaveResult =
  | { status: 'saved' | 'shared' | 'downloaded'; fileName: string }
  | { status: 'cancelled' };

export function reportSaveMessage(result: Exclude<ReportSaveResult, { status: 'cancelled' }>): string {
  if (result.status === 'saved') {
    return `${result.fileName} was saved in the folder you selected. Open Files and browse to that folder to find it.`;
  }
  if (result.status === 'downloaded') {
    return `${result.fileName} was sent to your browser's Downloads. Check the browser's download list.`;
  }
  return `${result.fileName} was shared. If you chose Save to Files, open the folder you selected there.`;
}

function base64FromBytes(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[chunk & 63] : '=';
  }
  return output;
}

export async function saveReportExport(
  bytes: Uint8Array,
  fileName: string,
  format: ReportExportFormat,
): Promise<ReportSaveResult> {
  const mimeType =
    format === 'pdf'
      ? 'application/pdf'
      : format === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes.slice().buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return { status: 'downloaded', fileName };
  }

  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return { status: 'cancelled' };
    const fileStem = fileName.replace(/\.(pdf|xlsx|csv)$/i, '');
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permission.directoryUri,
      fileStem,
      mimeType,
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, base64FromBytes(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { status: 'saved', fileName };
  }

  if (!FileSystem.cacheDirectory) throw new Error('A writable export folder is unavailable.');
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, base64FromBytes(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('File sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    dialogTitle: `Export ${fileName}`,
    mimeType,
    UTI:
      format === 'pdf'
        ? 'com.adobe.pdf'
        : format === 'csv'
          ? 'public.comma-separated-values-text'
          : 'org.openxmlformats.spreadsheetml.sheet',
  });
  return { status: 'shared', fileName };
}
