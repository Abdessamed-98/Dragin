package com.dragin.space.server

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class SpaceServerService : Service() {

    companion object {
        const val CHANNEL_ID = "space_server_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "com.dragin.space.STOP_SERVER"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Space")
            .setContentText("Sharing files on local network")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_delete,
                "Stop",
                PendingIntent.getService(
                    this, 0,
                    Intent(this, SpaceServerService::class.java).apply { action = ACTION_STOP },
                    PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Space Server",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps Space file sharing active"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
