package com.dragin.space.server

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

class SpaceDiscovery(
    private val context: Context,
    private val onPeerFound: (id: String, name: String, ip: String, port: Int, platform: String) -> Unit,
    private val onPeerLost: (id: String) -> Unit,
) {
    companion object {
        private const val TAG = "SpaceDiscovery"
        private const val SERVICE_TYPE = "_space._tcp."
        private const val HEALTH_INTERVAL = 5000L
        private const val PEER_TIMEOUT = 15000L
    }

    data class PeerInfo(
        val id: String,
        val name: String,
        val ip: String,
        val port: Int,
        val platform: String,
        var lastSeen: Long = System.currentTimeMillis(),
    )

    private val nsdManager: NsdManager =
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val peers = ConcurrentHashMap<String, PeerInfo>()
    private var ownDeviceId: String = ""
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val handler = Handler(Looper.getMainLooper())
    private var healthRunnable: Runnable? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    // Serial resolve queue — NsdManager can only resolve one at a time on API < 34
    private val resolveQueue = ConcurrentLinkedQueue<NsdServiceInfo>()
    @Volatile private var isResolving = false

    fun publish(port: Int, deviceId: String, deviceName: String, platform: String) {
        ownDeviceId = deviceId
        acquireMulticastLock()

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = "${deviceName}-${deviceId.take(8)}"
            serviceType = "_space._tcp"
            setPort(port)
            setAttribute("id", deviceId)
            setAttribute("name", deviceName)
            setAttribute("platform", platform)
        }

        registrationListener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(si: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Registration failed: $errorCode")
            }
            override fun onUnregistrationFailed(si: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Unregistration failed: $errorCode")
            }
            override fun onServiceRegistered(si: NsdServiceInfo) {
                Log.d(TAG, "Published ${si.serviceName} on port $port")
            }
            override fun onServiceUnregistered(si: NsdServiceInfo) {
                Log.d(TAG, "Unpublished ${si.serviceName}")
            }
        }

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
    }

    fun startBrowsing() {
        if (discoveryListener != null) return

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(service: NsdServiceInfo) {
                enqueueResolve(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                // Try to match by service name
                val entry = peers.entries.find { (_, peer) ->
                    service.serviceName.startsWith("${peer.name}-") ||
                    service.serviceName.contains(peer.id.take(8))
                }
                if (entry != null) {
                    peers.remove(entry.key)
                    onPeerLost(entry.key)
                    Log.d(TAG, "Peer lost (service down): ${entry.value.name}")
                }
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery start failed: $errorCode")
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery stop failed: $errorCode")
            }
            override fun onDiscoveryStarted(serviceType: String) {
                Log.d(TAG, "Browsing started for $serviceType")
            }
            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Browsing stopped")
            }
        }

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        startHealthCheck()
    }

    fun stopBrowsing() {
        stopHealthCheck()
        discoveryListener?.let {
            try { nsdManager.stopServiceDiscovery(it) } catch (_: Exception) {}
        }
        discoveryListener = null
    }

    fun unpublish() {
        registrationListener?.let {
            try { nsdManager.unregisterService(it) } catch (_: Exception) {}
        }
        registrationListener = null
        releaseMulticastLock()
        peers.clear()
    }

    // --- Serial resolve queue ---

    private fun enqueueResolve(service: NsdServiceInfo) {
        resolveQueue.add(service)
        processResolveQueue()
    }

    @Synchronized
    private fun processResolveQueue() {
        if (isResolving) return
        val service = resolveQueue.poll() ?: return
        isResolving = true

        nsdManager.resolveService(service, object : NsdManager.ResolveListener {
            override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "Resolve failed for ${si.serviceName}: $errorCode")
                isResolving = false
                processResolveQueue()
            }

            override fun onServiceResolved(si: NsdServiceInfo) {
                handleResolved(si)
                isResolving = false
                processResolveQueue()
            }
        })
    }

    private fun handleResolved(service: NsdServiceInfo) {
        val txt = parseTxtRecords(service)
        val peerId = txt["id"] ?: return
        if (peerId == ownDeviceId) return

        val ip = service.host?.hostAddress ?: return
        // Skip IPv6 link-local
        if (ip.contains(":")) return

        val peer = PeerInfo(
            id = peerId,
            name = txt["name"] ?: service.serviceName,
            ip = ip,
            port = service.port,
            platform = txt["platform"] ?: "unknown",
        )

        val isNew = !peers.containsKey(peerId)
        peers[peerId] = peer

        if (isNew) {
            Log.d(TAG, "Peer found: ${peer.name} (${peer.ip}:${peer.port})")
        }

        // Always fire — JS layer handles dedup
        onPeerFound(peer.id, peer.name, peer.ip, peer.port, peer.platform)
    }

    // --- Health check ---

    private fun startHealthCheck() {
        healthRunnable = object : Runnable {
            override fun run() {
                val now = System.currentTimeMillis()
                val expired = peers.filter { now - it.value.lastSeen > PEER_TIMEOUT }
                expired.forEach {
                    peers.remove(it.key)
                    onPeerLost(it.key)
                    Log.d(TAG, "Peer timed out: ${it.value.name}")
                }
                handler.postDelayed(this, HEALTH_INTERVAL)
            }
        }
        handler.postDelayed(healthRunnable!!, HEALTH_INTERVAL)
    }

    private fun stopHealthCheck() {
        healthRunnable?.let { handler.removeCallbacks(it) }
        healthRunnable = null
    }

    // --- Multicast lock ---

    private fun acquireMulticastLock() {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        multicastLock = wifi?.createMulticastLock("SpaceDiscovery")?.apply {
            setReferenceCounted(true)
            acquire()
        }
        Log.d(TAG, "MulticastLock acquired")
    }

    private fun releaseMulticastLock() {
        multicastLock?.let {
            if (it.isHeld) it.release()
        }
        multicastLock = null
        Log.d(TAG, "MulticastLock released")
    }

    // --- TXT record parsing ---

    private fun parseTxtRecords(serviceInfo: NsdServiceInfo): Map<String, String> {
        val result = mutableMapOf<String, String>()
        serviceInfo.attributes?.forEach { (key, value) ->
            result[key] = value?.let { String(it, Charsets.UTF_8) } ?: ""
        }
        return result
    }
}
