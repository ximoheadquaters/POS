import * as React from 'react';

import { XimoBluetoothPrinterViewProps } from './XimoBluetoothPrinter.types';

export default function XimoBluetoothPrinterView(props: XimoBluetoothPrinterViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
