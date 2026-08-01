import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  organizationProfileSchema,
  type ModuleCode,
  type OrganizationProfileInput,
} from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import {
  cacheRemoteOrganizationLogo,
  getCachedOrganizationLogo,
  removeCachedOrganizationLogo,
  saveCachedOrganizationLogo,
} from '@/lib/organization-logo';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';

interface OrganizationDetails extends OrganizationProfileInput {
  id: string;
  slug: string;
  createdAt: string;
  subscriptionStatus?: string;
  planCode?: string | null;
  planName?: string | null;
  branchCount?: number;
  activeBranchCount?: number;
  userCount?: number;
  activeUserCount?: number;
  enabledModules?: ModuleCode[];
  branches?: Array<{
    id: string;
    name: string;
    code: string;
    isActive: boolean;
  }>;
}

interface OrganizationUserSummary {
  id: string;
  isActive: boolean;
}

function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <View className="min-w-40 flex-1 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
        <Feather name={icon} size={17} color="#1A593B" />
      </View>
      <Text className="mt-3 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </Text>
      <Text className="mt-1 text-xl font-semibold text-slate-950">{value}</Text>
      <Text className="mt-1 text-xs text-slate-500">{note}</Text>
    </View>
  );
}

function OrganizationContent() {
  const { currentUser, refreshUser } = useSession();
  const activeBranch = useBranchStore((state) => state.activeBranch);
  const queryClient = useQueryClient();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pendingLogo, setPendingLogo] = useState<{ base64: string; dataUrl: string } | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [pickingLogo, setPickingLogo] = useState(false);
  const editable = currentUser?.permissions?.includes('organization:update') ?? false;
  const query = useQuery({
    queryKey: ['organization', 'current'],
    queryFn: () => api<OrganizationDetails>('/organizations/current'),
  });
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<OrganizationUserSummary[]>('/users'),
    enabled: currentUser?.permissions?.includes('users:read') ?? false,
  });
  const form = useForm<OrganizationProfileInput>({
    resolver: zodResolver(organizationProfileSchema),
    defaultValues: {
      name: '',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      logoPath: null,
    },
  });
  useEffect(() => {
    if (!query.data) return;
    form.reset({
      name: query.data.name ?? '',
      currency: query.data.currency ?? 'PHP',
      timezone: query.data.timezone ?? 'Asia/Manila',
      logoPath: query.data.logoPath ?? null,
    });
  }, [form, query.data]);
  const organizationId = query.data?.id ?? currentUser?.organization.id;
  useEffect(() => {
    if (!organizationId || pendingLogo || logoRemoved) return;
    let active = true;
    const remoteUrl = query.data?.logoPath?.trim() || null;
    void getCachedOrganizationLogo(organizationId).then(async (cached) => {
      if (!active) return;
      if (cached && (!remoteUrl || cached.remoteUrl === remoteUrl)) {
        setLogoPreview(cached.dataUrl);
        return;
      }
      setLogoPreview(remoteUrl);
      if (!remoteUrl) return;
      const localCopy = await cacheRemoteOrganizationLogo(organizationId, remoteUrl);
      if (active && localCopy) setLogoPreview(localCopy);
    });
    return () => {
      active = false;
    };
  }, [logoRemoved, organizationId, pendingLogo, query.data?.logoPath]);

  async function chooseLogo() {
    if (!editable || pickingLogo) return;
    setPickingLogo(true);
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Photo access needed', 'Allow photo access to choose an organization logo.');
          return;
        }
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (selection.canceled) return;
      const compressed = await ImageManipulator.manipulateAsync(
        selection.assets[0]!.uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!compressed.base64) throw new Error('The selected image could not be processed.');
      const dataUrl = `data:image/jpeg;base64,${compressed.base64}`;
      setPendingLogo({ base64: compressed.base64, dataUrl });
      setLogoRemoved(false);
      setLogoPreview(dataUrl);
    } catch (error) {
      Alert.alert(
        'Could not select logo',
        error instanceof Error ? error.message : 'The selected image could not be processed.',
      );
    } finally {
      setPickingLogo(false);
    }
  }

  function removeLogo() {
    setPendingLogo(null);
    setLogoRemoved(true);
    setLogoPreview(null);
    form.setValue('logoPath', null, { shouldDirty: true });
  }
  const save = useMutation({
    mutationFn: async (input: OrganizationProfileInput) => {
      let logoPath = logoRemoved ? null : input.logoPath?.trim() || null;
      if (pendingLogo) {
        const uploaded = await api<{ logoPath: string }>('/organizations/current/logo', {
          method: 'POST',
          body: JSON.stringify({ mimeType: 'image/jpeg', base64: pendingLogo.base64 }),
        });
        logoPath = uploaded.logoPath;
      }
      const profile = await api<OrganizationProfileInput>('/organizations/current', {
        method: 'PUT',
        body: JSON.stringify({
          ...input,
          logoPath,
        }),
      });
      return { profile, logoPath, localLogo: pendingLogo?.dataUrl ?? null };
    },
    onSuccess: async (result) => {
      if (organizationId) {
        if (result.logoPath && result.localLogo) {
          await saveCachedOrganizationLogo(organizationId, {
            remoteUrl: result.logoPath,
            dataUrl: result.localLogo,
          });
        } else if (!result.logoPath) {
          await removeCachedOrganizationLogo(organizationId);
        }
      }
      setPendingLogo(null);
      setLogoRemoved(false);
      form.setValue('logoPath', result.logoPath);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organization', 'current'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        refreshUser(),
      ]);
      Alert.alert('Organization updated', 'The business identity is now updated for every branch.');
    },
    onError: (error) => Alert.alert('Could not update organization', error.message),
  });
  const enabledModules = Array.isArray(query.data?.enabledModules)
    ? query.data.enabledModules
    : (currentUser?.modules ?? []);
  const fallbackBranches =
    currentUser?.branches?.length
      ? currentUser.branches
      : activeBranch
        ? [activeBranch]
        : [];
  const branches =
    Array.isArray(query.data?.branches) && query.data.branches.length > 0
      ? query.data.branches
      : fallbackBranches.map((branch) => ({ ...branch, isActive: true }));
  const activeBranchCount = Math.max(
    query.data?.activeBranchCount ?? 0,
    branches.filter((branch) => branch.isActive).length,
  );
  const branchCount = Math.max(query.data?.branchCount ?? 0, branches.length);
  const listedUsers = Array.isArray(usersQuery.data) ? usersQuery.data : [];
  const listedActiveUsers = listedUsers.filter((user) => user.isActive).length;
  const activeUserCount = Math.max(
    query.data?.activeUserCount ?? 0,
    listedActiveUsers,
    currentUser ? 1 : 0,
  );
  const userCount = Math.max(query.data?.userCount ?? 0, listedUsers.length, activeUserCount);

  return (
    <Screen>
      <Header
        title="Organization"
        subtitle="Tenant identity, subscription and access boundary"
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
      />
      {query.isLoading ? (
        <LoadingState label="Loading organization…" />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : query.data ? (
        <ScrollView contentContainerClassName="items-center p-4 pb-12">
          <View className="w-full max-w-5xl gap-5">
            <View className="flex-row items-start rounded-2xl border border-brand-100 bg-brand-50 p-4">
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white">
                <Feather name="shield" size={18} color="#1A593B" />
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-brand-950">
                  Your organization is your data boundary
                </Text>
                <Text className="mt-1 text-sm leading-5 text-brand-800">
                  Users, branches, products, inventory and sales under this organization are kept
                  separate from every other Ximo business.
                </Text>
              </View>
            </View>

            <View className="flex-row flex-wrap gap-3">
              <Metric
                icon="credit-card"
                label="Plan"
                value={query.data.planName || query.data.planCode || 'No plan'}
                note={(query.data.subscriptionStatus ?? 'Not configured').replaceAll('_', ' ')}
              />
              <Metric
                icon="map-pin"
                label="Branches"
                value={String(activeBranchCount)}
                note={`${branchCount} total`}
              />
              <Metric
                icon="users"
                label="Users"
                value={String(activeUserCount)}
                note={`${userCount} total`}
              />
              <Metric
                icon="grid"
                label="Modules"
                value={String(enabledModules.length)}
                note="Enabled for this organization"
              />
            </View>

            <View className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <View className="flex-row items-start border-b border-slate-100 p-5">
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Feather name="briefcase" size={18} color="#1A593B" />
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-slate-950">Organization identity</Text>
                  <Text className="mt-1 text-sm text-slate-500">
                    These details apply across every branch and user session.
                  </Text>
                </View>
              </View>
              <View className="gap-4 p-5">
                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field
                      label="Organization name"
                      value={field.value}
                      editable={editable}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <View className="gap-4 md:flex-row">
                  <View className="flex-1">
                    <Controller
                      control={form.control}
                      name="currency"
                      render={({ field, fieldState }) => (
                        <Field
                          label="Currency"
                          value={field.value}
                          editable={editable}
                          autoCapitalize="characters"
                          onChangeText={field.onChange}
                          onBlur={field.onBlur}
                          error={fieldState.error?.message}
                        />
                      )}
                    />
                  </View>
                  <View className="flex-1">
                    <Controller
                      control={form.control}
                      name="timezone"
                      render={({ field, fieldState }) => (
                        <Field
                          label="Timezone"
                          value={field.value}
                          editable={editable}
                          onChangeText={field.onChange}
                          onBlur={field.onBlur}
                          error={fieldState.error?.message}
                        />
                      )}
                    />
                  </View>
                </View>
                <View>
                  <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-700">
                    Organization logo
                  </Text>
                  <View className="flex-row items-center rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose organization logo"
                      disabled={!editable || pickingLogo}
                      onPress={() => void chooseLogo()}
                      className="h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    >
                      {logoPreview ? (
                        <Image
                          source={{ uri: logoPreview }}
                          resizeMode="contain"
                          className="h-full w-full"
                        />
                      ) : (
                        <Feather name="image" size={26} color="#94A3B8" />
                      )}
                    </Pressable>
                    <View className="ml-4 flex-1">
                      <Text className="font-medium text-slate-900">
                        {pickingLogo
                          ? 'Preparing image…'
                          : logoPreview
                            ? 'Logo ready'
                            : 'Add your business logo'}
                      </Text>
                      <Text className="mt-1 text-xs leading-5 text-slate-500">
                        Choose a JPG, PNG, or WebP image. Ximo compresses it and keeps a local copy
                        so it remains visible offline.
                      </Text>
                      {editable ? (
                        <View className="mt-3 flex-row flex-wrap gap-2">
                          <Pressable
                            disabled={pickingLogo}
                            onPress={() => void chooseLogo()}
                            className="min-h-10 flex-row items-center justify-center rounded-xl bg-brand-700 px-4"
                          >
                            <Feather name="upload" size={14} color="#FFFFFF" />
                            <Text className="ml-2 text-xs font-medium text-white">
                              {logoPreview ? 'Replace image' : 'Choose image'}
                            </Text>
                          </Pressable>
                          {logoPreview ? (
                            <Pressable
                              disabled={pickingLogo}
                              onPress={removeLogo}
                              className="min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-4"
                            >
                              <Text className="text-xs font-medium text-red-600">Remove</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                {editable ? (
                  <Button
                    title={save.isPending ? 'Saving…' : 'Save organization'}
                    disabled={save.isPending || pickingLogo}
                    onPress={form.handleSubmit((value) => save.mutate(value))}
                  />
                ) : (
                  <Text className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                    Your role can view organization details but cannot change them.
                  </Text>
                )}
              </View>
            </View>

            <View className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <View className="border-b border-slate-100 p-5">
                <Text className="font-semibold text-slate-950">Organization identifiers</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Use the organization ID when contacting support or reviewing integrations.
                </Text>
              </View>
              <View className="gap-3 p-5">
                <View className="rounded-xl bg-slate-50 p-3">
                  <Text className="text-xs uppercase tracking-wider text-slate-500">Slug</Text>
                  <Text selectable className="mt-1 font-medium text-slate-800">
                    {query.data.slug}
                  </Text>
                </View>
                <View className="rounded-xl bg-slate-50 p-3">
                  <Text className="text-xs uppercase tracking-wider text-slate-500">
                    Organization ID
                  </Text>
                  <Text selectable className="mt-1 font-medium text-slate-800">
                    {query.data.id}
                  </Text>
                </View>
              </View>
            </View>

            <View className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <View className="flex-row items-center border-b border-slate-100 p-5">
                <View className="flex-1">
                  <Text className="font-semibold text-slate-950">Branches</Text>
                  <Text className="mt-1 text-sm text-slate-500">
                    All locations belonging to this organization.
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push('/branch-select')}
                  className="min-h-10 flex-row items-center rounded-xl bg-brand-50 px-3"
                >
                  <Text className="text-xs font-medium text-brand-700">Switch branch</Text>
                </Pressable>
              </View>
              <View>
                {branches.map((branch, index) => (
                  <View
                    key={branch.id}
                    className={`flex-row items-center p-4 ${index ? 'border-t border-slate-100' : ''}`}
                  >
                    <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                      <Feather name="map-pin" size={16} color="#64748B" />
                    </View>
                    <View className="flex-1">
                      <Text className="font-medium text-slate-900">{branch.name}</Text>
                      <Text className="mt-1 text-xs text-slate-500">{branch.code}</Text>
                    </View>
                    <Text
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        branch.isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                ))}
                {branches.length === 0 ? (
                  <View className="p-5">
                    <Text className="text-sm text-slate-500">
                      Branch details are unavailable until the API service is restarted or updated.
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View className="gap-3 md:flex-row">
              {currentUser?.permissions?.includes('users:read') ? (
                <Pressable
                  onPress={() => router.push('/users')}
                  className="min-h-14 flex-1 flex-row items-center justify-center rounded-xl border border-slate-200 bg-white px-4"
                >
                  <Feather name="users" size={16} color="#1A593B" />
                  <Text className="ml-2 font-medium text-brand-700">Manage users and roles</Text>
                </Pressable>
              ) : null}
              {currentUser?.permissions?.includes('settings:manage') ? (
                <Pressable
                  onPress={() => router.push('/settings')}
                  className="min-h-14 flex-1 flex-row items-center justify-center rounded-xl border border-slate-200 bg-white px-4"
                >
                  <Feather name="settings" size={16} color="#1A593B" />
                  <Text className="ml-2 font-medium text-brand-700">Business settings</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

export default function OrganizationScreen() {
  return (
    <AppSidebarProvider>
      <OrganizationContent />
    </AppSidebarProvider>
  );
}
