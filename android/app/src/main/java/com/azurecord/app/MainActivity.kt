package com.azurecord.app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {
    companion object {
        private const val WEB_URL = "https://feirune12.github.io/azurecord-web/"
        private const val WEB_HOST = "feirune12.github.io"
        private const val WEB_PATH_PREFIX = "/azurecord-web/"
        private const val REQ_WEB_MEDIA = 901
        private const val REQ_MEDIA_PROJECTION = 902
    }

    private lateinit var webView: WebView
    private lateinit var projectionManager: MediaProjectionManager
    private var pendingProjectionPayload: JSONObject? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingWebResources: Array<String> = emptyArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
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
        AzurecordUpdater.resumePendingInstall(this)
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
            userAgentString = "$userAgentString AzurecordAndroid/2.0.4"
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
        if (requestCode != REQ_WEB_MEDIA) return

        val request = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (request == null) return

        val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (allGranted) request.grant(pendingWebResources) else request.deny()
        pendingWebResources = emptyArray()
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
        if (AzurecordNativeEvents.sink != null) AzurecordNativeEvents.sink = null
        pendingWebPermissionRequest?.deny()
        pendingWebPermissionRequest = null
        super.onDestroy()
    }
}
