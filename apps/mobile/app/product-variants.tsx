import { useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { type POSBarcodeItem } from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { ApiError, api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { normalizeBarcode } from '@/lib/product-scan';
import { useIosAlert } from '@/providers/ios-alert';
import { useBranchStore } from '@/store/branch';

function FormField({
  label,
  focused,
  children,
  className = '',
}: {
  label: string;
  focused?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={className}>
      <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </Text>
      <View
        className={`min-h-12 justify-center rounded-xl border px-3 transition-all ${
          focused
            ? 'border-brand-600 bg-white ring-2 ring-brand-200'
            : 'border-slate-200 bg-white'
        }`}
      >
        {children}
      </View>
    </View>
  );
}

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
  const branch = useBranchStore((state) => state.activeBranch);
  const {
    productId,
    name: productName,
    baseUnit = 'piece',
  } = useLocalSearchParams<{
    productId: string;
    name?: string;
    baseUnit?: string;
  }>();
  const { width } = useWindowDimensions();
  // Full window width (includes sidebar). Side-by-side from laptop sizes up.
  const isWide = width >= 1024;
  const isTablet = width >= 640;
  const client = useQueryClient();
  const { showAlert } = useIosAlert();

  const productsList = useQuery({
    queryKey: ['products-list-picker', branch?.id],
    enabled: Boolean(branch),
    queryFn: () => api<ProductItem[]>(`/products?branchId=${branch!.id}&pageSize=100`),
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

  const conversionLabel = (item: Variant) => {
    const unitCode = item.unit.toLowerCase();
    const base = (activeBaseUnit || '').toLowerCase();
    if (
      (unitCode === 'g' || unitCode === 'gram') &&
      (base === 'kg' || base === 'kilogram')
    ) {
      return `${item.unitsPerBase < 1 ? item.unitsPerBase * 1000 : item.unitsPerBase} g = ${
        item.unitsPerBase < 1 ? item.unitsPerBase : item.unitsPerBase / 1000
      } kg`;
    }
    if (
      (unitCode === 'ml' || unitCode === 'milliliter') &&
      (base === 'l' || base === 'liter')
    ) {
      return `${item.unitsPerBase < 1 ? item.unitsPerBase * 1000 : item.unitsPerBase} ml = ${
        item.unitsPerBase < 1 ? item.unitsPerBase : item.unitsPerBase / 1000
      } l`;
    }
    return `1 ${item.unit} = ${item.unitsPerBase} ${activeBaseUnit}`;
  };

  const beginEdit = (item: Variant) => {
    setEditing(item);
    setName(item.name);
    setSku(item.sku);
    setUnit(item.unit);
    setUnitsPerBase(String(item.unitsPerBase));
    setCost(item.cost ?? '');
    setPrice(item.sellingPrice ?? '');
    setBarcode(item.barcodes[0] ?? '');
    setIsPortioningContainer(item.isPortioningContainer);
  };

  const formCard = (
    <View className="gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <View
        className={`gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 ${
          isTablet ? 'flex-row items-center justify-between' : ''
        }`}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-700">
            <Feather name="package" size={20} color="#FFFFFF" />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-xs font-semibold text-brand-800">Target product</Text>
              <View className="flex-row items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5">
                <View className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                <Text className="text-[10px] font-medium text-emerald-800">Scanner ready</Text>
              </View>
            </View>
            <Text className="text-base font-bold text-slate-900" numberOfLines={2}>
              {activeProductName}{' '}
              <Text className="text-xs font-normal text-slate-500">({activeBaseUnit})</Text>
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change product"
          onPress={() => setPickerModalOpen(true)}
          className={`min-h-11 items-center justify-center rounded-xl border border-brand-300 bg-white px-4 active:bg-brand-50 ${
            isTablet ? '' : 'w-full'
          }`}
        >
          <Text className="text-sm font-semibold text-brand-800">Change product</Text>
        </Pressable>
      </View>

      <View>
        <Text className="text-base font-semibold text-slate-900">
          {editing ? 'Edit selling unit' : 'Add selling unit or variant'}
        </Text>
        <Text className="mt-1 text-xs leading-5 text-slate-500">
          One sold unit deducts the conversion quantity from {activeProductName}&apos;s shared{' '}
          {activeBaseUnit} inventory.
        </Text>
      </View>

      <View className={`gap-3 ${isTablet ? 'flex-row' : ''}`}>
        <FormField label="Name" focused={focusedField === 'name'} className="flex-1">
          <TextInput
            value={name}
            onChangeText={setName}
            onFocus={() => setFocusedField('name')}
            onBlur={() => setFocusedField(null)}
            placeholder="e.g. Pack of 12"
            placeholderTextColor="#94A3B8"
            className="w-full py-2.5 text-sm text-slate-900"
            style={{ outline: 'none' } as object}
          />
        </FormField>
        <FormField label="Variant SKU" focused={focusedField === 'sku'} className="flex-1">
          <TextInput
            value={sku}
            onChangeText={setSku}
            onFocus={() => setFocusedField('sku')}
            onBlur={() => setFocusedField(null)}
            autoCapitalize="characters"
            placeholder="SKU"
            placeholderTextColor="#94A3B8"
            className="w-full py-2.5 text-sm text-slate-900"
            style={{ outline: 'none' } as object}
          />
        </FormField>
      </View>

      <View>
        <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Selling unit
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {units.data
            ?.filter((item) => item.isActive)
            .map((item) => {
              const selected = unit === item.code;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setUnit(item.code)}
                  className={`min-h-9 items-center justify-center rounded-full border px-3.5 ${
                    selected
                      ? 'border-brand-700 bg-brand-700'
                      : 'border-slate-200 bg-slate-50 active:bg-slate-100'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      selected ? 'text-white' : 'text-slate-700'
                    }`}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}
        </View>
      </View>

      {unit.toLowerCase() === (activeBaseUnit || '').toLowerCase() &&
      Number(unitsPerBase) !== 1 ? (
        <View className="flex-row items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <Feather name="alert-triangle" size={16} color="#B45309" />
          <Text className="flex-1 text-xs font-semibold leading-snug text-amber-900">
            “{unit}” matches the base unit. To create a {unitsPerBase}-pack, choose Box, Pack, or
            another container unit above.
          </Text>
        </View>
      ) : null}

      <View className={`gap-3 ${isTablet ? 'flex-row' : ''}`}>
        <FormField
          label={`Qty per unit (${activeBaseUnit})`}
          focused={focusedField === 'unitsPerBase'}
          className="flex-1"
        >
          <TextInput
            value={unitsPerBase}
            onChangeText={setUnitsPerBase}
            onFocus={() => setFocusedField('unitsPerBase')}
            onBlur={() => setFocusedField(null)}
            keyboardType="decimal-pad"
            placeholder={`e.g. 12`}
            placeholderTextColor="#94A3B8"
            className="w-full py-2.5 text-sm text-slate-900"
            style={{ outline: 'none' } as object}
          />
        </FormField>
        <FormField label="Selling price" focused={focusedField === 'price'} className="flex-1">
          <TextInput
            value={price}
            onChangeText={setPrice}
            onFocus={() => setFocusedField('price')}
            onBlur={() => setFocusedField(null)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#94A3B8"
            className="w-full py-2.5 text-sm text-slate-900"
            style={{ outline: 'none' } as object}
          />
        </FormField>
        <FormField label="Cost (optional)" focused={focusedField === 'cost'} className="flex-1">
          <TextInput
            value={cost}
            onChangeText={setCost}
            onFocus={() => setFocusedField('cost')}
            onBlur={() => setFocusedField(null)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#94A3B8"
            className="w-full py-2.5 text-sm text-slate-900"
            style={{ outline: 'none' } as object}
          />
        </FormField>
      </View>

      <FormField label="Barcode (optional)" focused={focusedField === 'barcode'}>
        <TextInput
          value={barcode}
          onChangeText={setBarcode}
          onFocus={() => setFocusedField('barcode')}
          onBlur={() => setFocusedField(null)}
          placeholder="Scan or type barcode"
          placeholderTextColor="#94A3B8"
          className="w-full py-2.5 text-sm text-slate-900"
          style={{ outline: 'none' } as object}
        />
      </FormField>

      <View
        className={`gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 ${
          isTablet ? 'flex-row items-center' : ''
        }`}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-brand-950">
            Whole container reserved for direct sale
          </Text>
          <Text className="mt-1 text-xs leading-5 text-brand-800">
            Uses sealed stock. Base unit and BOM recipes use opened stock only.
          </Text>
        </View>
        <Switch
          value={isPortioningContainer}
          onValueChange={setIsPortioningContainer}
          trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
          thumbColor={isPortioningContainer ? '#1A593B' : '#FFFFFF'}
        />
      </View>

      <View className={`gap-2 ${isTablet ? 'flex-row' : ''}`}>
        {editing ? (
          <View className={isTablet ? 'min-w-[120px]' : 'w-full'}>
            <Button title="Cancel" variant="secondary" onPress={reset} />
          </View>
        ) : null}
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
  );

  const listHeader = (
    <View className="mb-3 flex-row items-center justify-between">
      <View>
        <Text className="text-base font-semibold text-slate-900">Configured units</Text>
        <Text className="mt-0.5 text-xs text-slate-500">
          {(variants.data ?? []).length} unit{(variants.data ?? []).length === 1 ? '' : 's'} for{' '}
          {activeProductName}
        </Text>
      </View>
    </View>
  );

  const renderVariant = ({ item }: { item: Variant }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.name}`}
      onPress={() => beginEdit(item)}
      className={`mb-2 rounded-2xl border border-slate-200 bg-white p-4 active:bg-slate-50 ${
        item.isActive ? '' : 'opacity-60'
      } ${editing?.id === item.id ? 'border-brand-400 bg-brand-50/40' : ''}`}
    >
      <View className={`gap-3 ${isTablet ? 'flex-row items-center' : ''}`}>
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-base font-semibold text-slate-900">{item.name}</Text>
            {item.isPortioningContainer ? (
              <View className="rounded-full bg-amber-50 px-2.5 py-0.5">
                <Text className="text-[10px] font-semibold text-amber-800">Sealed</Text>
              </View>
            ) : null}
            {!item.isActive ? (
              <View className="rounded-full bg-slate-100 px-2.5 py-0.5">
                <Text className="text-[10px] font-semibold text-slate-500">Inactive</Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-1 text-xs text-slate-500">
            {item.sku} · {conversionLabel(item)}
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
            <Text className="text-sm font-semibold text-brand-800">
              {item.sellingPrice ? formatMoney(item.sellingPrice) : 'Base price'}
            </Text>
            {item.barcodes[0] ? (
              <Text className="text-xs text-slate-500">Barcode {item.barcodes[0]}</Text>
            ) : (
              <Text className="text-xs text-slate-400">No barcode</Text>
            )}
          </View>
        </View>
        <View
          className={`flex-row items-center gap-3 ${isTablet ? '' : 'justify-between border-t border-slate-100 pt-3'}`}
        >
          <Text className="text-xs font-medium text-slate-500">
            {item.isActive ? 'Active' : 'Off'}
          </Text>
          <Switch
            value={item.isActive}
            disabled={toggle.isPending}
            onValueChange={() => toggle.mutate(item)}
            trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
            thumbColor={item.isActive ? '#1A593B' : '#FFFFFF'}
          />
        </View>
      </View>
    </Pressable>
  );

  const variantsList =
    variants.isLoading ? (
      <LoadingState label="Loading selling units…" />
    ) : variants.isError ? (
      <ErrorState message={variants.error.message} retry={() => void variants.refetch()} />
    ) : (
      <FlatList
        data={variants.data ?? []}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerClassName="pb-8"
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View className="items-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10">
            <Feather name="layers" size={28} color="#94A3B8" />
            <Text className="mt-3 text-sm font-medium text-slate-700">No selling units yet</Text>
            <Text className="mt-1 max-w-sm text-center text-xs text-slate-500">
              Add a box, pack, or other sellable unit for {activeProductName}.
            </Text>
          </View>
        }
        renderItem={renderVariant}
      />
    );

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

      {isWide ? (
        <View className="mx-auto w-full max-w-[1280px] flex-1 flex-row gap-5 px-4 py-4 lg:px-6">
          <ScrollView
            className="w-[46%] max-w-[560px] flex-none"
            contentContainerClassName="pb-8"
            keyboardShouldPersistTaps="handled"
          >
            {formCard}
          </ScrollView>
          <View className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-[#F8F9FA] p-4">
            {variantsList}
          </View>
        </View>
      ) : (
        <FlatList
          data={variants.data ?? []}
          keyExtractor={(item) => item.id}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="mx-auto w-full max-w-[720px] gap-0 px-4 py-4 pb-10"
          ListHeaderComponent={
            <View className="mb-4 gap-4">
              {formCard}
              {listHeader}
            </View>
          }
          ListEmptyComponent={
            variants.isLoading ? (
              <LoadingState label="Loading selling units…" />
            ) : variants.isError ? (
              <ErrorState
                message={variants.error.message}
                retry={() => void variants.refetch()}
              />
            ) : (
              <View className="items-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10">
                <Feather name="layers" size={28} color="#94A3B8" />
                <Text className="mt-3 text-sm font-medium text-slate-700">No selling units yet</Text>
                <Text className="mt-1 max-w-sm text-center text-xs text-slate-500">
                  Add a box, pack, or other sellable unit for {activeProductName}.
                </Text>
              </View>
            )
          }
          renderItem={renderVariant}
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
