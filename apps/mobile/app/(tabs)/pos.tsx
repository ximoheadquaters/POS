import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { minorToMoney, moneyToMinor, type POSBarcodeItem } from '@ximo/shared';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useIosAlert } from '@/providers/ios-alert';
import { liveDataQueryOptions } from '@/lib/live-data';
import {
  comboCartLines,
  comboSoldOut,
  type PosComboPromotion,
} from '@/lib/combo-cart';
import { evaluateCartPromotions, type PromotionRule } from '@/lib/promo-evaluator';
import { fetchPosCombos } from '@/lib/pos-combos';
import { findExactScannedProduct, normalizeBarcode } from '@/lib/product-scan';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { useAppSidebar } from '@/components/app-sidebar';
import { Button, EmptyState, ErrorState, Field, Header, LoadingState, Screen } from '@/components/ui';
import { QuantityInput } from '@/components/quantity-input';
import { getHardwareDriver } from '@/hardware/registry';
import { useSession } from '@/providers/session';
import {
  cartLineTotal,
  cartProductKey,
  cartSubtotal,
  cartTotal,
  hasCartStockConflict,
  quantityStep,
  selectSellingUnit,
  useCartStore,
  type CartProduct,
  type SellingUnit,
} from '@/store/cart';

type PosRow =
  | { kind: 'product'; key: string; product: CartProduct }
  | { kind: 'combo'; key: string; promo: PosComboPromotion };
import { useBranchStore } from '@/store/branch';
import { useShiftStore } from '@/store/shift';
import { useConnectivityStore } from '@/store/connectivity';

function categoryIcon(name: string): ComponentProps<typeof Feather>['name'] {
  const normalized = name.toLowerCase();
  if (normalized === 'combos') return 'gift';
  if (normalized.includes('beverage') || normalized.includes('water')) return 'droplet';
  if (normalized.includes('coffee')) return 'coffee';
  if (normalized.includes('snack')) return 'package';
  if (normalized.includes('noodle') || normalized.includes('food')) return 'crosshair';
  return 'grid';
}

function productIcon(name: string): ComponentProps<typeof Feather>['name'] {
  const normalized = name.toLowerCase();
  if (normalized.includes('cola') || normalized.includes('pepsi') || normalized.includes('water'))
    return 'droplet';
  if (normalized.includes('coffee') || normalized.includes('nescafe')) return 'coffee';
  return 'package';
}

function SellingUnitModal({
  product,
  onClose,
  onSelect,
}: {
  product: CartProduct | null;
  onClose(): void;
  onSelect(unit?: SellingUnit): void;
}) {
  if (!product) return null;
  const options: Array<SellingUnit | undefined> = [undefined, ...(product.sellingUnits ?? [])];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/35" onPress={onClose}>
        <Pressable
          className="rounded-t-3xl bg-white p-5 pb-10"
          onPress={(event) => event.stopPropagation()}
        >
          <View className="mb-4 flex-row items-center">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-slate-900">{product.name}</Text>
              <Text className="mt-1 text-sm text-slate-500">Choose how this item is sold</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close unit selection"
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
            >
              <Feather name="x" size={18} color="#6B6158" />
            </Pressable>
          </View>
          <View className="gap-2">
            {options.map((unit) => {
              const selected = selectSellingUnit(product, unit);
              const available = selected.availableQuantity;
              const disabled = typeof available === 'number' && available < quantityStep(selected);
              return (
                <Pressable
                  key={unit?.variantId ?? 'base'}
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => onSelect(unit)}
                  className={`flex-row items-center rounded-2xl border border-slate-200 p-4 ${
                    disabled ? 'opacity-40' : 'active:border-brand-400 active:bg-brand-50'
                  }`}
                >
                  <View className="flex-1">
                    <Text className="font-medium text-slate-900">
                      {unit?.name ?? `Per ${product.unit ?? 'piece'}`}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-500">
                      {unit
                        ? `${unit.unitsPerBase} ${product.unit ?? 'piece'} per ${unit.unit}`
                        : `Deducts 1 ${product.unit ?? 'piece'}`}
                    </Text>
                    {typeof available === 'number' ? (
                      <Text className="mt-1 text-xs text-slate-400">
                        {available} {selected.unit} available
                      </Text>
                    ) : null}
                  </View>
                  <Text className="font-semibold text-brand-700">
                    {formatMoney(selected.sellingPrice)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function PosScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 900;
  const { currentUser } = useSession();
  const sidebar = useAppSidebar();
  const inputRef = useRef<TextInput>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('All');
  const [scanPending, setScanPending] = useState(false);
  const [unitProduct, setUnitProduct] = useState<CartProduct | null>(null);
  const queryClient = useQueryClient();
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const addQuantity = useCartStore((state) => state.addQuantity);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const clearCart = useCartStore((state) => state.clear);
  const syncProducts = useCartStore((state) => state.syncProducts);
  const branch = useBranchStore((state) => state.activeBranch);
  const promotionsEnabled = currentUser?.modules.includes('promotions') ?? false;
  const activeShift = useShiftStore((state) => state.activeShift);
  const hydrateShift = useShiftStore((state) => state.hydrate);
  const reservedByProduct = useConnectivityStore((state) => state.reservedByProduct);
  const { showAlert } = useIosAlert();
  const [holdModalVisible, setHoldModalVisible] = useState(false);
  const [holdNote, setHoldNote] = useState('');

  const activePromotionsQuery = useQuery({
    queryKey: ['pos-active-promotions-rules', branch?.id],
    queryFn: async () => {
      if (!branch?.id) return [];
      const res = await api<any[]>(`/promotions?branchId=${branch.id}&pageSize=50`);
      const list = Array.isArray(res) ? res : (res as any)?.pages?.flat() ?? (res as any)?.data ?? [];
      return list.filter((p: any) => p.isActive);
    },
    enabled: Boolean(branch?.id),
  });

  const activePromo = useMemo(
    () => evaluateCartPromotions(items, (activePromotionsQuery.data ?? []) as PromotionRule[]),
    [items, activePromotionsQuery.data],
  );

  const posSubtotal = useMemo(() => cartSubtotal(items), [items]);
  const posTotal = useMemo(
    () => cartTotal(items, activePromo?.discountMoney || '0.00'),
    [items, activePromo],
  );

  const heldSalesQuery = useQuery({
    queryKey: ['pos-held-sales-count', branch?.id],
    queryFn: async () => {
      if (!branch?.id) return [];
      const res = await api<any[]>(`/sales/held?branchId=${branch.id}`);
      return Array.isArray(res) ? res : (res as any)?.data ?? [];
    },
    enabled: Boolean(branch?.id),
  });
  const heldCount = heldSalesQuery.data?.length ?? 0;

  const holdMutation = useMutation({
    mutationFn: () =>
      api<{ receiptNumber: string }>('/sales/hold', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branch?.id,
          shiftId: activeShift?.id,
          customerId: useCartStore.getState().customerId,
          note: holdNote.trim() || undefined,
          items: items.map((item) => ({
            productId: item.product.id,
            variantId: item.product.variantId ?? undefined,
            quantity: item.quantity,
          })),
        }),
      }),
    onSuccess: (data) => {
      setHoldModalVisible(false);
      setHoldNote('');
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['pos-held-sales-count'] });
      queryClient.invalidateQueries({ queryKey: ['food-parked-sales'] });
      showAlert({
        title: 'Sale Parked',
        message: `Order parked as ${data.receiptNumber}. You can resume it anytime from Parked Sales.`,
        type: 'success',
      });
    },
    onError: (error) =>
      showAlert({
        title: 'Could Not Hold Sale',
        message: error.message,
        type: 'error',
      }),
  });

  const focusInput = () => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebounced(text.trim());
    }, 300);
  };

  useEffect(() => void hydrateShift(), [hydrateShift]);

  // Auto-focus search input on mount and cleanup timer on unmount
  useEffect(() => {
    focusInput();
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Global key listener for web / desktop hardware barcode scanners
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true');

      if (isInputFocused || unitProduct !== null) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'Tab' || e.key === 'Escape') return;

      inputRef.current?.focus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unitProduct]);

  const query = useInfiniteQuery({
    queryKey: ['pos-products', branch?.id, debounced],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<CartProduct[]>(
        `/products?usage=pos&branchId=${branch!.id}&page=${pageParam}&pageSize=30${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`,
      ),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 30 ? allPages.length + 1 : undefined,
    ...liveDataQueryOptions,
  });
  const promotionsQuery = useQuery({
    queryKey: ['pos-promotions', branch?.id, debounced],
    enabled: Boolean(branch),
    queryFn: () => fetchPosCombos(branch!.id, debounced || undefined),
    ...liveDataQueryOptions,
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const availableProducts = useMemo(
    () =>
      products.map((product) => {
        const reserved = reservedByProduct[product.id] ?? 0;
        return typeof product.availableQuantity === 'number'
          ? { ...product, availableQuantity: Math.max(0, product.availableQuantity - reserved) }
          : product;
      }),
    [products, reservedByProduct],
  );
  const combos = useMemo(() => {
    const rows = promotionsQuery.data ?? [];
    return rows.map((promo) => ({
      ...promo,
      components: promo.components.map((component) => {
        const reserved = reservedByProduct[component.id] ?? 0;
        return typeof component.availableQuantity === 'number'
          ? {
              ...component,
              availableQuantity: Math.max(0, component.availableQuantity - reserved),
            }
          : component;
      }),
    }));
  }, [promotionsQuery.data, reservedByProduct]);
  const categories = useMemo(() => {
    const names = [
      'All',
      ...(combos.length ? ['Combos'] : []),
      ...Array.from(
        new Set(
          availableProducts
            .map((product) => product.categoryName)
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    ];
    return names;
  }, [availableProducts, combos.length]);
  const visibleRows = useMemo((): PosRow[] => {
    const comboRows: PosRow[] = combos.map((promo) => ({
      kind: 'combo',
      key: `combo:${promo.id}`,
      promo,
    }));
    const productRows: PosRow[] = availableProducts.map((product) => ({
      kind: 'product',
      key: product.id,
      product,
    }));
    if (category === 'Combos') return comboRows;
    if (category === 'All') return [...comboRows, ...productRows];
    return productRows.filter(
      (row) => row.kind === 'product' && row.product.categoryName === category,
    );
  }, [availableProducts, category, combos]);
  const cartQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(
        item.product.id,
        (quantities.get(item.product.id) ?? 0) + item.quantity * (item.product.unitsPerBase ?? 1),
      );
    }
    return quantities;
  }, [items]);
  const hasStockConflict = hasCartStockConflict(items);
  const scannerEnabled = currentUser?.modules.includes('barcode_scanner') ?? false;
  const customerDisplayEnabled = currentUser?.modules.includes('customer_display') ?? false;

  async function handleBarcodeScan(scannedValue: string) {
    const barcode = normalizeBarcode(scannedValue);
    if (!barcode || !branch) return;

    setScanPending(true);
    try {
      const item = await api<POSBarcodeItem>(
        `/pos/barcodes/${encodeURIComponent(barcode)}?branchId=${branch.id}`,
      );

      const cartProduct: CartProduct = {
        id: item.productId,
        name: item.productName,
        sku: item.barcode,
        unit: item.sellingUnitCode,
        sellingPrice: item.unitPrice,
        taxRate: item.taxRate ?? '0.00',
        isTaxInclusive: item.isTaxInclusive ?? true,
        unitsPerBase: item.baseUnitsPerSellingUnit,
        availableQuantity: item.currentStock ? parseFloat(item.currentStock) : undefined,
        variantId: item.productVariantId ?? undefined,
        sellingUnits: [],
      };

      const sellingUnit: SellingUnit | undefined = item.productVariantId
        ? {
            variantId: item.productVariantId,
            name: item.sellingUnitName,
            sku: item.barcode,
            unit: item.sellingUnitCode,
            unitsPerBase: item.baseUnitsPerSellingUnit,
            sellingPrice: item.unitPrice,
            barcodes: [item.barcode],
          }
        : undefined;

      const cartItem = selectSellingUnit(cartProduct, sellingUnit);
      add(cartItem);

      showAlert({
        title: 'Item Added',
        message: `${item.productName} — 1 ${item.sellingUnitName} added to cart.`,
        type: 'success',
      });
    } catch (error: any) {
      const fallback = findExactScannedProduct(availableProducts, barcode);
      if (fallback) {
        add(fallback);
        showAlert({
          title: 'Item Added',
          message: `${fallback.name} added to cart.`,
          type: 'success',
        });
        return;
      }

      const msg = error?.message || 'No product is assigned to this barcode.';
      showAlert({
        title: 'Barcode Lookup',
        message:
          msg.includes('404') || msg.includes('NOT_FOUND')
            ? `No product is assigned to barcode "${barcode}".`
            : msg,
        type: 'error',
      });
    } finally {
      setScanPending(false);
    }
  }

  useBarcodeScanner({
    onScan: handleBarcodeScan,
    enabled: true,
  });

  useEffect(() => {
    syncProducts(availableProducts);
  }, [availableProducts, syncProducts]);

  useEffect(() => {
    if (!customerDisplayEnabled || !currentUser) return;
    const display = getHardwareDriver('customer_display');
    void display
      .status()
      .then((status) => {
        if (status.state !== 'ready') return;
        return display.show({
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          total: cartTotal(items),
          currency: currentUser.organization.currency,
        });
      })
      .catch(() => undefined);
  }, [customerDisplayEnabled, currentUser, items]);

  const addProduct = (product: CartProduct, sellingUnit?: SellingUnit) => {
    if (!sellingUnit && product.sellingUnits?.length) {
      setUnitProduct(product);
      return;
    }
    add(selectSellingUnit(product, sellingUnit));
    setUnitProduct(null);
    focusInput();
  };

  const addCombo = (promo: PosComboPromotion) => {
    if (comboSoldOut(promo, cartQuantities)) {
      showAlert({
        title: 'Not enough stock',
        message: `One or more items in “${promo.name}” are out of stock for this combo.`,
        type: 'error',
      });
      return;
    }
    for (const line of comboCartLines(promo)) {
      addQuantity(line.product, line.quantity);
    }
    showAlert({
      title: 'Combo added',
      message: `${promo.name} added at ${formatMoney(promo.comboPrice)}.`,
      type: 'success',
    });
    focusInput();
  };

  const submitBarcode = async () => {
    const barcode = search.trim();
    if (!scannerEnabled || !barcode || scanPending) return;

    // Clear pending debounce timer so barcode scanning doesn't trigger product catalog search refetch
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setScanPending(true);
    try {
      // Look up in loaded products first (fast local match, zero API calls, zero catalog refetch)
      const localMatch = findExactScannedProduct(availableProducts, barcode);
      let exact: CartProduct | null = localMatch ?? null;

      if (!exact) {
        exact = await api<CartProduct | null>(
          `/products/lookup?usage=pos&code=${encodeURIComponent(barcode)}&branchId=${branch!.id}`,
        );
      }

      if (!exact) {
        if (currentUser?.permissions.includes('products:manage')) {
          Alert.alert('New product', `Barcode ${barcode} is not in the catalogue. Add it now?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add product',
              onPress: () =>
                router.push({
                  pathname: '/product-form',
                  params: { barcode, addToCart: '1' },
                }),
            },
          ]);
        } else {
          Alert.alert(
            'Product not found',
            'Ask an owner or manager to add this barcode before selling it.',
          );
        }
        return;
      }
      if (exact.status === 'inactive') {
        Alert.alert('Product is inactive', 'Ask an owner or manager to reactivate this product.');
        return;
      }
      if (
        exact.availableQuantity !== null &&
        exact.availableQuantity !== undefined &&
        exact.availableQuantity <= 0
      ) {
        Alert.alert(
          'Product is sold out',
          'Stock changed on another register. Refreshing products.',
        );
        await query.refetch();
        return;
      }
      const matchedSellingUnit = exact.sellingUnits?.find(
        (unit) => unit.sku === barcode || unit.barcodes?.includes(barcode),
      );
      const baseMatches = exact.sku === barcode || exact.barcodes?.includes(barcode);
      if (matchedSellingUnit) addProduct(exact, matchedSellingUnit);
      else if (baseMatches) addProduct({ ...exact, sellingUnits: [] });
      else addProduct(exact);

      setSearch('');
      if (debounced !== '') {
        setDebounced('');
      }
    } catch (error) {
      Alert.alert(
        'Could not scan product',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setScanPending(false);
      focusInput();
    }
  };

  if (isTablet) {
    const subtotal = cartSubtotal(items);
    const total = cartTotal(items);
    const tax = minorToMoney(moneyToMinor(total) - moneyToMinor(subtotal));
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
      <Screen>
        <SellingUnitModal
          product={unitProduct}
          onClose={() => {
            setUnitProduct(null);
            focusInput();
          }}
          onSelect={(unit) => {
            if (!unitProduct) return;
            add(selectSellingUnit(unitProduct, unit));
            setUnitProduct(null);
            focusInput();
          }}
        />
        <View className="flex-row items-center border-b border-slate-200 bg-white px-4 py-2">
          {sidebar?.compact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
              onPress={sidebar.openMenu}
              className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand-50"
            >
              <Feather name="menu" size={22} color="#1A593B" />
            </Pressable>
          ) : null}
          <View className="w-48">
            <Text className="text-lg font-semibold text-slate-900">Point of Sale</Text>
            <Text className="text-xs text-slate-500">
              {activeShift ? activeShift.registerName : branch?.name}
            </Text>
          </View>
          <View className="mx-4 max-w-xl flex-1 flex-row items-center rounded-xl bg-slate-100 px-4 border border-slate-200 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-200">
            <Feather name="search" size={17} color="#81776E" />
            <TextInput
              ref={inputRef}
              value={search}
              onChangeText={handleSearchChange}
              autoCapitalize="none"
              placeholder="Search name, SKU, or scan barcode"
              placeholderTextColor="#81776E"
              selectionColor="#1A593B"
              returnKeyType={scannerEnabled ? 'done' : 'search'}
              onSubmitEditing={(e: any) => {
                if (e && e.preventDefault) e.preventDefault();
                void submitBarcode();
              }}
              blurOnSubmit={false}
              autoFocus
              style={{ outline: 'none' }}
              className="ml-2 min-h-11 flex-1 text-sm text-slate-900 bg-transparent"
            />
          </View>
          {scannerEnabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan product with camera"
              onPress={() => router.push({ pathname: '/product-scan', params: { addToCart: '1' } })}
              className="min-h-11 flex-row items-center rounded-xl px-3 active:bg-brand-50"
            >
              <Feather name="camera" size={17} color="#1A593B" />
              <Text className="text-sm font-medium text-brand-700">Use camera</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="flex-1 flex-row bg-[#F5F6F8]">
          <View className="flex-1 px-4 py-3">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-2 max-h-11"
              contentContainerClassName="gap-2"
            >
              {categories.map((name) => {
                const selected = name === category;
                return (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setCategory(name);
                      focusInput();
                    }}
                    className={`min-h-9 items-center justify-center rounded-full px-4 ${
                      selected ? 'bg-brand-700' : 'border border-slate-200 bg-white'
                    }`}
                  >
                    <View className="flex-row items-center gap-2">
                      {name !== 'All' ? (
                        <Feather
                          name={categoryIcon(name)}
                          size={13}
                          color={selected ? '#FFFFFF' : '#81776E'}
                        />
                      ) : null}
                      <Text
                        className={`text-xs font-medium ${
                          selected ? 'text-white' : 'text-slate-600'
                        }`}
                      >
                        {name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text className="mb-2 text-xs text-slate-400">
              Scanner ready — scan a barcode or type it, then press Enter
            </Text>
            <View className="flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {query.isLoading ? (
                <LoadingState label="Loading products…" />
              ) : query.isError ? (
                <ErrorState message={query.error.message} retry={() => void query.refetch()} />
              ) : (
                <FlatList
                  data={visibleRows}
                  keyExtractor={(item) => item.key}
                  onEndReached={() =>
                    category !== 'Combos' && query.hasNextPage && void query.fetchNextPage()
                  }
                  contentContainerClassName="pb-2"
                  ListEmptyComponent={
                    promotionsQuery.isError && (category === 'All' || category === 'Combos') ? (
                      <ErrorState
                        message={promotionsQuery.error.message}
                        retry={() => void promotionsQuery.refetch()}
                      />
                    ) : (
                      <EmptyState
                        title={category === 'Combos' ? 'No combos' : 'No products'}
                        message={
                          category === 'Combos'
                            ? 'Create an active combo bundle with products in Promotions, then refresh POS.'
                            : 'Try a different search or category.'
                        }
                      />
                    )
                  }
                  renderItem={({ item, index }) => {
                    if (item.kind === 'combo') {
                      const soldOut = comboSoldOut(item.promo, cartQuantities);
                      const summary = item.promo.components
                        .map((component) =>
                          component.requiredQuantity > 1
                            ? `${component.requiredQuantity}× ${component.name}`
                            : component.name,
                        )
                        .join(' + ');
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add combo ${item.promo.name} to cart`}
                          disabled={soldOut}
                          onPress={() => addCombo(item.promo)}
                          className={`min-h-16 flex-row items-center border-b border-slate-100 px-4 ${
                            soldOut ? 'opacity-50' : 'active:bg-brand-50'
                          }`}
                        >
                          <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-rose-50">
                            <Feather name="gift" size={18} color="#BE123C" />
                          </View>
                          <View className="flex-1">
                            <View className="flex-row items-center gap-2">
                              <Text className="font-medium text-slate-900">{item.promo.name}</Text>
                              <View className="rounded-full bg-rose-100 px-2 py-0.5">
                                <Text className="text-[9px] font-semibold uppercase text-rose-700">
                                  Combo
                                </Text>
                              </View>
                            </View>
                            <Text className="mt-0.5 text-[10px] text-slate-400" numberOfLines={1}>
                              {summary}
                            </Text>
                          </View>
                          <Text className="w-24 text-right text-base font-semibold text-slate-900">
                            {formatMoney(item.promo.comboPrice)}
                          </Text>
                          <View className="ml-3 h-8 w-8 items-center justify-center rounded-full bg-brand-700">
                            <Feather name="plus" size={16} color="#FFFFFF" />
                          </View>
                        </Pressable>
                      );
                    }

                    const product = item.product;
                    const quantity = cartQuantities.get(product.id) ?? 0;
                    const soldOut =
                      product.availableQuantity !== null &&
                      product.availableQuantity !== undefined &&
                      (product.availableQuantity <= 0 || quantity >= product.availableQuantity);
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${product.name} to cart`}
                        disabled={soldOut}
                        onPress={() => addProduct(product)}
                        className={`min-h-16 flex-row items-center border-b border-slate-100 px-4 ${
                          soldOut ? 'opacity-50' : 'active:bg-brand-50'
                        }`}
                      >
                        <View
                          className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${
                            index % 3 === 0
                              ? 'bg-blue-50'
                              : index % 3 === 1
                                ? 'bg-amber-50'
                                : 'bg-brand-50'
                          }`}
                        >
                          <Feather
                            name={productIcon(product.name)}
                            size={18}
                            color={
                              index % 3 === 0 ? '#3867F4' : index % 3 === 1 ? '#B45309' : '#1A593B'
                            }
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="font-medium text-slate-900">{product.name}</Text>
                          <Text className="mt-0.5 text-[10px] uppercase text-slate-400">
                            {product.sku}
                          </Text>
                        </View>
                        <Text className="w-28 text-right text-xs text-slate-400">
                          {product.availableQuantity === null ||
                          product.availableQuantity === undefined
                            ? quantity
                              ? `${quantity} in order`
                              : ''
                            : `${product.availableQuantity} ${product.unit ?? 'piece'} in stock`}
                        </Text>
                        <Text className="w-24 text-right text-base font-semibold text-slate-900">
                          {formatMoney(product.sellingPrice)}
                        </Text>
                        <View className="ml-3 h-8 w-8 items-center justify-center rounded-full bg-brand-700">
                          <Feather name="plus" size={16} color="#FFFFFF" />
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          </View>

          <View className="w-[300px] border-l border-slate-200 bg-white">
            <View className="flex-row items-center border-b border-slate-100 px-4 py-4">
              <Feather name="shopping-cart" size={18} color="#1A593B" />
              <Text className="flex-1 text-base font-semibold text-slate-900">Current Order</Text>
              <View className="rounded-full bg-slate-100 px-3 py-1">
                <Text className="text-[10px] font-medium text-slate-500">
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </Text>
              </View>
            </View>
            <ScrollView className="flex-1" contentContainerClassName="p-3 gap-2">
              {!items.length ? (
                <View className="items-center p-8">
                  <Text className="font-medium text-slate-700">No items yet</Text>
                  <Text className="mt-2 text-center text-xs text-slate-400">
                    Choose a product from the list to start an order.
                  </Text>
                </View>
              ) : (
                items.map((item) => (
                  <View key={cartProductKey(item.product)} className="rounded-xl bg-slate-50 p-3">
                    <View className="flex-row">
                      <View className="flex-1 pr-2">
                        <Text className="font-medium text-slate-900">{item.product.name}</Text>
                        <Text className="mt-1 text-[10px] uppercase text-slate-400">
                          {item.product.promoName
                            ? `${item.product.promoName} · ${item.product.sku}`
                            : item.product.sku}
                        </Text>
                      </View>
                      <Text className="font-semibold text-slate-900">
                        {formatMoney(minorToMoney(moneyToMinor(cartLineTotal(item))))}
                      </Text>
                    </View>
                    <View className="mt-3 flex-row items-center">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${item.product.name}`}
                        onPress={() =>
                          setQuantity(
                            cartProductKey(item.product),
                            item.quantity - quantityStep(item.product),
                          )
                        }
                        className="h-8 w-8 items-center justify-center rounded-full bg-white"
                      >
                        <Feather name="minus" size={15} color="#6B6158" />
                      </Pressable>
                      <QuantityInput
                        compact
                        product={item.product}
                        quantity={item.quantity}
                        onChange={(quantity) => setQuantity(cartProductKey(item.product), quantity)}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${item.product.name}`}
                        onPress={() =>
                          setQuantity(
                            cartProductKey(item.product),
                            item.quantity + quantityStep(item.product),
                          )
                        }
                        className="h-8 w-8 items-center justify-center rounded-full bg-white"
                      >
                        <Feather name="plus" size={15} color="#1A593B" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.product.name}`}
                        onPress={() => setQuantity(cartProductKey(item.product), 0)}
                        className="ml-auto px-2 py-2"
                      >
                        <View className="flex-row items-center gap-1">
                          <Feather name="trash-2" size={12} color="#DC2626" />
                          <Text className="text-[10px] font-medium text-red-600">Remove</Text>
                        </View>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
            <View className="border-t border-slate-100 p-4">
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-slate-500">Subtotal</Text>
                <Text className="text-xs font-medium">{formatMoney(subtotal)}</Text>
              </View>
              <View className="mb-3 flex-row justify-between">
                <Text className="text-xs text-slate-500">Tax</Text>
                <Text className="text-xs font-medium">{formatMoney(tax)}</Text>
              </View>
              <View className="mb-4 flex-row justify-between border-t border-slate-100 pt-3">
                <Text className="font-semibold text-slate-900">Total</Text>
                <Text className="text-lg font-semibold text-slate-900">{formatMoney(total)}</Text>
              </View>
              {hasStockConflict ? (
                <Text className="mb-3 rounded-xl bg-red-50 p-2 text-xs text-red-700">
                  Piece and pack quantities exceed the shared stock.
                </Text>
              ) : null}
              {activeShift ? (
                <Button
                  title="Continue to Payment  ›"
                  disabled={!items.length || hasStockConflict}
                  onPress={() => router.push('/payment')}
                />
              ) : (
                <Button title="Open a shift to sell" onPress={() => router.push('/registers')} />
              )}
              {items.length ? (
                <View className="mt-2 gap-2">
                  <Button
                    title={holdMutation.isPending ? 'Holding Sale…' : 'Hold Sale (Park Cart)'}
                    variant="secondary"
                    disabled={holdMutation.isPending}
                    onPress={() => setHoldModalVisible(true)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear order"
                    onPress={() => {
                      clearCart();
                      focusInput();
                    }}
                    className="min-h-10 items-center justify-center"
                  >
                    <View className="flex-row items-center gap-1">
                      <Feather name="trash-2" size={13} color="#DC2626" />
                      <Text className="text-xs font-medium text-red-600">Clear Order</Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <Modal visible={holdModalVisible} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/40 p-5">
            <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
              <View className="mb-4 flex-row items-start justify-between">
                <View className="mr-4 flex-1">
                  <Text className="text-lg font-bold text-slate-950">Hold Current Sale?</Text>
                  <Text className="mt-1 text-sm text-slate-500">
                    Park this order to free up checkout for other customers. You can resume it anytime from Sales & Orders.
                  </Text>
                </View>
                <Pressable onPress={() => setHoldModalVisible(false)} className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                  <Feather name="x" size={18} color="#475569" />
                </Pressable>
              </View>
              <View className="mb-5">
                <Field
                  label="Optional Customer Tag / Reason"
                  value={holdNote}
                  onChangeText={setHoldNote}
                  placeholder="e.g. Customer stepped out for cash"
                />
              </View>
              <View className="flex-row gap-3">
                <Pressable
                  disabled={holdMutation.isPending}
                  onPress={() => setHoldModalVisible(false)}
                  className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
                >
                  <Text className="font-semibold text-slate-700">Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={holdMutation.isPending}
                  onPress={() => holdMutation.mutate()}
                  className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-amber-600 ${
                    holdMutation.isPending ? 'opacity-50' : 'active:bg-amber-700'
                  }`}
                >
                  <Text className="font-bold text-white">
                    {holdMutation.isPending ? 'Holding…' : 'Confirm & Park Cart'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </Screen>
    );
  }

  return (
    <Screen>
      <SellingUnitModal
        product={unitProduct}
        onClose={() => {
          setUnitProduct(null);
          focusInput();
        }}
        onSelect={(unit) => {
          if (!unitProduct) return;
          add(selectSellingUnit(unitProduct, unit));
          setUnitProduct(null);
          focusInput();
        }}
      />
      <View className="flex-row items-center justify-between bg-white pr-4">
        <View className="flex-1">
          <Header
            title="Point of sale"
            subtitle={activeShift ? activeShift.registerName : 'No open shift'}
          />
        </View>
        <Pressable
          onPress={() => router.push('/food/parked-sales')}
          className="flex-row items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 active:bg-amber-100"
        >
          <Feather name="pause-circle" size={15} color="#B45309" />
          <Text className="text-xs font-bold text-amber-900">
            Parked{heldCount > 0 ? ` (${heldCount})` : ''}
          </Text>
        </Pressable>
      </View>
      <View className="border-b border-slate-200 bg-white p-4">
        {!activeShift ? (
          <View className="mb-3 rounded-xl bg-brand-50 p-3">
            <Text className="font-medium text-brand-900">
              A shift is required to complete a sale
            </Text>
            <Text className="mt-1 text-sm text-slate-600">
              You can browse products now, then open a register shift before checkout.
            </Text>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={search}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          placeholder="Search name, SKU, or scan barcode"
          className="min-h-12 rounded-xl bg-slate-100 px-4 text-base"
          placeholderTextColor="#81776E"
          selectionColor="#1A593B"
          returnKeyType={scannerEnabled ? 'done' : 'search'}
          onSubmitEditing={() => void submitBarcode()}
          blurOnSubmit={false}
          autoFocus
        />
        {scannerEnabled ? (
          <View className="mt-2 flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-xs text-brand-700">
              Scanner ready · scan a barcode or type it, then press Enter.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan product with camera"
              onPress={() =>
                router.push({
                  pathname: '/product-scan',
                  params: { addToCart: '1' },
                })
              }
              className="min-h-11 items-center justify-center rounded-xl bg-brand-50 px-3 active:bg-brand-100"
            >
              <Text className="text-sm font-medium text-brand-700">Use camera</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <View className="border-b border-slate-100 bg-white px-4 py-2.5">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 items-center"
        >
          {categories.map((name) => {
            const selected = name === category;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setCategory(name);
                  focusInput();
                }}
                className={`h-9 items-center justify-center rounded-full px-4 ${
                  selected ? 'bg-brand-700' : 'border border-slate-200 bg-slate-50'
                }`}
              >
                <View className="flex-row items-center gap-1.5">
                  {name !== 'All' ? (
                    <Feather
                      name={categoryIcon(name)}
                      size={13}
                      color={selected ? '#FFFFFF' : '#81776E'}
                    />
                  ) : null}
                  <Text
                    className={`text-xs font-semibold ${
                      selected ? 'text-white' : 'text-slate-600'
                    }`}
                  >
                    {name}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View className="flex-1 flex-row">
        <View className="flex-1">
          {query.isLoading ? (
            <LoadingState label="Loading products…" />
          ) : query.isError ? (
            <ErrorState message={query.error.message} retry={() => void query.refetch()} />
          ) : (
            <FlatList
              key={isTablet ? 'tablet-products' : 'phone-products'}
              data={visibleRows}
              numColumns={1}
              keyExtractor={(item) => item.key}
              onEndReached={() =>
                category !== 'Combos' && query.hasNextPage && void query.fetchNextPage()
              }
              onEndReachedThreshold={0.4}
              contentContainerClassName="p-4 gap-3 pb-24"
              ListEmptyComponent={
                promotionsQuery.isError && (category === 'All' || category === 'Combos') ? (
                  <ErrorState
                    message={promotionsQuery.error.message}
                    retry={() => void promotionsQuery.refetch()}
                  />
                ) : (
                  <EmptyState
                    title={category === 'Combos' ? 'No combos' : 'No products'}
                    message={
                      category === 'Combos'
                        ? 'Create an active combo bundle in Promotions, then it will appear here.'
                        : 'Try a different search or category.'
                    }
                  />
                )
              }
              renderItem={({ item, index }) => {
                if (item.kind === 'combo') {
                  const soldOut = comboSoldOut(item.promo, cartQuantities);
                  const summary = item.promo.components
                    .map((component) =>
                      component.requiredQuantity > 1
                        ? `${component.requiredQuantity}× ${component.name}`
                        : component.name,
                    )
                    .join(' + ');
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add combo ${item.promo.name} to cart`}
                      disabled={soldOut}
                      onPress={() => addCombo(item.promo)}
                      className={`min-h-16 flex-row items-center rounded-xl border border-slate-100 bg-white px-4 py-3 active:border-brand-300 active:bg-brand-50 ${
                        soldOut ? 'opacity-50' : ''
                      }`}
                    >
                      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-rose-50">
                        <Feather name="gift" size={18} color="#BE123C" />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="font-bold text-slate-900">{item.promo.name}</Text>
                          <View className="rounded-full bg-rose-100 px-2 py-0.5">
                            <Text className="text-[9px] font-bold uppercase text-rose-700">
                              Combo
                            </Text>
                          </View>
                        </View>
                        <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
                          {summary}
                        </Text>
                      </View>
                      <View className="items-end pl-2">
                        <Text className="text-base font-bold text-slate-900">
                          {formatMoney(item.promo.comboPrice)}
                        </Text>
                        <Text className="mt-0.5 text-xs font-semibold text-brand-700">
                          + Add Combo
                        </Text>
                      </View>
                    </Pressable>
                  );
                }

                const product = item.product;
                const quantity = cartQuantities.get(product.id) ?? 0;
                const soldOut =
                  product.availableQuantity !== null &&
                  product.availableQuantity !== undefined &&
                  (product.availableQuantity <= 0 || quantity >= product.availableQuantity);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${product.name} to cart`}
                    disabled={soldOut}
                    className={`min-h-20 flex-1 flex-row items-center rounded-xl border border-slate-100 bg-white px-4 py-3 active:border-brand-300 active:bg-brand-50 ${
                      soldOut ? 'opacity-50' : ''
                    }`}
                    onPress={() => addProduct(product)}
                  >
                    <View className="flex-1">
                      <Text className="text-base font-medium text-slate-900">{product.name}</Text>
                      <Text className="mt-1 text-xs text-slate-500">{product.sku}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-lg font-semibold text-brand-700">
                        {formatMoney(product.sellingPrice)}
                      </Text>
                      <Text className="mt-1 text-xs font-medium text-brand-500">
                        {product.availableQuantity === null || product.availableQuantity === undefined
                          ? quantity
                            ? `${quantity} in cart`
                            : '+ Add'
                          : product.availableQuantity <= 0
                            ? 'Sold out'
                            : `${product.availableQuantity} ${product.unit ?? 'piece'} in stock${
                                quantity ? ` · ${quantity} in cart` : ''
                              }`}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
        {isTablet ? (
          <View className="w-[360px] border-l border-brand-100 bg-white">
            <View className="border-b border-slate-100 px-5 py-4">
              <Text className="text-xl font-semibold text-brand-900">Current order</Text>
              <Text className="mt-1 text-sm text-slate-500">
                {items.reduce((sum, item) => sum + item.quantity, 0)} items
              </Text>
            </View>
            <ScrollView className="flex-1" contentContainerClassName="p-4 gap-3">
              {!items.length ? (
                <View className="items-center rounded-2xl bg-slate-50 p-8">
                  <Text className="font-medium text-slate-700">Your order is empty</Text>
                  <Text className="mt-2 text-center text-sm text-slate-500">
                    Select a product on the left or scan its barcode.
                  </Text>
                </View>
              ) : (
                items.map((item) => {
                  const hasPromo = activePromo?.appliedProductIds.has(item.product.id);
                  return (
                    <View
                      key={cartProductKey(item.product)}
                      className="rounded-2xl border border-slate-100 p-4"
                    >
                      <View className="flex-row">
                        <View className="flex-1 pr-3">
                          <Text className="font-medium text-slate-900">{item.product.name}</Text>
                          <Text className="mt-1 text-xs text-slate-500">
                            {formatMoney(item.product.sellingPrice)} per{' '}
                            {item.product.unit ?? 'piece'}
                          </Text>
                          {hasPromo ? (
                            <View className="mt-1 flex-row items-center gap-1 self-start rounded-md bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
                              <Feather name="trending-up" size={10} color="#047857" />
                              <Text className="text-[10px] font-bold text-emerald-800">
                                {activePromo?.name || 'Volume Discount Applied'}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text className="font-semibold text-brand-700">
                          {formatMoney(minorToMoney(moneyToMinor(cartLineTotal(item))))}
                        </Text>
                      </View>
                      <View className="mt-3 flex-row items-center">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease ${item.product.name}`}
                          onPress={() =>
                            setQuantity(
                              cartProductKey(item.product),
                              item.quantity - quantityStep(item.product),
                            )
                          }
                          className="h-10 w-10 items-center justify-center rounded-xl bg-slate-100"
                        >
                          <Text className="text-xl font-medium text-slate-700">−</Text>
                        </Pressable>
                        <QuantityInput
                          product={item.product}
                          quantity={item.quantity}
                          onChange={(quantity) => setQuantity(cartProductKey(item.product), quantity)}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase ${item.product.name}`}
                          disabled={
                            item.product.availableQuantity !== null &&
                            item.product.availableQuantity !== undefined &&
                            item.quantity >= item.product.availableQuantity
                          }
                          onPress={() =>
                            setQuantity(
                              cartProductKey(item.product),
                              item.quantity + quantityStep(item.product),
                            )
                          }
                          className="h-10 w-10 items-center justify-center rounded-xl bg-brand-100 disabled:opacity-40"
                        >
                          <Text className="text-xl font-medium text-brand-900">+</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${item.product.name}`}
                          onPress={() => setQuantity(cartProductKey(item.product), 0)}
                          className="ml-auto min-h-10 justify-center px-2"
                        >
                          <Text className="text-sm font-medium text-red-700">Remove</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <View className="border-t border-brand-100 p-5">
              <View className="mb-3 gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-slate-500">Subtotal</Text>
                  <Text className="text-xs font-semibold text-slate-800">{formatMoney(posSubtotal)}</Text>
                </View>
                {activePromo ? (
                  <View className="flex-row items-center justify-between rounded-xl bg-emerald-50 px-2.5 py-1.5 border border-emerald-200">
                    <View className="flex-row items-center gap-1.5">
                      <Feather name="trending-up" size={12} color="#047857" />
                      <Text className="text-xs font-bold text-emerald-900">{activePromo.name}</Text>
                    </View>
                    <Text className="text-xs font-black text-emerald-700">
                      -{formatMoney(activePromo.discountMoney)}
                    </Text>
                  </View>
                ) : null}
                <View className="flex-row items-end justify-between border-t border-slate-100 pt-2">
                  <Text className="text-base font-bold text-slate-900">Total</Text>
                  <Text className="text-2xl font-black text-brand-700">{formatMoney(posTotal)}</Text>
                </View>
              </View>
              {hasStockConflict ? (
                <Text className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  Piece and pack quantities exceed the shared stock.
                </Text>
              ) : null}
              {activeShift ? (
                <Button
                  title="Continue to payment"
                  disabled={!items.length || hasStockConflict}
                  onPress={() => router.push('/payment')}
                />
              ) : (
                <Button title="Open a shift to sell" onPress={() => router.push('/registers')} />
              )}
            </View>
          </View>
        ) : null}
      </View>
      {!isTablet ? (
        <View className="border-t border-slate-200 bg-white p-3 shadow-sm">
          {activeShift ? (
            items.length > 0 ? (
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => {
                    clearCart();
                    focusInput();
                  }}
                  className="h-12 w-12 items-center justify-center rounded-xl border border-red-200 bg-red-50 active:bg-red-100"
                  accessibilityLabel="Clear cart items"
                >
                  <Feather name="trash-2" size={18} color="#DC2626" />
                </Pressable>

                <Pressable
                  onPress={() => setHoldModalVisible(true)}
                  disabled={holdMutation.isPending}
                  className={`h-12 flex-row items-center justify-center rounded-xl bg-amber-600 px-3.5 ${
                    holdMutation.isPending ? 'opacity-50' : 'active:bg-amber-700'
                  }`}
                  accessibilityLabel="Hold sale"
                >
                  <Feather name="pause-circle" size={18} color="#FFFFFF" />
                  <Text className="ml-1.5 font-bold text-white text-xs">Hold</Text>
                </Pressable>

                <View className="flex-1">
                  <Button
                    title={`Cart · ${items.reduce((sum, item) => sum + item.quantity, 0)} items · ${formatMoney(posTotal)}`}
                    onPress={() => router.push('/cart')}
                  />
                </View>
              </View>
            ) : null
          ) : (
            <Button title="Open a shift to sell" onPress={() => router.push('/registers')} />
          )}
        </View>
      ) : null}

      <Modal visible={holdModalVisible} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <View className="mb-4 flex-row items-start justify-between">
              <View className="mr-4 flex-1">
                <Text className="text-lg font-bold text-slate-950">Hold Current Sale?</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  Park this order to free up checkout for other customers. You can resume it anytime from Parked Sales.
                </Text>
              </View>
              <Pressable onPress={() => setHoldModalVisible(false)} className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                <Feather name="x" size={18} color="#475569" />
              </Pressable>
            </View>
            <View className="mb-5">
              <Field
                label="Optional Customer Tag / Reason"
                value={holdNote}
                onChangeText={setHoldNote}
                placeholder="e.g. Customer stepped out for cash"
              />
            </View>
            <View className="flex-row gap-3">
              <Pressable
                disabled={holdMutation.isPending}
                onPress={() => setHoldModalVisible(false)}
                className="min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white"
              >
                <Text className="font-semibold text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                disabled={holdMutation.isPending}
                onPress={() => holdMutation.mutate()}
                className={`min-h-12 flex-[2] items-center justify-center rounded-xl bg-amber-600 ${
                  holdMutation.isPending ? 'opacity-50' : 'active:bg-amber-700'
                }`}
              >
                <Text className="font-bold text-white">
                  {holdMutation.isPending ? 'Holding…' : 'Confirm & Park Cart'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
