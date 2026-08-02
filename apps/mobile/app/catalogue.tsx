import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/providers/session';

type Section = 'categories' | 'brands' | 'units';

interface MasterItem {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  code?: string;
  kind?: 'discrete' | 'decimal';
  defaultStep?: number;
  isSystem?: boolean;
}

interface SectionDefinition {
  key: Section;
  label: string;
  singular: string;
  endpoint: string;
  icon: 'folder' | 'award' | 'box';
  description: string;
}

const sections: SectionDefinition[] = [
  {
    key: 'categories',
    label: 'Categories',
    singular: 'Category',
    endpoint: '/categories',
    icon: 'folder',
    description: 'Group products for faster browsing, POS filtering, and reporting.',
  },
  {
    key: 'brands',
    label: 'Brands',
    singular: 'Brand',
    endpoint: '/brands',
    icon: 'award',
    description: 'Organize products by manufacturer or store brand.',
  },
];

function CatalogueContent() {
  const { currentUser } = useSession();
  const editable = currentUser?.permissions.includes('products:manage') ?? false;
  const client = useQueryClient();
  const [section, setSection] = useState<Section>('categories');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'discrete' | 'decimal'>('discrete');
  const [step, setStep] = useState('1');
  const selected = sections.find((item) => item.key === section)!;

  const query = useQuery({
    queryKey: ['catalogue', section],
    queryFn: () => api<MasterItem[]>(selected.endpoint),
  });

  const clearForm = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setCode('');
    setKind('discrete');
    setStep('1');
  };

  const closeForm = () => {
    setFormOpen(false);
    clearForm();
  };

  const openCreate = () => {
    clearForm();
    setFormOpen(true);
  };

  const openEdit = (item: MasterItem) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description ?? '');
    setCode(item.code ?? '');
    setKind(item.kind ?? 'discrete');
    setStep(String(item.defaultStep ?? 1));
    setFormOpen(true);
  };

  const changeSection = (nextSection: Section) => {
    setSection(nextSection);
    setSearch('');
    closeForm();
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        isActive: editing?.isActive ?? true,
      };
      return api(editing ? `${selected.endpoint}/${editing.id}` : selected.endpoint, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      closeForm();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['catalogue', section] }),
        client.invalidateQueries({ queryKey: [section] }),
      ]);
    },
    onError: (error) => Alert.alert('Could not save', error.message),
  });

  const toggle = useMutation({
    mutationFn: (item: MasterItem) =>
      api(`${selected.endpoint}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !item.isActive }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['catalogue', section] }),
    onError: (error) => Alert.alert('Could not update', error.message),
  });

  const data = useMemo(() => query.data ?? [], [query.data]);
  const filteredData = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((item) =>
      [item.name, item.description].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
  }, [data, search]);
  const activeCount = data.filter((item) => item.isActive).length;
  const inactiveCount = data.length - activeCount;
  const validStep = Number.isFinite(Number(step)) && Number(step) > 0;
  const canSave = Boolean(name.trim());

  return (
    <Screen>
      <Header
        title="Product catalogue"
        subtitle="Categories and brands"
        showBack
        backLabel="Products"
        fallbackHref="/products"
      />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-4 pb-12">
        <View className="w-full max-w-5xl self-center gap-4">
          <View className="rounded-2xl border border-slate-200 bg-white p-1">
            <View className="flex-row gap-1">
              {sections.map((item) => {
                const active = section === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => changeSection(item.key)}
                    className={`min-h-11 flex-1 flex-row items-center justify-center rounded-xl px-2 ${
                      active ? 'bg-brand-700' : 'active:bg-slate-100'
                    }`}
                  >
                    <Feather name={item.icon} size={15} color={active ? '#FFFFFF' : '#64748B'} />
                    <Text
                      numberOfLines={1}
                      className={`ml-2 text-xs font-semibold sm:text-sm ${
                        active ? 'text-white' : 'text-slate-600'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <View className="gap-4 md:flex-row md:items-center">
              <View className="flex-row items-center md:flex-1">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
                  <Feather name={selected.icon} size={21} color="#1A593B" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-lg font-semibold text-slate-900">{selected.label}</Text>
                  <Text className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                    {selected.description}
                  </Text>
                </View>
              </View>

              <View className="flex-row gap-2">
                <View className="min-w-20 rounded-xl bg-brand-50 px-3 py-2">
                  <Text className="text-lg font-semibold text-brand-800">{activeCount}</Text>
                  <Text className="text-[10px] font-medium uppercase tracking-wider text-brand-700">
                    Active
                  </Text>
                </View>
                <View className="min-w-20 rounded-xl bg-slate-100 px-3 py-2">
                  <Text className="text-lg font-semibold text-slate-700">{inactiveCount}</Text>
                  <Text className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Inactive
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View className="gap-3 sm:flex-row sm:items-end">
            <View className="flex-1">
              <Field
                label={`Search ${selected.label.toLowerCase()}`}
                placeholder="Search by name"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {editable ? (
              <View className="mb-3 sm:min-w-44">
                <Button title={`+ New ${selected.singular}`} onPress={openCreate} />
              </View>
            ) : null}
          </View>

          {query.isLoading ? (
            <View className="min-h-64 rounded-2xl border border-slate-200 bg-white">
              <LoadingState label={`Loading ${selected.label.toLowerCase()}…`} />
            </View>
          ) : query.isError ? (
            <View className="min-h-64 rounded-2xl border border-slate-200 bg-white">
              <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            </View>
          ) : filteredData.length ? (
            <View className="flex-row flex-wrap gap-3">
              {filteredData.map((item) => (
                <View
                  key={item.id}
                  className={`w-full rounded-2xl border bg-white p-4 md:w-[49%] ${
                    item.isActive ? 'border-slate-200' : 'border-slate-200 opacity-70'
                  }`}
                >
                  <View className="flex-row items-start">
                    <View
                      className={`h-11 w-11 items-center justify-center rounded-xl ${
                        item.isActive ? 'bg-brand-50' : 'bg-slate-100'
                      }`}
                    >
                      <Feather
                        name={selected.icon}
                        size={18}
                        color={item.isActive ? '#1A593B' : '#94A3B8'}
                      />
                    </View>
                    <View className="ml-3 flex-1 pr-2">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-base font-semibold text-slate-900">{item.name}</Text>
                        <View
                          className={`rounded-full px-2 py-0.5 ${
                            item.isActive ? 'bg-brand-50' : 'bg-slate-100'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-semibold ${
                              item.isActive ? 'text-brand-700' : 'text-slate-500'
                            }`}
                          >
                            {item.isActive ? 'Active' : 'Inactive'}
                          </Text>
                        </View>
                      </View>
                      <Text className="mt-1 text-xs leading-5 text-slate-500">
                        {section === 'units'
                          ? `${item.code?.toUpperCase() || '—'} · ${item.kind || 'discrete'} · step ${item.defaultStep ?? 1}`
                          : item.description || `No ${selected.singular.toLowerCase()} description`}
                      </Text>
                    </View>
                  </View>

                  {editable ? (
                    <View className="mt-4 flex-row items-center border-t border-slate-100 pt-3">
                      <View className="flex-1 flex-row items-center">
                        <Switch
                          value={item.isActive}
                          disabled={toggle.isPending}
                          onValueChange={() => toggle.mutate(item)}
                          trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                          thumbColor={item.isActive ? '#1A593B' : '#FFFFFF'}
                        />
                        <Text className="ml-2 text-xs font-medium text-slate-500">
                          {item.isActive ? 'Enabled for products' : 'Hidden from selection'}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() => openEdit(item)}
                        className="min-h-10 flex-row items-center rounded-xl bg-slate-100 px-3 active:bg-slate-200"
                      >
                        <Feather name="edit-2" size={14} color="#334155" />
                        <Text className="ml-2 text-xs font-semibold text-slate-700">Edit</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View className="min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <Feather name={search ? 'search' : selected.icon} size={24} color="#94A3B8" />
              </View>
              <Text className="mt-4 text-base font-semibold text-slate-900">
                {search ? `No ${selected.label.toLowerCase()} found` : `No ${selected.label.toLowerCase()} yet`}
              </Text>
              <Text className="mt-1 max-w-sm text-center text-xs leading-5 text-slate-500">
                {search
                  ? 'Try another search term.'
                  : `Create your first ${selected.singular.toLowerCase()} to keep the product catalogue organized.`}
              </Text>
              {!search && editable ? (
                <View className="mt-4 min-w-40">
                  <Button title={`Add ${selected.singular}`} onPress={openCreate} />
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={formOpen}
        transparent
        animationType="fade"
        onRequestClose={closeForm}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close form"
          onPress={closeForm}
          className="flex-1 items-center justify-end bg-black/45 p-0 sm:justify-center sm:p-6"
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            className="max-h-[92%] w-full max-w-lg overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
          >
            <View className="flex-row items-center border-b border-slate-100 p-5">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                <Feather name={selected.icon} size={19} color="#1A593B" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-lg font-semibold text-slate-900">
                  {editing ? `Edit ${selected.singular}` : `New ${selected.singular}`}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500">
                  {editing ? 'Update the details used across your catalogue.' : `Add a ${selected.singular.toLowerCase()} for product setup.`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={closeForm}
                className="h-10 w-10 items-center justify-center rounded-xl bg-slate-100 active:bg-slate-200"
              >
                <Feather name="x" size={18} color="#475569" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-5">
              {section === 'units' ? (
                <Field
                  label="Unit code"
                  value={code}
                  editable={!editing?.isSystem}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="For example: tray"
                />
              ) : null}

              <Field
                label={`${selected.singular} name`}
                value={name}
                onChangeText={setName}
                placeholder={section === 'categories' ? 'For example: Beverages' : section === 'brands' ? 'For example: Coca-Cola' : 'For example: Tray'}
              />

              {section === 'units' ? (
                <>
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Quantity behavior
                  </Text>
                  <View className="mb-3 flex-row rounded-xl bg-slate-100 p-1">
                    {(['discrete', 'decimal'] as const).map((value) => {
                      const active = kind === value;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setKind(value)}
                          className={`min-h-11 flex-1 items-center justify-center rounded-lg ${
                            active ? 'bg-brand-700' : ''
                          }`}
                        >
                          <Text className={`text-sm font-semibold capitalize ${active ? 'text-white' : 'text-slate-600'}`}>
                            {value}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mb-3 text-xs leading-5 text-slate-500">
                    Discrete units use whole quantities, while decimal units support values such as 0.25 kg or 125 ml.
                  </Text>
                  <Field
                    label="Default quantity step"
                    value={step}
                    onChangeText={setStep}
                    keyboardType="decimal-pad"
                    placeholder={kind === 'decimal' ? '0.01' : '1'}
                    error={step && !validStep ? 'Enter a number greater than zero.' : undefined}
                  />
                </>
              ) : (
                <Field
                  label="Description (optional)"
                  value={description}
                  onChangeText={setDescription}
                  placeholder={`Describe when this ${selected.singular.toLowerCase()} should be used`}
                  multiline
                  numberOfLines={3}
                />
              )}

              <View className="mt-3 flex-row gap-2">
                <View className="flex-1">
                  <Button title="Cancel" variant="secondary" onPress={closeForm} />
                </View>
                <View className="flex-[2]">
                  <Button
                    title={save.isPending ? 'Saving…' : editing ? 'Save changes' : `Create ${selected.singular.toLowerCase()}`}
                    disabled={save.isPending || !canSave}
                    onPress={() => save.mutate()}
                  />
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

export default function CatalogueScreen() {
  return (
    <AppSidebarProvider>
      <CatalogueContent />
    </AppSidebarProvider>
  );
}
