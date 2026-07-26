import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { EmptyState, Header, Screen } from '@/components/ui';

export default function BranchSelectionScreen() {
  const { currentUser, signOut } = useSession();
  const select = useBranchStore((state) => state.select);
  const branches = currentUser?.branches ?? [];
  return (
    <Screen>
      <Header
        title="Choose branch"
        subtitle={`${currentUser?.displayName ?? 'Signed-in user'} · Select where you are working today`}
      />
      <FlatList
        data={branches}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-5 gap-3"
        ListEmptyComponent={
          <EmptyState
            title="No assigned branches"
            message="Ask an administrator to assign your account."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Work at ${item.name}`}
            className="min-h-24 flex-row items-center rounded-2xl border border-brand-100 bg-white px-5 active:border-brand-300 active:bg-brand-50"
            onPress={async () => {
              await select(item);
              router.replace('/(tabs)');
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
      <View className="px-5 pb-5">
        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          className="min-h-12 items-center justify-center"
        >
          <Text className="font-bold text-slate-600">Not your account? Sign out</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
