import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ReportErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View className="flex-1 items-center justify-center bg-[#F8F9FA] p-6">
        <View className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-5">
          <Text className="text-lg font-bold text-slate-900">Could not display this report</Text>
          <Text selectable className="mt-2 text-sm text-slate-600">{this.state.error.message}</Text>
          <Text className="mt-2 text-xs text-slate-500">No sale or report data was changed.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(tabs)/more')}
            className="mt-5 min-h-11 items-center justify-center rounded-xl bg-brand-700 px-4"
          >
            <Text className="font-semibold text-white">Back to More</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}
