import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { FeatureAvailability } from '@/lib/feature-lock';
import { router } from 'expo-router';

export interface LockedFeatureModalProps {
  visible: boolean;
  featureName: string;
  description?: string;
  availability: FeatureAvailability;
  onClose(): void;
}

export function LockedFeatureModal({
  visible,
  featureName,
  description,
  availability,
  onClose,
}: LockedFeatureModalProps) {
  if (!visible || availability.state === 'available') return null;

  let statusText = '';
  let actionText: string | null = null;
  let actionHandler: (() => void) | null = null;

  if (availability.state === 'module_disabled') {
    statusText = `${availability.featureName} is not enabled for this organization.`;
    if (availability.canManageModules) {
      actionText = 'Manage Modules';
      actionHandler = () => {
        onClose();
        router.push('/organization');
      };
    }
  } else if (availability.state === 'plan_required') {
    statusText = `${availability.featureName} is available on the ${availability.requiredPlan} plan.`;
    if (availability.canManageBilling) {
      actionText = 'View Plan Options';
      actionHandler = () => {
        onClose();
        router.push('/organization');
      };
    }
  } else if (availability.state === 'permission_denied') {
    statusText = `You do not have permission to use ${availability.featureName}.`;
  } else if (availability.state === 'profile_not_applicable') {
    statusText = `${availability.featureName} is not applicable for your store profile.`;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityLabel={`Locked feature: ${featureName}`}
    >
      <View className="flex-1 items-center justify-center bg-slate-950/60 p-4">
        <View className="max-h-[90%] w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
          <ScrollView contentContainerClassName="gap-4">
            <View className="flex-row items-center justify-between">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
                <Feather name="lock" size={22} color="#D97706" />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close lock explanation"
                onPress={onClose}
                className="h-10 w-10 items-center justify-center rounded-full bg-slate-100 active:bg-slate-200"
              >
                <Feather name="x" size={18} color="#64748B" />
              </Pressable>
            </View>

            <View>
              <Text className="text-xl font-bold text-slate-900">{featureName}</Text>
              {description ? (
                <Text className="mt-1 text-sm text-slate-600">{description}</Text>
              ) : null}
            </View>

            <View className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                Access Status
              </Text>
              <Text className="mt-1 text-sm font-medium text-amber-950">{statusText}</Text>
            </View>

            <View className="mt-2 gap-2">
              {actionText && actionHandler ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={actionText}
                  onPress={actionHandler}
                  className="min-h-12 items-center justify-center rounded-xl bg-brand-700 px-4 active:bg-brand-800"
                >
                  <Text className="font-semibold text-white">{actionText}</Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                className="min-h-12 items-center justify-center rounded-xl bg-slate-100 px-4 active:bg-slate-200"
              >
                <Text className="font-semibold text-slate-700">Close</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
