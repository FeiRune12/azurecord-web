package com.azurecord.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject

class AzureCallScreenService : Service() {
    companion object {
        const val ACTION_START = "com.azurecord.app.action.START_SCREEN_SHARE"
        const val ACTION_STOP = "com.azurecord.app.action.STOP_SCREEN_SHARE"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_PROJECTION_DATA = "projectionData"
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_PEER_ID = "peerId"
        const val EXTRA_TOKEN = "token"

        private const val CHANNEL_ID = "azurecall-screen-share"
        private const val NOTIFICATION_ID = 204
    }

    private var engine: AzureCallScreenEngine? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                val requestedCallId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
                val current = engine
                if (current == null || requestedCallId.isBlank() || current.callId == requestedCallId) {
                    current?.stop("user")
                    if (current == null) {
                        emitState(requestedCallId, false)
                        stopSelf()
                    }
                }
                return START_NOT_STICKY
            }

            ACTION_START -> {
                startAsMediaProjectionForeground()

                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val projectionData = projectionDataFrom(intent)
                val callId = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
                val peerId = intent.getStringExtra(EXTRA_PEER_ID).orEmpty()
                val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()

                if (resultCode == 0 || projectionData == null || callId.isBlank() || peerId.isBlank() || token.isBlank()) {
                    emitError(callId, "A permissão de captura do Android chegou incompleta.")
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return START_NOT_STICKY
                }

                engine?.forceClose()
                engine = AzureCallScreenEngine(
                    service = this,
                    resultCode = resultCode,
                    projectionData = projectionData,
                    callId = callId,
                    peerId = peerId,
                    token = token,
                    onState = { active -> emitState(callId, active) },
                    onError = { message -> emitError(callId, message) },
                    onStopped = {
                        engine = null
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelf()
                    }
                ).also { it.start() }

                return START_NOT_STICKY
            }
        }

        stopSelf()
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION")
    private fun projectionDataFrom(intent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
    }

    private fun startAsMediaProjectionForeground() {
        val stopIntent = Intent(this, AzureCallScreenService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this,
            204,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_azurecord)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.screen_share_active))
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Parar", stopPendingIntent).build())
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.screen_share_channel),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantém o compartilhamento de tela do AzureCall ativo."
                setShowBadge(false)
            }
        )
    }

    private fun emitState(callId: String, active: Boolean) {
        AzurecordNativeEvents.emit(
            JSONObject()
                .put("type", "screenShare.state")
                .put("callId", callId)
                .put("active", active)
                .toString()
        )
    }

    private fun emitError(callId: String, message: String) {
        AzurecordNativeEvents.emit(
            JSONObject()
                .put("type", "screenShare.error")
                .put("callId", callId)
                .put("message", message)
                .toString()
        )
    }

    override fun onDestroy() {
        engine?.forceClose()
        engine = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
