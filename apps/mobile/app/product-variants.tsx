import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { type POSBarcodeItem } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { ApiError, api } from '@/lib/api';
import { normalizeBarcode } from '@/lib/product-scan';
import { useIosAlert } from '@/providers/ios-alert';

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

interface ProductItem {
  id: string;
  name: string;
  unit: string;
  sku?: string;
  barcodes?: string[];
  sellingUnits?: Array<{
    variantId?: string;
    name?: string;
    sku?: string;
    unit?: string;
    barcodes?: string[];
  }>;
}

function ProductChooserModal({
  visible,
  products,
  activeProductId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  products: ProductItem[];
  activeProductId?: string;
  onClose(): void;
  onSelect(product: ProductItem): void;
}) {
  const [search, setSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) => {
      const matchName = p.name.toLowerCase().includes(q);
      const matchUnit = p.unit.toLowerCase().includes(q);
      const matchSku = Boolean(p.sku && p.sku.toLowerCase().includes(q));
      const matchBaseBarcode = Boolean(
        p.barcodes && p.barcodes.some((b) => b.toLowerCase().includes(q)),
      );
      const matchVariantBarcode = Boolean(
        p.sellingUnits &&
          p.sellingUnits.some(
            (su) =>
              (su.barcodes && su.barcodes.some((b) => b.toLowerCase().includes(q))) ||
              (su.sku && su.sku.toLowerCase().includes(q)),
          ),
      );
      return matchName || matchUnit || matchSku || matchBaseBarcode || matchVariantBarcode;
    });
  }, [products, search]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center bg-black/40 p-4" onPress={onClose}>
        <Pressable
          className="mx-auto w-full max-w-[560px] rounded-3xl bg-white p-5 shadow-2xl"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <View>
              <Text className="text-lg font-bold text-slate-900">Select Target Product</Text>
              <Text className="mt-0.5 text-xs text-slate-500">
                Choose a product to manage its selling units and barcodes
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:bg-slate-200"
            >
              <Feather name="x" size={18} color="#475569" />
            </Pressable>
          </View>

          <View
            className={`mb-3 flex-row items-center rounded-xl border px-3 py-2 transition-all ${
              isSearchFocused
                ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                : 'border-slate-300 bg-slate-50'
            }`}
          >
            <Feather name="search" size={16} color={isSearchFocused ? '#15803D' : '#64748B'} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              placeholder="Search by product name, SKU, or barcode..."
              className="ml-2 flex-1 text-sm text-slate-900"
              style={{ outline: 'none' }}
              autoFocus
            />
            {search ? (
              <Pressable onPress={() => setSearch('')}>
                <Feather name="x" size={16} color="#64748B" />
              </Pressable>
            ) : null}
          </View>

          <ScrollView className="max-h-[360px] gap-1" keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <View className="items-center py-8">
                <Text className="text-sm text-slate-400">No products found matching "{search}"</Text>
              </View>
            ) : (
              filtered.map((prod) => {
                const selected = activeProductId === prod.id;
                const barcodeList = [
                  ...(prod.barcodes ?? []),
                  ...(prod.sellingUnits?.flatMap((su) => su.barcodes ?? []) ?? []),
                ];
                const uniqueBarcodes = Array.from(new Set(barcodeList.filter(Boolean)));

                return (
                  <Pressable
                    key={prod.id}
                    onPress={() => onSelect(prod)}
                    className={`flex-row items-center justify-between rounded-xl border p-3 ${
                      selected
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-100 bg-white active:bg-slate-50'
                    }`}
                  >
                    <View className="flex-1 pr-2">
                      <Text className="font-semibold text-slate-900">{prod.name}</Text>
                      <Text className="mt-0.5 text-xs text-slate-500">
                        {prod.sku ? `SKU: ${prod.sku} · ` : ''}Base unit: {prod.unit}
                      </Text>
                      {uniqueBarcodes.length > 0 ? (
                        <Text className="mt-1 text-[11px] text-brand-700">
                          Barcodes: {uniqueBarcodes.join(', ')}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-700">
                        <Feather name="check" size={14} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  const { showAlert } = useIosAlert();

  const productsList = useQuery({
    queryKey: ['products-list-picker'],
    queryFn: () => api<ProductItem[]>('/products?pageSize=100'),
  });

  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    productId && productId !== 'undefined' ? productId : null,
  );
  const [pickerModalOpen, setPickerModalOpen] = useState(false);

  const activeProduct = useMemo(() => {
    if (selectedProductId) {
      return productsList.data?.find((p) => p.id === selectedProductId);
    }
    if (productId && productId !== 'undefined') {
      return { id: productId, name: productName ?? 'Product', unit: baseUnit };
    }
    return productsList.data?.[0];
  }, [productsList.data, selectedProductId, productId, productName, baseUnit]);

  const activeProductId = activeProduct?.id;
  const activeProductName = activeProduct?.name ?? 'Product';
  const activeBaseUnit = activeProduct?.unit ?? 'piece';

  async function handleScanToSelect(scannedValue: string) {
    const barcode = normalizeBarcode(scannedValue);
    if (!barcode) return;
    try {
      const res = await api<POSBarcodeItem>(`/pos/barcodes/${encodeURIComponent(barcode)}`);
      if (res.productId) {
        setSelectedProductId(res.productId);
        setPickerModalOpen(false);
        reset();
        showAlert({
          title: 'Product Selected via Scan',
          message: `Selected ${res.productName} (${res.sellingUnitCode}).`,
          type: 'success',
        });
        return;
      }
    } catch {
      const match = productsList.data?.find(
        (p) =>
          p.sku === barcode ||
          p.barcodes?.includes(barcode) ||
          p.sellingUnits?.some((su) => su.barcodes?.includes(barcode) || su.sku === barcode),
      );
      if (match) {
        setSelectedProductId(match.id);
        setPickerModalOpen(false);
        reset();
        showAlert({
          title: 'Product Selected via Scan',
          message: `Selected ${match.name} (${match.unit}).`,
          type: 'success',
        });
        return;
      }
      showAlert({
        title: 'Barcode Not Found',
        message: `No product assigned to barcode "${barcode}".`,
        type: 'error',
      });
    }
  }

  useBarcodeScanner({
    onScan: handleScanToSelect,
    enabled: true,
  });

  const [editing, setEditing] = useState<Variant | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('box');
  const [unitsPerBase, setUnitsPerBase] = useState('12');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isPortioningContainer, setIsPortioningContainer] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const variants = useQuery({
    queryKey: ['product-variants', activeProductId],
    queryFn: () => api<Variant[]>(`/products/${activeProductId}/variants`),
    enabled: Boolean(activeProductId),
  });

  const units = useQuery({
    queryKey: ['product-units'],
    queryFn: () => api<Unit[]>('/product-units'),
  });

  const reset = () => {
    setEditing(null);
    setName('');
    setSku('');
    setUnit('box');
    setUnitsPerBase('12');
    setCost('');
    setPrice('');
    setBarcode('');
    setIsPortioningContainer(false);
  };

  const save = useMutation({
    mutationFn: () => {
      if (!activeProductId) {
        throw new Error('Please select a product before adding selling units.');
      }
      const bNorm = (activeBaseUnit || '').toLowerCase().trim();
      const uNorm = (unit || '').toLowerCase().trim();
      let numFactor = Number(unitsPerBase);
      if ((uNorm === 'g' || uNorm === 'gram') && (bNorm === 'kg' || bNorm === 'kilogram')) {
        if (numFactor >= 1) numFactor = numFactor / 1000;
      } else if ((uNorm === 'ml' || uNorm === 'milliliter') && (bNorm === 'l' || bNorm === 'liter')) {
        if (numFactor >= 1) numFactor = numFactor / 1000;
      }

      if (bNorm === uNorm && numFactor !== 1) {
        throw new Error(
          `You selected "${unit}" (same as the base unit) with a factor of ${numFactor}. To define a ${numFactor}-pack or box, please click a container unit pill (like "Box" or "Pack") above instead of "${unit}".`
        );
      }

      const body = {
        name: name.trim(),
        sku: sku.trim(),
        unit,
        unitsPerBase: numFactor,
        cost: cost.trim() || undefined,
        sellingPrice: price.trim() || undefined,
        barcode: barcode.trim() || undefined,
        isActive: editing?.isActive ?? true,
        isPortioningContainer,
      };
      return api(
        editing
          ? `/products/${activeProductId}/variants/${editing.id}`
          : `/products/${activeProductId}/variants`,
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: async () => {
      reset();
      showAlert({
        title: 'Selling Unit Saved',
        message: 'The selling unit was added successfully.',
        type: 'success',
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['product-variants', activeProductId] }),
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: ['pos-products'] }),
      ]);
    },
    onError: (error) => {
      let message = error.message;
      if (error instanceof ApiError && error.details) {
        const details = error.details as { fieldErrors?: Record<string, string[]> };
        if (details.fieldErrors) {
          const fieldMsgs = Object.entries(details.fieldErrors)
            .map(([field, errs]) => `${field}: ${errs.join(', ')}`)
            .join('\n');
          if (fieldMsgs) message = fieldMsgs;
        }
      }
      showAlert({
        title: 'Could Not Save Unit',
        message,
        type: 'error',
      });
    },
  });

  const toggle = useMutation({
    mutationFn: (variant: Variant) => {
      if (!activeProductId) {
        throw new Error('Please select a product first.');
      }
      return api(`/products/${activeProductId}/variants/${variant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !variant.isActive }),
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['product-variants', activeProductId] }),
    onError: (error) =>
      showAlert({
        title: 'Could Not Update Unit',
        message: error.message,
        type: 'error',
      }),
  });

  return (
    <Screen>
      <Header
        title="Selling units"
        subtitle={`${activeProductName} · base inventory in ${activeBaseUnit}`}
        showBack
        backLabel="Products"
        fallbackHref="/products"
      />

      <ProductChooserModal
        visible={pickerModalOpen}
        products={productsList.data ?? []}
        activeProductId={activeProductId}
        onClose={() => setPickerModalOpen(false)}
        onSelect={(prod) => {
          setSelectedProductId(prod.id);
          setPickerModalOpen(false);
          reset();
        }}
      />

      <View className="border-b border-slate-200 bg-white p-4">
        <View className="mx-auto w-full max-w-[720px] gap-3 rounded-2xl border border-slate-200 p-4">
          <View className="flex-row items-center justify-between rounded-2xl border border-brand-200 bg-brand-50 p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-700">
                <Feather name="package" size={20} color="#FFFFFF" />
              </View>
              <View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs font-semibold text-brand-800">Target Product</Text>
                  <View className="flex-row items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5">
                    <View className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    <Text className="text-[10px] font-medium text-emerald-800">Scanner Ready</Text>
                  </View>
                </View>
                <Text className="text-base font-bold text-slate-900">
                  {activeProductName} <Text className="text-xs font-normal text-slate-500">({activeBaseUnit})</Text>
                </Text>
              </View>
            </View>
            <Button
              title="Change Product"
              variant="secondary"
              onPress={() => setPickerModalOpen(true)}
            />
          </View>

          <Text className="mt-1 font-medium text-slate-900">
            {editing ? 'Edit selling unit' : 'Add selling unit or variant'}
          </Text>
          <Text className="text-xs leading-5 text-slate-500">
            One sold unit deducts the conversion quantity from {activeProductName}'s shared {activeBaseUnit}{' '}
            inventory.
          </Text>
          <View className="flex-row gap-2">
            <View
              className={`min-h-12 flex-1 rounded-xl border px-3 justify-center transition-all ${
                focusedField === 'name'
                  ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                  : 'border-transparent bg-slate-100'
              }`}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                placeholder="Name, e.g. Pack of 12"
                className="w-full text-sm text-slate-900"
                style={{ outline: 'none' }}
              />
            </View>
            <View
              className={`min-h-12 flex-1 rounded-xl border px-3 justify-center transition-all ${
                focusedField === 'sku'
                  ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                  : 'border-transparent bg-slate-100'
              }`}
            >
              <TextInput
                value={sku}
                onChangeText={setSku}
                onFocus={() => setFocusedField('sku')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="characters"
                placeholder="Variant SKU"
                className="w-full text-sm text-slate-900"
                style={{ outline: 'none' }}
              />
            </View>
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
          {unit.toLowerCase() === (activeBaseUnit || '').toLowerCase() && Number(unitsPerBase) !== 1 ? (
            <View className="flex-row items-center gap-2 rounded-xl bg-amber-50 p-3 border border-amber-200">
              <Feather name="alert-triangle" size={16} color="#B45309" />
              <Text className="flex-1 text-xs font-semibold text-amber-900 leading-snug">
                You currently have "{unit}" selected (same as base unit). To create a {unitsPerBase}-pack, click the "Box", "Pack", or "Case" pill above.
              </Text>
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <View
              className={`min-h-12 flex-1 rounded-xl border px-3 justify-center transition-all ${
                focusedField === 'unitsPerBase'
                  ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                  : 'border-transparent bg-slate-100'
              }`}
            >
              <TextInput
                value={unitsPerBase}
                onChangeText={setUnitsPerBase}
                onFocus={() => setFocusedField('unitsPerBase')}
                onBlur={() => setFocusedField(null)}
                keyboardType="decimal-pad"
                placeholder={`Number of ${activeBaseUnit}`}
                className="w-full text-sm text-slate-900"
                style={{ outline: 'none' }}
              />
            </View>
            <View
              className={`min-h-12 flex-1 rounded-xl border px-3 justify-center transition-all ${
                focusedField === 'price'
                  ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                  : 'border-transparent bg-slate-100'
              }`}
            >
              <TextInput
                value={price}
                onChangeText={setPrice}
                onFocus={() => setFocusedField('price')}
                onBlur={() => setFocusedField(null)}
                keyboardType="decimal-pad"
                placeholder="Selling price"
                className="w-full text-sm text-slate-900"
                style={{ outline: 'none' }}
              />
            </View>
            <View
              className={`min-h-12 flex-1 rounded-xl border px-3 justify-center transition-all ${
                focusedField === 'cost'
                  ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                  : 'border-transparent bg-slate-100'
              }`}
            >
              <TextInput
                value={cost}
                onChangeText={setCost}
                onFocus={() => setFocusedField('cost')}
                onBlur={() => setFocusedField(null)}
                keyboardType="decimal-pad"
                placeholder="Cost (optional)"
                className="w-full text-sm text-slate-900"
                style={{ outline: 'none' }}
              />
            </View>
          </View>
          <View
            className={`min-h-12 rounded-xl border px-3 justify-center transition-all ${
              focusedField === 'barcode'
                ? 'border-brand-600 bg-white ring-2 ring-brand-200'
                : 'border-transparent bg-slate-100'
            }`}
          >
            <TextInput
              value={barcode}
              onChangeText={setBarcode}
              onFocus={() => setFocusedField('barcode')}
              onBlur={() => setFocusedField(null)}
              placeholder="Barcode (optional)"
              className="w-full text-sm text-slate-900"
              style={{ outline: 'none' }}
            />
          </View>
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
                  !activeProductId ||
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
          contentContainerClassName="mx-auto w-full max-w-[720px] p-4 gap-2"
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-sm text-slate-500">No selling units configured for {activeProductName} yet.</Text>
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
                  {item.sku} · {
                    (item.unit.toLowerCase() === 'g' || item.unit.toLowerCase() === 'gram') && (activeBaseUnit?.toLowerCase() === 'kg' || activeBaseUnit?.toLowerCase() === 'kilogram')
                      ? `${item.unitsPerBase < 1 ? item.unitsPerBase * 1000 : item.unitsPerBase} g = ${item.unitsPerBase < 1 ? item.unitsPerBase : item.unitsPerBase / 1000} kg`
                      : (item.unit.toLowerCase() === 'ml' || item.unit.toLowerCase() === 'milliliter') && (activeBaseUnit?.toLowerCase() === 'l' || activeBaseUnit?.toLowerCase() === 'liter')
                        ? `${item.unitsPerBase < 1 ? item.unitsPerBase * 1000 : item.unitsPerBase} ml = ${item.unitsPerBase < 1 ? item.unitsPerBase : item.unitsPerBase / 1000} l`
                        : `1 ${item.unit} = ${item.unitsPerBase} ${activeBaseUnit}`
                  }
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
