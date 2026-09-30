import { requireNativeView } from 'expo';
import * as React from 'react';

import { XimoBluetoothPrinterViewProps } from './XimoBluetoothPrinter.types';

const NativeView: React.ComponentType<XimoBluetoothPrinterViewProps> =
  requireNativeView('XimoBluetoothPrinter');

export default function XimoBluetoothPrinterView(props: XimoBluetoothPrinterViewProps) {
  return <NativeView {...props} />;
}
