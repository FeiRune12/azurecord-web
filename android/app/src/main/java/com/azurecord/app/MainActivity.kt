package com.azurecord.app

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.ValueCallback
import android.webkit.WebViewClient
import android.view.WindowManager
import org.json.JSONObject

class MainActivity : Activity() {
    companion object {
        private const val WEB_URL = "https://feirune12.github.io/azurecord-web/"
        private const val WEB_HOST = "feirune12.github.io"
        private const val WEB_PATH_PREFIX = "/azurecord-web/"
        private const val REQ_WEB_MEDIA = 901
        private const val REQ_MEDIA_PROJECTION = 902
        private const val REQ_CALL_PERMISSIONS = 904
        private const val REQ_FILE_CHOOSER = 905
        private const val CALL_CHANNEL = "azurecord_calls"
        private const val CALL_NOTIFICATION_ID = 3107
    }

    private lateinit var webView: WebView
    private lateinit var projectionManager: MediaProjectionManager
    private lateinit var audioManager: AudioManager
    private var nativeCallActive = false
    private var pendingProjectionPayload: JSONObject? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()
    private var pendingCallPermissions: Array<String> = emptyArray()
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        webView = WebView(this)
        setContentView(webView)
        configureWebView()
        AzurecordUpdater.schedule(this)
        requestNotificationPermissionIfNeeded()

        AzurecordNativeEvents.sink = { json ->
            runOnUiThread {
                if (::webView.isInitialized) {
                    val quoted = JSONObject.quote(json)
                    webView.evaluateJavascript("window.__azurecordNativeEvent && window.__azurecordNativeEvent($quoted);", null)
                }
            }
        }

        if (savedInstanceState == null) {
            webView.loadUrl(WEB_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }

        if (intent?.action == AzurecordUpdater.ACTION_INSTALL_READY) {
            webView.post { AzurecordUpdater.installReadyUpdate(this, finishAfterRequest = false) }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 903)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == AzurecordUpdater.ACTION_INSTALL_READY) {
            AzurecordUpdater.installReadyUpdate(this, finishAfterRequest = false)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        AzurecordUpdater.resumePendingInstall(this)
    }

    override fun onPause() {
        if (::webView.isInitialized && !nativeCallActive) webView.onPause()
        super.onPause()
    }

    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString AzurecordAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.addJavascriptInterface(AzurecordBridge(this), "AzurecordNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return handleNavigation(request.url)
            }

            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return handleNavigation(Uri.parse(url))
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebMediaPermission(request) }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileChooser?.onReceiveValue(null)
                pendingFileChooser = filePathCallback
                val chooserIntent = try {
                    fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                    }
                } catch (_: Exception) {
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                    }
                }
                return try {
                    startActivityForResult(chooserIntent, REQ_FILE_CHOOSER)
                    true
                } catch (_: ActivityNotFoundException) {
                    pendingFileChooser?.onReceiveValue(null)
                    pendingFileChooser = null
                    false
                }
            }
        }
    }

    private fun isTrustedAzurecordUri(uri: Uri?): Boolean {
        if (uri == null || uri.scheme != "https" || !uri.host.equals(WEB_HOST, ignoreCase = true)) return false
        val path = uri.path ?: "/"
        return path == "/azurecord-web" || path.startsWith(WEB_PATH_PREFIX)
    }

    private fun handleNavigation(uri: Uri): Boolean {
        if (isTrustedAzurecordUri(uri)) return false
        if (uri.scheme == "http" || uri.scheme == "https") {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (_: ActivityNotFoundException) {
            }
        }
        return true
    }

    private fun handleWebMediaPermission(request: PermissionRequest) {
        if (!isTrustedAzurecordUri(request.origin)) {
            request.deny()
            return
        }

        val allowedResources = request.resources.filter {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }.toTypedArray()

        if (allowedResources.isEmpty()) {
            request.deny()
            return
        }

        val androidPermissions = mutableListOf<String>()
        if (allowedResources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) androidPermissions += Manifest.permission.RECORD_AUDIO

        if (allowedResources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
        ) androidPermissions += Manifest.permission.CAMERA

        if (androidPermissions.isEmpty()) {
            request.grant(allowedResources)
            return
        }

        pendingWebPermissionRequest?.deny()
        pendingWebPermissionRequest = request
        pendingWebResources = allowedResources
        requestPermissions(androidPermissions.distinct().toTypedArray(), REQ_WEB_MEDIA)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == REQ_CALL_PERMISSIONS) {
            val requested = pendingCallPermissions
            pendingCallPermissions = emptyArray()
            val allGranted = requested.isNotEmpty() && requested.all {
                checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
            }
            AzurecordNativeEvents.emit(
                JSONObject()
                    .put("type", "callPermissions.result")
                    .put("granted", allGranted)
                    .toString()
            )
            return
        }

        if (requestCode != REQ_WEB_MEDIA) return

        val request = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (request == null) return

        val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (allGranted) request.grant(pendingWebResources) else request.deny()
        pendingWebResources = emptyArray()
    }

    fun requestCallPermissions(includeCamera: Boolean) {
        runOnUiThread {
            val missing = mutableListOf<String>()
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                missing += Manifest.permission.RECORD_AUDIO
            }
            if (includeCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                missing += Manifest.permission.CAMERA
            }

            if (missing.isEmpty()) {
                AzurecordNativeEvents.emit(
                    JSONObject()
                        .put("type", "callPermissions.result")
                        .put("granted", true)
                        .toString()
                )
                return@runOnUiThread
            }

            pendingCallPermissions = missing.distinct().toTypedArray()
            requestPermissions(pendingCallPermissions, REQ_CALL_PERMISSIONS)
        }
    }

    fun setNativeCallActive(active: Boolean) {
        nativeCallActive = active
        runOnUiThread {
            val notifications = getSystemService(NotificationManager::class.java)
            notifications.cancel(CALL_NOTIFICATION_ID)
            if (active) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                try { audioManager.mode = AudioManager.MODE_IN_COMMUNICATION } catch (_: Exception) {}
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                try { audioManager.mode = AudioManager.MODE_NORMAL } catch (_: Exception) {}
            }
        }
    }

    fun notifyIncomingCall(name: String, callId: String, type: String) {
        runOnUiThread {
            val manager = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CALL_CHANNEL,
                        "Chamadas AzureCall",
                        NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        description = "Chamadas recebidas no Azurecord"
                        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                    }
                )
            }
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return@runOnUiThread

            val openIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra("azurecord_call_id", callId)
            }
            val pending = PendingIntent.getActivity(
                this,
                3107,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val kind = when (type) {
                "video" -> "videochamada"
                "screen" -> "chamada com compartilhamento"
                else -> "chamada"
            }
            val notification = Notification.Builder(this, CALL_CHANNEL)
                .setSmallIcon(R.drawable.ic_azurecord)
                .setContentTitle("$name está ligando")
                .setContentText("Toque para abrir a $kind no Azurecord.")
                .setCategory(Notification.CATEGORY_CALL)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build()
            manager.notify(CALL_NOTIFICATION_ID, notification)
        }
    }

    fun requestNativeScreenShare(payload: String) {
        val parsed = try { JSONObject(payload) } catch (_: Exception) { null }
        if (parsed == null ||
            parsed.optString("callId").isBlank() ||
            parsed.optString("peerId").isBlank() ||
            parsed.optString("token").isBlank()
        ) {
            dispatchNativeError(parsed?.optString("callId").orEmpty(), "A chamada não forneceu uma sessão válida para compartilhar a tela.")
            return
        }

        pendingProjectionPayload = parsed
        try {
            startActivityForResult(projectionManager.createScreenCaptureIntent(), REQ_MEDIA_PROJECTION)
        } catch (error: Exception) {
            pendingProjectionPayload = null
            dispatchNativeError(parsed.optString("callId"), error.message ?: "O Android não conseguiu abrir a permissão de captura.")
        }
    }

    fun stopNativeScreenShare(callId: String) {
        val intent = Intent(this, AzureCallScreenService::class.java).apply {
            action = AzureCallScreenService.ACTION_STOP
            putExtra(AzureCallScreenService.EXTRA_CALL_ID, callId)
        }
        try {
            startService(intent)
        } catch (_: Exception) {
            dispatchNativeState(callId, false)
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE_CHOOSER) {
            val callback = pendingFileChooser
            pendingFileChooser = null
            val uris = if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            callback?.onReceiveValue(uris)
            return
        }
        if (requestCode != REQ_MEDIA_PROJECTION) return

        val payload = pendingProjectionPayload
        pendingProjectionPayload = null
        val callId = payload?.optString("callId").orEmpty()

        if (payload == null || resultCode != RESULT_OK || data == null) {
            dispatchNativeError(callId, "Compartilhamento de tela cancelado.")
            return
        }

        val serviceIntent = Intent(this, AzureCallScreenService::class.java).apply {
            action = AzureCallScreenService.ACTION_START
            putExtra(AzureCallScreenService.EXTRA_RESULT_CODE, resultCode)
            putExtra(AzureCallScreenService.EXTRA_PROJECTION_DATA, data)
            putExtra(AzureCallScreenService.EXTRA_CALL_ID, payload.optString("callId"))
            putExtra(AzureCallScreenService.EXTRA_PEER_ID, payload.optString("peerId"))
            putExtra(AzureCallScreenService.EXTRA_TOKEN, payload.optString("token"))
        }

        try {
            startForegroundService(serviceIntent)
        } catch (error: Exception) {
            dispatchNativeError(callId, error.message ?: "O serviço de transmissão não conseguiu iniciar.")
        }
    }

    private fun dispatchNativeState(callId: String, active: Boolean) {
        AzurecordNativeEvents.emit(
            JSONObject()
                .put("type", "screenShare.state")
                .put("callId", callId)
                .put("active", active)
                .toString()
        )
    }

    private fun dispatchNativeError(callId: String, message: String) {
        AzurecordNativeEvents.emit(
            JSONObject()
                .put("type", "screenShare.error")
                .put("callId", callId)
                .put("message", message)
                .toString()
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }

        if (AzurecordUpdater.installReadyUpdate(this, finishAfterRequest = true)) return
        finishAndRemoveTask()
    }

    override fun onDestroy() {
        try {
            nativeCallActive = false
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (::audioManager.isInitialized) audioManager.mode = AudioManager.MODE_NORMAL
            getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
        } catch (_: Exception) {}
        if (AzurecordNativeEvents.sink != null) AzurecordNativeEvents.sink = null
        pendingWebPermissionRequest?.deny()
        pendingWebPermissionRequest = null
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        super.onDestroy()
    }
}
