import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  createFile: vi.fn(),
  write: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: mocks.permission,
    createFileAsync: mocks.createFile,
    writeAsStringAsync: mocks.write,
  },
}));
vi.mock('expo-sharing', () => ({}));

import { reportSaveMessage, saveReportExport } from './save-report-export';

describe('Android report exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the Excel file in a user-selected folder instead of a temporary cache', async () => {
    mocks.permission.mockResolvedValue({ granted: true, directoryUri: 'content://selected-folder' });
    mocks.createFile.mockResolvedValue('content://selected-file');
    mocks.write.mockResolvedValue(undefined);

    const result = await saveReportExport(new Uint8Array([0x50, 0x4b]), 'sales.xlsx', 'xlsx');

    expect(mocks.createFile).toHaveBeenCalledWith(
      'content://selected-folder',
      'sales',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mocks.write).toHaveBeenCalledWith('content://selected-file', 'UEs=', { encoding: 'base64' });
    expect(result).toEqual({ status: 'saved', fileName: 'sales.xlsx' });
    if (result.status !== 'cancelled') expect(reportSaveMessage(result)).toContain('folder you selected');
  });

  it('does not report success when the folder picker is cancelled', async () => {
    mocks.permission.mockResolvedValue({ granted: false });
    const result = await saveReportExport(new Uint8Array([0x25, 0x50]), 'sales.pdf', 'pdf');
    expect(result).toEqual({ status: 'cancelled' });
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
