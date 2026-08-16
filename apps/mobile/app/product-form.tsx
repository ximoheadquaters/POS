import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import {
  convertRecipeQuantity,
  productSchema,
  type ProductInput,
  type ProductUnit,
} from '@ximo/shared';
import type { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { calculateBulkCostSuggestion, formatCalculatedUnitCost } from '@/lib/bulk-cost';
import { normalizeBarcode } from '@/lib/product-scan';
import { useIosAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useCartStore, type CartProduct } from '@/store/cart';
import {
  getModeTransitionWarning,
  getRetailModeCreationDefaults,
  inferRetailMode,
  isMeasurementUnit,
  type MeasurementDimension,
  type RetailProductMode,
} from '@/lib/retail-product-mode';
import {
  getAlternateUnitsSummary,
  getInventorySummary,
  getRepackingRecipeSummary,
  getRetailLabel,
  getSupplierPackageSummary,
  getTaxDetailsSummary,
} from '@/lib/retail-terminology';
import {
  formatReceivingConversionExplanation,
  formatStockPreview,
  formatUnitDeductionExplanation,
  formatVariantAutoName,
  formatVariantQuantityLabel,
  getCompatibleUnitsForDimension,
  pluralizeUnit,
} from '@/lib/unit-preview-helpers';
import { validateUnitConversion } from '@ximo/shared';

const UNIT_OPTIONS = [
  'piece',
  'serving',
  'box',
  'pack',
  'sack',
  'bottle',
  'can',
  'ml',
  'l',
  'g',
  'kg',
] as const satisfies readonly ProductUnit[];

type StockSaleMode = 'single_unit' | 'whole_and_portions' | 'portions_only';
type PackageMeasureUnit = 'g' | 'kg' | 'ml' | 'l';

const PACKAGE_UNIT_CODES = ['sack', 'pack', 'box', 'bottle', 'can'] as const;

function recipeUnitOptions(baseUnit?: string) {
  const normalized = (baseUnit ?? '').trim().toLowerCase();
  if (['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(normalized)) {
    return [
      { code: 'g', label: 'Grams (g)' },
      { code: 'kg', label: 'Kilograms (kg)' },
    ];
  }
  if (['ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters'].includes(normalized)) {
    return [
      { code: 'ml', label: 'Milliliters (ml)' },
      { code: 'l', label: 'Liters (L)' },
    ];
  }
  const discreteUnits: Record<string, { code: string; label: string }> = {
    piece: { code: 'piece', label: 'Pieces (pc)' },
    pieces: { code: 'piece', label: 'Pieces (pc)' },
    pc: { code: 'piece', label: 'Pieces (pc)' },
    pcs: { code: 'piece', label: 'Pieces (pc)' },
    serving: { code: 'serving', label: 'Servings' },
    servings: { code: 'serving', label: 'Servings' },
    pack: { code: 'pack', label: 'Packs' },
    packs: { code: 'pack', label: 'Packs' },
    box: { code: 'box', label: 'Boxes' },
    boxes: { code: 'box', label: 'Boxes' },
    sack: { code: 'sack', label: 'Sacks' },
    sacks: { code: 'sack', label: 'Sacks' },
    bottle: { code: 'bottle', label: 'Bottles' },
    bottles: { code: 'bottle', label: 'Bottles' },
    can: { code: 'can', label: 'Cans' },
    cans: { code: 'can', label: 'Cans' },
  };
  return [discreteUnits[normalized] ?? discreteUnits.piece!];
}

function isMeasuredInventoryUnit(unit?: string): boolean {
  return [
    'g',
    'gram',
    'grams',
    'kg',
    'kilogram',
    'kilograms',
    'ml',
    'milliliter',
    'milliliters',
    'l',
    'liter',
    'liters',
  ].includes((unit ?? '').trim().toLowerCase());
}

function packageSizeInBaseUnits(size: string, _unit: PackageMeasureUnit): number {
  const amount = Number(size);
  if (!Number.isFinite(amount)) return 0;
  return amount;
}

const PRODUCT_PRESETS = [
  {
    id: 'retail' as const,
    label: 'Retail Product',
    description: 'Standard packaged goods sold directly from stock',
    icon: 'shopping-bag' as const,
    unit: 'piece' as ProductUnit,
    inventoryRole: 'sellable' as const,
    preparationBehavior: 'standard' as const,
    trackInventory: true,
  },
  {
    id: 'raw' as const,
    label: 'Raw Ingredient',
    description: 'Raw inventory materials used in recipes; excluded from retail POS',
    icon: 'archive' as const,
    unit: 'kg' as ProductUnit,
    inventoryRole: 'ingredient' as const,
    preparationBehavior: 'standard' as const,
    trackInventory: true,
    sellingPrice: '0.00',
  },
  {
    id: 'prepared_food' as const,
    label: 'Cook-to-Order Prepared Food',
    description: 'Cooked meals sold per serving; ingredients deducted at checkout',
    icon: 'coffee' as const,
    unit: 'serving' as ProductUnit,
    inventoryRole: 'sellable' as const,
    preparationBehavior: 'cook_to_order' as const,
    trackInventory: false,
  },
  {
    id: 'repacked' as const,
    label: 'Repacking',
    description: 'Bulk items repacked or portioned into smaller units or packs',
    icon: 'layers' as const,
    unit: 'pack' as ProductUnit,
    inventoryRole: 'sellable' as const,
    preparationBehavior: 'preproduced' as const,
    trackInventory: true,
  },
] as const;

type ProductSetup = (typeof PRODUCT_PRESETS)[number]['id'];

function resolveBusinessProfile(user: {
  organization?: { businessProfile?: string };
  businessProfile?: string;
} | null): 'retail' | 'food_service' | 'hybrid' {
  const profile =
    user?.organization?.businessProfile ?? user?.businessProfile ?? 'retail';
  if (profile === 'food_service' || profile === 'hybrid') return profile;
  return 'retail';
}

function isPresetAllowedForProfile(
  presetId: ProductSetup,
  profile: 'retail' | 'food_service' | 'hybrid',
): boolean {
  if (profile === 'food_service') {
    return presetId === 'raw' || presetId === 'prepared_food';
  }
  if (profile === 'retail') {
    return presetId === 'retail' || presetId === 'repacked';
  }
  return true;
}

function isPresetAllowedForModules(presetId: ProductSetup, modules: string[]): boolean {
  if (presetId === 'raw' && !modules.includes('ingredients')) return false;
  if (
    presetId === 'prepared_food' &&
    (!modules.includes('recipes') || !modules.includes('prepared_food'))
  ) {
    return false;
  }
  if (
    presetId === 'repacked' &&
    !modules.includes('production') &&
    !modules.includes('inventory')
  ) {
    return false;
  }
  return true;
}

function getVisibleProductPresets(
  profile: 'retail' | 'food_service' | 'hybrid',
  modules: string[],
) {
  return PRODUCT_PRESETS.filter(
    (preset) =>
      isPresetAllowedForProfile(preset.id, profile) &&
      isPresetAllowedForModules(preset.id, modules),
  );
}

function generatedSku(name: string): string {
  const prefix = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix || 'ITEM'}-${suffix}`;
}

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
  portioningEnabled?: boolean;
  portioningVariantId?: string | null;
}

interface IngredientOption {
  id: string;
  name: string;
  sku: string;
  cost: string;
  averageCost?: string | null;
  unit: string;
  status: string;
  inventoryRole?: 'sellable' | 'ingredient' | 'both';
  trackInventory?: boolean;
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

function firstFormErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { message?: unknown } & Record<string, unknown>;
  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message;
  }
  for (const nested of Object.values(candidate)) {
    const message = firstFormErrorMessage(nested);
    if (message) return message;
  }
  return null;
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
  const { showAlert } = useIosAlert();
  const { currentUser } = useSession();
  const businessProfile = resolveBusinessProfile(currentUser);
  const userModules = currentUser?.modules ?? [];
  const visibleProductPresets = getVisibleProductPresets(businessProfile, userModules);
  const defaultProductSetup =
    visibleProductPresets[0]?.id ??
    (businessProfile === 'food_service' ? 'raw' : 'retail');
  const productId = typeof params.id === 'string' ? params.id : '';
  const isEditing = Boolean(productId);
  const suggestedPrice =
    typeof params.suggestedPrice === 'string' ? params.suggestedPrice.trim() : '';
  const targetMargin = typeof params.targetMargin === 'string' ? params.targetMargin.trim() : '';
  const scannedBarcode = typeof params.barcode === 'string' ? params.barcode.trim() : '';
  const enteredSku = typeof params.sku === 'string' ? params.sku.trim() : '';
  const addToCart = params.addToCart === '1';
  const incoming = params.incoming === '1';
  const branch = useBranchStore((state) => state.activeBranch);
  const add = useCartStore((state) => state.add);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerTarget, setScannerTarget] = useState<'barcode' | 'alternate' | null>(null);
  const [scanChecking, setScanChecking] = useState(false);
  const [scannerCameraReady, setScannerCameraReady] = useState(false);
  const [scannerCameraError, setScannerCameraError] = useState('');
  const [scannerCameraSession, setScannerCameraSession] = useState(0);
  const scannerLockRef = useRef(false);
  const [openingQuantity, setOpeningQuantity] = useState(addToCart ? '1' : '0');
  const [openingContainerQuantity, setOpeningContainerQuantity] = useState('0');
  const [stockSaleMode, setStockSaleMode] = useState<StockSaleMode>('single_unit');
  const [packageSize, setPackageSize] = useState('25');
  const [packageMeasureUnit, setPackageMeasureUnit] = useState<PackageMeasureUnit>('kg');
  const [packagePurchaseCost, setPackagePurchaseCost] = useState('');
  const [loosePurchaseQuantity, setLoosePurchaseQuantity] = useState('');
  const [alternateEnabled, setAlternateEnabled] = useState(false);
  const [portioningEnabled, setPortioningEnabled] = useState(false);
  const [alternateUnit, setAlternateUnit] = useState<ProductUnit>('pack');
  const [unitsPerAlternate, setUnitsPerAlternate] = useState('10');
  const [alternatePrice, setAlternatePrice] = useState('');
  const [alternateSku, setAlternateSku] = useState('');
  const [alternateBarcode, setAlternateBarcode] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const preserveLoadedRecipeCost = useRef(isEditing);
  const [pricingOffset, setPricingOffset] = useState(0);
  const queryClient = useQueryClient();

  const [productSetup, setProductSetup] = useState<ProductSetup>(defaultProductSetup);
  const [retailMode, setRetailMode] = useState<RetailProductMode>('simple');
  const [measurementDimension, setMeasurementDimension] = useState<MeasurementDimension>('weight');
  const [pendingRetailMode, setPendingRetailMode] = useState<RetailProductMode | null>(null);
  const [showModeConfirmModal, setShowModeConfirmModal] = useState(false);
  const [alsoSellBulkDirectly, setAlsoSellBulkDirectly] = useState(false);
  const [showAdditionalDetails, setShowAdditionalDetails] = useState(false);
  const [showAdvancedInventory, setShowAdvancedInventory] = useState(false);
  const [recipeEnabled, setRecipeEnabled] = useState(false);
  const [recipeItems, setRecipeItems] = useState<
    Array<{
      ingredientProductId: string;
      ingredientName: string;
      quantityRequired: number;
      unit: string;
      baseUnit?: string;
      cost: string;
    }>
  >([]);
  const [recipeSelectedIngredientId, setRecipeSelectedIngredientId] = useState('');
  const [recipeQtyInput, setRecipeQtyInput] = useState('1');
  const [recipeUnitInput, setRecipeUnitInput] = useState('piece');

  const categories = useQuery({
    queryKey: ['categories', branch?.id],
    enabled: Boolean(branch),
    queryFn: () => api<CatalogueItem[]>(`/categories?branchId=${branch!.id}`),
  });
  const brands = useQuery({
    queryKey: ['brands', branch?.id],
    enabled: Boolean(branch),
    queryFn: () => api<CatalogueItem[]>(`/brands?branchId=${branch!.id}`),
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
    queryKey: ['all-inventory-products-for-bom', branch?.id],
    queryFn: () =>
      api<any>(
        `/products?includeInactive=true&includeIncoming=true&pageSize=100${
          branch?.id ? `&branchId=${branch.id}` : ''
        }`,
      ),
  });

  const availableIngredients = useMemo(() => {
    const raw = allProductsQuery.data;
    const list: IngredientOption[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : [];
    const rolePriority = { ingredient: 0, both: 1, sellable: 2 } as const;
    return list
      .filter((product) => product.id !== productId && product.trackInventory !== false)
      .map((product) => ({
        ...product,
        cost: product.averageCost || product.cost || '0.00',
      }))
      .sort(
        (left, right) =>
          (rolePriority[left.inventoryRole ?? 'sellable'] ?? 2) -
            (rolePriority[right.inventoryRole ?? 'sellable'] ?? 2) ||
          left.name.localeCompare(right.name),
      );
  }, [allProductsQuery.data, productId]);

  const [recipeSearchQuery, setRecipeSearchQuery] = useState('');
  const [showSellableBomSources, setShowSellableBomSources] = useState(false);

  const rawIngredientSources = useMemo(
    () =>
      availableIngredients.filter(
        (ingredient) =>
          ingredient.inventoryRole === 'ingredient' || ingredient.inventoryRole === 'both',
      ),
    [availableIngredients],
  );
  const sellableOnlySources = useMemo(
    () =>
      availableIngredients.filter(
        (ingredient) => !ingredient.inventoryRole || ingredient.inventoryRole === 'sellable',
      ),
    [availableIngredients],
  );
  const filterRecipeSources = (sources: IngredientOption[]) => {
    const query = recipeSearchQuery.toLowerCase().trim();
    if (!query) return sources;
    return sources.filter(
      (ingredient) =>
        ingredient.name?.toLowerCase().includes(query) ||
        ingredient.sku?.toLowerCase().includes(query),
    );
  };
  const filteredRawIngredientSources = filterRecipeSources(rawIngredientSources);
  const filteredSellableOnlySources = filterRecipeSources(sellableOnlySources);
  const visibleRawIngredientSources = filteredRawIngredientSources.slice(0, 8);
  const visibleSellableOnlySources = filteredSellableOnlySources.slice(0, 8);

  const selectedRecipeIngredient = useMemo(
    () => availableIngredients.find((product) => product.id === recipeSelectedIngredientId),
    [availableIngredients, recipeSelectedIngredientId],
  );
  const compatibleRecipeUnits = useMemo(
    () => recipeUnitOptions(selectedRecipeIngredient?.unit),
    [selectedRecipeIngredient?.unit],
  );
  const selectedSourceIsPackaged = Boolean(
    selectedRecipeIngredient && !isMeasuredInventoryUnit(selectedRecipeIngredient.unit),
  );

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
          baseUnit?: string;
          ingredientCost: string;
        }>
      >(`/products/${productId}/recipe`),
  });

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  const wizardSteps = recipeEnabled
    ? [
        { step: 1, label: 'Product Setup', icon: 'package' as const },
        {
          step: 2,
          label: productSetup === 'repacked' ? 'Repacking (BOM)' : 'Recipe (BOM)',
          icon: productSetup === 'repacked' ? ('layers' as const) : ('coffee' as const),
        },
        { step: 3, label: 'Pricing & Tax', icon: 'dollar-sign' as const },
        { step: 4, label: 'Availability', icon: 'settings' as const },
      ]
    : [
        { step: 1, label: 'Product Setup', icon: 'package' as const },
        { step: 2, label: 'Inventory & Units', icon: 'box' as const },
        { step: 3, label: 'Pricing & Tax', icon: 'dollar-sign' as const },
        { step: 4, label: 'Availability', icon: 'settings' as const },
      ];

  const activeUnits =
    units.data?.filter((unit) => unit.isActive) ??
    UNIT_OPTIONS.map((code) => ({
      id: code,
      code,
      name: code.toUpperCase(),
      kind: ['piece', 'serving', 'box', 'pack', 'bottle', 'can'].includes(code)
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
      inventoryRole: 'sellable',
      trackInventory: true,
      cost: '0.00',
      sellingPrice: '0.00',
      taxRate: '12.00',
      isTaxInclusive: false,
      status: incoming ? 'pending_receipt' : 'active',
    },
  });

  useEffect(() => {
    if (existingRecipeQuery.data && existingRecipeQuery.data.length > 0) {
      setProductSetup(productDetails.data?.trackInventory ? 'repacked' : 'prepared_food');
      setRecipeEnabled(true);
      setRecipeItems(
        existingRecipeQuery.data.map((r: any) => ({
          ingredientProductId: r.ingredientProductId,
          ingredientName: r.ingredientName,
          quantityRequired: r.quantityRequired,
          unit: r.unit,
          baseUnit: r.baseUnit || r.unit,
          cost: r.ingredientCost || '0.00',
        })),
      );
    }
  }, [existingRecipeQuery.data, productDetails.data?.trackInventory]);

  const bomCost = useMemo(
    () =>
      recipeItems.reduce((sum, item) => {
        const effectiveQty = convertRecipeQuantity(item.quantityRequired, item.unit, item.baseUnit);
        return sum + parseFloat(item.cost || '0') * effectiveQty;
      }, 0),
    [recipeItems],
  );

  useEffect(() => {
    if (!recipeEnabled || (isEditing && existingRecipeQuery.isLoading)) return;
    if (isEditing && preserveLoadedRecipeCost.current && recipeItems.length > 0) {
      preserveLoadedRecipeCost.current = false;
      return;
    }
    form.setValue('cost', bomCost.toFixed(2));
  }, [bomCost, existingRecipeQuery.isLoading, form, isEditing, recipeEnabled, recipeItems.length]);

  useEffect(() => {
    const product = productDetails.data;
    if (!product) return;
    setPortioningEnabled(Boolean(product.portioningEnabled));
    form.reset({
      categoryId: product.categoryId ?? null,
      brandId: product.brandId ?? null,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? undefined,
      unit: product.unit,
      inventoryRole: product.inventoryRole ?? 'sellable',
      trackInventory: product.trackInventory,
      description: product.description ?? undefined,
      cost: product.cost,
      sellingPrice: product.sellingPrice,
      taxRate: product.taxRate,
      isTaxInclusive: product.isTaxInclusive,
      status: product.status,
      imagePath: product.imagePath ?? undefined,
    });
    if (product.inventoryRole === 'ingredient') {
      setProductSetup('raw');
      setRecipeEnabled(false);
    } else if (existingRecipeQuery.data?.length) {
      // The recipe-loading effect identifies prepared food versus tracked
      // prepared/repacked stock.
    } else if (product.unit === 'serving' && !product.trackInventory) {
      setProductSetup('prepared_food');
      setRecipeEnabled(true);
    } else {
      setProductSetup('retail');
      setRecipeEnabled(false);
    }

    const inferredMode = inferRetailMode({
      preparationBehavior: product.preparationBehavior,
      inventoryRole: product.inventoryRole,
      unit: product.unit,
      recipeItemsCount: existingRecipeQuery.data?.length ?? 0,
      hasPortioningContainer: Boolean(product.portioningEnabled),
      hasAlternateSellingUnits: alternateEnabled,
      alternateEnabled,
    });
    setRetailMode(inferredMode);
    setAlsoSellBulkDirectly(product.inventoryRole === 'both');
  }, [existingRecipeQuery.data, form, productDetails.data]);

  const trackInventory = form.watch('trackInventory');
  const baseUnit = form.watch('unit') ?? 'piece';
  const inventoryRole = form.watch('inventoryRole') ?? 'sellable';
  const isRepackedProduct = productSetup === 'repacked';
  const recipeOutputLabel = isRepackedProduct
    ? baseUnit === 'piece'
      ? 'finished unit'
      : `finished ${baseUnit}`
    : 'serving';
  const sellingPrice = form.watch('sellingPrice');
  const productCost = form.watch('cost');
  const portionCostUnit = isMeasuredInventoryUnit(baseUnit)
    ? (baseUnit as PackageMeasureUnit)
    : packageMeasureUnit;
  const portionCostQuantity =
    stockSaleMode === 'whole_and_portions' ? packageSize : loosePurchaseQuantity;
  const showPortionCostCalculator =
    trackInventory &&
    stockSaleMode !== 'single_unit' &&
    isMeasuredInventoryUnit(baseUnit) &&
    !recipeEnabled;
  const bulkCostSuggestion = useMemo(
    () =>
      calculateBulkCostSuggestion(
        Number(packagePurchaseCost),
        Number(portionCostQuantity),
        portionCostUnit,
      ),
    [packagePurchaseCost, portionCostQuantity, portionCostUnit],
  );

  useEffect(() => {
    if (bulkCostSuggestion && bulkCostSuggestion.primaryUnitCost > 0) {
      form.setValue('cost', bulkCostSuggestion.primaryUnitCost.toFixed(2), {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
  }, [bulkCostSuggestion, form]);

  const bulkCostApplied = Boolean(
    bulkCostSuggestion &&
    Math.abs(Number(productCost) - Number(bulkCostSuggestion.primaryUnitCost.toFixed(2))) < 0.001,
  );
  const suggestionApplied =
    Boolean(suggestedPrice) &&
    Number.isFinite(Number(suggestedPrice)) &&
    Number(sellingPrice) === Number(suggestedPrice);
  const scannerEnabled = currentUser?.modules.includes('barcode_scanner') ?? false;

  useEffect(() => {
    if (isEditing) return;
    if (visibleProductPresets.some((preset) => preset.id === productSetup)) return;
    const next = visibleProductPresets[0];
    if (!next) return;
    setProductSetup(next.id);
    setRecipeEnabled(next.id === 'prepared_food' || next.id === 'repacked');
    form.setValue(
      'inventoryRole',
      next.id === 'raw' ? 'ingredient' : 'sellable',
      { shouldValidate: true },
    );
    form.setValue('unit', next.unit, { shouldValidate: true });
    form.setValue('trackInventory', next.trackInventory, { shouldValidate: true });
  }, [form, isEditing, productSetup, visibleProductPresets]);

  const selectStockSaleMode = (mode: StockSaleMode) => {
    setStockSaleMode(mode);
    if (mode === 'whole_and_portions') {
      const base = packageMeasureUnit;
      form.setValue('unit', base, { shouldDirty: true, shouldValidate: true });
      form.setValue('trackInventory', true, { shouldDirty: true });
      setAlternateEnabled(true);
      setPortioningEnabled(true);
      setUnitsPerAlternate(String(packageSizeInBaseUnits(packageSize, packageMeasureUnit)));
      if (!PACKAGE_UNIT_CODES.includes(alternateUnit as (typeof PACKAGE_UNIT_CODES)[number])) {
        setAlternateUnit(base === 'g' || base === 'kg' ? 'sack' : 'bottle');
      }
      if (!alternateSku) {
        const sku = form.getValues('sku');
        if (sku) setAlternateSku(`${sku}-${base === 'g' || base === 'kg' ? 'SACK' : 'BOTTLE'}`);
      }
      return;
    }

    setAlternateEnabled(false);
    setPortioningEnabled(false);
    setOpeningContainerQuantity('0');
    if (
      mode === 'portions_only' &&
      !['g', 'kg', 'ml', 'l'].includes(form.getValues('unit') ?? '')
    ) {
      form.setValue('unit', 'g', { shouldDirty: true, shouldValidate: true });
    }
  };

  const selectPackageMeasureUnit = (unit: PackageMeasureUnit) => {
    setPackageMeasureUnit(unit);
    form.setValue('unit', unit, { shouldDirty: true, shouldValidate: true });
    setUnitsPerAlternate(String(packageSizeInBaseUnits(packageSize, unit)));
    if ((unit === 'g' || unit === 'kg') && ['bottle', 'can'].includes(alternateUnit)) {
      setAlternateUnit('sack');
    }
    if ((unit === 'ml' || unit === 'l') && ['sack'].includes(alternateUnit)) {
      setAlternateUnit('bottle');
    }
  };

  const updatePackageSize = (value: string) => {
    setPackageSize(value);
    setUnitsPerAlternate(String(packageSizeInBaseUnits(value, packageMeasureUnit)));
  };

  const applySuggestedPrice = () => {
    const amount = Number(suggestedPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      showAlert({ title: 'Invalid suggested price', message: 'Refresh the product list and try again.', type: 'warning' });
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

  const applyBulkCostSuggestion = () => {
    if (!bulkCostSuggestion) return;
    form.setValue('cost', bulkCostSuggestion.primaryUnitCost.toFixed(2), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const resumeScanner = () => {
    scannerLockRef.current = false;
    setScanChecking(false);
  };

  const closeScanner = () => {
    scannerLockRef.current = false;
    setScanChecking(false);
    setScannerCameraReady(false);
    setScannerCameraError('');
    setScannerTarget(null);
  };

  const openScanner = async (target: 'barcode' | 'alternate') => {
    if (!scannerEnabled) {
      showAlert({
        title: 'Barcode scanner is disabled',
        message: 'Enable the Barcode Scanner module in business settings to use the camera.',
        type: 'warning',
      });
      return;
    }
    let permission = cameraPermission;
    if (!permission?.granted && permission?.canAskAgain !== false) {
      permission = await requestCameraPermission();
    }
    if (!permission?.granted) {
      showAlert({
        title: 'Camera access is needed',
        message: 'Allow camera access in your browser or device settings, then try again.',
        type: 'warning',
      });
      return;
    }
    scannerLockRef.current = false;
    setScanChecking(false);
    setScannerCameraReady(false);
    setScannerCameraError('');
    setScannerCameraSession((value) => value + 1);
    setScannerTarget(target);
  };

  const handleCameraScan = async (result: BarcodeScanningResult) => {
    if (scannerLockRef.current || !scannerTarget) return;
    scannerLockRef.current = true;
    setScanChecking(true);
    if (!branch) {
      showAlert({
        title: 'Branch required',
        message: 'Select an assigned branch before scanning a product barcode.',
        type: 'warning',
        buttons: [{ text: 'OK', onPress: closeScanner }],
      });
      return;
    }
    const barcode = normalizeBarcode(result.data);
    if (barcode.length < 3) {
      showAlert({
        title: 'Invalid barcode',
        message: 'The scanned barcode must contain at least 3 characters.',
        type: 'warning',
        buttons: [{ text: 'Scan another', onPress: resumeScanner }],
      });
      return;
    }
    try {
      const existing = await api<CartProduct | null>(
        `/products/lookup?code=${encodeURIComponent(barcode)}&branchId=${branch.id}`,
      );
      if (existing && existing.id !== productId) {
        showAlert({
          title: 'Barcode already used',
          message: `${existing.name} already uses barcode ${barcode}.`,
          type: 'warning',
          buttons: [{ text: 'Scan another', onPress: resumeScanner }],
        });
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
      closeScanner();
    } catch (error) {
      showAlert({
        title: 'Could not check barcode',
        message: error instanceof Error ? error.message : 'Please try scanning again.',
        type: 'error',
        buttons: [{ text: 'Try again', onPress: resumeScanner }],
      });
    }
  };

  const mutation = useMutation({
    mutationFn: async (input: ProductInput) => {
      if (!branch || !currentUser?.branches.some((item) => item.id === branch.id)) {
        throw new Error('Select an assigned branch before saving this product.');
      }
      const enteredOpeningQuantity = Number(openingQuantity);
      const quantity =
        !isEditing && stockSaleMode === 'whole_and_portions'
          ? packageSizeInBaseUnits(openingQuantity, packageMeasureUnit)
          : enteredOpeningQuantity;
      if (
        !isEditing &&
        input.trackInventory &&
        (!Number.isFinite(enteredOpeningQuantity) ||
          enteredOpeningQuantity < 0 ||
          Math.round(enteredOpeningQuantity * 1_000) !== enteredOpeningQuantity * 1_000)
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
      let finalAlternatePrice = alternatePrice.trim();
      if (
        !isEditing &&
        alternateEnabled &&
        input.inventoryRole !== 'ingredient' &&
        !finalAlternatePrice
      ) {
        const basePriceNum = Number(input.sellingPrice);
        if (Number.isFinite(basePriceNum) && basePriceNum > 0 && conversion > 0) {
          finalAlternatePrice = (basePriceNum * conversion).toFixed(2);
          setAlternatePrice(finalAlternatePrice);
        } else {
          throw new Error('Enter the alternate unit selling price');
        }
      }
      const sealedOpeningQuantity = Number(openingContainerQuantity);
      if (
        !isEditing &&
        portioningEnabled &&
        (!Number.isInteger(sealedOpeningQuantity) || sealedOpeningQuantity < 0)
      ) {
        throw new Error('Sealed opening stock must be a whole number of containers');
      }
      if (!isEditing && portioningEnabled && !alternateEnabled) {
        throw new Error('Add a whole selling unit before enabling portioning');
      }
      let savedProduct: CartProduct;
      const activePreparationBehavior =
        productSetup === 'prepared_food'
          ? 'cook_to_order'
          : productSetup === 'repacked'
            ? 'preproduced'
            : 'standard';
      if (isEditing) {
        savedProduct = await api<CartProduct>(`/products/${productId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...input,
            preparationBehavior: activePreparationBehavior,
            barcode: input.barcode ?? null,
          }),
        });
      } else {
        savedProduct = await api<CartProduct>('/products', {
          method: 'POST',
          body: JSON.stringify({
            ...input,
            preparationBehavior: activePreparationBehavior,
            status: incoming ? 'pending_receipt' : input.status,
            trackInventory: incoming ? true : input.trackInventory,
            branchId: branch.id,
            openingQuantity: incoming ? 0 : input.trackInventory ? quantity : 0,
            openingContainerQuantity:
              incoming || !input.trackInventory || !portioningEnabled ? 0 : sealedOpeningQuantity,
            sellingUnits: alternateEnabled
              ? [
                  {
                    name:
                      input.inventoryRole === 'ingredient'
                        ? `${alternateUnit.toUpperCase()} storage package (${formatVariantQuantityLabel(conversion, input.unit)})`
                        : formatVariantAutoName(alternateUnit, conversion, input.unit),
                    sku: alternateSku.trim() || `${input.sku}-${alternateUnit.toUpperCase()}`,
                    barcode: alternateBarcode.trim() || undefined,
                    unit: alternateUnit,
                    unitsPerBase: conversion,
                    sellingPrice: input.inventoryRole === 'ingredient' ? '0.00' : finalAlternatePrice,
                    isPortioningContainer: portioningEnabled,
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
            items: recipeItems.map((item) => ({
              ingredientProductId: item.ingredientProductId,
              quantityRequired: item.quantityRequired,
              unit: item.unit,
            })),
          }),
        });
      } else if (isEditing) {
        await api(`/products/${savedProduct.id}/recipe`, {
          method: 'PUT',
          body: JSON.stringify({ items: [] }),
        });
      }

      return savedProduct;
    },
    onSuccess: async (product) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['product', productId] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-products'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
      ];
      if (branch) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ['inventory', branch.id] }),
          queryClient.invalidateQueries({ queryKey: ['inventory-summary', branch.id] }),
        );
      }
      await Promise.all(invalidations);
      if (addToCart) {
        add(product);
        router.replace('/(tabs)/pos');
      } else {
        router.back();
      }
    },
    onError: (error) => {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('alternate') ||
        msg.includes('unit') ||
        msg.includes('portion') ||
        msg.includes('stock')
      ) {
        setCurrentStep(2);
        setShowAdvancedInventory(true);
      } else if (msg.includes('cost') || msg.includes('price') || msg.includes('tax')) {
        setCurrentStep(3);
      }
      showAlert({ title: 'Could not save product', message: error.message, type: 'error' });
    },
  });

  const submitProduct = () => {
    const nameVal = form.getValues('name')?.trim() || '';
    if (!nameVal) {
      setCurrentStep(1);
      showAlert({ title: 'Product name required', message: 'Please enter a product name before saving.', type: 'warning' });
      return;
    }
    if (!form.getValues('sku')?.trim()) {
      form.setValue('sku', generatedSku(nameVal), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    form.handleSubmit(
      (value) => {
        const cleanCost = (value.cost || '0.00').replace(/[^0-9.]/g, '') || '0.00';
        const cleanPrice = (value.sellingPrice || '0.00').replace(/[^0-9.]/g, '') || '0.00';
        const cleanTax = (value.taxRate || '12.00').replace(/[^0-9.]/g, '') || '12.00';
        mutation.mutate({
          ...value,
          name: nameVal,
          cost: cleanCost,
          sellingPrice: cleanPrice,
          taxRate: cleanTax,
        });
      },
      (errors) => {
        if (errors.name || errors.sku || errors.unit || errors.inventoryRole) {
          setCurrentStep(1);
        } else if (errors.cost || errors.sellingPrice || errors.taxRate) {
          setCurrentStep(3);
        }
        if (errors.sku) setShowAdditionalDetails(true);
        showAlert({
          title: 'Product information is incomplete',
          message: firstFormErrorMessage(errors) ?? 'Review the highlighted product fields and try again.',
          type: 'warning',
        });
      },
    )();
  };

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
            placeholder={name === 'cost' || name === 'sellingPrice' ? '\u20B10.00' : placeholder}
            placeholderTextColor="#A8A099"
            selectionColor="#1A593B"
            className={`rounded-xl border bg-white px-4 text-base text-slate-900 focus:border-brand-700 ${
              options.multiline ? 'min-h-24 py-3' : 'min-h-12'
            } ${fieldState.error ? 'border-red-400' : 'border-slate-200'}`}
          />
          {fieldState.error?.message ? (
            <Text className="mt-1 text-xs text-red-600">
              {name === 'name' && (fieldState.error.message.includes('1') || fieldState.error.message.includes('>=1'))
                ? 'Enter a product name.'
                : fieldState.error.message}
            </Text>
          ) : options.helper ? (
            <Text className="mt-1 text-xs leading-4 text-slate-500">{options.helper}</Text>
          ) : null}
        </View>
      )}
    />
  );

  const goToNextStep = async () => {
    if (currentStep === 1) {
      if (!form.getValues('sku')?.trim()) {
        form.setValue('sku', generatedSku(form.getValues('name') ?? ''), {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      const basicInfoIsValid = await form.trigger(['name', 'sku']);
      if (!basicInfoIsValid) return;
    }

    if (recipeEnabled && currentStep === 2 && recipeItems.length === 0) {
      showAlert({
        title: isRepackedProduct ? 'Add source materials' : 'Add recipe ingredients',
        message: isRepackedProduct
          ? 'A prepared or repacked product needs at least one raw material in its bill of materials.'
          : 'Prepared food needs at least one ingredient in its bill of materials.',
        type: 'warning',
      });
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, 4) as 1 | 2 | 3 | 4);
  };

  if (
    !branch ||
    !currentUser?.branches.some((authorizedBranch) => authorizedBranch.id === branch.id)
  ) {
    return <Redirect href="/branch-select" />;
  }

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

            {/* Compact progress keeps attention on one decision at a time. */}
            <View className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
              <View className="flex-row items-center">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Feather
                    name={wizardSteps[currentStep - 1]?.icon ?? 'circle'}
                    size={17}
                    color="#1A593B"
                  />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Step {currentStep} of {wizardSteps.length}
                  </Text>
                  <Text className="mt-0.5 text-base font-semibold text-slate-950">
                    {wizardSteps[currentStep - 1]?.label}
                  </Text>
                </View>
              </View>
              <View className="mt-3 flex-row gap-1.5">
                {wizardSteps.map((step) => (
                  <View
                    key={step.step}
                    className={`h-1.5 flex-1 rounded-full ${
                      currentStep >= step.step ? 'bg-brand-700' : 'bg-slate-200'
                    }`}
                  />
                ))}
              </View>
            </View>

            {currentStep === 1 ? (
              <View>
                <SectionLabel>Product setup</SectionLabel>
                <View className="mb-7 rounded-3xl border border-slate-200 bg-white p-5">
                  <Text className="font-semibold text-slate-950">What are you adding?</Text>
                  <Text className="mb-4 mt-1 text-sm leading-5 text-slate-500">
                    Pick one. Ximo will set the recommended inventory behavior automatically.
                  </Text>
                  <View className="gap-3 sm:flex-row sm:flex-wrap">
                    {visibleProductPresets.map((preset) => {
                      const selected = productSetup === preset.id;
                      return (
                        <Pressable
                          key={preset.label}
                          disabled={incoming && !preset.trackInventory}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => {
                            const preparedFood = preset.id === 'prepared_food';
                            const usesRecipe = preparedFood || preset.id === 'repacked';
                            setProductSetup(preset.id);
                            setRecipeEnabled(usesRecipe);
                            form.setValue(
                              'inventoryRole',
                              preset.id === 'raw' ? 'ingredient' : 'sellable',
                              { shouldValidate: true },
                            );
                            form.setValue('unit', preset.unit, { shouldValidate: true });
                            form.setValue('trackInventory', preset.trackInventory, {
                              shouldValidate: true,
                            });
                            setStockSaleMode(
                              preset.id === 'raw'
                                ? 'portions_only'
                                : 'single_unit',
                            );
                            setShowAdvancedInventory(false);
                            if (usesRecipe) setOpeningQuantity('0');
                            if (!preset.trackInventory || preset.id !== 'retail') {
                              setAlternateEnabled(false);
                              setPortioningEnabled(false);
                              setOpeningContainerQuantity('0');
                            }
                          }}
                          className={`min-h-20 flex-row items-center rounded-2xl border p-4 sm:w-[48%] lg:w-[31%] ${
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

                <View className="mb-7 flex-row items-center rounded-2xl border border-brand-100 bg-brand-50 p-4">
                  <Feather
                    name={inventoryRole === 'ingredient' ? 'archive' : 'shopping-cart'}
                    size={17}
                    color="#1A593B"
                  />
                  <Text className="ml-3 flex-1 text-sm leading-5 text-brand-900">
                    {inventoryRole === 'ingredient'
                      ? 'Raw ingredient: tracked in inventory and hidden from the POS.'
                      : 'Sellable product: visible in the POS when it is active.'}
                  </Text>
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
                      {showAdditionalDetails ? (
                        <View className="flex-1">
                          {renderTextField('sku', 'SKU', 'Generated automatically', {
                            autoCapitalize: 'characters',
                            helper: 'Optional. Leave blank and Ximo will create one.',
                          })}
                        </View>
                      ) : null}
                      <View className="flex-1">
                        <Controller
                          control={form.control}
                          name="barcode"
                          render={({ field, fieldState }) => (
                            <View>
                              <Text className="mb-2 text-sm font-medium text-slate-700">
                                Barcode
                              </Text>
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
                                    scannerEnabled
                                      ? 'bg-brand-700 active:opacity-80'
                                      : 'bg-slate-200'
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
                    {showAdditionalDetails
                      ? renderTextField(
                          'description',
                          'Description',
                          'Optional notes about this product',
                          {
                            multiline: true,
                          },
                        )
                      : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showAdditionalDetails }}
                      onPress={() => setShowAdditionalDetails((visible) => !visible)}
                      className="min-h-11 flex-row items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 active:bg-slate-100"
                    >
                      <Feather
                        name={showAdditionalDetails ? 'chevron-up' : 'sliders'}
                        size={15}
                        color="#475569"
                      />
                      <Text className="ml-2 text-sm font-medium text-slate-700">
                        {showAdditionalDetails
                          ? 'Hide extra details'
                          : 'Add category, brand, SKU or notes'}
                      </Text>
                    </Pressable>
                  </View>

                  {showAdditionalDetails ? (
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
                              <Text className="mb-2 text-sm font-medium text-slate-700">
                                Category
                              </Text>
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
                  ) : null}
                </View>
              </View>
            ) : null}

            {currentStep === 3 ? (
              <View>
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
                  {recipeEnabled ? (
                    <View className="border-b border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center">
                      <View className="flex-1">
                        <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                          {isRepackedProduct ? 'Calculated production cost' : 'Calculated BOM cost'}
                        </Text>
                        <Text className="mt-1 text-lg font-semibold text-emerald-950">
                          {formatMoney(bomCost.toFixed(2))}
                        </Text>
                        <Text className="mt-1 text-xs leading-4 text-emerald-800">
                          {isRepackedProduct
                            ? 'This is filled automatically from the source materials in the repacking BOM. You may adjust it for labor, packaging, utilities, or other production expenses.'
                            : 'This is filled automatically from the recipe. You may adjust the cost below for labor, packaging, utilities, or other preparation expenses.'}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          form.setValue('cost', bomCost.toFixed(2), { shouldValidate: true })
                        }
                        className="mt-3 min-h-10 items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 sm:ml-4 sm:mt-0"
                      >
                        <Text className="text-xs font-semibold text-emerald-800">Use BOM cost</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {showPortionCostCalculator ? (
                    <View className="border-b border-brand-100 bg-brand-50 p-5">
                      <View className="sm:flex-row sm:items-start">
                        <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white">
                          <Feather name="dollar-sign" size={18} color="#1A593B" />
                        </View>
                        <View className="mt-3 flex-1 sm:mt-0">
                          <Text className="font-semibold text-brand-950">
                            Let Ximo calculate the cost per portion
                          </Text>
                          <Text className="mt-1 text-sm leading-5 text-brand-800">
                            {stockSaleMode === 'whole_and_portions'
                              ? `Enter what you paid for one ${alternateUnit}. One ${alternateUnit} contains ${packageSize || '0'} ${packageMeasureUnit}.`
                              : `Enter how much ${portionCostUnit} you bought and the total amount you paid.`}
                          </Text>

                          <View className="mt-4 gap-3 sm:flex-row sm:items-end">
                            {stockSaleMode !== 'whole_and_portions' ? (
                              <View className="flex-1">
                                <Text className="mb-2 text-sm font-medium text-slate-700">
                                  Quantity purchased ({portionCostUnit})
                                </Text>
                                <TextInput
                                  value={loosePurchaseQuantity}
                                  onChangeText={setLoosePurchaseQuantity}
                                  keyboardType="decimal-pad"
                                  placeholder="Example: 10"
                                  placeholderTextColor="#A8A099"
                                  selectionColor="#1A593B"
                                  className="min-h-12 rounded-xl border border-brand-200 bg-white px-4 text-base text-slate-900 focus:border-brand-700"
                                />
                              </View>
                            ) : null}
                            <View className="flex-1">
                              <Text className="mb-2 text-sm font-medium text-slate-700">
                                {stockSaleMode === 'whole_and_portions'
                                  ? `Total cost of one ${alternateUnit}`
                                  : 'Total amount paid'}
                              </Text>
                              <TextInput
                                value={packagePurchaseCost}
                                onChangeText={setPackagePurchaseCost}
                                keyboardType="decimal-pad"
                                placeholder={'\u20B10.00'}
                                placeholderTextColor="#A8A099"
                                selectionColor="#1A593B"
                                className="min-h-12 rounded-xl border border-brand-200 bg-white px-4 text-base text-slate-900 focus:border-brand-700"
                              />
                            </View>
                            {bulkCostSuggestion ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: bulkCostApplied }}
                                disabled={bulkCostApplied}
                                onPress={applyBulkCostSuggestion}
                                className={`min-h-12 items-center justify-center rounded-xl px-5 active:opacity-80 ${
                                  bulkCostApplied ? 'bg-brand-600' : 'bg-brand-800'
                                }`}
                              >
                                <View className="flex-row items-center">
                                  {bulkCostApplied ? (
                                    <Feather name="check" size={15} color="#FFFFFF" />
                                  ) : null}
                                  <Text
                                    className={`font-semibold text-white ${
                                      bulkCostApplied ? 'ml-2' : ''
                                    }`}
                                  >
                                    {bulkCostApplied ? 'Cost applied' : 'Use suggested cost'}
                                  </Text>
                                </View>
                              </Pressable>
                            ) : null}
                          </View>

                          {bulkCostSuggestion ? (
                            <View className="mt-4 rounded-2xl border border-brand-200 bg-white p-4">
                              <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                                Suggested inventory cost
                              </Text>
                              <View className="mt-3 gap-3 sm:flex-row">
                                <View className="flex-1 rounded-xl bg-slate-50 p-3">
                                  <Text className="text-xs text-slate-500">
                                    Cost per {bulkCostSuggestion.primaryUnit}
                                  </Text>
                                  <Text className="mt-1 text-lg font-semibold text-slate-950">
                                    {formatCalculatedUnitCost(bulkCostSuggestion.primaryUnitCost)}
                                  </Text>
                                </View>
                                <View className="flex-1 rounded-xl bg-slate-50 p-3">
                                  <Text className="text-xs text-slate-500">
                                    Cost per {bulkCostSuggestion.secondaryUnit}
                                  </Text>
                                  <Text className="mt-1 text-lg font-semibold text-slate-950">
                                    {formatCalculatedUnitCost(bulkCostSuggestion.secondaryUnitCost)}
                                  </Text>
                                </View>
                              </View>
                              <Text className="hidden">
                                {formatMoney(packagePurchaseCost)} {'÷'} {portionCostQuantity}{' '}
                                {portionCostUnit} ={' '}
                                {formatCalculatedUnitCost(bulkCostSuggestion.primaryUnitCost)}/
                                {bulkCostSuggestion.primaryUnit}
                              </Text>
                              <Text className="mt-3 text-xs leading-4 text-slate-500">
                                {formatMoney(packagePurchaseCost)} {String.fromCharCode(247)}{' '}
                                {portionCostQuantity} {portionCostUnit} ={' '}
                                {formatCalculatedUnitCost(bulkCostSuggestion.primaryUnitCost)}/
                                {bulkCostSuggestion.primaryUnit}
                              </Text>
                            </View>
                          ) : (
                            <Text className="mt-3 text-xs leading-4 text-brand-700">
                              {stockSaleMode === 'whole_and_portions'
                                ? 'Enter the total supplier cost above. If the package size is wrong, go back to Inventory & Units and update it first.'
                                : `Example: enter 10 ${portionCostUnit} and the complete amount paid for those 10 ${portionCostUnit}.`}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  ) : null}
                  <View className="gap-5 p-5 md:flex-row">
                    <View className="flex-1">
                      {renderTextField(
                        'cost',
                        trackInventory ? `Reference cost per ${baseUnit}` : 'Cost',
                        '₱0.00',
                        {
                          keyboardType: 'decimal-pad',
                          helper: trackInventory
                            ? 'Starting cost only. Supplier receipts update the branch average cost.'
                            : 'Estimated cost used to calculate gross profit.',
                        },
                      )}
                    </View>
                    {inventoryRole !== 'ingredient' ? (
                      <>
                        <View className="flex-1">
                          {renderTextField(
                            'sellingPrice',
                            stockSaleMode === 'whole_and_portions'
                              ? `Portion price per ${packageMeasureUnit}`
                              : 'Selling price',
                            '₱0.00',
                            {
                              keyboardType: 'decimal-pad',
                              helper:
                                stockSaleMode === 'whole_and_portions'
                                  ? `Used when selling opened stock by ${packageMeasureUnit}.`
                                  : 'Only changes when an authorized user saves a new price.',
                            },
                          )}
                        </View>
                        <View className="flex-1">
                          {renderTextField('taxRate', 'Tax rate (%)', '12.00', {
                            keyboardType: 'decimal-pad',
                          })}
                        </View>
                      </>
                    ) : (
                      <View className="flex-1 rounded-2xl bg-brand-50 p-4">
                        <Text className="text-sm font-semibold text-brand-950">
                          Not sold at the POS
                        </Text>
                        <Text className="mt-1 text-xs leading-5 text-brand-800">
                          A raw ingredient only needs its cost. Recipes use that cost automatically.
                        </Text>
                      </View>
                    )}
                  </View>
                  {inventoryRole !== 'ingredient' ? (
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
                  ) : null}
                </View>
              </View>
            ) : null}

            {currentStep === 2 ? (
              <View>
                {!recipeEnabled ? (
                  <View>
                    <SectionLabel>Inventory and units</SectionLabel>
                    <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                      <CardHeader
                        icon="box"
                        title={
                          inventoryRole === 'ingredient'
                            ? 'How is this ingredient stored?'
                            : 'How do you sell this product?'
                        }
                        description={
                          inventoryRole === 'ingredient'
                            ? 'Packages are for receiving and storage. Recipes consume only the measured ingredient.'
                            : 'Choose the closest setup. Ximo will configure the inventory units for you.'
                        }
                      />
                      <View className="flex-row items-center border-b border-slate-100 bg-slate-50/70 p-4">
                        <View className="flex-1 pr-3">
                          <Text className="text-sm font-medium text-slate-900">
                            {stockSaleMode === 'single_unit'
                              ? 'Simple stock tracking'
                              : stockSaleMode === 'portions_only'
                                ? 'Measured stock'
                                : 'Whole packages and portions'}
                          </Text>
                          <Text className="mt-1 text-xs leading-4 text-slate-500">
                            {stockSaleMode === 'single_unit'
                              ? 'Recommended for most products.'
                              : stockSaleMode === 'portions_only'
                                ? 'Inventory is tracked by weight or volume.'
                                : 'Sealed packages and opened stock are tracked separately.'}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: showAdvancedInventory }}
                          onPress={() => setShowAdvancedInventory((visible) => !visible)}
                          className="min-h-10 flex-row items-center rounded-xl border border-slate-200 bg-white px-3"
                        >
                          <Feather name="sliders" size={14} color="#1A593B" />
                          <Text className="ml-2 text-xs font-semibold text-brand-800">
                            {showAdvancedInventory ? 'Done' : 'Advanced'}
                          </Text>
                        </Pressable>
                      </View>
                      {!isEditing && showAdvancedInventory ? (
                        <View className="border-b border-slate-100 p-5">
                          <View className="gap-3 md:flex-row">
                            {[
                              {
                                id: 'single_unit' as const,
                                title:
                                  inventoryRole === 'ingredient'
                                    ? 'Counted ingredient'
                                    : 'Whole units only',
                                description:
                                  inventoryRole === 'ingredient'
                                    ? 'Eggs, cups, wrappers, or other items consumed by piece.'
                                    : 'Sell complete pieces, packs, sacks, or containers.',
                                icon: 'package' as const,
                              },
                              {
                                id: 'whole_and_portions' as const,
                                title:
                                  inventoryRole === 'ingredient'
                                    ? 'Packaged bulk ingredient'
                                    : 'Whole + portions',
                                description:
                                  inventoryRole === 'ingredient'
                                    ? 'Receive sacks or bottles; BOM consumes kg, g, L, or ml.'
                                    : 'Sell sealed packages and smaller measured amounts.',
                                icon: 'layers' as const,
                              },
                              {
                                id: 'portions_only' as const,
                                title:
                                  inventoryRole === 'ingredient'
                                    ? 'Loose ingredient'
                                    : 'Portions only',
                                description:
                                  inventoryRole === 'ingredient'
                                    ? 'Track only the measured amount; there are no sealed packages.'
                                    : 'Sell loose stock by weight or volume.',
                                icon: 'activity' as const,
                              },
                            ].map((mode) => {
                              const selected = stockSaleMode === mode.id;
                              return (
                                <Pressable
                                  key={mode.id}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected }}
                                  onPress={() => selectStockSaleMode(mode.id)}
                                  className={`flex-1 rounded-2xl border p-4 ${
                                    selected
                                      ? 'border-brand-700 bg-brand-50'
                                      : 'border-slate-200 bg-white active:bg-slate-50'
                                  }`}
                                >
                                  <View className="flex-row items-center">
                                    <View
                                      className={`h-9 w-9 items-center justify-center rounded-xl ${
                                        selected ? 'bg-white' : 'bg-slate-100'
                                      }`}
                                    >
                                      <Feather
                                        name={mode.icon}
                                        size={16}
                                        color={selected ? '#1A593B' : '#64748B'}
                                      />
                                    </View>
                                    <View className="ml-3 flex-1">
                                      <Text className="text-sm font-semibold text-slate-950">
                                        {mode.title}
                                      </Text>
                                      <Text className="mt-1 text-xs leading-4 text-slate-500">
                                        {mode.description}
                                      </Text>
                                    </View>
                                    {selected ? (
                                      <Feather name="check-circle" size={18} color="#1A593B" />
                                    ) : null}
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}
                      <Controller
                        control={form.control}
                        name="unit"
                        render={({ field }) => {
                          if (!isEditing && stockSaleMode === 'whole_and_portions') {
                            return (
                              <View className="flex-row items-center border-b border-slate-100 bg-brand-50/50 p-5">
                                <Feather name="check-circle" size={18} color="#1A593B" />
                                <Text className="ml-3 flex-1 text-sm leading-5 text-brand-900">
                                  Ximo will track and price opened stock automatically in{' '}
                                  {field.value}.
                                </Text>
                              </View>
                            );
                          }
                          const selectableUnits =
                            !isEditing && stockSaleMode === 'portions_only'
                              ? activeUnits.filter((unit) =>
                                  ['g', 'kg', 'ml', 'l'].includes(unit.code),
                                )
                              : !isEditing && stockSaleMode === 'single_unit'
                                ? activeUnits.filter((unit) => unit.kind === 'discrete')
                                : activeUnits;
                          return (
                            <View className="border-b border-slate-100 p-5">
                              <Text className="mb-1 font-medium text-slate-900">
                                {stockSaleMode === 'portions_only'
                                  ? 'How are portions measured?'
                                  : 'Selling unit'}
                              </Text>
                              <Text className="mb-4 text-xs leading-4 text-slate-500">
                                {stockSaleMode === 'portions_only'
                                  ? 'Choose the unit cashiers will enter at checkout.'
                                  : 'Choose the unit used for each complete item.'}
                              </Text>
                              <View className="flex-row flex-wrap gap-2">
                                {selectableUnits.map((unitOption) => (
                                  <ChoiceChip
                                    key={unitOption.code}
                                    label={unitOption.name || unitOption.code.toUpperCase()}
                                    selected={field.value === unitOption.code}
                                    onPress={() => field.onChange(unitOption.code)}
                                  />
                                ))}
                              </View>
                            </View>
                          );
                        }}
                      />
                      {showAdvancedInventory ? (
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
                                  Turn off for cooked-to-order items or services without fixed
                                  stock.
                                </Text>
                              </View>
                              {!isEditing && stockSaleMode === 'whole_and_portions' ? (
                                <View className="rounded-full bg-brand-50 px-3 py-1.5">
                                  <Text className="text-xs font-semibold text-brand-700">On</Text>
                                </View>
                              ) : (
                                <Switch
                                  value={field.value}
                                  onValueChange={(value) => {
                                    field.onChange(value);
                                    if (!value) setOpeningQuantity('0');
                                  }}
                                  trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                                  thumbColor={field.value ? '#1A593B' : '#FFFFFF'}
                                />
                              )}
                            </View>
                          )}
                        />
                      ) : null}
                      {trackInventory ? (
                        isEditing ? (
                          <View className="flex-row items-center p-5">
                            <View className="flex-1 pr-4">
                              <Text className="font-medium text-slate-900">
                                Stock quantity is managed separately
                              </Text>
                              <Text className="mt-1 text-xs leading-5 text-slate-500">
                                Use a stock adjustment so every quantity change has a reason and
                                audit record.
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
                              <Text className="ml-2 text-sm font-medium text-brand-700">
                                Adjust stock
                              </Text>
                            </Pressable>
                          </View>
                        ) : stockSaleMode === 'whole_and_portions' ? null : (
                          <View className="p-5">
                            <Text className="mb-2 text-sm font-medium text-slate-700">
                              Opening stock · {branch.name}
                            </Text>
                            {portioningEnabled ? (
                              <Text className="mb-2 text-xs font-medium text-slate-600">
                                Already opened / loose stock ({packageMeasureUnit})
                              </Text>
                            ) : null}
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
                            {portioningEnabled ? (
                              <View className="mt-4">
                                <Text className="mb-2 text-sm font-medium text-slate-700">
                                  Number of sealed {alternateUnit}s
                                </Text>
                                <TextInput
                                  value={openingContainerQuantity}
                                  onChangeText={setOpeningContainerQuantity}
                                  editable={!incoming}
                                  keyboardType="number-pad"
                                  placeholder="Number of sealed containers"
                                  placeholderTextColor="#A8A099"
                                  selectionColor="#1A593B"
                                  className={`min-h-12 rounded-xl border border-slate-200 px-4 text-base text-slate-900 focus:border-brand-700 ${
                                    incoming ? 'bg-slate-100' : 'bg-white'
                                  }`}
                                />
                              </View>
                            ) : null}
                            <Text className="mt-2 text-xs leading-4 text-slate-500">
                              {incoming
                                ? 'Stock stays at zero until this product is received from the purchase order.'
                                : portioningEnabled
                                  ? `Enter loose stock in ${packageMeasureUnit}. Sealed ${alternateUnit}s are counted separately.`
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

                    {isEditing || stockSaleMode === 'whole_and_portions' ? (
                      <>
                        <SectionLabel>
                          {isEditing
                            ? inventoryRole === 'ingredient'
                              ? 'Storage packages'
                              : 'Variants'
                            : inventoryRole === 'ingredient'
                              ? 'Storage package'
                              : 'Package setup'}
                        </SectionLabel>
                        <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                          <View className="min-h-24 flex-row items-center p-5">
                            <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                              <Feather name="copy" size={17} color="#1A593B" />
                            </View>
                            <View className="flex-1 pr-3">
                              <Text className="font-semibold text-slate-950">
                                {isEditing
                                  ? 'Pack, box, and other units'
                                  : inventoryRole === 'ingredient'
                                    ? 'Set up the receiving package'
                                    : 'Set up the sealed package'}
                              </Text>
                              <Text className="mt-1 text-sm leading-5 text-slate-500">
                                {isEditing
                                  ? 'Manage every alternate variant, conversion, price, SKU, and barcode.'
                                  : inventoryRole === 'ingredient'
                                    ? 'This package is never shown in BOM units. It only tells Ximo how much measured stock it contains.'
                                    : 'Enter the package size normally; Ximo handles the inventory conversion.'}
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
                                <Text className="ml-2 text-sm font-medium text-brand-700">
                                  Manage variants
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                          {!isEditing && stockSaleMode === 'whole_and_portions' ? (
                            <View className="border-t border-slate-100 p-5">
                              <Text className="mb-2 text-sm font-medium text-slate-700">
                                Package type
                              </Text>
                              <View className="mb-5 flex-row flex-wrap gap-2">
                                {activeUnits
                                  .filter((unit) =>
                                    PACKAGE_UNIT_CODES.includes(
                                      unit.code as (typeof PACKAGE_UNIT_CODES)[number],
                                    ),
                                  )
                                  .map((unitOption) => (
                                    <ChoiceChip
                                      key={unitOption.code}
                                      label={unitOption.name || unitOption.code.toUpperCase()}
                                      selected={alternateUnit === unitOption.code}
                                      onPress={() => {
                                        setAlternateUnit(unitOption.code);
                                        const sku = form.getValues('sku');
                                        if (sku)
                                          setAlternateSku(
                                            `${sku}-${unitOption.code.toUpperCase()}`,
                                          );
                                      }}
                                    />
                                  ))}
                              </View>

                              <View className="mb-5 flex-row items-start rounded-2xl bg-brand-50 p-4">
                                <Feather name="check-circle" size={16} color="#1A593B" />
                                <Text className="ml-2 flex-1 text-sm leading-5 text-brand-900">
                                  One {alternateUnit} contains {packageSize || '0'}{' '}
                                  {packageMeasureUnit}. No manual conversion is needed.
                                </Text>
                              </View>

                              <View className="gap-5 md:flex-row">
                                <View className="flex-1">
                                  <Text className="mb-2 text-sm font-medium text-slate-700">
                                    Package size
                                  </Text>
                                  <View className="gap-2 sm:flex-row">
                                    <TextInput
                                      value={packageSize}
                                      onChangeText={updatePackageSize}
                                      keyboardType="decimal-pad"
                                      placeholder="Example: 25"
                                      placeholderTextColor="#A8A099"
                                      className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-slate-900 focus:border-brand-700"
                                    />
                                    <View className="flex-row flex-wrap gap-2">
                                      {(['g', 'kg', 'ml', 'l'] as PackageMeasureUnit[]).map(
                                        (unit) => (
                                          <ChoiceChip
                                            key={unit}
                                            label={unit === 'l' ? 'L' : unit}
                                            selected={packageMeasureUnit === unit}
                                            onPress={() => selectPackageMeasureUnit(unit)}
                                          />
                                        ),
                                      )}
                                    </View>
                                  </View>
                                </View>
                                {inventoryRole !== 'ingredient' ? (
                                  <View className="flex-1">
                                    <Text className="mb-2 text-sm font-medium text-slate-700">
                                      Whole {alternateUnit} price
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
                                ) : null}
                              </View>
                              {inventoryRole !== 'ingredient' ? (
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
                                          scannerEnabled
                                            ? 'bg-brand-700 active:opacity-80'
                                            : 'bg-slate-200'
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
                              ) : (
                                <View className="mt-5 flex-row rounded-2xl bg-slate-50 p-4">
                                  <Feather name="info" size={16} color="#64748B" />
                                  <Text className="ml-2 flex-1 text-xs leading-5 text-slate-600">
                                    Storage packages do not need a selling price, POS barcode, or
                                    BOM unit. Only the contained {packageMeasureUnit} is consumed.
                                  </Text>
                                </View>
                              )}
                              <View className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <Text className="text-sm font-semibold text-slate-950">
                                  Opening stock · {branch.name}
                                </Text>
                                <Text className="mt-1 text-xs leading-4 text-slate-500">
                                  Count sealed packages separately from stock that is already open.
                                </Text>
                                <View className="mt-4 gap-4 md:flex-row">
                                  <View className="flex-1">
                                    <Text className="mb-2 text-xs font-medium text-slate-700">
                                      Sealed {alternateUnit}s
                                    </Text>
                                    <TextInput
                                      value={openingContainerQuantity}
                                      onChangeText={setOpeningContainerQuantity}
                                      editable={!incoming}
                                      keyboardType="number-pad"
                                      placeholder="Example: 10"
                                      placeholderTextColor="#A8A099"
                                      className={`min-h-12 rounded-xl border border-slate-200 px-4 text-slate-900 focus:border-brand-700 ${
                                        incoming ? 'bg-slate-100' : 'bg-white'
                                      }`}
                                    />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="mb-2 text-xs font-medium text-slate-700">
                                      Already opened ({packageMeasureUnit})
                                    </Text>
                                    <TextInput
                                      value={openingQuantity}
                                      onChangeText={setOpeningQuantity}
                                      editable={!incoming}
                                      keyboardType="decimal-pad"
                                      placeholder="Example: 0"
                                      placeholderTextColor="#A8A099"
                                      className={`min-h-12 rounded-xl border border-slate-200 px-4 text-slate-900 focus:border-brand-700 ${
                                        incoming ? 'bg-slate-100' : 'bg-white'
                                      }`}
                                    />
                                  </View>
                                </View>
                                {incoming ? (
                                  <Text className="mt-2 text-xs leading-4 text-slate-500">
                                    Opening stock stays at zero until the purchase order is
                                    received.
                                  </Text>
                                ) : null}
                              </View>
                              <View className="mt-5 flex-row items-center rounded-2xl border border-brand-200 bg-brand-50 p-4">
                                <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-white">
                                  <Feather name="layers" size={17} color="#1A593B" />
                                </View>
                                <View className="flex-1 pr-3">
                                  <Text className="text-sm font-semibold text-brand-950">
                                    Sealed and opened stock are separated automatically
                                  </Text>
                                  <Text className="mt-1 text-xs leading-5 text-brand-800">
                                    Whole {alternateUnit}s can only use sealed stock. Portions and
                                    BOM ingredients use opened {baseUnit} stock.
                                  </Text>
                                </View>
                                <Feather name="check-circle" size={20} color="#1A593B" />
                              </View>
                              <View className="mt-3 flex-row rounded-xl bg-amber-50 p-3">
                                <Feather name="info" size={15} color="#92400E" />
                                <Text className="ml-2 flex-1 text-xs leading-5 text-amber-900">
                                  When staff opens one {alternateUnit}, {packageSize || '0'}{' '}
                                  {packageMeasureUnit} becomes available for portions and recipes.
                                  Total stock value does not change.
                                </Text>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : null}

                {recipeEnabled ? (
                  <View>
                    <SectionLabel>
                      {isRepackedProduct
                        ? 'Repacking & Source Materials (BOM)'
                        : 'Recipe & Ingredients (BOM)'}
                    </SectionLabel>
                    <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white">
                      <CardHeader
                        icon={isRepackedProduct ? 'layers' : 'coffee'}
                        title={
                          isRepackedProduct ? 'Production / repacking BOM' : 'Prepared food recipe'
                        }
                        description={
                          isRepackedProduct
                            ? `Add the raw stock and packaging required to produce one ${recipeOutputLabel}. These materials are consumed when you record a production or repacking batch—not at checkout.`
                            : 'Add everything required to make one serving. Ingredient inventory is deducted automatically at checkout.'
                        }
                        action={
                          <View className="rounded-full bg-brand-50 px-3 py-1.5">
                            <Text className="text-xs font-semibold text-brand-800">Required</Text>
                          </View>
                        }
                      />
                      <View className="border-t border-slate-100 p-5">
                        {isRepackedProduct ? (
                          <View className="mb-4 flex-row rounded-xl bg-brand-50 p-3">
                            <Feather name="info" size={15} color="#1A593B" />
                            <Text className="ml-2 flex-1 text-xs leading-5 text-brand-900">
                              Choose the bulk or raw stock being divided. The finished packs you are
                              creating should not also be selected as their own source.
                            </Text>
                          </View>
                        ) : null}
                        <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {isRepackedProduct
                            ? '1. Select Raw or Packaging Material'
                            : '1. Select Raw Ingredient Item'}
                        </Text>
                        {rawIngredientSources.length === 0 ? (
                          <View className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <Text className="text-xs font-medium text-amber-900">
                              {isRepackedProduct
                                ? 'No source materials in inventory yet'
                                : 'No other products in inventory yet'}
                            </Text>
                            <Text className="mt-1 text-xs leading-4 text-amber-800">
                              {isRepackedProduct
                                ? 'Create raw inventory items first (for example, bulk sugar or empty packaging), then select them here as source materials.'
                                : 'Create raw inventory items first (e.g., Coffee Beans, Fresh Milk, Cups) in Products, then you can select and link them here as ingredients.'}
                            </Text>
                          </View>
                        ) : (
                          <View className="mb-4">
                            <View className="mb-2 flex-row items-center justify-between">
                              <Text className="text-xs font-medium text-slate-600">
                                {isRepackedProduct
                                  ? `Tap an item to add for one ${recipeOutputLabel}:`
                                  : 'Tap a product to add as ingredient:'}
                              </Text>
                              {rawIngredientSources.length > 5 ? (
                                <Text className="text-[11px] font-medium text-slate-400">
                                  {filteredRawIngredientSources.length} item(s) found
                                </Text>
                              ) : null}
                            </View>

                            {availableIngredients.length > 3 ? (
                              <View className="mb-3 flex-row items-center rounded-xl border border-slate-200 bg-white px-3 h-10">
                                <Feather name="search" size={14} color="#64748B" />
                                <TextInput
                                  value={recipeSearchQuery}
                                  onChangeText={setRecipeSearchQuery}
                                  placeholder={
                                    isRepackedProduct
                                      ? 'Filter raw materials...'
                                      : 'Filter raw ingredients...'
                                  }
                                  placeholderTextColor="#94A3B8"
                                  className="ml-2 flex-1 text-xs font-medium text-slate-900"
                                />
                                {recipeSearchQuery ? (
                                  <Pressable onPress={() => setRecipeSearchQuery('')}>
                                    <Feather name="x" size={14} color="#64748B" />
                                  </Pressable>
                                ) : null}
                              </View>
                            ) : null}

                            <View className="flex-row flex-wrap gap-2">
                              {visibleRawIngredientSources.map((ing: IngredientOption) => {
                                const selected = recipeSelectedIngredientId === ing.id;
                                const roleLabel =
                                  ing.inventoryRole === 'ingredient'
                                    ? 'Raw inventory'
                                    : ing.inventoryRole === 'both'
                                      ? 'Sell + ingredient'
                                      : 'Sellable stock';
                                return (
                                  <Pressable
                                    key={ing.id}
                                    onPress={() => {
                                      setRecipeSelectedIngredientId(ing.id);
                                      setRecipeUnitInput(recipeUnitOptions(ing.unit)[0]!.code);
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
                                      ({formatMoney(ing.cost || '0.00')}/{ing.unit || 'pc'} ·{' '}
                                      {roleLabel})
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            {filteredRawIngredientSources.length >
                            visibleRawIngredientSources.length ? (
                              <Text className="mt-3 text-xs leading-4 text-slate-500">
                                Showing the first {visibleRawIngredientSources.length} items. Search
                                by product name or SKU to find another raw item.
                              </Text>
                            ) : null}
                          </View>
                        )}

                        {sellableOnlySources.length > 0 ? (
                          <View className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ expanded: showSellableBomSources }}
                              onPress={() => {
                                const nextValue = !showSellableBomSources;
                                setShowSellableBomSources(nextValue);
                                if (
                                  !nextValue &&
                                  selectedRecipeIngredient &&
                                  (!selectedRecipeIngredient.inventoryRole ||
                                    selectedRecipeIngredient.inventoryRole === 'sellable')
                                ) {
                                  setRecipeSelectedIngredientId('');
                                }
                              }}
                              className="flex-row items-center p-4 active:bg-slate-50"
                            >
                              <View className="h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                                <Feather name="shopping-bag" size={15} color="#64748B" />
                              </View>
                              <View className="ml-3 flex-1">
                                <Text className="text-sm font-semibold text-slate-900">
                                  Use an existing sellable item
                                </Text>
                                <Text className="mt-0.5 text-xs leading-4 text-slate-500">
                                  Optional—only when the complete piece or package is consumed.
                                </Text>
                              </View>
                              <View className="mr-3 rounded-full bg-slate-100 px-2.5 py-1">
                                <Text className="text-[11px] font-semibold text-slate-600">
                                  {sellableOnlySources.length}
                                </Text>
                              </View>
                              <Feather
                                name={showSellableBomSources ? 'chevron-up' : 'chevron-down'}
                                size={17}
                                color="#64748B"
                              />
                            </Pressable>

                            {showSellableBomSources ? (
                              <View className="border-t border-amber-200 bg-amber-50 p-4">
                                <View className="mb-3 flex-row">
                                  <Feather name="alert-circle" size={15} color="#B45309" />
                                  <Text className="ml-2 flex-1 text-xs leading-5 text-amber-900">
                                    Selecting one of these deducts a whole sellable item. Ximo will
                                    not divide it into grams or milliliters unless that product is
                                    configured as measured raw stock.
                                  </Text>
                                </View>
                                <View className="flex-row flex-wrap gap-2">
                                  {visibleSellableOnlySources.map((ingredient) => {
                                    const selected = recipeSelectedIngredientId === ingredient.id;
                                    return (
                                      <Pressable
                                        key={ingredient.id}
                                        onPress={() => {
                                          setRecipeSelectedIngredientId(ingredient.id);
                                          setRecipeUnitInput(
                                            recipeUnitOptions(ingredient.unit)[0]!.code,
                                          );
                                        }}
                                        className={`flex-row items-center rounded-xl border px-3 py-2.5 ${
                                          selected
                                            ? 'border-brand-700 bg-brand-700'
                                            : 'border-amber-200 bg-white active:bg-amber-100'
                                        }`}
                                      >
                                        <Feather
                                          name={selected ? 'check-circle' : 'shopping-bag'}
                                          size={14}
                                          color={selected ? '#FFFFFF' : '#B45309'}
                                        />
                                        <Text
                                          className={`ml-2 text-xs font-semibold ${
                                            selected ? 'text-white' : 'text-slate-800'
                                          }`}
                                        >
                                          {ingredient.name}
                                        </Text>
                                        <Text
                                          className={`ml-1.5 text-[11px] ${
                                            selected ? 'text-brand-100' : 'text-slate-400'
                                          }`}
                                        >
                                          ({formatMoney(ingredient.cost || '0.00')}/
                                          {ingredient.unit || 'pc'})
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                                {filteredSellableOnlySources.length >
                                visibleSellableOnlySources.length ? (
                                  <Text className="mt-3 text-xs leading-4 text-amber-800">
                                    Showing the first {visibleSellableOnlySources.length} items. Use
                                    the material search above to find another sellable item.
                                  </Text>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {isRepackedProduct
                            ? `2. Quantity Used per ${recipeOutputLabel}`
                            : '2. Quantity Used per Serving'}
                        </Text>
                        <View className="mb-3">
                          <Text className="mb-1 text-xs font-medium text-slate-700">
                            Deduct source stock in
                          </Text>
                          {!selectedRecipeIngredient ? (
                            <Text className="mb-2 text-xs text-slate-500">
                              Select an ingredient first. Ximo will show only compatible recipe
                              units.
                            </Text>
                          ) : null}
                          {selectedRecipeIngredient && compatibleRecipeUnits.length === 1 ? (
                            <View className="self-start rounded-lg bg-slate-100 px-3 py-2">
                              <Text className="text-xs font-semibold text-slate-700">
                                {compatibleRecipeUnits[0]?.label}
                              </Text>
                            </View>
                          ) : (
                            <View className="flex-row flex-wrap gap-1.5">
                              {compatibleRecipeUnits.map((u) => {
                                const selected = recipeUnitInput === u.code;
                                return (
                                  <Pressable
                                    key={u.code}
                                    disabled={!selectedRecipeIngredient}
                                    onPress={() => setRecipeUnitInput(u.code)}
                                    className={`rounded-lg border px-2.5 py-1.5 ${
                                      selected
                                        ? 'border-brand-700 bg-brand-700'
                                        : 'border-slate-200 bg-white'
                                    } ${!selectedRecipeIngredient ? 'opacity-40' : ''}`}
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
                          )}
                          {selectedRecipeIngredient && selectedSourceIsPackaged ? (
                            <View className="mt-3 flex-row rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <Feather name="alert-circle" size={15} color="#B45309" />
                              <View className="ml-2 flex-1">
                                <Text className="text-xs font-semibold text-amber-900">
                                  {selectedRecipeIngredient.name} is tracked per{' '}
                                  {selectedRecipeIngredient.unit}
                                </Text>
                                <Text className="mt-1 text-xs leading-5 text-amber-800">
                                  Ximo cannot offer grams or kilograms because the amount inside one{' '}
                                  {selectedRecipeIngredient.unit} is unknown. Continue only if the
                                  whole {selectedRecipeIngredient.unit} is consumed. To make 100 g
                                  portions, select or create a Raw Ingredient version of{' '}
                                  {selectedRecipeIngredient.name} tracked in g or kg.
                                </Text>
                              </View>
                            </View>
                          ) : null}
                        </View>

                        <View className="flex-row items-center gap-3">
                          <View className="flex-1">
                            <Text className="mb-1 text-xs font-medium text-slate-700">
                              {isRepackedProduct
                                ? `Qty per ${recipeOutputLabel}`
                                : 'Qty per Serving'}
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
                                (product) => product.id === recipeSelectedIngredientId,
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
                                  baseUnit: ing.unit || 'piece',
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
                              {isRepackedProduct ? 'Add Material' : 'Add Ingredient'}
                            </Text>
                          </Pressable>
                        </View>

                        {recipeItems.length > 0 ? (
                          <View className="mt-4 gap-2">
                            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              {isRepackedProduct ? 'Added Materials' : 'Added Ingredients'} (
                              {recipeItems.length})
                            </Text>
                            {recipeItems.map((item) => {
                              const effQty = convertRecipeQuantity(
                                item.quantityRequired,
                                item.unit,
                                item.baseUnit,
                              );
                              const lineEstCost = (parseFloat(item.cost || '0') * effQty).toFixed(
                                2,
                              );
                              return (
                                <View
                                  key={item.ingredientProductId}
                                  className="flex-row items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3"
                                >
                                  <View className="flex-1 pr-2">
                                    <Text className="text-sm font-semibold text-slate-900">
                                      {item.ingredientName}
                                    </Text>
                                    <Text className="text-xs text-emerald-700">
                                      {item.quantityRequired} {item.unit} per {recipeOutputLabel}{' '}
                                      (Est. {formatMoney(lineEstCost)})
                                    </Text>
                                  </View>
                                  <Pressable
                                    onPress={() =>
                                      setRecipeItems((prev) =>
                                        prev.filter(
                                          (i) => i.ingredientProductId !== item.ingredientProductId,
                                        ),
                                      )
                                    }
                                    className="h-8 w-8 items-center justify-center rounded-lg bg-rose-50 border border-rose-200"
                                  >
                                    <Feather name="trash-2" size={14} color="#E11D48" />
                                  </Pressable>
                                </View>
                              );
                            })}
                            <View className="mt-2 flex-row items-center justify-between rounded-2xl bg-brand-50 p-3 border border-brand-100">
                              <Text className="text-xs font-medium text-brand-900">
                                Est. Raw Material Cost:
                              </Text>
                              <Text className="text-sm font-bold text-brand-900">
                                {formatMoney(bomCost.toFixed(2))}
                              </Text>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {currentStep === 4 ? (
              <View>
                <SectionLabel>Summary and review</SectionLabel>
                <View className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 gap-3">
                  <Text className="text-base font-bold text-slate-900">Product Summary</Text>

                  <View className="rounded-2xl bg-slate-50 p-4 gap-2.5">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold text-slate-500">Product Name</Text>
                      <Text className="text-sm font-bold text-slate-900">{form.getValues('name') || 'Unnamed'}</Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold text-slate-500">Stocking Method</Text>
                      <Text className="text-sm font-semibold text-brand-800">
                        {stockSaleMode === 'single_unit'
                          ? 'Whole items'
                          : stockSaleMode === 'whole_and_portions'
                            ? 'Packages and loose amounts'
                            : 'Loose measured stock'}
                      </Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold text-slate-500">Base Stock Unit</Text>
                      <Text className="text-sm font-semibold text-slate-800">{(baseUnit ?? 'piece').toUpperCase()}</Text>
                    </View>
                    {alternateEnabled ? (
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold text-slate-500">Supplier Package</Text>
                        <Text className="text-sm font-semibold text-slate-800">
                          1 {alternateUnit} contains {packageSize} {packageMeasureUnit}
                        </Text>
                      </View>
                    ) : null}
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold text-slate-500">Opening Stock</Text>
                      <Text className="text-sm font-semibold text-slate-800">
                        {alternateEnabled ? `${openingContainerQuantity} sealed ${alternateUnit}s and ` : ''}
                        {openingQuantity} opened {baseUnit}
                      </Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold text-slate-500">Cashier Availability</Text>
                      <Text className="text-sm font-semibold text-slate-800">
                        {inventoryRole === 'ingredient' ? 'Not sold directly at the cashier' : 'Available at cashier'}
                      </Text>
                    </View>
                  </View>
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
                          The product will automatically become available after its first stock
                          receipt.
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
                              onValueChange={(value) =>
                                field.onChange(value ? 'active' : 'inactive')
                              }
                              trackColor={{ false: '#D7D2CC', true: '#A7D2BC' }}
                              thumbColor={enabled ? '#1A593B' : '#FFFFFF'}
                            />
                          </View>
                        );
                      }}
                    />
                  )}
                </View>
              </View>
            ) : null}

            {/* Wizard Navigation Footer Bar */}
            <View className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
              <View className="gap-3 sm:flex-row">
                {currentStep > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCurrentStep((s) => (s - 1) as any)}
                    className="min-h-14 flex-row items-center justify-center rounded-xl border border-slate-200 bg-white px-5 sm:w-36 active:bg-slate-50"
                  >
                    <Feather name="chevron-left" size={18} color="#334155" />
                    <Text className="ml-1 font-semibold text-slate-700">Back</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutation.isPending}
                    onPress={() => router.back()}
                    className="min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 sm:w-36 active:bg-slate-50"
                  >
                    <Text className="font-semibold text-slate-700">Cancel</Text>
                  </Pressable>
                )}

                {currentStep < 4 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void goToNextStep()}
                    className="min-h-14 flex-1 flex-row items-center justify-center rounded-xl bg-brand-700 px-5 active:opacity-80"
                  >
                    <Text className="mr-2 text-base font-semibold text-white">
                      Next: {wizardSteps[currentStep]?.label}
                    </Text>
                    <Feather name="chevron-right" size={18} color="#FFFFFF" />
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={mutation.isPending}
                    onPress={submitProduct}
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
                            ? 'Save & Add'
                            : 'Save product'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={scannerTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeScanner}
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
                onPress={closeScanner}
                className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
              >
                <Feather name="x" size={20} color="#475569" />
              </Pressable>
            </View>
            <View className="h-80 bg-black">
              {scannerCameraError ? (
                <View className="flex-1 items-center justify-center p-6">
                  <Feather name="camera-off" size={28} color="#CBD5E1" />
                  <Text className="mt-3 text-center font-semibold text-white">
                    Camera could not start
                  </Text>
                  <Text className="mt-1 text-center text-sm leading-5 text-slate-300">
                    {scannerCameraError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      scannerLockRef.current = false;
                      setScanChecking(false);
                      setScannerCameraReady(false);
                      setScannerCameraError('');
                      setScannerCameraSession((value) => value + 1);
                    }}
                    className="mt-4 min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5"
                  >
                    <Text className="text-sm font-semibold text-white">Try camera again</Text>
                  </Pressable>
                </View>
              ) : cameraPermission?.granted && scannerTarget ? (
                <View className="flex-1">
                <CameraView
                  key={scannerCameraSession}
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: [...CAMERA_BARCODE_TYPES] }}
                  onBarcodeScanned={scanChecking ? undefined : handleCameraScan}
                  onCameraReady={() => {
                    setScannerCameraReady(true);
                    setScannerCameraError('');
                  }}
                  onMountError={(event) => {
                    scannerLockRef.current = true;
                    setScannerCameraReady(false);
                    setScannerCameraError(
                      event.message || 'Check that another application is not using the camera.',
                    );
                  }}
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
                  {!scannerCameraReady ? (
                    <View className="absolute inset-0 items-center justify-center bg-black">
                      <LoadingState label="Starting camera…" />
                    </View>
                  ) : null}
                </View>
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
