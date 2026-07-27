import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { HardwareModuleCode } from '@ximo/shared';
import { Button, Header, LoadingState, Screen } from '@/components/ui';
import { HARDWARE_CAPABILITIES } from '@/hardware/capabilities';
import { getHardwareDriver, getHardwareStatuses } from '@/hardware/registry';
import { useSession } from '@/providers/session';

export default function HardwareScreen() {
  const { currentUser, refreshUser } = useSession();
  const modules = currentUser?.modules ?? [];
  const query = useQuery({
    queryKey: ['hardware-status', [...modules].sort().join(',')],
    queryFn: () => getHardwareStatuses(modules),
  });
  const refresh = useMutation({
    mutationFn: async () => {
      await refreshUser();
      await query.refetch();
    },
    onError: (error) => Alert.alert('Could not refresh hardware modules', error.message),
  });
  const test = useMutation({
    mutationFn: async (code: HardwareModuleCode) => {
      await getHardwareDriver(code).test();
      return code;
    },
    onSuccess: (code) => {
      const capability = HARDWARE_CAPABILITIES.find((item) => item.code === code);
      Alert.alert(
        `${capability?.name ?? 'Hardware'} is ready`,
        code === 'barcode_scanner'
          ? 'Open Point of sale, scan a barcode into the search field, and send Enter.'
          : 'The device test completed successfully.',
      );
    },
    onError: (error) => Alert.alert('Hardware test failed', error.message),
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
        <ScrollView contentContainerClassName="p-5 pb-10">
          <View className="mb-5 rounded-2xl bg-brand-50 p-4">
            <Text className="font-bold text-brand-900">Safe until hardware is connected</Text>
            <Text className="mt-1 text-sm leading-5 text-slate-600">
              A platform administrator enables each module for the organization. The feature becomes
              operational only when this device also has a compatible driver.
            </Text>
          </View>

          <View className="gap-3">
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
                  className="rounded-2xl border border-slate-100 bg-white p-4"
                >
                  <View className="flex-row items-start">
                    <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                      <Text className="font-black text-brand-700">{capability.symbol}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-bold text-slate-900">{capability.name}</Text>
                      <Text className="mt-1 text-sm leading-5 text-slate-500">
                        {capability.description}
                      </Text>
                    </View>
                  </View>
                  <View
                    className={`mt-4 rounded-xl p-3 ${
                      ready ? 'bg-emerald-50' : configured ? 'bg-amber-50' : 'bg-slate-100'
                    }`}
                  >
                    <Text
                      className={`text-sm font-bold ${
                        ready
                          ? 'text-emerald-800'
                          : configured
                            ? 'text-amber-800'
                            : 'text-slate-600'
                      }`}
                    >
                      {statusLabel} · {status?.driverName}
                    </Text>
                    <Text className="mt-1 text-xs leading-4 text-slate-600">{status?.detail}</Text>
                  </View>
                  {ready ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={test.isPending}
                      onPress={() => test.mutate(capability.code)}
                      className="mt-3 min-h-11 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-4 active:bg-brand-100"
                    >
                      <Text className="font-bold text-brand-700">Test device</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View className="mt-5">
            <Button
              title={refresh.isPending ? 'Refreshing access…' : 'Refresh enabled modules'}
              variant="secondary"
              disabled={refresh.isPending}
              onPress={() => refresh.mutate()}
            />
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
