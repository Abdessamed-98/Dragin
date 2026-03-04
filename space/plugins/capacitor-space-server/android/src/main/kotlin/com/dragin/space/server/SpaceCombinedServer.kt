package com.dragin.space.server

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class SpaceCombinedServer(
    private val context: Context,
    port: Int = 0,
    private val onWsMessage: (clientId: String, message: String) -> Unit,
    private val onWsClientConnected: (clientId: String, remoteAddress: String) -> Unit,
    private val onWsClientDisconnected: (clientId: String) -> Unit,
) : NanoWSD(port) {

    data class FileEntry(
        val filePath: String,
        val fileName: String,
        val mimeType: String,
    )

    private val fileRegistry = ConcurrentHashMap<String, FileEntry>()
    private val wsClients = ConcurrentHashMap<String, WebSocket>()
    private var discoveryInfo: JSONObject = JSONObject()
    private var pairPin: String? = null
    private var deviceInfo: JSONObject = JSONObject()

    // --- Public API ---

    fun registerFile(fileId: String, filePath: String, fileName: String, mimeType: String) {
        fileRegistry[fileId] = FileEntry(filePath, fileName, mimeType)
    }

    fun unregisterFile(fileId: String) {
        fileRegistry.remove(fileId)
    }

    fun setDiscoveryInfo(info: JSONObject) {
        discoveryInfo = info
    }

    fun setDeviceInfo(info: JSONObject) {
        deviceInfo = info
    }

    fun setPairPin(pin: String?) {
        pairPin = pin
    }

    fun sendToClient(clientId: String, message: String) {
        try {
            wsClients[clientId]?.send(message)
        } catch (e: IOException) {
            wsClients.remove(clientId)
        }
    }

    fun broadcastWs(message: String) {
        val dead = mutableListOf<String>()
        for ((id, ws) in wsClients) {
            try {
                ws.send(message)
            } catch (e: IOException) {
                dead.add(id)
            }
        }
        dead.forEach { wsClients.remove(it) }
    }

    fun getActivePort(): Int = listeningPort

    // --- HTTP handling (non-WS requests) ---

    override fun serveHttp(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        val method = session.method
        val uri = session.uri ?: "/"

        // CORS preflight
        if (method == NanoHTTPD.Method.OPTIONS) {
            return corsResponse(NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.NO_CONTENT, "text/plain", ""
            ))
        }

        if (method == NanoHTTPD.Method.GET) {
            // GET /health
            if (uri == "/health") {
                return corsResponse(NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/json",
                    """{"status":"ok"}"""
                ))
            }

            // GET /files/{fileId}
            val fileMatch = Regex("^/files/([a-zA-Z0-9_-]+)$").find(uri)
            if (fileMatch != null) {
                return corsResponse(serveFile(fileMatch.groupValues[1]))
            }

            // GET /space-discover
            if (uri == "/space-discover") {
                return corsResponse(serveDiscovery())
            }

            // GET /space-pair?pin=...
            if (uri.startsWith("/space-pair")) {
                val params = session.parameters
                val pin = params["pin"]?.firstOrNull()
                return corsResponse(servePair(pin))
            }
        }

        return corsResponse(NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "Not found"
        ))
    }

    private fun serveFile(fileId: String): NanoHTTPD.Response {
        val entry = fileRegistry[fileId]
            ?: return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "File not found"
            )

        return try {
            val inputStream: InputStream
            val size: Long

            if (entry.filePath.startsWith("content://")) {
                val uri = Uri.parse(entry.filePath)
                inputStream = context.contentResolver.openInputStream(uri)
                    ?: return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.INTERNAL_ERROR, "text/plain", "Cannot open file"
                    )
                size = getContentUriSize(uri)
            } else {
                val file = java.io.File(entry.filePath)
                if (!file.exists()) {
                    return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "File not found"
                    )
                }
                inputStream = FileInputStream(file)
                size = file.length()
            }

            if (size > 0) {
                NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    entry.mimeType,
                    inputStream,
                    size
                ).apply {
                    addHeader("Cache-Control", "public, max-age=3600")
                }
            } else {
                NanoHTTPD.newChunkedResponse(
                    NanoHTTPD.Response.Status.OK,
                    entry.mimeType,
                    inputStream
                ).apply {
                    addHeader("Cache-Control", "public, max-age=3600")
                }
            }
        } catch (e: Exception) {
            NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR, "text/plain", "Server error: ${e.message}"
            )
        }
    }

    private fun serveDiscovery(): NanoHTTPD.Response {
        val response = JSONObject().apply {
            put("space", true)
            put("id", deviceInfo.optString("id", ""))
            put("name", deviceInfo.optString("name", ""))
            put("port", listeningPort)
            put("platform", deviceInfo.optString("platform", "android"))
            put("spaces", discoveryInfo.optJSONArray("spaces") ?: org.json.JSONArray())
        }
        return NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            "application/json",
            response.toString()
        )
    }

    private fun servePair(pin: String?): NanoHTTPD.Response {
        if (pairPin != null && pin == pairPin) {
            return serveDiscovery()
        }
        return NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.FORBIDDEN, "text/plain", "Forbidden"
        )
    }

    private fun getContentUriSize(uri: Uri): Long {
        var size = 0L
        try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (idx >= 0 && !cursor.isNull(idx)) {
                        size = cursor.getLong(idx)
                    }
                }
            }
        } catch (_: Exception) {}
        return size
    }

    private fun corsResponse(response: NanoHTTPD.Response): NanoHTTPD.Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
        return response
    }

    // --- WebSocket handling ---

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return SpaceWebSocket(handshake)
    }

    inner class SpaceWebSocket(handshake: NanoHTTPD.IHTTPSession) : NanoWSD.WebSocket(handshake) {
        val clientId: String = UUID.randomUUID().toString()
        val remoteIp: String = handshake.remoteIpAddress ?: "unknown"

        override fun onOpen() {
            wsClients[clientId] = this
            onWsClientConnected(clientId, remoteIp)
        }

        override fun onClose(
            code: NanoWSD.WebSocketFrame.CloseCode?,
            reason: String?,
            initiatedByRemote: Boolean
        ) {
            wsClients.remove(clientId)
            onWsClientDisconnected(clientId)
        }

        override fun onMessage(message: NanoWSD.WebSocketFrame) {
            val text = message.textPayload ?: return
            onWsMessage(clientId, text)
        }

        override fun onPong(pong: NanoWSD.WebSocketFrame) {}

        override fun onException(exception: IOException) {
            // SocketTimeoutException should not kill a WebSocket connection
            if (exception is java.net.SocketTimeoutException) {
                Log.w("SpaceWS", "Socket timeout on $clientId — ignoring")
                return
            }
            wsClients.remove(clientId)
            onWsClientDisconnected(clientId)
        }
    }
}
