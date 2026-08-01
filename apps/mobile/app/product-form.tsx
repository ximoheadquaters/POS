import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { productSchema, type ProductInput, type ProductUnit } from '@ximo/shared';
import type { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { normalizeBarcode } from '@/lib/product-scan';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useCartStore, type CartProduct } from '@/store/cart';

const UNIT_OPTIONS = [
  'piece',
  'serving',
  'box',
  'pack',
  'ml',
  'l',
  'g',
  'kg',
] as const satisfies readonly ProductUnit[];

const PRODUCT_PRESETS = [
  {
    label: 'Retail item',
    description: 'Packaged goods with stock',
    icon: 'shopping-bag' as const,
    unit: 'piece' as ProductUnit,
    trackInventory: true,
  },
  {
    label: 'Prepared food',
    description: 'Meals sold per serving',
    icon: 'coffee' as const,
    unit: 'serving' as ProductUnit,
    trackInventory: false,
  },
  {
    label: 'By weight',
    description: 'Meat, fish, rice, or produce',
    icon: 'activity' as const,
    unit: 'kg' as ProductUnit,
    trackInventory: true,
  },
] as const;

const CAMERA_BARCODE_TYPES = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'itf14',
  'codabar',
  'datamatrix',
] as const;

interface CatalogueItem {
  id: string;
  name: string;
  isActive: boolean;
}

interface UnitItem extends CatalogueItem {
  code: string;
  kind: 'discrete' | 'decimal';
  defaultStep: number;
}

interface ProductDetails extends Omit<ProductInput, 'barcode' | 'description' | 'imagePath'> {
  id: string;
  barcode?: string | null;
  description?: string | null;
  imagePath?: string | null;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </Text>
  );
}

function CardHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-row items-start border-b border-slate-100 p-5">
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
        <Feather name={icon} size={18} color="#1A593B" />
      </View>
      <View className="flex-1">
        <Text className="font-semibold text-slate-950">{title}</Text>
        <Text className="mt-1 text-sm leading-5 text-slate-500">{description}</Text>
      </View>
      {action ? <View className="ml-3">{action}</View> : null}
    </View>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-10 items-center justify-center rounded-full border px-4 ${
        selected ? 'border-brand-700 bg-brand-700' : 'border-slate-200 bg-white'
      }`}
    >
      <Text className={`text-xs font-medium ${selected ? 'text-white' : 'text-slate-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProductFormContent() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    sku?: string;
    addToCart?: string;
    incoming?: string;
    suggestedPrice?: string;
    targetMargin?: string;
  }>();
  const { currentUser } = useSession();
  const productId = typeof params.id === 'string' ? params.id : '';
  const isEditing = Boolean(productId);
  const suggestedPrice =
    typeof params.suggestedPrice === 'string' ? params.suggestedPrice.trim() : '';
  const targetMargin = typeof params.targetMargin === 'string' ? params.targetMargin.trim() : '';
  const scannedBarcode = typeof params.barcode === 'string' ? params.barcode.trim() : '';
  const enteredSku = typeof params.sku === 'string' ? params.sku.trim() : '';
  const addToCart = params.addToCart === '1';
  const incoming = params.incoming === '1';
  const branch = useBranchStore((state) => state.activeBranch)!;
  const add = useCartStore((state) => state.add);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerTarget, setScannerTarget] = useState<'barcode' | 'alternate' | null>(null);
  const [scanChecking, setScanChecking] = useState(false);
  const [openingQuantity, setOpeningQuantity] = useState(addToCart ? '1' : '0');
  const [alternateEnabled, setAlternateEnabled] = useState(false);
  const [alternateUnit, setAlternateUnit] = useState<ProductUnit>('pack');
  const [unitsPerAlternate, setUnitsPerAlternate] = useState('10');
  const [alternatePrice, setAlternatePrice] = useState('');
  const [alternateSku, setAlternateSku] = useState('');
  const [alternateBarcode, setAlternateBarcode] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const [pricingOffset, setPricingOffset] = useState(0);
  const queryClient = useQueryClient();

  const [recipeEnabled, setRecipeEnabled] = useState(false);
  const [recipeItems, setRecipeItems] = useState<
    Array<{
      ingredientProductId: string;
      ingredientName: string;
      quantityRequired: number;
      unit: string;
      cost: string;
    }>
  >([]);
  const [recipeSelectedIngredientId, setRecipeSelectedIngredientId] = useState('');
  const [recipeQtyInput, setRecipeQtyInput] = useState('1');
  const [recipeUnitInput, setRecipeUnitInput] = useState('piece');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<CatalogueItem[]>('/categories'),
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<CatalogueItem[]>('/brands'),
  });
  const units = useQuery({
    queryKey: ['product-units'],
    queryFn: () => api<UnitItem[]>('/product-units'),
  });
  const productDetails = useQuery({
    queryKey: ['product', productId],
    enabled: isEditing,
    queryFn: () => api<ProductDetails>(`/products/${productId}`),
  });

  const allProductsQuery = useQuery({
    queryKey: ['all-products-for-recipe', branch?.id],
    queryFn: () =>
      api<any>(
        `/products?includeInactive=true&includeIncoming=true&pageSize=200${
          branch?.id ? `&branchId=${branch.id}` : ''
        }`,
      ),
  });

  const availableIngredients = useMemo(() => {
    const raw = allProductsQuery.data;
    const list: Array<{ id: string; name: string; sku: string; cost: string; unit: string; status: string }> =
      Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    return list.filter((p) => p.id !== productId);
  }, [allProductsQuery.data, productId]);

  const existingRecipeQuery = useQuery({
    queryKey: ['product-recipe', productId],
    enabled: isEditing,
    queryFn: () =>
      api<
        Array<{
          ingredientProductId: string;
          ingredientName: string;
          quantityRequired: number;
          unit: string;
          ingredientCost: string;
        }>
      >(`/products/${productId}/recipe`),
  });

  useEffect(() => {
    if (existingRecipeQuery.data && existingRecipeQuery.data.length > 0) {
      setRecipeEnabled(true);
      setRecipeItems(
        existingRecipeQuery.data.map((r) => ({
          ingredientProductId: r.ingredientProductId,
          ingredientName: r.ingredientName,
          quantityRequired: r.quantityRequired,
          unit: r.unit,
          cost: r.ingredientCost || '0.00',
        })),
      );
    }
  }, [existingRecipeQuery.data]);

  const activeUnits =
    units.data?.filter((unit) => unit.isActive) ??
    UNIT_OPTIONS.map((code) => ({
      id: code,
      code,
      name: code.toUpperCase(),
      kind: ['piece', 'serving', 'box', 'pack'].includes(code)
        ? ('discrete' as const)
        : ('decimal' as const),
      defaultStep: 1,
      isActive: true,
    }));

  const form = useForm<z.input<typeof productSchema>, unknown, ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      sku: enteredSku || scannedBarcode,
      barcode: scannedBarcode || undefined,
      unit: 'piece',
      trackInventory: true,
      cost: '0.00',
      sellingPrice: '0.00',
      taxRate: '12.00',
      isTaxInclusive: false,
      status: incoming ? 'pending_receipt' : 'active',
    },
  });

  useEffect(() => {
    const product = productDetails.data;
    if (!product) return;
    form.reset({
      categoryId: product.categoryId ?? null,
      brandId: product.brandId ?? null,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? undefined,
      unit: product.unit,
      trackInventory: product.trackInventory,
      description: product.description ?? undefined,
      cost: product.cost,
      sellingPrice: product.sellingPrice,
      taxRate: product.taxRate,
      isTaxInclusive: product.isTaxInclusive,
      status: product.status,
      imagePath: product.imagePath ?? undefined,
    });
  }, [form, productDetails.data]);

  const trackInventory = form.watch('trackInventory');
  const baseUnit = form.watch('unit') ?? 'piece';
  const sellingPrice = form.watch('sellingPrice');
  const suggestionApplied =
    Boolean(suggestedPrice) &&
    Number.isFinite(Number(suggestedPrice)) &&
    Number(sellingPrice) === Number(suggestedPrice);
  const scannerEnabled = currentUser?.modules.includes('barcode_scanner') ?? false;

  const applySuggestedPrice = () => {
    const amount = Number(suggestedPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      Alert.alert('Invalid suggested price', 'Refresh the product list and try again.');
      return;
    }
    form.setValue('sellingPrice', amount.toFixed(2), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(pricingOffset - 16, 0),
        animated: true,
      });
      form.setFocus('sellingPrice');
    }, 100);
  };

  const openScanner = async (target: 'barcode' | 'alternate') => {
    if (!scannerEnabled) {
      Alert.alert(
        'Barcode scanner is disabled',
        'Enable the Barcode Scanner module in business settings to use the camera.',
      );
      return;
    }
    let permission = cameraPermission;
    if (!permission?.granted && permission?.canAskAgain !== false) {
      permission = await requestCameraPermission();
    }
    if (!permission?.granted) {
      Alert.alert(
        'Camera access is needed',
        'Allow camera access in your browser or device settings, then try again.',
      );
      return;
    }
    setScanChecking(false);
    setScannerTarget(target);
  };

  const handleCameraScan = async (result: BarcodeScanningResult) => {
    if (scanChecking || !scannerTarget) return;
    const barcode = normalizeBarcode(result.data);
    if (barcode.length < 3) {
      Alert.alert('Invalid barcode', 'The scanned barcode must contain at least 3 characters.');
      return;
    }
    setScanChecking(true);
    try {
      const existing = await api<CartProduct | null>(
        `/products/lookup?code=${encodeURIComponent(barcode)}&branchId=${branch.id}`,
      );
      if (existing && existing.id !== productId) {
        Alert.alert('Barcode already used', `${existing.name} already uses barcode ${barcode}.`);
        setScanChecking(false);
        return;
      }
      if (scannerTarget === 'barcode') {
        form.setValue('barcode', barcode, { shouldDirty: true, shouldValidate: true });
        if (!form.getValues('sku')?.trim()) {
          form.setValue('sku', barcode, { shouldDirty: true, shouldValidate: true });
        }
      } else {
        setAlternateBarcode(barcode);
      }
      setScannerTarget(null);
      setScanChecking(false);
    } catch (error) {
      Alert.alert(
        'Could not check barcode',
        error instanceof Error ? error.message : 'Please try scanning again.',
      );
      setScanChecking(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async (input: ProductInput) => {
      const quantity = Number(openingQuantity);
      if (
        !isEditing &&
        input.trackInventory &&
        (!Number.isFinite(quantity) ||
          quantity < 0 ||
          Math.round(quantity * 1_000) !== quantity * 1_000)
      ) {
        throw new Error('Stock on hand must be zero or more, with up to 3 decimal places');
      }
      const conversion = Number(unitsPerAlternate);
      if (
        !isEditing &&
        alternateEnabled &&
        (!Number.isFinite(conversion) ||
          conversion <= 1 ||
          Math.round(conversion * 1_000) !== conversion * 1_000)
      ) {
        throw new Error('Units per pack or box must be greater than 1');
      }
      if (!isEditing && alternateEnabled && (!alternateSku.trim() || !alternatePrice.trim())) {
        throw new Error('Enter the alternate unit SKU and selling price');
      }
      let savedProduct: CartProduct;
      if (isEditing) {
        savedProduct = await api<CartProduct>(`/products/${productId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...input,
            barcode: input.barcode ?? null,
          }),
        });
      } else {
        savedProduct = await api<CartProduct>('/products', {
          method: 'POST',
          body: JSON.stringify({
            ...input,
            status: incoming ? 'pending_receipt' : input.status,
            trackInventory: incoming ? true : input.trackInventory,
            branchId: branch.id,
            openingQuantity: incoming ? 0 : input.trackInventory ? quantity : 0,
            sellingUnits: alternateEnabled
              ? [
                  {
                    name: `${alternateUnit.toUpperCase()} of ${conversion}`,
                    sku: alternateSku.trim(),
                    barcode: alternateBarcode.trim() || undefined,
                    unit: alternateUnit,
                    unitsPerBase: conversion,
                    sellingPrice: alternatePrice,
                  },
                ]
              : [],
          }),
        });
      }

      if (recipeEnabled && recipeItems.length > 0) {
        await api(`/products/${savedProduct.id}/recipe`, {
          method: 'PUT',
          body: JSON.stringify({
            items: recipeItems.map((i) => ({
              ingredientProductId: i.ingredientProductId,
              quantityRequired: i.quantityRequired,
              unit: i.unit,
            })),
          }),
        });
      } else if (isEditing && !recipeEnabled) {
        await api(`/products/${savedProduct.id}/recipe`, {
          method: 'PUT',
          body: JSON.stringify({ items: [] }),
        });
      }

      return savedProduct;
    },
    onSuccess: async (product) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product', productId] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-products'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', branch.id] }),
      ]);
      if (addToCart) {
        add(product);
        router.replace('/(tabs)/pos');
      } else {
        router.back();
      }
    },
    onError: (error) => Alert.alert('Could not save product', error.message),
  });

  const renderTextField = (
    name: keyof ProductInput,
    label: string,
    placeholder: string,
    options: {
      keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
      autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
      multiline?: boolean;
      helper?: string;
    } = {},
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <View>
          <Text className="mb-2 text-sm font-medium text-slate-700">{label}</Text>
          <TextInput
            ref={field.ref}
            value={typeof field.value === 'string' ? field.value : ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType={options.keyboardType ?? 'default'}
            autoCapitalize={options.autoCapitalize}
            multiline={options.multiline}
            textAlignVertical={options.multiline ? 'top' : 'center'}
            placeholder={placeholder}
            placeholderTextColor="#A8A099"
            selectionColor="#1A593B"
            className={`rounded-xl border bg-white px-4 text-base text-slate-900 focus:border-brand-700 ${
              options.multiline ? 'min-h-24 py-3' : 'min-h-12'
            } ${fieldState.error ? 'border-red-400' : 'border-slate-200'}`}
          />
          {fieldState.error?.message ? (
            <Text className="mt-1 text-xs text-red-600">{fieldState.error.message}</Text>
          ) : options.helper ? (
            <Text className="mt-1 text-xs leading-4 text-slate-500">{options.helper}</Text>
          ) : null}
        </View>
      )}
    />
  );

  if (!branch) return <Redirect href="/branch-select" />;

  return (
    <Screen>
      <Header
        title={
          isEditing
            ? 'Edit product'
            : incoming
              ? 'Register incoming product'
              : scannedBarcode
                ? 'Add scanned product'
                : 'New product'
        }
        subtitle={
          isEditing
            ? `Update ${productDetails.data?.name ?? 'product'} details for ${branch.name}.`
            : incoming
              ? `Add it to this purchase order. It stays hidden until stock arrives at ${branch.name}.`
              : scannedBarcode
                ? `Barcode ${scannedBarcode} is ready for ${branch.name}.`
                : `Create a product for ${branch.name}.`
        }
        showBack
        backLabel={
          isEditing ? 'Products' : incoming ? 'Purchase order' : addToCart ? 'POS' : 'Products'
        }
        fallbackHref={incoming ? '/purchase-order-form' : addToCart ? '/(tabs)/pos' : '/products'}
      />

      {isEditing && productDetails.isLoading ? (
        <LoadingState />
      ) : isEditing && productDetails.isError ? (
        <ErrorState
          message={productDetails.error.message}
          retry={() => void productDetails.refetch()}
        />
      ) : (
        <ScrollView
          ref={scrollViewRef}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="px-4 py-6 pb-12"
        >
          <View className="w-full max-w-4xl self-center">
            {scannedBarcode ? (
              <View className="mb-6 flex-row items-start rounded-2xl border border-brand-100 bg-brand-50 p-4">
                <Feather name="check-circle" size={19} color="#1A593B" />
                <View className="ml-3 flex-1">
                  <Text className="font-medium text-brand-900">Barcode captured</Text>
                  <Text className="mt-1 text-sm leading-5 text-slate-600">
                    It has been copied into the barcode and SKU fields. You can change the SKU
                    without changing the barcode.
                  </Text>
                </View>
              </View>
            ) : null}
            {isEditing && suggestedPrice ? (
              <View className="mb-6 flex-row items-center rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white">
                  <Feather name="trending-up" size={18} color="#B45309" />
                </View>
                <View className="flex-1 pr-4">
                  <Text className="font-medium text-amber-900">Suggested selling price</Text>
                  <Text className="mt-1 text-sm leading-5 text-amber-800">
                    {formatMoney(suggestedPrice)}
                    {targetMargin ? ` targets a ${targetMargin}% gross margin.` : '.'} Review it
                    before saving; Ximo will never change the price automatically.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: suggestionApplied }}
                  disabled={suggestionApplied}
                  onPress={applySuggestedPrice}
                  className={`min-h-11 items-center justify-center rounded-xl px-4 active:opacity-80 ${
                    suggestionApplied ? 'bg-brand-700' : 'bg-amber-700'
                  }`}
                >
                  <View className="flex-row items-center">
                    {suggestionApplied ? <Feather name="check" size={15} color="#FFFFFF" /> : null}
                    <Text
                      className={`text-sm font-medium text-white ${suggestionApplied ? 'ml-2' : ''}`}
                    >
                      {suggestionApplied ? 'Applied' : 'Use suggestion'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <SectionLabel>Product setup</SectionLabel>
            <View className="mb-7 rounded-3xl border border-slate-200 bg-white p-5">
              <Text className="font-semibold text-slate-950">How is this product sold?</Text>
              <Text className="mb-4 mt-1 text-sm leading-5 text-slate-500">
                Choose the closest setup. You can fine-tune the unit and inventory settings below.
              </Text>
              <View className="gap-3 md:flex-row">
                {PRODUCT_PRESETS.map((preset) => {
                  const selected =
                    baseUnit === preset.unit && trackInventory === preset.trackInventory;
                  return (
                    <Pressable
                      key={preset.label}
                      disabled={incoming && !preset.trackInventory}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        form.setValue('unit', preset.unit, { shouldValidate: true });
                        form.setValue('trackInventory', preset.trackInventory, {
                          shouldValidate: true,
                        });
                        if (!preset.trackInventory) setOpeningQuantity('0');
                      }}
                      className={`min-h-24 flex-1 flex-row items-center rounded-2xl border p-4 ${
                        selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
                      } ${incoming && !preset.trackInventory ? 'opacity-40' : ''}`}
                    >
                      <View
                        className={`h-11 w-11 items-center justify-center rounded-xl ${
                          selected ? 'bg-white' : 'bg-slate-100'
                        }`}
                      >
                        <Feather
                          name={preset.icon}
                          size={19}
                          color={selected ? '#1A593B' : '#64748B'}
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="font-medium text-slate-900">{preset.label}</Text>
                        <Text className="mt-1 text-xs leading-4 text-slate-500">
                          {preset.description}
                        </Text>
                      </View>
                      {selected ? (
                        <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-700">
                          <Feather name="check" size={14} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <SectionLabel>Basic information</SectionLabel>
            <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <CardHeader
                icon="tag"
                title="Product details"
                description="Use a clear product name and unique codes that are easy to search."
              />
              <View className="gap-5 p-5">
                {renderTextField('name', 'Product name', 'Example: Coca-Cola 330ml', {
                  autoCapitalize: 'words',
                })}
                <View className="gap-5 md:flex-row">
                  <View className="flex-1">
                    {renderTextField('sku', 'SKU', 'Example: COKE-ML-330', {
                      autoCapitalize: 'characters',
                      helper: 'Your internal product code.',
                    })}
                  </View>
                  <View className="flex-1">
                    <Controller
                      control={form.control}
                      name="barcode"
                      render={({ field, fieldState }) => (
                        <View>
                          <Text className="mb-2 text-sm font-medium text-slate-700">Barcode</Text>
                          <View className="flex-row gap-2">
                            <TextInput
                              value={typeof field.value === 'string' ? field.value : ''}
                              onChangeText={field.onChange}
                              onBlur={field.onBlur}
                              autoCapitalize="none"
                              autoCorrect={false}
                              placeholder="Scan or type barcode"
                              placeholderTextColor="#A8A099"
                              selectionColor="#1A593B"
                              className={`min-h-12 flex-1 rounded-xl border bg-white px-4 text-base text-slate-900 focus:border-brand-700 ${
                                fieldState.error ? 'border-red-400' : 'border-slate-200'
                              }`}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Scan product barcode with camera"
                              onPress={() => void openScanner('barcode')}
                              className={`h-12 w-12 items-center justify-center rounded-xl ${
                                scannerEnabled ? 'bg-brand-700 active:opacity-80' : 'bg-slate-200'
                              }`}
                            >
                              <Feather
                                name="camera"
                                size={19}
                                color={scannerEnabled ? '#FFFFFF' : '#64748B'}
                              />
                            </Pressable>
                          </View>
                          {fieldState.error?.message ? (
                            <Text className="mt-1 text-xs text-red-600">
                              {fieldState.error.message}
                            </Text>
                          ) : (
                            <Text className="mt-1 text-xs leading-4 text-slate-500">
                              Optional. Tap the camera button to scan.
                            </Text>
                          )}
                        </View>
                      )}
                    />
                  </View>
                </View>
                {renderTextField(
                  'description',
                  'Description',
                  'Optional notes about this product',
                  {
                    multiline: true,
                  },
                )}
              </View>

              <View className="border-t border-slate-100 p-5">
                <View className="mb-4 flex-row items-center justify-between">
                  <View>
                    <Text className="font-medium text-slate-900">Classification</Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      Helps organize the POS and reports.
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/catalogue')}
                    className="min-h-10 flex-row items-center justify-center rounded-xl bg-brand-50 px-3"
                  >
                    <Feather name="settings" size={14} color="#1A593B" />
                    <Text className="ml-2 text-xs font-medium text-brand-700">Manage</Text>
                  </Pressable>
                </View>
                <View className="gap-5 md:flex-row">
                  <Controller
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <View className="flex-1">
                        <Text className="mb-2 text-sm font-medium text-slate-700">Category</Text>
                        <View className="flex-row flex-wrap gap-2">
                          <ChoiceChip
                            label="None"
                            selected={!field.value}
                            onPress={() => field.onChange(null)}
                          />
                          {categories.data
                            ?.filter((item) => item.isActive)
                            .map((item) => (
                              <ChoiceChip
                                key={item.id}
                                label={item.name}
                                selected={field.value === item.id}
                                onPress={() => field.onChange(item.id)}
                              />
                            ))}
                        </View>
                      </View>
                    )}
                  />
                  <Controller
                    control={form.control}
                    name="brandId"
                    render={({ field }) => (
                      <View className="flex-1">
                        <Text className="mb-2 text-sm font-medium text-slate-700">Brand</Text>
                        <View className="flex-row flex-wrap gap-2">
                          <ChoiceChip
                            label="None"
                            selected={!field.value}
                            onPress={() => field.onChange(null)}
                          />
                          {brands.data
                            ?.filter((item) => item.isActive)
                            .map((item) => (
                              <ChoiceChip
                                key={item.id}
                                label={item.name}
                                selected={field.value === item.id}
                                onPress={() => field.onChange(item.id)}
                              />
                            ))}
                        </View>
                      </View>
                    )}
                  />
                </View>
              </View>
            </View>

            <SectionLabel>Pricing</SectionLabel>
            <View
              onLayout={(event) => setPricingOffset(event.nativeEvent.layout.y)}
              className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white"
            >
              <CardHeader
                icon="credit-card"
                title="Price and tax"
                description="Set the purchase cost, selling price, and tax treatment."
              />
              <View className="gap-5 p-5 md:flex-row">
                <View className="flex-1">
                  {renderTextField('cost', trackInventory ? 'Reference cost' : 'Cost', '₱0.00', {
                    keyboardType: 'decimal-pad',
                    helper: trackInventory
                      ? 'Starting cost only. Supplier receipts update the branch average cost.'
                      : 'Estimated cost used to calculate gross profit.',
                  })}
                </View>
                <View className="flex-1">
                  {renderTextField('sellingPrice', 'Selling price', '₱0.00', {
                    keyboardType: 'decimal-pad',
                    helper: 'Only changes when an authorized user saves a new price.',
                  })}
                </View>
                <View className="flex-1">
                  {renderTextField('taxRate', 'Tax rate (%)', '12.00', {
                    keyboardType: 'decimal-pad',
                  })}
                </View>
              </View>
              <Controller
                control={form.control}
                name="isTaxInclusive"
                render={({ field }) => (
                  <View className="min-h-20 flex-row items-center border-t border-slate-100 px-5 py-3">
                    <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                      <Feather name="percent" size={17} color="#64748B" />
                    </View>
                    <View className="flex-1 pr-3">
                      <Text className="font-medium text-slate-900">
                        Tax included in selling price
                      </Text>
                      <Text className="mt-1 text-xs leading-4 text-slate-500">
                        Turn on when the entered selling price already includes tax.
                      </Text>
                    </View>
                    <Switch
                      value={field.value}
                      disabled={incoming}
                      onValueChange={field.onChange}
                      trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                      thumbColor={field.value ? '#1A593B' : '#FFFFFF'}
                    />
                  </View>
                )}
              />
            </View>

            <SectionLabel>Inventory and units</SectionLabel>
            <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <CardHeader
                icon="box"
                title="Stock setup"
                description="Choose the base selling unit and whether stock should be deducted."
              />
              <Controller
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <View className="border-b border-slate-100 p-5">
                    <Text className="mb-1 font-medium text-slate-900">Base selling unit</Text>
                    <Text className="mb-4 text-xs leading-4 text-slate-500">
                      This is the smallest unit stored in inventory.
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {activeUnits.map((unitOption) => (
                        <ChoiceChip
                          key={unitOption.code}
                          label={unitOption.name || unitOption.code.toUpperCase()}
                          selected={field.value === unitOption.code}
                          onPress={() => field.onChange(unitOption.code)}
                        />
                      ))}
                    </View>
                  </View>
                )}
              />
              <Controller
                control={form.control}
                name="trackInventory"
                render={({ field }) => (
                  <View className="min-h-20 flex-row items-center border-b border-slate-100 px-5 py-3">
                    <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                      <Feather name="layers" size={17} color="#64748B" />
                    </View>
                    <View className="flex-1 pr-3">
                      <Text className="font-medium text-slate-900">Track inventory</Text>
                      <Text className="mt-1 text-xs leading-4 text-slate-500">
                        Turn off for cooked-to-order items or services without fixed stock.
                      </Text>
                    </View>
                    <Switch
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (!value) setOpeningQuantity('0');
                      }}
                      trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                      thumbColor={field.value ? '#1A593B' : '#FFFFFF'}
                    />
                  </View>
                )}
              />
              {trackInventory ? (
                isEditing ? (
                  <View className="flex-row items-center p-5">
                    <View className="flex-1 pr-4">
                      <Text className="font-medium text-slate-900">
                        Stock quantity is managed separately
                      </Text>
                      <Text className="mt-1 text-xs leading-5 text-slate-500">
                        Use a stock adjustment so every quantity change has a reason and audit
                        record.
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/stock-adjustment',
                          params: {
                            productId,
                            name: form.getValues('name'),
                            unit: form.getValues('unit'),
                          },
                        })
                      }
                      className="min-h-11 flex-row items-center rounded-xl bg-brand-50 px-4"
                    >
                      <Feather name="layers" size={15} color="#1A593B" />
                      <Text className="ml-2 text-sm font-medium text-brand-700">Adjust stock</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View className="p-5">
                    <Text className="mb-2 text-sm font-medium text-slate-700">
                      Opening stock · {branch.name}
                    </Text>
                    <TextInput
                      value={openingQuantity}
                      onChangeText={setOpeningQuantity}
                      editable={!incoming}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#A8A099"
                      selectionColor="#1A593B"
                      className={`min-h-12 rounded-xl border border-slate-200 px-4 text-base text-slate-900 focus:border-brand-700 ${
                        incoming ? 'bg-slate-100' : 'bg-white'
                      }`}
                    />
                    <Text className="mt-2 text-xs leading-4 text-slate-500">
                      {incoming
                        ? 'Stock stays at zero until this product is received from the purchase order.'
                        : 'Weight and volume items support up to three decimal places, such as 0.250 kg.'}
                    </Text>
                  </View>
                )
              ) : (
                <View className="flex-row bg-slate-50 p-5">
                  <Feather name="info" size={16} color="#64748B" />
                  <Text className="ml-2 flex-1 text-xs leading-5 text-slate-600">
                    Stock deductions are disabled. This product can still be sold normally.
                  </Text>
                </View>
              )}
            </View>

            <SectionLabel>Multiple selling units</SectionLabel>
            <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <View className="min-h-24 flex-row items-center p-5">
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Feather name="copy" size={17} color="#1A593B" />
                </View>
                <View className="flex-1 pr-3">
                  <Text className="font-semibold text-slate-950">
                    {isEditing ? 'Pack, box, and other units' : 'Sell this product another way'}
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-slate-500">
                    {isEditing
                      ? 'Manage every alternate selling unit, conversion, price, SKU, and barcode.'
                      : 'Example: keep inventory by piece while also selling a full pack or box.'}
                  </Text>
                </View>
                {isEditing ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: '/product-variants',
                        params: {
                          productId,
                          name: form.getValues('name'),
                          baseUnit: form.getValues('unit'),
                        },
                      })
                    }
                    className="min-h-11 flex-row items-center rounded-xl bg-brand-50 px-4"
                  >
                    <Feather name="settings" size={15} color="#1A593B" />
                    <Text className="ml-2 text-sm font-medium text-brand-700">Manage units</Text>
                  </Pressable>
                ) : (
                  <Switch
                    value={alternateEnabled}
                    onValueChange={(value) => {
                      setAlternateEnabled(value);
                      if (value && !alternateSku) {
                        setAlternateSku(`${form.getValues('sku')}-${alternateUnit.toUpperCase()}`);
                      }
                    }}
                    trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                    thumbColor={alternateEnabled ? '#1A593B' : '#FFFFFF'}
                  />
                )}
              </View>
              {!isEditing && alternateEnabled ? (
                <View className="border-t border-slate-100 p-5">
                  <Text className="mb-2 text-sm font-medium text-slate-700">
                    Alternate selling unit
                  </Text>
                  <View className="mb-5 flex-row flex-wrap gap-2">
                    {activeUnits
                      .filter((unit) => unit.code !== baseUnit)
                      .map((unitOption) => (
                        <ChoiceChip
                          key={unitOption.code}
                          label={unitOption.name || unitOption.code.toUpperCase()}
                          selected={alternateUnit === unitOption.code}
                          onPress={() => {
                            setAlternateUnit(unitOption.code);
                            const sku = form.getValues('sku');
                            if (sku) setAlternateSku(`${sku}-${unitOption.code.toUpperCase()}`);
                          }}
                        />
                      ))}
                  </View>

                  <View className="mb-5 flex-row items-start rounded-2xl bg-brand-50 p-4">
                    <Feather name="repeat" size={16} color="#1A593B" />
                    <Text className="ml-2 flex-1 text-sm leading-5 text-brand-900">
                      Selling 1 {alternateUnit} will deduct {unitsPerAlternate || '0'} {baseUnit}{' '}
                      from inventory.
                    </Text>
                  </View>

                  <View className="gap-5 md:flex-row">
                    <View className="flex-1">
                      <Text className="mb-2 text-sm font-medium text-slate-700">
                        {baseUnit} in one {alternateUnit}
                      </Text>
                      <TextInput
                        value={unitsPerAlternate}
                        onChangeText={setUnitsPerAlternate}
                        keyboardType="decimal-pad"
                        placeholder="Example: 10"
                        placeholderTextColor="#A8A099"
                        className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 focus:border-brand-700"
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="mb-2 text-sm font-medium text-slate-700">
                        {alternateUnit} selling price
                      </Text>
                      <TextInput
                        value={alternatePrice}
                        onChangeText={setAlternatePrice}
                        keyboardType="decimal-pad"
                        placeholder="₱0.00"
                        placeholderTextColor="#A8A099"
                        className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 focus:border-brand-700"
                      />
                    </View>
                  </View>
                  <View className="mt-5 gap-5 md:flex-row">
                    <View className="flex-1">
                      <Text className="mb-2 text-sm font-medium text-slate-700">
                        {alternateUnit} SKU
                      </Text>
                      <TextInput
                        value={alternateSku}
                        onChangeText={setAlternateSku}
                        autoCapitalize="characters"
                        placeholder={`SKU-${alternateUnit.toUpperCase()}`}
                        placeholderTextColor="#A8A099"
                        className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 focus:border-brand-700"
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="mb-2 text-sm font-medium text-slate-700">
                        {alternateUnit} barcode
                      </Text>
                      <View className="flex-row gap-2">
                        <TextInput
                          value={alternateBarcode}
                          onChangeText={setAlternateBarcode}
                          keyboardType="number-pad"
                          placeholder="Optional barcode"
                          placeholderTextColor="#A8A099"
                          className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 focus:border-brand-700"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Scan ${alternateUnit} barcode with camera`}
                          onPress={() => void openScanner('alternate')}
                          className={`h-12 w-12 items-center justify-center rounded-xl ${
                            scannerEnabled ? 'bg-brand-700 active:opacity-80' : 'bg-slate-200'
                          }`}
                        >
                          <Feather
                            name="camera"
                            size={19}
                            color={scannerEnabled ? '#FFFFFF' : '#64748B'}
                          />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <SectionLabel>Recipe & Ingredients (BOM)</SectionLabel>
            <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <View className="min-h-20 flex-row items-center justify-between p-5">
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Feather name="coffee" size={17} color="#1A593B" />
                </View>
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-slate-900">
                    Composite product recipe (BOM)
                  </Text>
                  <Text className="mt-1 text-xs leading-4 text-slate-500">
                    Deduct raw inventory ingredients (e.g. coffee beans, milk, cups) on sale checkout.
                  </Text>
                </View>
                <Switch
                  value={recipeEnabled}
                  onValueChange={(val) => {
                    setRecipeEnabled(val);
                    if (!val) setRecipeItems([]);
                  }}
                  trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                  thumbColor={recipeEnabled ? '#1A593B' : '#FFFFFF'}
                />
              </View>

              {recipeEnabled ? (
                <View className="border-t border-slate-100 p-5">
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    1. Select Raw Ingredient Item
                  </Text>
                {availableIngredients.length === 0 ? (
                  <View className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <Text className="text-xs font-medium text-amber-900">
                      No other products in inventory yet
                    </Text>
                    <Text className="mt-1 text-xs leading-4 text-amber-800">
                      Create raw inventory items first (e.g., Coffee Beans, Fresh Milk, Cups) in
                      Products, then you can select and link them here as ingredients.
                    </Text>
                  </View>
                ) : (
                  <View className="mb-4">
                    <Text className="mb-2 text-xs font-medium text-slate-600">
                      Tap a product to add as ingredient:
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {availableIngredients.map((ing: { id: string; name: string; cost: string; unit: string }) => {
                        const selected = recipeSelectedIngredientId === ing.id;
                        return (
                          <Pressable
                            key={ing.id}
                            onPress={() => {
                              setRecipeSelectedIngredientId(ing.id);
                              setRecipeUnitInput(ing.unit || 'piece');
                            }}
                            className={`flex-row items-center rounded-xl border px-3 py-2.5 ${
                              selected
                                ? 'border-brand-700 bg-brand-700'
                                : 'border-slate-200 bg-slate-50 active:bg-slate-100'
                            }`}
                          >
                            <Feather
                              name={selected ? 'check-circle' : 'box'}
                              size={14}
                              color={selected ? '#FFFFFF' : '#64748B'}
                            />
                            <Text
                              className={`ml-2 text-xs font-semibold ${
                                selected ? 'text-white' : 'text-slate-800'
                              }`}
                            >
                              {ing.name}
                            </Text>
                            <Text
                              className={`ml-1.5 text-[11px] ${
                                selected ? 'text-brand-100' : 'text-slate-400'
                              }`}
                            >
                              ({formatMoney(ing.cost || '0.00')}/{ing.unit || 'pc'})
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  2. Quantity Used per Serving
                </Text>
                <View className="mb-3">
                  <Text className="mb-1 text-xs font-medium text-slate-700">Select Unit</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {[
                      { code: 'piece', label: 'Piece (pc)' },
                      { code: 'g', label: 'Grams (g)' },
                      { code: 'kg', label: 'Kg (kg)' },
                      { code: 'ml', label: 'Milliliters (ml)' },
                      { code: 'l', label: 'Liters (L)' },
                      { code: 'serving', label: 'Serving' },
                      { code: 'pack', label: 'Pack' },
                      { code: 'box', label: 'Box' },
                    ].map((u) => {
                      const selected = recipeUnitInput === u.code;
                      return (
                        <Pressable
                          key={u.code}
                          onPress={() => setRecipeUnitInput(u.code)}
                          className={`rounded-lg border px-2.5 py-1.5 ${
                            selected
                              ? 'border-brand-700 bg-brand-700'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <Text
                            className={`text-xs font-medium ${
                              selected ? 'text-white' : 'text-slate-700'
                            }`}
                          >
                            {u.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="mb-1 text-xs font-medium text-slate-700">
                      Qty per Serving
                    </Text>
                    <TextInput
                      value={recipeQtyInput}
                      onChangeText={setRecipeQtyInput}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 0.018"
                      className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-brand-700"
                    />
                  </View>
                  <Pressable
                    onPress={() => {
                      if (!recipeSelectedIngredientId) return;
                      const ing = availableIngredients.find(
                        (p: { id: string; name: string; cost: string; unit: string }) => p.id === recipeSelectedIngredientId,
                      );
                      if (!ing) return;
                      const qty = parseFloat(recipeQtyInput) || 1;
                      setRecipeItems((prev) => [
                        ...prev.filter((i) => i.ingredientProductId !== ing.id),
                        {
                          ingredientProductId: ing.id,
                          ingredientName: ing.name,
                          quantityRequired: qty,
                          unit: recipeUnitInput || ing.unit || 'piece',
                          cost: ing.cost || '0.00',
                        },
                      ]);
                      setRecipeSelectedIngredientId('');
                      setRecipeQtyInput('1');
                    }}
                    disabled={!recipeSelectedIngredientId}
                    className={`mt-5 min-h-11 flex-row items-center justify-center rounded-xl px-5 active:opacity-80 ${
                      recipeSelectedIngredientId ? 'bg-brand-700' : 'bg-slate-200'
                    }`}
                  >
                    <Feather
                      name="plus"
                      size={15}
                      color={recipeSelectedIngredientId ? '#FFFFFF' : '#94A3B8'}
                    />
                    <Text
                      className={`ml-1 text-xs font-bold ${
                        recipeSelectedIngredientId ? 'text-white' : 'text-slate-400'
                      }`}
                    >
                      Add Ingredient
                    </Text>
                  </Pressable>
                </View>

                {recipeItems.length > 0 ? (
                  <View className="mt-4 gap-2">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Added Ingredients ({recipeItems.length})
                    </Text>
                    {recipeItems.map((item) => (
                      <View
                        key={item.ingredientProductId}
                        className="flex-row items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <View className="flex-1 pr-2">
                          <Text className="text-sm font-semibold text-slate-900">
                            {item.ingredientName}
                          </Text>
                          <Text className="text-xs text-emerald-700">
                            {item.quantityRequired} {item.unit} per serving (Est.{' '}
                            {formatMoney((parseFloat(item.cost) * item.quantityRequired).toFixed(2))})
                          </Text>
                        </View>
                        <Pressable
                          onPress={() =>
                            setRecipeItems((prev) =>
                              prev.filter((i) => i.ingredientProductId !== item.ingredientProductId),
                            )
                          }
                          className="h-8 w-8 items-center justify-center rounded-lg bg-rose-50 border border-rose-200"
                        >
                          <Feather name="trash-2" size={14} color="#E11D48" />
                        </Pressable>
                      </View>
                    ))}
                    <View className="mt-2 flex-row items-center justify-between rounded-2xl bg-brand-50 p-3 border border-brand-100">
                      <Text className="text-xs font-medium text-brand-900">Est. Raw Material Cost:</Text>
                      <Text className="text-sm font-bold text-brand-900">
                        {formatMoney(
                          recipeItems
                            .reduce(
                              (sum, i) => sum + parseFloat(i.cost || '0') * i.quantityRequired,
                              0,
                            )
                            .toFixed(2),
                        )}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <SectionLabel>Other settings</SectionLabel>
            <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <CardHeader
                icon="settings"
                title="Media and availability"
                description="Add an optional image and control whether the product appears in POS."
              />
              <View className="p-5">
                {renderTextField('imagePath', 'Image path', '/images/product.png', {
                  autoCapitalize: 'none',
                  helper: 'Optional. You can add or change the product image later.',
                })}
              </View>
              {incoming ? (
                <View className="min-h-20 flex-row items-center border-t border-slate-100 bg-amber-50 px-5 py-3">
                  <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                    <Feather name="clock" size={17} color="#B45309" />
                  </View>
                  <View className="flex-1 pr-3">
                    <Text className="font-medium text-amber-900">Hidden until received</Text>
                    <Text className="mt-1 text-xs leading-4 text-amber-800">
                      The product will automatically become available after its first stock receipt.
                    </Text>
                  </View>
                  <Text className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-800">
                    Incoming
                  </Text>
                </View>
              ) : (
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => {
                    const enabled = field.value === 'active';
                    return (
                      <View className="min-h-20 flex-row items-center border-t border-slate-100 px-5 py-3">
                        <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                          <Feather name="eye" size={17} color="#64748B" />
                        </View>
                        <View className="flex-1 pr-3">
                          <Text className="font-medium text-slate-900">Available for sale</Text>
                          <Text className="mt-1 text-xs leading-4 text-slate-500">
                            Turn off to hide the product from POS without deleting its history.
                          </Text>
                        </View>
                        <Switch
                          value={enabled}
                          onValueChange={(value) => field.onChange(value ? 'active' : 'inactive')}
                          trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                          thumbColor={enabled ? '#1A593B' : '#FFFFFF'}
                        />
                      </View>
                    );
                  }}
                />
              )}
            </View>

            <View className="rounded-3xl border border-slate-200 bg-white p-4">
              <View className="gap-3 sm:flex-row">
                <Pressable
                  accessibilityRole="button"
                  disabled={mutation.isPending}
                  onPress={() => router.back()}
                  className="min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 sm:w-40"
                >
                  <Text className="font-medium text-slate-700">Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={mutation.isPending}
                  onPress={form.handleSubmit((value) => mutation.mutate(value))}
                  className={`min-h-14 flex-1 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 ${
                    mutation.isPending ? 'opacity-50' : 'active:opacity-80'
                  }`}
                >
                  <Feather name="check" size={18} color="#FFFFFF" />
                  <Text className="ml-2 text-base font-semibold text-white">
                    {mutation.isPending
                      ? 'Saving…'
                      : isEditing
                        ? 'Save changes'
                        : addToCart
                          ? 'Save and add to cart'
                          : incoming
                            ? 'Register incoming product'
                            : 'Save product'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={scannerTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setScannerTarget(null);
          setScanChecking(false);
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/70 p-4">
          <View className="w-full max-w-xl overflow-hidden rounded-3xl bg-white">
            <View className="flex-row items-start justify-between p-5">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-semibold text-slate-950">
                  {scannerTarget === 'alternate'
                    ? `Scan ${alternateUnit} barcode`
                    : 'Scan product barcode'}
                </Text>
                <Text className="mt-1 text-sm leading-5 text-slate-500">
                  Hold the barcode inside the frame. It will be entered automatically.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close barcode scanner"
                onPress={() => {
                  setScannerTarget(null);
                  setScanChecking(false);
                }}
                className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={20} color="#475569" />
              </Pressable>
            </View>
            <View className="h-80 bg-black">
              {cameraPermission?.granted && scannerTarget ? (
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: [...CAMERA_BARCODE_TYPES] }}
                  onBarcodeScanned={scanChecking ? undefined : handleCameraScan}
                >
                  <View className="flex-1 items-center justify-center">
                    <View className="h-32 w-[82%] max-w-sm rounded-2xl border-2 border-white" />
                    <View className="mt-4 rounded-full bg-black/60 px-4 py-2">
                      <Text className="text-sm font-medium text-white">
                        {scanChecking ? 'Checking barcode…' : 'Ready to scan'}
                      </Text>
                    </View>
                  </View>
                </CameraView>
              ) : null}
            </View>
            <View className="flex-row items-start bg-slate-50 p-4">
              <Feather name="shield" size={16} color="#64748B" />
              <Text className="ml-2 flex-1 text-xs leading-5 text-slate-600">
                The camera is used only to read the barcode. No photo or video is saved.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function ProductFormScreen() {
  return (
    <AppSidebarProvider>
      <ProductFormContent />
    </AppSidebarProvider>
  );
}
