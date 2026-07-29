import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
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

const sections: Array<{ key: Section; label: string; endpoint: string }> = [
  { key: 'categories', label: 'Categories', endpoint: '/categories' },
  { key: 'brands', label: 'Brands', endpoint: '/brands' },
  { key: 'units', label: 'Units', endpoint: '/product-units' },
];

function CatalogueContent() {
  const { currentUser } = useSession();
  const editable = currentUser?.permissions.includes('products:manage') ?? false;
  const client = useQueryClient();
  const [section, setSection] = useState<Section>('categories');
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
  const reset = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setCode('');
    setKind('discrete');
    setStep('1');
  };
  const save = useMutation({
    mutationFn: async () => {
      const body =
        section === 'units'
          ? {
              code: code.trim().toLowerCase(),
              name: name.trim(),
              kind,
              defaultStep: Number(step),
              isActive: editing?.isActive ?? true,
            }
          : {
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
      reset();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['catalogue', section] }),
        client.invalidateQueries({ queryKey: [section] }),
        client.invalidateQueries({ queryKey: ['product-units'] }),
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
  return (
    <Screen>
      <Header
        title="Product catalogue"
        subtitle="Categories, brands and selling units"
        showBack
        backLabel="Products"
        fallbackHref="/products"
      />
      <View className="border-b border-slate-200 bg-white p-4">
        <View className="flex-row gap-2">
          {sections.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => {
                setSection(item.key);
                reset();
              }}
              className={`min-h-10 flex-1 items-center justify-center rounded-xl ${
                section === item.key ? 'bg-brand-700' : 'bg-slate-100'
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  section === item.key ? 'text-white' : 'text-slate-700'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {editable ? (
          <View className="mt-4 gap-3 rounded-2xl border border-slate-200 p-4">
            <Text className="font-medium text-slate-900">
              {editing
                ? `Edit ${selected.label.slice(0, -1)}`
                : `New ${selected.label.slice(0, -1)}`}
            </Text>
            {section === 'units' ? (
              <TextInput
                value={code}
                editable={!editing?.isSystem}
                onChangeText={setCode}
                autoCapitalize="none"
                placeholder="Unit code, e.g. tray"
                className="min-h-12 rounded-xl bg-slate-100 px-4"
              />
            ) : null}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              className="min-h-12 rounded-xl bg-slate-100 px-4"
            />
            {section === 'units' ? (
              <>
                <View className="flex-row gap-2">
                  {(['discrete', 'decimal'] as const).map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => setKind(value)}
                      className={`min-h-10 flex-1 items-center justify-center rounded-xl ${
                        kind === value ? 'bg-brand-700' : 'bg-slate-100'
                      }`}
                    >
                      <Text
                        className={`capitalize ${kind === value ? 'text-white' : 'text-slate-700'}`}
                      >
                        {value}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={step}
                  onChangeText={setStep}
                  keyboardType="decimal-pad"
                  placeholder="Default quantity step"
                  className="min-h-12 rounded-xl bg-slate-100 px-4"
                />
              </>
            ) : (
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Description (optional)"
                className="min-h-12 rounded-xl bg-slate-100 px-4"
              />
            )}
            <View className="flex-row gap-2">
              {editing ? <Button title="Cancel" variant="secondary" onPress={reset} /> : null}
              <View className="flex-1">
                <Button
                  title={save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add'}
                  disabled={
                    save.isPending ||
                    !name.trim() ||
                    (section === 'units' && (!code.trim() || !(Number(step) > 0)))
                  }
                  onPress={() => save.mutate()}
                />
              </View>
            </View>
          </View>
        ) : null}
      </View>
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-2 p-4 pb-12"
          renderItem={({ item }) => (
            <Pressable
              disabled={!editable}
              onPress={() => {
                setEditing(item);
                setName(item.name);
                setDescription(item.description ?? '');
                setCode(item.code ?? '');
                setKind(item.kind ?? 'discrete');
                setStep(String(item.defaultStep ?? 1));
              }}
              className={`flex-row items-center rounded-2xl border border-slate-100 bg-white p-4 ${
                item.isActive ? '' : 'opacity-60'
              }`}
            >
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <Feather
                  name={
                    section === 'categories' ? 'folder' : section === 'brands' ? 'award' : 'box'
                  }
                  size={18}
                  color="#1A593B"
                />
              </View>
              <View className="flex-1">
                <Text className="font-medium text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {section === 'units'
                    ? `${item.code?.toUpperCase()} · ${item.kind} · step ${item.defaultStep}`
                    : item.description || 'No description'}
                </Text>
              </View>
              {editable ? (
                <Switch
                  value={item.isActive}
                  disabled={toggle.isPending}
                  onValueChange={() => toggle.mutate(item)}
                  trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                  thumbColor={item.isActive ? '#1A593B' : '#FFFFFF'}
                />
              ) : null}
            </Pressable>
          )}
        />
      )}
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
