import { useState } from 'react';
import { appAlert } from '@/providers/ios-alert';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { EmptyState, Header, OfflineState, Screen } from '@/components/ui';

interface RegisterStatus {
  id: string;
  name: string;
  activeShiftId?: string;
  activeCashierId?: string;
}

export default function BranchSelectionScreen() {
  const { currentUser, refreshUser, signOut } = useSession();
  const select = useBranchStore((state) => state.select);
  const setActiveShift = useShiftStore((state) => state.setActive);
  const clearShift = useShiftStore((state) => state.clear);
  const [selectingBranchId, setSelectingBranchId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retryingWorkspace, setRetryingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const branches = currentUser?.branches ?? [];

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await clearShift();
      await signOut();
    } catch {
      // SessionProvider still clears local credentials in its sign-out cleanup.
    } finally {
      router.replace('/(auth)/login');
    }
  }

  function retryWorkspace() {
    if (retryingWorkspace) return;
    setRetryingWorkspace(true);
    setWorkspaceError('');
    void refreshUser()
      .catch((error) => {
        setWorkspaceError(
          error instanceof Error ? error.message : 'The POS server is still unavailable.',
        );
      })
      .finally(() => setRetryingWorkspace(false));
  }

  if (signingOut) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-8">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
            <ActivityIndicator size="small" color="#1A593B" />
          </View>
          <View className="items-center gap-1">
            <Text className="text-lg font-semibold text-slate-900">Signing you out…</Text>
            <Text className="text-sm text-slate-500">Clearing this device securely.</Text>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Choose Branch"
        subtitle={`${currentUser?.displayName ?? 'Signed-in user'} · Select where you are working today`}
      />
      {!currentUser ? (
        <OfflineState
          title={retryingWorkspace ? 'Reconnecting to your workspace…' : 'Workspace unavailable'}
          message={
            workspaceError ||
            'The POS server is unavailable. Your account and branch list will return when it reconnects.'
          }
          retry={retryWorkspace}
        />
      ) : (
        <FlatList
          data={branches}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-5 gap-3"
          ListEmptyComponent={
            <EmptyState
              title="No Assigned Branches"
              message="Ask an administrator to assign your account."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Work at ${item.name}`}
              accessibilityState={{ disabled: selectingBranchId !== null }}
              disabled={selectingBranchId !== null}
              className="min-h-24 flex-row items-center rounded-2xl border border-brand-100 bg-white px-5 active:border-brand-300 active:bg-brand-50"
              onPress={async () => {
                if (!currentUser) return;
                setSelectingBranchId(item.id);
                try {
                  if (
                    currentUser.modules.includes('registers') &&
                    currentUser.permissions.includes('registers:read')
                  ) {
                    const registers = await api<RegisterStatus[]>(`/registers?branchId=${item.id}`);
                    const activeRegister = registers.find(
                      (register) =>
                        register.activeShiftId && register.activeCashierId === currentUser.id,
                    );
                    if (activeRegister?.activeShiftId) {
                      await setActiveShift({
                        id: activeRegister.activeShiftId,
                        registerId: activeRegister.id,
                        registerName: activeRegister.name,
                        branchId: item.id,
                      });
                    } else {
                      await clearShift();
                    }
                  } else {
                    await clearShift();
                  }
                  await select(item);
                  router.replace('/(tabs)');
                } catch (error) {
                  appAlert(
                    'Could not select branch',
                    error instanceof Error ? error.message : 'Please try again.',
                  );
                } finally {
                  setSelectingBranchId(null);
                }
              }}
            >
              <View className="mr-4 h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                <Text className="text-lg font-black text-brand-700">{item.code.slice(0, 2)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-lg font-bold text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-sm font-medium text-brand-700">{item.code}</Text>
              </View>
              <Text className="text-2xl font-bold text-brand-700">{'\u203A'}</Text>
            </Pressable>
          )}
        />
      )}
      <View className="px-5 pb-5">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: signingOut }}
          disabled={signingOut}
          onPress={() => void handleSignOut()}
          className="min-h-12 items-center justify-center"
        >
          <Text className="font-bold text-slate-600">Not your account? Sign out</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
