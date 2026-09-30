import { registerWebModule, NativeModule } from 'expo';

import { XimoBluetoothPrinterModuleEvents } from './XimoBluetoothPrinter.types';

class XimoBluetoothPrinterModule extends NativeModule<XimoBluetoothPrinterModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world!';
  }
}

export default registerWebModule(XimoBluetoothPrinterModule, 'XimoBluetoothPrinterModule');
