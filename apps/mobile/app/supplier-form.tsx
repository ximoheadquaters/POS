import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, Field, Header, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useBranchStore } from '@/store/branch';

function SupplierFormContent() {
  const branch = useBranchStore((state) => state.activeBranch);
  const params = useLocalSearchParams<{
    id?: string;
    name?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    notes?: string;
    isActive?: string;
  }>();
  const editing = Boolean(params.id);
  const client = useQueryClient();
  const [name, setName] = useState(params.name ?? '');
  const [contactName, setContactName] = useState(params.contactName ?? '');
  const [email, setEmail] = useState(params.email ?? '');
  const [phone, setPhone] = useState(params.phone ?? '');
  const [address, setAddress] = useState(params.address ?? '');
  const [taxId, setTaxId] = useState(params.taxId ?? '');
  const [notes, setNotes] = useState(params.notes ?? '');
  const [isActive, setIsActive] = useState(params.isActive !== 'false');
  const save = useMutation({
    mutationFn: () =>
      api(params.id ? `/suppliers/${params.id}` : '/suppliers', {
        method: params.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          branchId: branch!.id,
          name,
          contactName,
          email,
          phone,
          address,
          taxId,
          notes,
          isActive,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['suppliers'] });
      router.back();
    },
    onError: (error) => Alert.alert('Could not save supplier', error.message),
  });
  return (
    <Screen>
      <Header
        title={editing ? 'Edit supplier' : 'New supplier'}
        subtitle="Contact and ordering information"
        showBack
        backLabel="Purchasing"
        fallbackHref="/purchasing"
      />
      <ScrollView contentContainerClassName="items-center p-4 pb-12">
        <View className="w-full max-w-3xl gap-5">
          <View className="rounded-2xl border border-slate-200 bg-white p-5">
            <View className="mb-5 flex-row items-center">
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <Feather name="truck" size={18} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-slate-900">Supplier details</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Only the supplier name is required.
                </Text>
              </View>
            </View>
            <Field label="Supplier name *" value={name} onChangeText={setName} />
            <View className="flex-row flex-wrap gap-x-4">
              <View className="min-w-64 flex-1">
                <Field label="Contact person" value={contactName} onChangeText={setContactName} />
              </View>
              <View className="min-w-64 flex-1">
                <Field
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>
            <View className="flex-row flex-wrap gap-x-4">
              <View className="min-w-64 flex-1">
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View className="min-w-64 flex-1">
                <Field label="Tax ID / TIN" value={taxId} onChangeText={setTaxId} />
              </View>
            </View>
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={3}
            />
            <Field
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: isActive }}
            onPress={() => setIsActive((value) => !value)}
            className="flex-row items-center rounded-2xl border border-slate-200 bg-white p-5"
          >
            <View
              className={`mr-3 h-7 w-12 justify-center rounded-full px-1 ${
                isActive ? 'items-end bg-brand-700' : 'items-start bg-slate-300'
              }`}
            >
              <View className="h-5 w-5 rounded-full bg-white" />
            </View>
            <View className="flex-1">
              <Text className="font-medium text-slate-900">Supplier is active</Text>
              <Text className="mt-1 text-sm text-slate-500">
                Disabled suppliers remain in history but cannot be selected for new orders.
              </Text>
            </View>
          </Pressable>
          <View className="flex-row justify-end gap-3">
            <View className="min-w-32">
              <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
            </View>
            <View className="min-w-52">
              <Button
                title={save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
                disabled={save.isPending || name.trim().length < 2}
                onPress={() => save.mutate()}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function SupplierFormScreen() {
  return (
    <AppSidebarProvider>
      <SupplierFormContent />
    </AppSidebarProvider>
  );
}
