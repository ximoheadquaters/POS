import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createEmployeeSchema,
  type CreateEmployeeInput,
  type EmployeeRoleCode,
} from '@ximo/shared';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, Field, Header, Screen } from '@/components/ui';
import { useSession } from '@/providers/session';

const roleOptions: Array<{
  code: EmployeeRoleCode;
  label: string;
  description: string;
}> = [
  {
    code: 'manager',
    label: 'Manager',
    description: 'Manages daily operations, employees, products, inventory, and reports.',
  },
  {
    code: 'cashier',
    label: 'Cashier',
    description: 'Opens a register shift, checks out sales, and handles branch returns.',
  },
  {
    code: 'inventory_staff',
    label: 'Inventory staff',
    description: 'Maintains products and stock without access to checkout or reports.',
  },
];

function EmployeeFormContent() {
  const { currentUser } = useSession();
  const queryClient = useQueryClient();
  const branches = currentUser?.branches ?? [];
  const allowedRoles =
    currentUser?.role === 'manager'
      ? roleOptions.filter((option) => option.code !== 'manager')
      : roleOptions;
  const form = useForm<z.input<typeof createEmployeeSchema>, unknown, CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      displayName: '',
      email: '',
      temporaryPassword: '',
      role: 'cashier',
      branchIds: branches.length === 1 ? [branches[0]!.id] : [],
    },
  });
  const selectedRole = form.watch('role');
  const selectedBranches = form.watch('branchIds');
  const mutation = useMutation({
    mutationFn: (input: CreateEmployeeInput) =>
      api('/users', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      router.back();
      Alert.alert(
        'Employee created',
        'The employee can now sign in with their email and initial password.',
      );
    },
    onError: (error) => Alert.alert('Could not create employee', error.message),
  });

  const toggleBranch = (branchId: string) => {
    const next = selectedBranches.includes(branchId)
      ? selectedBranches.filter((id) => id !== branchId)
      : [...selectedBranches, branchId];
    form.setValue('branchIds', next, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Screen>
      <Header
        title="Add employee"
        subtitle="Create a secure account and assign where they can work."
        showBack
        backLabel="Users"
        fallbackHref="/users"
      />
      <ScrollView contentContainerClassName="px-4 py-6 pb-12">
        <View className="w-full max-w-3xl self-center">
          <Controller
            control={form.control}
            name="displayName"
            render={({ field, fieldState }) => (
              <Field
                label="Employee name"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="words"
                placeholder="Juan Dela Cruz"
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field
                label="Login email"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="cashier@business.com"
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="temporaryPassword"
            render={({ field, fieldState }) => (
              <Field
                label="Initial password"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="At least 12 characters"
                error={fieldState.error?.message}
              />
            )}
          />
          <View className="mb-6 rounded-2xl bg-brand-50 p-4">
            <Text className="font-bold text-brand-900">Share the password securely</Text>
            <Text className="mt-1 text-sm leading-5 text-slate-600">
              Do not send employee passwords in a public group chat or write them on the register.
            </Text>
          </View>

          <Text className="mb-2 text-sm font-medium text-slate-700">Role</Text>
          <View className="mb-2 gap-3">
            {allowedRoles.map((option) => {
              const selected = selectedRole === option.code;
              return (
                <Pressable
                  key={option.code}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() =>
                    form.setValue('role', option.code, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  className={`rounded-2xl border p-4 ${
                    selected
                      ? 'border-brand-700 bg-brand-50'
                      : 'border-slate-200 bg-white active:border-brand-300'
                  }`}
                >
                  <View className="flex-row items-center">
                    <View
                      className={`mr-3 h-5 w-5 rounded-full border-2 ${
                        selected ? 'border-brand-700 bg-brand-700' : 'border-slate-300'
                      }`}
                    />
                    <Text className="font-bold text-slate-900">{option.label}</Text>
                  </View>
                  <Text className="ml-8 mt-1 text-sm leading-5 text-slate-500">
                    {option.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {form.formState.errors.role ? (
            <Text className="mb-4 text-sm text-red-600">{form.formState.errors.role.message}</Text>
          ) : null}

          <Text className="mb-2 mt-4 text-sm font-medium text-slate-700">Assigned branches</Text>
          <Text className="mb-3 text-sm leading-5 text-slate-500">
            Select at least one branch where this employee is allowed to work.
          </Text>
          <View className="mb-2 gap-3">
            {branches.map((branch) => {
              const selected = selectedBranches.includes(branch.id);
              return (
                <Pressable
                  key={branch.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleBranch(branch.id)}
                  className={`min-h-16 flex-row items-center rounded-2xl border px-4 ${
                    selected
                      ? 'border-brand-700 bg-brand-50'
                      : 'border-slate-200 bg-white active:border-brand-300'
                  }`}
                >
                  <View
                    className={`mr-3 h-6 w-6 items-center justify-center rounded-lg border ${
                      selected ? 'border-brand-700 bg-brand-700' : 'border-slate-300'
                    }`}
                  >
                    {selected ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                  </View>
                  <View className="flex-1">
                    <Text className="font-bold text-slate-900">{branch.name}</Text>
                    <Text className="mt-0.5 text-xs font-bold text-brand-600">{branch.code}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {form.formState.errors.branchIds ? (
            <Text className="mb-4 text-sm text-red-600">
              {form.formState.errors.branchIds.message}
            </Text>
          ) : null}

          <View className="mt-5">
            <Button
              title={mutation.isPending ? 'Creating employee…' : 'Create employee'}
              disabled={mutation.isPending}
              onPress={form.handleSubmit((input) => mutation.mutate(input))}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function EmployeeFormScreen() {
  return (
    <AppSidebarProvider>
      <EmployeeFormContent />
    </AppSidebarProvider>
  );
}
