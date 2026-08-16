import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HardwareModuleCode } from '@ximo/shared';
import { Button, Header, LoadingState, Screen } from '@/components/ui';
import { ReceiptPrinterSetup } from '@/components/receipt-printer-setup';
import { HARDWARE_CAPABILITIES } from '@/hardware/capabilities';
import { getHardwareDriver, getHardwareStatuses } from '@/hardware/registry';
import {
  DEFAULT_RECEIPT_PRINTER_SETTINGS,
  getReceiptPrinterSettings,
  saveReceiptPrinterSettings,
} from '@/hardware/receipt-printer-settings';
import type { ReceiptPrinterSettings } from '@/hardware/types';
import { useIosAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

import { AppSidebarProvider } from '@/components/app-sidebar';

function HardwareContent() {
  const { currentUser, refreshUser } = useSession();
  const { showAlert } = useIosAlert();
  const queryClient = useQueryClient();
  const branch = useBranchStore((state) => state.activeBranch);
  const modules = currentUser?.modules ?? [];
  const organizationId = currentUser?.organization.id;
  const branchId = branch?.id;
  const [printerSettings, setPrinterSettings] = useState<ReceiptPrinterSettings>(
    DEFAULT_RECEIPT_PRINTER_SETTINGS,
  );
  const [saveLabel, setSaveLabel] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ['hardware-status', [...modules].sort().join(',')],
    queryFn: () => getHardwareStatuses(modules),
  });
  const printerSettingsQuery = useQuery({
    queryKey: ['receipt-printer-settings', organizationId, branchId],
    queryFn: () => getReceiptPrinterSettings(organizationId, branchId),
  });
  useEffect(() => {
    if (printerSettingsQuery.data) setPrinterSettings(printerSettingsQuery.data);
  }, [printerSettingsQuery.data]);

  const savePrinter = useMutation({
    mutationFn: () => {
      if (!organizationId) {
        throw new Error('Sign in again, then retry saving printer settings.');
      }
      return saveReceiptPrinterSettings(printerSettings, organizationId, branchId);
    },
    onSuccess: async (saved) => {
      setPrinterSettings(saved);
      await queryClient.invalidateQueries({
        queryKey: ['receipt-printer-settings', organizationId, branchId],
      });
      setSaveLabel('Saved');
      showAlert({
        type: 'success',
        title: 'Printer settings saved',
        message: 'This device will use these settings for future receipts.',
      });
      setTimeout(() => setSaveLabel(undefined), 2000);
    },
    onError: (error) =>
      showAlert({
        type: 'error',
        title: 'Could not save printer settings',
        message: error.message,
      }),
  });
  const refresh = useMutation({
    mutationFn: async () => {
      await refreshUser();
      await query.refetch();
    },
    onError: (error) =>
      showAlert({
        type: 'error',
        title: 'Could not refresh hardware modules',
        message: error.message,
      }),
  });
  const test = useMutation({
    mutationFn: async (code: HardwareModuleCode) => {
      if (code === 'receipt_printer') {
        await getHardwareDriver('receipt_printer').test(printerSettings);
      } else {
        await getHardwareDriver(code).test();
      }
      return code;
    },
    onSuccess: (code) => {
      const capability = HARDWARE_CAPABILITIES.find((item) => item.code === code);
      showAlert({
        type: 'success',
        title: `${capability?.name ?? 'Hardware'} is ready`,
        message:
          code === 'barcode_scanner'
            ? 'Open Point of sale, scan a barcode into the search field, and send Enter.'
            : 'The device test completed successfully.',
      });
    },
    onError: (error) =>
      showAlert({
        type: 'error',
        title: 'Hardware test failed',
        message: error.message,
      }),
  });

  return (
    <Screen>
      <Header
        title="Hardware devices"
        subtitle="Optional capabilities for this organization and device"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      {query.isLoading ? (
        <LoadingState label="Checking hardware…" />
      ) : (
        <ScrollView contentContainerClassName="p-4 md:p-6 pb-12">
          <View className="w-full max-w-3xl self-center gap-5">
            {/* Informational banner */}
            <View className="flex-row items-center rounded-2xl border border-brand-200 bg-brand-50/80 p-4">
              <View className="mr-3.5 h-10 w-10 items-center justify-center rounded-xl bg-brand-100">
                <Text className="text-base font-black text-brand-800">⚡</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs font-bold text-brand-950">Hardware Integration Status</Text>
                <Text className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                  Modules are enabled by store administrators. Connect compatible drivers or devices to make them operational.
                </Text>
              </View>
            </View>

            {/* Capabilities list */}
            <View className="gap-4">
              {HARDWARE_CAPABILITIES.map((capability) => {
                const status = query.data?.find((item) => item.code === capability.code);
                const ready = status?.state === 'ready';
                const configured = status?.state === 'not_configured';
                const statusLabel = ready
                  ? 'Ready'
                  : configured
                    ? 'Driver required'
                    : 'Module disabled';
                return (
                  <View
                    key={capability.code}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="mr-3 flex-1 flex-row items-start">
                        <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                          <Text className="text-base font-black text-slate-700">{capability.symbol}</Text>
                        </View>
                        <View className="flex-1">
                          <View className="flex-row flex-wrap items-center gap-2">
                            <Text className="text-base font-bold text-slate-900">{capability.name}</Text>
                            <View
                              className={`rounded-full px-2.5 py-0.5 ${
                                ready
                                  ? 'bg-emerald-100'
                                  : configured
                                    ? 'bg-amber-100'
                                    : 'bg-slate-100'
                              }`}
                            >
                              <Text
                                className={`text-[11px] font-bold ${
                                  ready
                                    ? 'text-emerald-800'
                                    : configured
                                      ? 'text-amber-800'
                                      : 'text-slate-600'
                                }`}
                              >
                                {statusLabel}
                              </Text>
                            </View>
                          </View>
                          <Text className="mt-1 text-xs text-slate-500 leading-normal">
                            {capability.description}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Driver details */}
                    <View className="mt-3 rounded-xl bg-slate-50 p-3">
                      <Text className="text-xs font-semibold text-slate-800">
                        Driver: {status?.driverName ?? 'Standard Driver'}
                      </Text>
                      <Text className="mt-0.5 text-[11px] text-slate-500">{status?.detail}</Text>
                    </View>

                    {ready && capability.code !== 'receipt_printer' ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={test.isPending}
                        onPress={() => test.mutate(capability.code)}
                        className="mt-3.5 min-h-10 self-start flex-row items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-4 active:bg-brand-100"
                      >
                        <Text className="text-xs font-bold text-brand-800">Test Device</Text>
                      </Pressable>
                    ) : null}

                    {capability.code === 'receipt_printer' && status?.state !== 'unavailable' ? (
                      <ReceiptPrinterSetup
                        value={printerSettings}
                        onChange={setPrinterSettings}
                        onSave={() => savePrinter.mutate()}
                        onTest={() => test.mutate('receipt_printer')}
                        saving={savePrinter.isPending}
                        testing={test.isPending}
                        saveLabel={saveLabel}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Bottom Refresh */}
            <View className="mt-2 flex-row justify-end">
              <Button
                title={refresh.isPending ? 'Refreshing access…' : 'Refresh enabled modules'}
                variant="secondary"
                disabled={refresh.isPending}
                onPress={() => refresh.mutate()}
              />
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

export default function HardwareScreen() {
  return (
    <AppSidebarProvider>
      <HardwareContent />
    </AppSidebarProvider>
  );
}
