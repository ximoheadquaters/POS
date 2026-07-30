import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Header, Screen } from '@/components/ui';

import { AppSidebarProvider } from '@/components/app-sidebar';

function ReturnsContent() {
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
