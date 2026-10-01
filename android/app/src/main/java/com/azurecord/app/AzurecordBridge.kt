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
    fun isNativeAndroid(): Boolean = true
}

object AzurecordNativeEvents {
    @Volatile
    var sink: ((String) -> Unit)? = null

    fun emit(json: String) {
        sink?.invoke(json)
    }
}
