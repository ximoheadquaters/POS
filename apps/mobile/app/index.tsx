import { useEffect } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

export default function SplashScreen() {
  const { session, currentUser, loading } = useSession();
  const activeBranch = useBranchStore((state) => state.activeBranch);
  const hydrated = useBranchStore((state) => state.hydrated);
  const hydrate = useBranchStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loading || !hydrated) return;
    if (!session) router.replace('/(auth)/login');
    else if (!currentUser || !activeBranch) router.replace('/branch-select');
    else router.replace('/(tabs)');
  }, [activeBranch, currentUser, hydrated, loading, session]);

  return (
    <View className="flex-1 items-center justify-center bg-brand-700">
      <View className="h-20 w-20 items-center justify-center rounded-3xl bg-white">
        <Text className="text-4xl font-black text-brand-700">X</Text>
      </View>
      <Text className="mt-5 text-2xl font-bold text-white">Ximo POS</Text>
      <Text className="mt-2 text-brand-100">Preparing your workspace…</Text>
    </View>
  );
}
