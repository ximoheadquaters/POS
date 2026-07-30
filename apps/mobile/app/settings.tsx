import { Alert, ScrollView } from 'react-native';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { organizationSettingsSchema, type OrganizationSettingsInput } from '@ximo/shared';
import { api } from '@/lib/api';
import { Button, Field, Header, LoadingState, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';

import { AppSidebarProvider } from '@/components/app-sidebar';

function SettingsContent() {
  const { currentUser } = useSession();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<OrganizationSettingsInput>('/settings'),
  });
  const form = useForm<OrganizationSettingsInput>({
    resolver: zodResolver(organizationSettingsSchema),
    defaultValues: {
      businessName: '',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      taxRate: '12.00',
      receiptHeader: '',
      receiptFooter: '',
      allowNegativeInventory: false,
      paymentMethods: ['cash', 'card', 'ewallet'],
      targetMarginPercent: '25.00',
      lowMarginThresholdPercent: '15.00',
    },
  });
  useEffect(() => {
    if (query.data) form.reset(query.data);
  }, [form, query.data]);
  const save = useMutation({
    mutationFn: (input: OrganizationSettingsInput) =>
      api('/settings', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => Alert.alert('Settings saved'),
    onError: (error) => Alert.alert('Could not save settings', error.message),
  });
  if (query.isLoading)
    return (
      <Screen>
        <Header
          title="Settings"
          subtitle="Loading business configuration"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <LoadingState />
      </Screen>
    );
  const editable = currentUser?.permissions.includes('settings:manage') ?? false;
  return (
    <Screen>
      <Header
        title="Settings"
        subtitle={editable ? 'Business and checkout configuration' : 'Read only'}
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      <ScrollView contentContainerClassName="p-5 pb-10">
        {(
          [
            ['businessName', 'Business name'],
            ['currency', 'Currency'],
            ['timezone', 'Timezone'],
            ['taxRate', 'Default tax rate (%)'],
            ['targetMarginPercent', 'Target gross margin (%)'],
            ['lowMarginThresholdPercent', 'Low-margin warning below (%)'],
            ['receiptHeader', 'Receipt header'],
            ['receiptFooter', 'Receipt footer'],
          ] as const
        ).map(([name, label]) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <Field
                label={label}
                value={field.value}
                editable={editable}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
        {editable ? (
          <Button
            title={save.isPending ? 'Saving…' : 'Save settings'}
            disabled={save.isPending}
            onPress={form.handleSubmit((value) => save.mutate(value))}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function SettingsScreen() {
  return (
    <AppSidebarProvider>
      <SettingsContent />
    </AppSidebarProvider>
  );
}
