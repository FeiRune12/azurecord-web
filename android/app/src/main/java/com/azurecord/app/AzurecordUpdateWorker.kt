package com.azurecord.app

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class AzurecordUpdateWorker(
    appContext: Context,
    params: WorkerParameters
) : Worker(appContext, params) {

    companion object {
        private const val LATEST_RELEASE =
            "https://api.github.com/repos/FeiRune12/azurecord-web/releases/latest"
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    override fun doWork(): Result {
        return try {
            checkAndDownload()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun checkAndDownload() {
        val releaseRequest = Request.Builder()
            .url(LATEST_RELEASE)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10")
            .header("User-Agent", "Azurecord-Android/" + BuildConfig.VERSION_NAME)
            .get()
            .build()

        val release = http.newCall(releaseRequest).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("GitHub Releases respondeu HTTP " + response.code)
            JSONObject(response.body?.string().orEmpty())
        }

        val tag = release.optString("tag_name").removePrefix("v")
        if (tag.isBlank() || compareVersions(tag, BuildConfig.VERSION_NAME) <= 0) return
        if (AzurecordUpdater.rejectedVersion(applicationContext) == tag) return

        val assets = release.optJSONArray("assets") ?: return
        var downloadUrl = ""
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val name = asset.optString("name")
            if (name.startsWith("Azurecord-Android-") &&
                name.endsWith(".apk") &&
                !name.contains("UNSIGNED-TEST", ignoreCase = true)
            ) {
                downloadUrl = asset.optString("browser_download_url")
                break
            }
        }
        if (downloadUrl.isBlank()) return

        val updates = AzurecordUpdater.updateDirectory(applicationContext)
        updates.listFiles()?.forEach { file ->
            if (file.name.endsWith(".apk") || file.name.endsWith(".part")) {
                try { file.delete() } catch (_: Exception) {}
            }
        }

        val temp = File(updates, "azurecord-" + tag + ".apk.part")
        val target = File(updates, "azurecord-" + tag + ".apk")

        val downloadRequest = Request.Builder()
            .url(downloadUrl)
            .header("User-Agent", "Azurecord-Android/" + BuildConfig.VERSION_NAME)
            .get()
            .build()

        http.newCall(downloadRequest).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("Download da atualização respondeu HTTP " + response.code)
            val body = response.body ?: throw IllegalStateException("A atualização veio sem conteúdo.")
            temp.outputStream().use { output ->
                body.byteStream().use { input -> input.copyTo(output) }
            }
        }

        if (!temp.renameTo(target)) {
            temp.copyTo(target, overwrite = true)
            temp.delete()
        }

        if (!AzurecordUpdater.verifyDownloadedApk(applicationContext, target)) {
            target.delete()
            AzurecordUpdater.markSigningTransitionNeeded(applicationContext, tag, downloadUrl)
            return
        }

        AzurecordUpdater.markReady(applicationContext, tag, target)
    }

    private fun compareVersions(a: String, b: String): Int {
        val left = a.split(".").map { it.toIntOrNull() ?: 0 }
        val right = b.split(".").map { it.toIntOrNull() ?: 0 }
        val size = maxOf(left.size, right.size)
        for (i in 0 until size) {
            val x = left.getOrElse(i) { 0 }
            val y = right.getOrElse(i) { 0 }
            if (x != y) return x.compareTo(y)
        }
        return 0
    }
}
