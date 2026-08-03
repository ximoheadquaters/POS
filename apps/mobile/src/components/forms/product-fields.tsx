import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { PREPARATION_BEHAVIORS, PreparationBehavior } from '@ximo/shared';

export interface ProductIdentityFieldsProps {
  name: string;
  onChangeName: (value: string) => void;
  sku: string;
  onChangeSku: (value: string) => void;
  barcode: string;
  onChangeBarcode: (value: string) => void;
  showSkuBarcode?: boolean;
  errors?: Record<string, string>;
}

export const ProductIdentityFields: React.FC<ProductIdentityFieldsProps> = ({
  name,
  onChangeName,
  sku,
  onChangeSku,
  barcode,
  onChangeBarcode,
  showSkuBarcode = true,
  errors = {},
}) => {
  return (
    <View className="gap-4">
      <View>
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
          Product Name *
        </Text>
        <TextInput
          value={name}
          onChangeText={onChangeName}
          placeholder="e.g. Premium Beef Burger"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white"
        />
        {errors.name ? <Text className="text-xs text-red-500 mt-1">{errors.name}</Text> : null}
      </View>

      {showSkuBarcode && (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">SKU</Text>
            <TextInput
              value={sku}
              onChangeText={onChangeSku}
              placeholder="Auto / Manual SKU"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white text-sm"
            />
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Barcode</Text>
            <TextInput
              value={barcode}
              onChangeText={onChangeBarcode}
              placeholder="Barcode"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white text-sm"
            />
          </View>
        </View>
      )}
    </View>
  );
};

export interface PricingFieldsProps {
  cost: string;
  onChangeCost: (value: string) => void;
  sellingPrice: string;
  onChangeSellingPrice: (value: string) => void;
  showSellingPrice?: boolean;
  taxRate?: string;
  onChangeTaxRate?: (value: string) => void;
  errors?: Record<string, string>;
}

export const PricingFields: React.FC<PricingFieldsProps> = ({
  cost,
  onChangeCost,
  sellingPrice,
  onChangeSellingPrice,
  showSellingPrice = true,
  taxRate = '0',
  onChangeTaxRate,
  errors = {},
}) => {
  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Cost Price ₱</Text>
          <TextInput
            value={cost}
            onChangeText={onChangeCost}
            keyboardType="decimal-pad"
            placeholder="0.00"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white text-sm"
          />
          {errors.cost ? <Text className="text-xs text-red-500 mt-1">{errors.cost}</Text> : null}
        </View>

        {showSellingPrice && (
          <View className="flex-1">
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Selling Price ₱</Text>
            <TextInput
              value={sellingPrice}
              onChangeText={onChangeSellingPrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white text-sm"
            />
            {errors.sellingPrice ? <Text className="text-xs text-red-500 mt-1">{errors.sellingPrice}</Text> : null}
          </View>
        )}
      </View>
    </View>
  );
};

export interface PreparationBehaviorFieldsProps {
  selected: PreparationBehavior;
  onSelect: (behavior: PreparationBehavior) => void;
  allowedBehaviors?: PreparationBehavior[];
}

export const PreparationBehaviorFields: React.FC<PreparationBehaviorFieldsProps> = ({
  selected,
  onSelect,
  allowedBehaviors = ['cook_to_order', 'preproduced'],
}) => {
  const options = [
    {
      id: 'cook_to_order' as PreparationBehavior,
      title: 'Cook to Order',
      desc: 'Deducts BOM recipe ingredients immediately upon checkout',
    },
    {
      id: 'preproduced' as PreparationBehavior,
      title: 'Preproduced / Batch',
      desc: 'Produced via Batch Production screen before being sold',
    },
  ].filter((opt) => allowedBehaviors.includes(opt.id));

  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
        Preparation & Inventory Behavior
      </Text>
      <View className="gap-2 sm:flex-row">
        {options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              className={`flex-1 rounded-xl p-3 border ${
                isSelected
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-500'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {opt.title}
              </Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{opt.desc}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

export interface RecipeBomFieldsProps {
  recipeItems: Array<{
    ingredientProductId: string;
    ingredientName?: string;
    quantityRequired: string;
    unit: string;
    unitCost?: string;
  }>;
  onUpdateItems: (
    items: Array<{
      ingredientProductId: string;
      ingredientName?: string;
      quantityRequired: string;
      unit: string;
      unitCost?: string;
    }>,
  ) => void;
  calculatedCost?: string;
}

export const RecipeBomFields: React.FC<RecipeBomFieldsProps> = ({
  recipeItems,
  onUpdateItems,
  calculatedCost = '0.00',
}) => {
  return (
    <View className="gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          Bill of Materials (BOM Recipe)
        </Text>
        <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          Total Recipe Cost: ₱{calculatedCost}
        </Text>
      </View>
      {recipeItems.length === 0 ? (
        <Text className="text-xs text-slate-500 italic">No ingredients added to recipe yet.</Text>
      ) : (
        <View className="gap-2">
          {recipeItems.map((item, idx) => (
            <View
              key={idx}
              className="flex-row items-center justify-between bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <Text className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {item.ingredientName || item.ingredientProductId}
              </Text>
              <Text className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {item.quantityRequired} {item.unit}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};
