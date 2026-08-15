import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Button, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeBarcode, productLookupPath } from '@/lib/product-scan';
import { useIosAlert } from '@/providers/ios-alert';
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
  const { showAlert } = useIosAlert();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualBarcode, setManualBarcode] = useState('');
  const [manualCodeType, setManualCodeType] = useState<'barcode' | 'sku'>('barcode');
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraSession, setCameraSession] = useState(0);
  const scanLockRef = useRef(false);
  const permissionPromptedRef = useRef(false);

  const resumeScanning = useCallback(() => {
    scanLockRef.current = false;
    setChecking(false);
    setManualBarcode('');
  }, []);

  useFocusEffect(
    useCallback(() => {
      scanLockRef.current = false;
      setChecking(false);
      setCameraReady(false);
      setCameraError('');
      setFocused(true);
      return () => {
        setFocused(false);
        scanLockRef.current = true;
      };
    }, []),
  );

  useEffect(() => {
    if (
      !focused ||
      !permission ||
      permission.granted ||
      permission.status !== 'undetermined' ||
      permissionPromptedRef.current
    ) {
      return;
    }
    permissionPromptedRef.current = true;
    void requestPermission().catch(() => {
      setCameraError('The camera permission request could not be opened.');
    });
  }, [focused, permission, requestPermission]);

  const handleCode = async (rawValue: string, codeType: 'barcode' | 'sku' = 'barcode') => {
    const barcode = normalizeBarcode(rawValue);
    if (scanLockRef.current) return;
    if (barcode.length < 3) {
      scanLockRef.current = true;
      setChecking(true);
      showAlert({
        type: 'warning',
        title: 'Invalid barcode',
        message: 'Enter or scan at least 3 characters.',
        buttons: [{ text: 'Scan another', onPress: resumeScanning }],
      });
      return;
    }
    if (!branch || !currentUser?.branches.some((assigned) => assigned.id === branch.id)) {
      scanLockRef.current = true;
      setChecking(true);
      showAlert({
        type: 'warning',
        title: 'Branch required',
        message: 'Select an assigned branch before scanning a product.',
        buttons: [
          { text: 'Cancel', style: 'cancel', onPress: resumeScanning },
          { text: 'Select branch', onPress: () => router.replace('/branches') },
        ],
      });
      return;
    }
    scanLockRef.current = true;
    setChecking(true);
    try {
      const existing = await api<CartProduct | null>(
        productLookupPath(barcode, branch.id, addToCart ? 'pos' : undefined),
      );
      if (existing) {
        if (addToCart) {
          if (existing.status === 'inactive') {
            showAlert({
              type: 'warning',
              title: 'Product is inactive',
              message: 'Ask an owner or manager to reactivate this product.',
              buttons: [{ text: 'Scan another', onPress: resumeScanning }],
            });
            return;
          }
          if (
            existing.availableQuantity !== null &&
            existing.availableQuantity !== undefined &&
            existing.availableQuantity <= 0
          ) {
            showAlert({
              type: 'warning',
              title: 'Product is sold out',
              message: 'Stock changed on another register.',
              buttons: [{ text: 'Scan another', onPress: resumeScanning }],
            });
            return;
          }
          add(existing);
          router.replace('/(tabs)/pos');
          return;
        }
        showAlert({
          type: 'info',
          title: 'Product already exists',
          message: `${existing.name} already uses this barcode.`,
          buttons: [
            { text: 'Scan another', onPress: resumeScanning },
            { text: 'Back to products', onPress: () => router.back() },
          ],
        });
        return;
      }
      if (!currentUser?.permissions.includes('products:manage')) {
        showAlert({
          type: 'warning',
          title: 'Product not found',
          message: 'Ask an owner or manager to add this barcode before selling it.',
          buttons: [{ text: 'Scan another', onPress: resumeScanning }],
        });
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
      showAlert({
        type: 'error',
        title: 'Could not check barcode',
        message: error instanceof Error ? error.message : 'Please try again.',
        buttons: [{ text: 'Try again', onPress: resumeScanning }],
      });
    }
  };

  const handleCameraScan = (result: BarcodeScanningResult) => {
    void handleCode(result.data, 'barcode');
  };

  if (!currentUser?.modules.includes('barcode_scanner')) {
    return <Redirect href="/(tabs)/more" />;
  }

  const insecureWebContext =
    Platform.OS === 'web' && typeof window !== 'undefined' && !window.isSecureContext;

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
          {permission.granted && !insecureWebContext ? (
            cameraError ? (
              <View className="mb-4 min-h-72 items-center justify-center rounded-3xl bg-slate-950 p-6">
                <Text className="text-center font-semibold text-white">Camera could not start</Text>
                <Text className="mt-2 text-center text-sm leading-5 text-slate-300">
                  {cameraError}
                </Text>
                <View className="mt-4 w-full max-w-48">
                  <Button
                    title="Try camera again"
                    onPress={() => {
                      setCameraError('');
                      setCameraReady(false);
                      setCameraSession((value) => value + 1);
                    }}
                  />
                </View>
              </View>
            ) : (
              <View className="relative mb-4 h-72 overflow-hidden rounded-3xl bg-black">
                {focused ? (
                <CameraView
                  key={cameraSession}
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                  onBarcodeScanned={checking ? undefined : handleCameraScan}
                  onCameraReady={() => {
                    setCameraReady(true);
                    setCameraError('');
                  }}
                  onMountError={(event) => {
                    setCameraReady(false);
                    setCameraError(event.message || 'Check that another app is not using the camera.');
                  }}
                >
                  <View className="flex-1 items-center justify-center">
                    <View className="h-32 w-72 rounded-2xl border-2 border-white" />
                    <Text className="mt-4 rounded-full bg-black/60 px-4 py-2 font-bold text-white">
                      Hold the barcode inside the box
                    </Text>
                  </View>
                </CameraView>
                ) : null}
                {!cameraReady ? (
                  <View className="absolute inset-0 items-center justify-center bg-black">
                    <LoadingState label="Starting camera…" />
                  </View>
                ) : null}
              </View>
            )
          ) : (
            <View className="mb-4 rounded-3xl bg-brand-50 p-5">
              <Text className="font-bold text-brand-900">Camera access is needed</Text>
              <Text className="mt-1 leading-5 text-slate-600">
                {insecureWebContext
                  ? 'Camera scanning requires HTTPS or localhost. Open the secure Ximo address and try again.'
                  : 'Ximo only uses the camera to read product barcodes.'}
              </Text>
              {!insecureWebContext && permission.canAskAgain ? (
                <View className="mt-4">
                  <Button title="Allow camera" onPress={() => void requestPermission()} />
                </View>
              ) : !insecureWebContext ? (
                <View className="mt-4 gap-2">
                <Text className="mt-3 text-sm font-bold text-red-700">
                    {Platform.OS === 'web'
                      ? 'Use the lock or camera icon beside the browser address to allow camera access.'
                      : 'Enable camera access for Ximo POS in your phone settings.'}
                </Text>
                  {Platform.OS !== 'web' ? (
                    <Button title="Open device settings" onPress={() => void Linking.openSettings()} />
                  ) : null}
                </View>
              ) : null}
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
