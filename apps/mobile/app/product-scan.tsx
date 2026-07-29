import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Button, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeBarcode } from '@/lib/product-scan';
import { useSession } from '@/providers/session';
import { useBranchStore } from '@/store/branch';
import { useCartStore, type CartProduct } from '@/store/cart';

const BARCODE_TYPES = [
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

export default function ProductScanScreen() {
  const params = useLocalSearchParams<{ addToCart?: string }>();
  const { currentUser } = useSession();
  const addToCart = params.addToCart === '1';
  const branch = useBranchStore((state) => state.activeBranch);
  const add = useCartStore((state) => state.add);
  const [permission, requestPermission] = useCameraPermissions();
  const [manualBarcode, setManualBarcode] = useState('');
  const [manualCodeType, setManualCodeType] = useState<'barcode' | 'sku'>('barcode');
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const handleCode = async (rawValue: string, codeType: 'barcode' | 'sku' = 'barcode') => {
    const barcode = normalizeBarcode(rawValue);
    if (checking) return;
    if (barcode.length < 3) {
      Alert.alert('Invalid barcode', 'Enter or scan at least 3 characters.');
      return;
    }
    setChecking(true);
    try {
      const existing = await api<CartProduct | null>(
        `/products/lookup?code=${encodeURIComponent(barcode)}${
          addToCart && branch ? `&branchId=${branch.id}` : ''
        }`,
      );
      if (existing) {
        if (addToCart) {
          if (existing.status === 'inactive') {
            Alert.alert(
              'Product is inactive',
              'Ask an owner or manager to reactivate this product.',
              [{ text: 'Scan another', onPress: () => setChecking(false) }],
            );
            return;
          }
          if (
            existing.availableQuantity !== null &&
            existing.availableQuantity !== undefined &&
            existing.availableQuantity <= 0
          ) {
            Alert.alert('Product is sold out', 'Stock changed on another register.', [
              { text: 'Scan another', onPress: () => setChecking(false) },
            ]);
            return;
          }
          add(existing);
          router.replace('/(tabs)/pos');
          return;
        }
        Alert.alert('Product already exists', `${existing.name} already uses this barcode.`, [
          {
            text: 'Scan another',
            onPress: () => {
              setManualBarcode('');
              setChecking(false);
            },
          },
          { text: 'Back to products', onPress: () => router.back() },
        ]);
        return;
      }
      if (!currentUser?.permissions.includes('products:manage')) {
        Alert.alert(
          'Product not found',
          'Ask an owner or manager to add this barcode before selling it.',
          [{ text: 'Scan another', onPress: () => setChecking(false) }],
        );
        return;
      }
      router.replace({
        pathname: '/product-form',
        params: {
          [codeType]: barcode,
          addToCart: addToCart ? '1' : '0',
        },
      } as Href);
    } catch (error) {
      Alert.alert(
        'Could not check barcode',
        error instanceof Error ? error.message : 'Please try again.',
        [{ text: 'Try again', onPress: () => setChecking(false) }],
      );
    }
  };

  const handleCameraScan = (result: BarcodeScanningResult) => {
    void handleCode(result.data, 'barcode');
  };

  if (!currentUser?.modules.includes('barcode_scanner')) {
    return <Redirect href="/(tabs)/more" />;
  }

  return (
    <Screen>
      <Header
        title="Scan product"
        subtitle={
          addToCart
            ? 'Scan an item to add it to the sale.'
            : 'Scan an item to add it to the catalogue.'
        }
        showBack
        backLabel={addToCart ? 'POS' : 'Products'}
        fallbackHref={addToCart ? '/(tabs)/pos' : '/products'}
      />
      {!permission ? (
        <LoadingState label="Checking camera permission…" />
      ) : (
        <View className="flex-1 p-4">
          {permission.granted ? (
            <View className="mb-4 h-72 overflow-hidden rounded-3xl bg-black">
              {focused ? (
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                  onBarcodeScanned={checking ? undefined : handleCameraScan}
                >
                  <View className="flex-1 items-center justify-center">
                    <View className="h-32 w-72 rounded-2xl border-2 border-white" />
                    <Text className="mt-4 rounded-full bg-black/60 px-4 py-2 font-bold text-white">
                      Hold the barcode inside the box
                    </Text>
                  </View>
                </CameraView>
              ) : null}
            </View>
          ) : (
            <View className="mb-4 rounded-3xl bg-brand-50 p-5">
              <Text className="font-bold text-brand-900">Camera access is needed</Text>
              <Text className="mt-1 leading-5 text-slate-600">
                Ximo only uses the camera to read product barcodes.
              </Text>
              {permission.canAskAgain ? (
                <View className="mt-4">
                  <Button title="Allow camera" onPress={() => void requestPermission()} />
                </View>
              ) : (
                <Text className="mt-3 text-sm font-bold text-red-700">
                  Enable camera access for Ximo POS in your phone settings.
                </Text>
              )}
            </View>
          )}

          <View className="rounded-2xl border border-slate-100 bg-white p-4">
            <Text className="font-bold text-slate-900">Scanner or manual entry</Text>
            <Text className="mb-3 mt-1 text-sm leading-5 text-slate-500">
              Scan a barcode, or choose SKU before typing a product code.
            </Text>
            <View className="mb-3 flex-row rounded-xl bg-slate-100 p-1">
              {(['barcode', 'sku'] as const).map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected: manualCodeType === type }}
                  onPress={() => setManualCodeType(type)}
                  className={`flex-1 items-center rounded-lg py-2 ${
                    manualCodeType === type ? 'bg-white' : ''
                  }`}
                >
                  <Text
                    className={`font-bold ${
                      manualCodeType === type ? 'text-brand-700' : 'text-slate-500'
                    }`}
                  >
                    {type === 'barcode' ? 'Barcode' : 'SKU'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-2">
              <TextInput
                value={manualBarcode}
                onChangeText={setManualBarcode}
                onSubmitEditing={() => void handleCode(manualBarcode, manualCodeType)}
                editable={!checking}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                placeholder={manualCodeType === 'barcode' ? 'Scan or enter barcode' : 'Enter SKU'}
                placeholderTextColor="#81776E"
                selectionColor="#1A593B"
                className="min-h-14 flex-1 rounded-xl border border-slate-300 px-4 text-base"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: checking || manualBarcode.trim().length < 3 }}
                disabled={checking || manualBarcode.trim().length < 3}
                onPress={() => void handleCode(manualBarcode, manualCodeType)}
                className={`min-h-14 items-center justify-center rounded-xl bg-brand-700 px-4 ${
                  checking || manualBarcode.trim().length < 3 ? 'opacity-50' : 'active:opacity-80'
                }`}
              >
                <Text className="font-bold text-white">{checking ? 'Checking…' : 'Use'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}
