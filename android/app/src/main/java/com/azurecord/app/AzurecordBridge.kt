package com.azurecord.app

import android.webkit.JavascriptInterface

class AzurecordBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun startScreenShare(payload: String): Boolean {
        activity.runOnUiThread { activity.requestNativeScreenShare(payload) }
        return true
    }

    @JavascriptInterface
    fun stopScreenShare(callId: String): Boolean {
        activity.runOnUiThread { activity.stopNativeScreenShare(callId) }
        return true
    }

    @JavascriptInterface
    fun hasCallPermissions(includeCamera: Boolean): Boolean =
        activity.hasCallPermissions(includeCamera)

    @JavascriptInterface
    fun requestCallPermissions(includeCamera: Boolean): Boolean {
        if (activity.hasCallPermissions(includeCamera)) return true
        activity.requestCallPermissions(includeCamera)
        return true
    }

    @JavascriptInterface
    fun setCallActive(active: Boolean): Boolean {
        activity.setNativeCallActive(active)
        return true
    }

    @JavascriptInterface
    fun notifyIncomingCall(name: String, callId: String, type: String): Boolean {
        activity.notifyIncomingCall(name, callId, type)
        return true
    }

    @JavascriptInterface
    fun setBadgeCount(count: Int): Boolean {
        activity.setLauncherBadgeCount(count.coerceAtLeast(0))
        return true
    }

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun isNativeAndroid(): Boolean = true
}

object AzurecordNativeEvents {
    @Volatile
    var sink: ((String) -> Unit)? = null

    fun emit(json: String) {
        sink?.invoke(json)
    }
}
