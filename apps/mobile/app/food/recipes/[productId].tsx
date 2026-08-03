import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';

export default function RecipeEditorScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<any>(null);
  const [availableIngredients, setAvailableIngredients] = useState<any[]>([]);
  const [recipeItems, setRecipeItems] = useState<
    Array<{ ingredientProductId: string; quantityRequired: string; unit: string }>
  >([]);

  useEffect(() => {
    if (productId) {
      Promise.all([
        api<any>(`/products/${productId}`),
        api<any[]>(`/products?inventoryRole=ingredient,both`),
        api<any[]>(`/products/${productId}/recipe`),
      ])
        .then(([prodRes, ingRes, recipeRes]) => {
          setProduct((prodRes as any)?.data ?? prodRes);
          const ingData = Array.isArray(ingRes) ? ingRes : (ingRes as any)?.data ?? [];
          setAvailableIngredients(ingData);
          const recipeData = Array.isArray(recipeRes) ? recipeRes : (recipeRes as any)?.data ?? [];
          if (Array.isArray(recipeData)) {
            setRecipeItems(
              recipeData.map((r: any) => ({
                ingredientProductId: r.ingredientProductId,
                quantityRequired: String(r.quantityRequired),
                unit: r.unit || 'g',
              })),
            );
          }
        })
        .catch((err: any) => {
          Alert.alert('Error', err.message || 'Failed to load recipe data');
        })
        .finally(() => setLoading(false));
    }
  }, [productId]);

  const handleAddIngredient = (ing: any) => {
    if (recipeItems.some((item) => item.ingredientProductId === ing.id)) return;
    setRecipeItems([
      ...recipeItems,
      { ingredientProductId: ing.id, quantityRequired: '1', unit: ing.unit || 'g' },
    ]);
  };

  const handleRemoveIngredient = (ingId: string) => {
    setRecipeItems(recipeItems.filter((item) => item.ingredientProductId !== ingId));
  };

  const handleSaveRecipe = async () => {
    setSaving(true);
    try {
      await api(`/products/${productId}/recipe`, {
        method: 'PUT',
        body: JSON.stringify({
          items: recipeItems.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantityRequired: parseFloat(item.quantityRequired) || 0,
            unit: item.unit,
          })),
        }),
      });
      Alert.alert('Success', 'Recipe updated successfully!');
      router.back();
    } catch (err: any) {
      Alert.alert('Save Error', err.message || 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <View className="max-w-2xl mx-auto w-full gap-6">
        <View className="flex-row items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <View>
            <Text className="text-xl font-bold text-slate-900 dark:text-white">
              BOM Recipe Editor
            </Text>
            <Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Output Item: {product?.name || productId}
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cancel</Text>
          </Pressable>
        </View>

        <View className="gap-3">
          <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Selected Recipe Ingredients
          </Text>
          {recipeItems.length === 0 ? (
            <Text className="text-xs text-slate-500 italic">No ingredients added yet.</Text>
          ) : (
            recipeItems.map((item, idx) => {
              const ing = availableIngredients.find((i) => i.id === item.ingredientProductId);
              return (
                <View
                  key={idx}
                  className="flex-row items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <Text className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1">
                    {ing?.name || item.ingredientProductId}
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={item.quantityRequired}
                      onChangeText={(val) => {
                        const updated = [...recipeItems];
                        updated[idx]!.quantityRequired = val;
                        setRecipeItems(updated);
                      }}
                      keyboardType="decimal-pad"
                      className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-center text-sm"
                    />
                    <Text className="text-xs text-slate-500 w-10">{item.unit}</Text>
                    <Pressable onPress={() => handleRemoveIngredient(item.ingredientProductId)}>
                      <Feather name="trash-2" size={16} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View className="gap-2">
          <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Add Available Raw Ingredients
          </Text>
          <View className="gap-2">
            {availableIngredients.map((ing) => {
              const isAdded = recipeItems.some((item) => item.ingredientProductId === ing.id);
              return (
                <Pressable
                  key={ing.id}
                  disabled={isAdded}
                  onPress={() => handleAddIngredient(ing)}
                  className={`p-3 rounded-xl border flex-row items-center justify-between ${
                    isAdded
                      ? 'bg-slate-100 dark:bg-slate-900 border-slate-200 opacity-50'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 active:bg-slate-50'
                  }`}
                >
                  <Text className="text-sm text-slate-800 dark:text-slate-200">{ing.name}</Text>
                  <Text className="text-xs font-semibold text-emerald-600">
                    {isAdded ? 'Added' : '+ Add'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="pt-4 flex-row justify-end">
          <Pressable
            onPress={handleSaveRecipe}
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-6 py-3 items-center justify-center shadow-sm active:bg-emerald-700"
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-bold text-white">Save Recipe</Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
