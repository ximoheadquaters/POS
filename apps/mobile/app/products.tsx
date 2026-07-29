import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';

interface Product {
  id: string;
  name: string;
  sku: string;
  unit?: string;
  sellingPrice: string;
  cost: string;
  averageCost: string;
  grossMarginPercent: string | null;
  suggestedSellingPrice: string;
  targetMarginPercent: string;
  lowMarginThresholdPercent: string;
  isLowMargin: boolean;
  status: string;
  trackInventory: boolean;
  sellingUnits?: Array<{ variantId: string; name: string; unit: string; unitsPerBase: number }>;
  categoryName?: string;
  brandName?: string;
}

function ProductsContent() {
  const [search, setSearch] = useState('');
  const { currentUser } = useSession();
  const branch = useBranchStore((state) => state.activeBranch);
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['products', branch?.id, search],
    initialPageParam: 1,
    enabled: Boolean(branch),
    queryFn: ({ pageParam }) =>
      api<Product[]>(
        `/products?branchId=${branch!.id}&includeInactive=true&page=${pageParam}&pageSize=30${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      ),
    getNextPageParam: (last, pages) => (last.length === 30 ? pages.length + 1 : undefined),
  });
  const products = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: Pick<Product, 'id' | 'status'>) =>
      api(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
      ]);
    },
    onError: (error) => Alert.alert('Could not update product', error.message),
  });
  return (
    <Screen>
      <Header
        title="Products"
        subtitle="Manage your product catalog"
        action={
          currentUser?.permissions.includes('products:manage') ? (
            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Manage catalogue"
                className="rounded-xl bg-brand-50 px-3 py-3"
                onPress={() => router.push('/catalogue')}
              >
                <Feather name="folder" size={18} color="#1A593B" />
              </Pressable>
              {currentUser.modules.includes('barcode_scanner') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan new product"
                  className="rounded-xl bg-brand-50 px-3 py-3"
                  onPress={() => router.push('/product-scan')}
                >
                  <Feather name="maximize" size={18} color="#1A593B" />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add new product"
                className="min-h-11 flex-row items-center rounded-xl bg-brand-700 px-4"
                onPress={() => router.push('/product-form')}
              >
                <Feather name="plus" size={17} color="#FFFFFF" />
                <Text className="ml-2 font-medium text-white">New Product</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
      {products.length ? (
        <View className="bg-white p-4">
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products by name or SKU"
            placeholderTextColor="#81776E"
            selectionColor="#1A593B"
            className="min-h-14 rounded-xl bg-slate-100 px-4"
          />
        </View>
      ) : null}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-2"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-36">
              <Feather name="box" size={42} color="#C7C0B8" />
              <Text className="mt-4 text-base font-medium text-slate-700">No products yet</Text>
              <Text className="mt-2 text-sm text-slate-400">
                Add your first product to get started
              </Text>
              {currentUser?.permissions.includes('products:manage') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add first product"
                  onPress={() => router.push('/product-form')}
                  className="mt-5 min-h-10 flex-row items-center px-3"
                >
                  <Feather name="plus" size={15} color="#1A593B" />
                  <Text className="ml-1 font-medium text-brand-700">Add Product</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View
              className={`flex-row items-center rounded-2xl border bg-white p-4 ${
                item.status === 'active' ? 'border-slate-100' : 'border-slate-200 opacity-70'
              }`}
            >
              <View className="flex-1">
                <Text className="font-medium text-slate-900">{item.name}</Text>
                <Text className="mt-1 text-xs text-slate-500">
                  {item.sku} · {(item.unit ?? 'piece').toUpperCase()} ·{' '}
                  {item.categoryName ?? 'Uncategorized'}
                  {item.brandName ? ` · ${item.brandName}` : ''}
                </Text>
                <Text className="mt-1 text-xs text-slate-400">
                  {item.trackInventory ? 'Inventory tracked' : 'Stock not tracked'}
                  {item.sellingUnits?.length
                    ? ` · Also sold by ${item.sellingUnits.map((unit) => unit.unit).join(', ')}`
                    : ''}
                </Text>
                <View className="mt-2 flex-row flex-wrap items-center gap-2">
                  <Text className="text-xs text-slate-500">
                    Average cost {formatMoney(item.averageCost)}
                  </Text>
                  <Text
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      item.isLowMargin ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    Margin {item.grossMarginPercent ?? '0.00'}%
                  </Text>
                  {item.isLowMargin ? (
                    <Text className="text-xs text-red-600">
                      Below {item.lowMarginThresholdPercent}% warning level
                    </Text>
                  ) : null}
                </View>
              </View>
              <View className="items-end">
                <Text className="font-semibold text-brand-700">
                  {formatMoney(item.sellingPrice)}
                </Text>
                {currentUser?.permissions.includes('products:manage') ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.name}`}
                      onPress={() =>
                        router.push({
                          pathname: '/product-form',
                          params: { id: item.id },
                        })
                      }
                      className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-brand-700 px-3"
                    >
                      <Feather name="edit-2" size={12} color="#FFFFFF" />
                      <Text className="ml-1 text-xs font-medium text-white">Edit</Text>
                    </Pressable>
                    {item.isLowMargin ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Review suggested price for ${item.name}`}
                        onPress={() =>
                          router.push({
                            pathname: '/product-form',
                            params: {
                              id: item.id,
                              suggestedPrice: item.suggestedSellingPrice,
                              targetMargin: item.targetMarginPercent,
                            },
                          })
                        }
                        className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-amber-50 px-3"
                      >
                        <Feather name="trending-up" size={12} color="#B45309" />
                        <Text className="ml-1 text-xs font-medium text-amber-700">
                          Review {formatMoney(item.suggestedSellingPrice)}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/product-variants',
                          params: {
                            productId: item.id,
                            name: item.name,
                            baseUnit: item.unit ?? 'piece',
                          },
                        })
                      }
                      className="mt-2 min-h-8 flex-row items-center justify-center rounded-full bg-brand-50 px-3"
                    >
                      <Feather name="copy" size={12} color="#1A593B" />
                      <Text className="ml-1 text-xs font-medium text-brand-700">Units</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: item.status === 'active' }}
                      disabled={statusMutation.isPending}
                      onPress={() =>
                        statusMutation.mutate({
                          id: item.id,
                          status: item.status === 'active' ? 'inactive' : 'active',
                        })
                      }
                      className={`mt-2 min-h-8 justify-center rounded-full px-3 ${
                        item.status === 'active' ? 'bg-brand-50' : 'bg-slate-100'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          item.status === 'active' ? 'text-brand-700' : 'text-slate-600'
                        }`}
                      >
                        {item.status === 'active' ? 'Enabled' : 'Disabled'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

export default function ProductsScreen() {
  return (
    <AppSidebarProvider>
      <ProductsContent />
    </AppSidebarProvider>
  );
}
