package expo.modules.ximobluetoothprinter

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class XimoBluetoothPrinterModule : Module() {
  private val serialPortUuid = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private val printLock = Any()

  private fun context(): Context = appContext.reactContext
    ?: throw IllegalStateException("Android printer context is unavailable.")

  private fun adapter() = (context().getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    ?: throw IllegalStateException("This device does not support Bluetooth.")

  private fun requireConnectPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      context().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) throw SecurityException("Allow Nearby devices access for Ximo POS, then retry.")
  }

  override fun definition() = ModuleDefinition {
    Name("XimoBluetoothPrinter")

    AsyncFunction("getPairedDevices") {
      requireConnectPermission()
      val bluetooth = adapter()
      if (!bluetooth.isEnabled) throw IllegalStateException("Turn on Bluetooth, then retry.")
      bluetooth.bondedDevices.map { device ->
        mapOf("name" to (device.name ?: "Bluetooth printer"), "address" to device.address)
      }.sortedBy { it["name"] }
    }

    AsyncFunction("printBase64") { address: String, payload: String ->
      synchronized(printLock) {
        requireConnectPermission()
        val bluetooth = adapter()
        if (!bluetooth.isEnabled) throw IllegalStateException("Turn on Bluetooth, then retry.")
        val device = bluetooth.bondedDevices.firstOrNull { it.address.equals(address, ignoreCase = true) }
          ?: throw IllegalArgumentException("Printer is no longer paired. Pair it in Android Bluetooth settings, then select it again in Ximo POS.")
        val bytes = Base64.decode(payload, Base64.DEFAULT)
        if (bytes.isEmpty() || bytes.size > 64 * 1024) throw IllegalArgumentException("Receipt data is invalid or too large.")
        val socket = device.createRfcommSocketToServiceRecord(serialPortUuid)
        try {
          socket.connect()
          socket.outputStream.use { output ->
            output.write(bytes)
            output.flush()
          }
        } finally {
          try { socket.close() } catch (_: Exception) { }
        }
      }
    }
  }
}
