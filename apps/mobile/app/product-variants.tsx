import { useState } from 'react';
import { Alert, FlatList, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';

interface Variant {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitsPerBase: number;
  cost?: string;
  sellingPrice?: string;
  isActive: boolean;
  isPortioningContainer: boolean;
  barcodes: string[];
}

interface Unit {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

function ProductVariantsContent() {
  const {
    productId,
    name: productName,
    baseUnit = 'piece',
  } = useLocalSearchParams<{
    productId: string;
    name?: string;
    baseUnit?: string;
  }>();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Variant | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('pack');
  const [unitsPerBase, setUnitsPerBase] = useState('1');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isPortioningContainer, setIsPortioningContainer] = useState(false);
  const variants = useQuery({
    queryKey: ['product-variants', productId],
    queryFn: () => api<Variant[]>(`/products/${productId}/variants`),
    enabled: Boolean(productId),
  });
  const units = useQuery({
    queryKey: ['product-units'],
    queryFn: () => api<Unit[]>('/product-units'),
  });
  const reset = () => {
    setEditing(null);
    setName('');
    setSku('');
    setUnit('pack');
    setUnitsPerBase('1');
    setCost('');
    setPrice('');
    setBarcode('');
    setIsPortioningContainer(false);
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        sku: sku.trim(),
        unit,
        unitsPerBase: Number(unitsPerBase),
        cost: cost.trim() || undefined,
        sellingPrice: price.trim() || undefined,
        barcode: barcode.trim() || undefined,
        isActive: editing?.isActive ?? true,
        isPortioningContainer,
      };
      return api(
        editing
          ? `/products/${productId}/variants/${editing.id}`
          : `/products/${productId}/variants`,
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: async () => {
      reset();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['product-variants', productId] }),
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: ['pos-products'] }),
      ]);
    },
    onError: (error) => Alert.alert('Could not save variant', error.message),
  });
  const toggle = useMutation({
    mutationFn: (variant: Variant) =>
      api(`/products/${productId}/variants/${variant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !variant.isActive }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['product-variants', productId] }),
    onError: (error) => Alert.alert('Could not update variant', error.message),
  });
  return (
    <Screen>
      <Header
        title="Selling units"
        subtitle={`${productName ?? 'Product'} · base inventory in ${baseUnit}`}
        showBack
        backLabel="Products"
        fallbackHref="/products"
      />
      <View className="border-b border-slate-200 bg-white p-4">
        <View className="mx-auto w-full max-w-[720px] gap-3 rounded-2xl border border-slate-200 p-4">
          <Text className="font-medium text-slate-900">
            {editing ? 'Edit selling unit' : 'Add selling unit or variant'}
          </Text>
          <Text className="text-xs leading-5 text-slate-500">
            One sold unit deducts the conversion quantity from the product’s shared {baseUnit}{' '}
            inventory.
          </Text>
          <View className="flex-row gap-2">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name, e.g. Pack of 12"
              className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4"
            />
            <TextInput
              value={sku}
              onChangeText={setSku}
              autoCapitalize="characters"
              placeholder="Variant SKU"
              className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4"
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {units.data
              ?.filter((item) => item.isActive)
              .map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setUnit(item.code)}
                  className={`rounded-full px-4 py-2 ${
                    unit === item.code ? 'bg-brand-700' : 'bg-slate-100'
                  }`}
                >
                  <Text
                    className={`text-xs ${unit === item.code ? 'text-white' : 'text-slate-700'}`}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
          </View>
          <View className="flex-row gap-2">
            <TextInput
              value={unitsPerBase}
              onChangeText={setUnitsPerBase}
              keyboardType="decimal-pad"
              placeholder={`Number of ${baseUnit}`}
              className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4"
            />
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="Selling price"
              className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4"
            />
            <TextInput
              value={cost}
              onChangeText={setCost}
              keyboardType="decimal-pad"
              placeholder="Cost (optional)"
              className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4"
            />
          </View>
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Barcode (optional)"
            className="min-h-12 rounded-xl bg-slate-100 px-4"
          />
          <View className="flex-row items-center rounded-2xl border border-brand-200 bg-brand-50 p-4">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-brand-950">
                Whole container reserved for direct sale
              </Text>
              <Text className="mt-1 text-xs leading-5 text-brand-800">
                When enabled, this unit uses sealed stock. The base unit and BOM recipes use only opened stock.
              </Text>
            </View>
            <Switch
              value={isPortioningContainer}
              onValueChange={setIsPortioningContainer}
              trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
              thumbColor={isPortioningContainer ? '#1A593B' : '#FFFFFF'}
            />
          </View>
          <View className="flex-row gap-2">
            {editing ? <Button title="Cancel" variant="secondary" onPress={reset} /> : null}
            <View className="flex-1">
              <Button
                title={save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add selling unit'}
                disabled={
                  save.isPending ||
                  !name.trim() ||
                  !sku.trim() ||
                  !(Number(unitsPerBase) > 0) ||
                  !price.trim()
                }
                onPress={() => save.mutate()}
              />
            </View>
          </View>
        </View>
      </View>
      {variants.isLoading ? (
        <LoadingState />
      ) : variants.isError ? (
        <ErrorState message={variants.error.message} retry={() => void variants.refetch()} />
      ) : (
        <FlatList
          data={variants.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="mx-auto w-full max-w-[720px] gap-2 p-4 pb-12"
          ListEmptyComponent={
            <View className="items-center py-14">
              <Feather name="copy" size={36} color="#C7C0B8" />
              <Text className="mt-3 text-slate-500">No alternate selling units yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setEditing(item);
                setName(item.name);
                setSku(item.sku);
                setUnit(item.unit);
                setUnitsPerBase(String(item.unitsPerBase));
                setCost(item.cost ?? '');
                setPrice(item.sellingPrice ?? '');
                setBarcode(item.barcodes[0] ?? '');
                setIsPortioningContainer(item.isPortioningContainer);
              }}
              className={`flex-row items-center rounded-2xl border border-slate-100 bg-white p-4 ${
                item.isActive ? '' : 'opacity-60'
              }`}
            >
              <View className="flex-1">
                <Text className="font-medium text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {item.sku} · 1 {item.unit} = {item.unitsPerBase} {baseUnit}
                </Text>
                <Text className="mt-1 text-xs text-brand-700">
                  {item.sellingPrice ? `₱${item.sellingPrice}` : 'Uses base price'}
                  {item.barcodes[0] ? ` · ${item.barcodes[0]}` : ''}
                </Text>
                {item.isPortioningContainer ? (
                  <View className="mt-2 self-start rounded-full bg-amber-50 px-2.5 py-1">
                    <Text className="text-[10px] font-semibold text-amber-800">
                      Sealed stock container
                    </Text>
                  </View>
                ) : null}
              </View>
              <Switch
                value={item.isActive}
                disabled={toggle.isPending}
                onValueChange={() => toggle.mutate(item)}
                trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                thumbColor={item.isActive ? '#1A593B' : '#FFFFFF'}
              />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

export default function ProductVariantsScreen() {
  return (
    <AppSidebarProvider>
      <ProductVariantsContent />
    </AppSidebarProvider>
  );
}
