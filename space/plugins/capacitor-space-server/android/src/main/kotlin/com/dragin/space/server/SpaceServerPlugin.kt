package com.dragin.space.server

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "SpaceServer")
class SpaceServerPlugin : Plugin() {

    companion object {
        private const val TAG = "SpaceServerPlugin"
    }

    private var server: SpaceCombinedServer? = null
    private var discovery: SpaceDiscovery? = null
    private var serviceIntent: Intent? = null
    private var deviceId: String = ""

    @PluginMethod
    fun startServer(call: PluginCall) {
        // Guard: stop existing server before creating a new one
        // (handles WebView reload / Activity recreation)
        if (server != null) {
            Log.d(TAG, "Stopping existing server before restart")
            discovery?.stopBrowsing()
            discovery?.unpublish()
            discovery = null
            server?.stop()
            server = null
        }

        deviceId = call.getString("deviceId") ?: ""
        val deviceName = call.getString("deviceName") ?: "Android"
        val platform = call.getString("platform") ?: "android"

        try {
            server = SpaceCombinedServer(
                context = activity,
                port = 0,
                onWsMessage = { clientId, message ->
                    val data = JSObject().apply {
                        put("clientId", clientId)
                        put("message", message)
                    }
                    notifyListeners("wsMessage", data)
                },
                onWsClientConnected = { clientId, remoteAddress ->
                    val data = JSObject().apply {
                        put("clientId", clientId)
                        put("remoteAddress", remoteAddress)
                    }
                    notifyListeners("wsClientConnected", data)
                },
                onWsClientDisconnected = { clientId ->
                    val data = JSObject().apply {
                        put("clientId", clientId)
                    }
                    notifyListeners("wsClientDisconnected", data)
                },
            )

            server!!.setDeviceInfo(JSONObject().apply {
                put("id", deviceId)
                put("name", deviceName)
                put("platform", platform)
            })

            // Timeout 0 = no socket read timeout.
            // Default (5s) kills idle WebSocket connections with SocketTimeoutException.
            server!!.start(0)
            val port = server!!.listeningPort

            Log.d(TAG, "Server started on port $port")

            // Start foreground service
            serviceIntent = Intent(activity, SpaceServerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(serviceIntent)
            } else {
                activity.startService(serviceIntent)
            }

            // Initialize discovery (publish only, browsing starts via startDiscovery)
            discovery = SpaceDiscovery(
                context = activity,
                onPeerFound = { id, name, ip, peerPort, peerPlatform ->
                    val data = JSObject().apply {
                        put("id", id)
                        put("name", name)
                        put("ip", ip)
                        put("port", peerPort)
                        put("platform", peerPlatform)
                    }
                    notifyListeners("peerFound", data)
                },
                onPeerLost = { id ->
                    val data = JSObject().apply { put("id", id) }
                    notifyListeners("peerLost", data)
                },
            )
            discovery!!.publish(port, deviceId, deviceName, platform)

            val ret = JSObject().apply { put("port", port) }
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start server", e)
            call.reject("Failed to start server: ${e.message}")
        }
    }

    @PluginMethod
    fun stopServer(call: PluginCall) {
        discovery?.stopBrowsing()
        discovery?.unpublish()
        discovery = null
        server?.stop()
        server = null
        serviceIntent?.let {
            activity.stopService(it)
        }
        serviceIntent = null
        Log.d(TAG, "Server stopped")
        call.resolve()
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        discovery?.startBrowsing()
        call.resolve()
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        discovery?.stopBrowsing()
        call.resolve()
    }

    @PluginMethod
    fun registerFile(call: PluginCall) {
        val fileId = call.getString("fileId") ?: return call.reject("Missing fileId")
        val filePath = call.getString("filePath") ?: return call.reject("Missing filePath")
        val fileName = call.getString("fileName") ?: return call.reject("Missing fileName")
        val mimeType = call.getString("mimeType") ?: "application/octet-stream"

        // Try to persist content:// URI permission
        val actualPath = if (filePath.startsWith("content://")) {
            try {
                val uri = Uri.parse(filePath)
                activity.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
                filePath
            } catch (_: Exception) {
                filePath
            }
        } else {
            filePath
        }

        server?.registerFile(fileId, actualPath, fileName, mimeType)
        call.resolve()
    }

    @PluginMethod
    fun unregisterFile(call: PluginCall) {
        val fileId = call.getString("fileId") ?: return call.reject("Missing fileId")
        server?.unregisterFile(fileId)
        call.resolve()
    }

    @PluginMethod
    fun setDiscoveryInfo(call: PluginCall) {
        val spaces = call.getArray("spaces")
        val pairPin = call.getString("pairPin")

        val info = JSONObject().apply {
            put("spaces", spaces)
        }
        server?.setDiscoveryInfo(info)
        server?.setPairPin(pairPin)
        call.resolve()
    }

    @PluginMethod
    fun sendToClient(call: PluginCall) {
        val clientId = call.getString("clientId") ?: return call.reject("Missing clientId")
        val message = call.getString("message") ?: return call.reject("Missing message")
        server?.sendToClient(clientId, message)
        call.resolve()
    }

    @PluginMethod
    fun broadcastMessage(call: PluginCall) {
        val message = call.getString("message") ?: return call.reject("Missing message")
        server?.broadcastWs(message)
        call.resolve()
    }

    @PluginMethod
    fun pickFiles(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "pickFilesCallback")
    }

    @ActivityCallback
    private fun pickFilesCallback(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().apply { put("files", JSArray()) })
            return
        }

        val data = result.data
        if (data == null) {
            call.resolve(JSObject().apply { put("files", JSArray()) })
            return
        }

        val files = JSArray()

        val clipData = data.clipData
        if (clipData != null) {
            for (i in 0 until clipData.itemCount) {
                val uri = clipData.getItemAt(i).uri
                uriToFileEntry(uri)?.let { files.put(it) }
            }
        } else {
            data.data?.let { uri ->
                uriToFileEntry(uri)?.let { files.put(it) }
            }
        }

        call.resolve(JSObject().apply { put("files", files) })
    }

    private fun uriToFileEntry(uri: Uri): JSObject? {
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: Exception) {}

        var name = "unknown"
        var size = 0L
        try {
            activity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) name = cursor.getString(nameIdx) ?: "unknown"
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                }
            }
        } catch (_: Exception) {}

        val mimeType = activity.contentResolver.getType(uri) ?: "application/octet-stream"

        return JSObject().apply {
            put("uri", uri.toString())
            put("name", name)
            put("size", size)
            put("mimeType", mimeType)
        }
    }

    override fun handleOnDestroy() {
        discovery?.stopBrowsing()
        discovery?.unpublish()
        server?.stop()
        serviceIntent?.let {
            try { activity.stopService(it) } catch (_: Exception) {}
        }
    }
}
