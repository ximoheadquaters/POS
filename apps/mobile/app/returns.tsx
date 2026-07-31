import { Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Button, Header, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';
import { AppSidebarProvider } from '@/components/app-sidebar';

function ReturnsContent() {
  const { currentUser } = useSession();
  const isReturnsModuleEnabled = currentUser?.modules.includes('returns');

  if (!isReturnsModuleEnabled) {
    return (
      <Screen>
        <Header
          title="Returns"
          subtitle="Customer returns module"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <View className="flex-1 items-center justify-center p-8">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <Feather name="lock" size={26} color="#D97706" />
          </View>
          <Text className="mb-2 text-xl font-bold text-slate-900">Returns Module Disabled</Text>
          <Text className="mb-6 max-w-sm text-center text-sm text-slate-600">
            Customer returns are disabled for your organization. You can still inspect receipts in sales history.
          </Text>
          <Button title="View Sales History" onPress={() => router.push('/(tabs)/sales')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Returns"
        subtitle="Returns must reference an original completed sale."
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <View className="flex-1 items-center justify-center p-8">
        <Text className="mb-5 text-center text-slate-600">
          Find the receipt in sales history, open its details, then choose Return items.
        </Text>
        <Button title="Find a sale" onPress={() => router.push('/(tabs)/sales')} />
      </View>
    </Screen>
  );
}

export default function ReturnsScreen() {
  return (
    <AppSidebarProvider>
      <ReturnsContent />
    </AppSidebarProvider>
  );
}
