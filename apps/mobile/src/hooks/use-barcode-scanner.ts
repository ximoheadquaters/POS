import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void | Promise<void>;
  enabled?: boolean;
  scannerCharacterTimeoutMs?: number;
  duplicateScanWindowMs?: number;
  minimumBarcodeLength?: number;
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  scannerCharacterTimeoutMs = 50,
  duplicateScanWindowMs = 300,
  minimumBarcodeLength = 3,
}: UseBarcodeScannerOptions) {
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const lastCompletedScanRef = useRef<{ barcode: string; time: number } | null>(null);
  const processingRef = useRef(false);
  const queueRef = useRef<string[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Ignore keys when typing inside editable inputs
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable) &&
        target.getAttribute('data-enable-scanner') !== 'true';

      if (isInput) {
        bufferRef.current = '';
        return;
      }

      // Ignore modifier keys
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
        return;
      }

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (timeSinceLastKey > scannerCharacterTimeoutMs) {
        bufferRef.current = '';
      }

      if (event.key === 'Enter') {
        const completedBarcode = bufferRef.current.trim();
        bufferRef.current = '';

        if (completedBarcode.length >= minimumBarcodeLength) {
          event.preventDefault();

          // Suppress duplicate hardware repeats within duplicateScanWindowMs
          if (
            lastCompletedScanRef.current &&
            lastCompletedScanRef.current.barcode === completedBarcode &&
            now - lastCompletedScanRef.current.time < duplicateScanWindowMs
          ) {
            return;
          }

          lastCompletedScanRef.current = { barcode: completedBarcode, time: now };
          setLastScannedBarcode(completedBarcode);

          // Queue different scans while processing
          if (processingRef.current) {
            queueRef.current.push(completedBarcode);
          } else {
            processBarcode(completedBarcode);
          }
        }
      } else if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    async function processBarcode(barcode: string) {
      processingRef.current = true;
      setIsScanning(true);
      try {
        await onScan(barcode);
      } finally {
        setIsScanning(false);
        processingRef.current = false;
        if (queueRef.current.length > 0) {
          const nextBarcode = queueRef.current.shift()!;
          void processBarcode(nextBarcode);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [duplicateScanWindowMs, enabled, minimumBarcodeLength, onScan, scannerCharacterTimeoutMs]);

  return {
    isScanning,
    lastScannedBarcode,
  };
}
