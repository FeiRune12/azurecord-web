package com.azurecord.app

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object AzurecordUpdater {
    const val ACTION_INSTALL_READY = "com.azurecord.app.action.INSTALL_READY_UPDATE"

    private const val PREFS = "azurecord_native_updater"
    private const val KEY_VERSION = "ready_version"
    private const val KEY_PATH = "ready_path"
    private const val KEY_PENDING_PERMISSION = "pending_install_permission"
    private const val KEY_FINISH_AFTER_PERMISSION = "finish_after_permission"
    private const val KEY_INSTALL_IN_PROGRESS = "install_in_progress"
    private const val KEY_REJECTED_VERSION = "rejected_version"
    private const val KEY_LAST_LAUNCHED_VERSION = "last_launched_version"

    private const val UPDATE_CHANNEL = "azurecord-updates"
    private const val UPDATE_NOTIFICATION_ID = 205

    fun schedule(context: Context) {
        val appContext = context.applicationContext
        val installedReady = readyVersion(appContext)
        if (installedReady != null && compareVersions(installedReady, BuildConfig.VERSION_NAME) <= 0) {
            clearReady(appContext)
        }
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val periodic = PeriodicWorkRequestBuilder<AzurecordUpdateWorker>(4, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            "azurecord-update-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            periodic
        )

        val immediate = OneTimeWorkRequestBuilder<AzurecordUpdateWorker>()
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            "azurecord-update-on-launch",
            ExistingWorkPolicy.REPLACE,
            immediate
        )
    }

    fun updateDirectory(context: Context): File {
        return File(context.filesDir, "updates").apply { mkdirs() }
    }

    fun markReady(context: Context, version: String, apk: File) {
        val prefs = prefs(context)
        prefs.edit()
            .putString(KEY_VERSION, version)
            .putString(KEY_PATH, apk.absolutePath)
            .remove(KEY_REJECTED_VERSION)
            .putBoolean(KEY_INSTALL_IN_PROGRESS, false)
            .apply()
        cancelReadyNotification(context)
    }

    fun rejectedVersion(context: Context): String? =
        prefs(context).getString(KEY_REJECTED_VERSION, null)

    fun markSigningTransitionNeeded(context: Context, version: String, downloadUrl: String) {
        prefs(context).edit().putString(KEY_REJECTED_VERSION, version).apply()
        ensureUpdateChannel(context)
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val open = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))
        val pending = PendingIntent.getActivity(
            context,
            206,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(context, UPDATE_CHANNEL)
            .setSmallIcon(R.drawable.ic_azurecord)
            .setContentTitle("Azurecord $version precisa de uma reinstalação única")
            .setContentText("A assinatura Android mudou para a chave permanente. Toque para baixar o APK oficial.")
            .setContentIntent(pending)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(UPDATE_NOTIFICATION_ID, notification)
    }

    fun readyVersion(context: Context): String? {
        val version = prefs(context).getString(KEY_VERSION, null)
        val path = prefs(context).getString(KEY_PATH, null)
        if (version.isNullOrBlank() || path.isNullOrBlank() || !File(path).isFile) return null
        return version
    }

    fun installReadyUpdate(activity: Activity, finishAfterRequest: Boolean): Boolean {
        val prefs = prefs(activity)
        if (prefs.getBoolean(KEY_INSTALL_IN_PROGRESS, false)) {
            // A previous PackageInstaller session may have been cancelled or lost.
            // Do not leave the UI reporting success forever: allow a fresh explicit attempt.
            prefs.edit().putBoolean(KEY_INSTALL_IN_PROGRESS, false).apply()
        }

        val path = prefs.getString(KEY_PATH, null) ?: return false
        val apk = File(path)
        if (!apk.isFile) {
            clearReady(activity)
            return false
        }

        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            prefs.edit()
                .putBoolean(KEY_PENDING_PERMISSION, true)
                .putBoolean(KEY_FINISH_AFTER_PERMISSION, finishAfterRequest)
                .apply()

            val settings = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.packageName)
            )
            activity.startActivity(settings)
            return true
        }

        return try {
            stageInstall(activity, apk)
            prefs.edit()
                .putBoolean(KEY_PENDING_PERMISSION, false)
                .putBoolean(KEY_INSTALL_IN_PROGRESS, true)
                .apply()
            cancelReadyNotification(activity)
            if (finishAfterRequest) activity.finishAndRemoveTask()
            true
        } catch (error: Exception) {
            prefs.edit().putBoolean(KEY_INSTALL_IN_PROGRESS, false).apply()
            showInstallProblem(activity, error.message ?: "O Android não conseguiu preparar a atualização.")
            false
        }
    }

    fun resumePendingInstall(activity: Activity) {
        val prefs = prefs(activity)
        if (!prefs.getBoolean(KEY_PENDING_PERMISSION, false)) return
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) return

        val finishAfter = prefs.getBoolean(KEY_FINISH_AFTER_PERMISSION, false)
        prefs.edit()
            .putBoolean(KEY_PENDING_PERMISSION, false)
            .putBoolean(KEY_FINISH_AFTER_PERMISSION, false)
            .apply()

        installReadyUpdate(activity, finishAfterRequest = finishAfter)
    }

    fun verifyDownloadedApk(context: Context, apk: File): Boolean {
        if (!apk.isFile || apk.length() <= 0L) return false

        val manager = context.packageManager
        val archive = archiveInfo(manager, apk) ?: return false
        val current = installedInfo(manager, context.packageName) ?: return false

        if (archive.packageName != context.packageName) return false
        if (longVersionCode(archive) <= longVersionCode(current)) return false

        val currentSigners = signerDigests(current)
        val archiveSigners = signerDigests(archive)
        return currentSigners.isNotEmpty() && currentSigners == archiveSigners
    }

    fun clearReady(context: Context) {
        val prefs = prefs(context)
        val path = prefs.getString(KEY_PATH, null)
        if (!path.isNullOrBlank()) {
            try { File(path).delete() } catch (_: Exception) {}
        }
        prefs.edit()
            .remove(KEY_VERSION)
            .remove(KEY_PATH)
            .remove(KEY_PENDING_PERMISSION)
            .remove(KEY_FINISH_AFTER_PERMISSION)
            .remove(KEY_INSTALL_IN_PROGRESS)
            .remove(KEY_REJECTED_VERSION)
            .apply()
        cancelReadyNotification(context)
    }

    fun consumeUpdatedVersion(context: Context): String? {
        val prefs = prefs(context)
        val current = BuildConfig.VERSION_NAME
        val previous = prefs.getString(KEY_LAST_LAUNCHED_VERSION, null)
        prefs.edit().putString(KEY_LAST_LAUNCHED_VERSION, current).apply()
        if (previous.isNullOrBlank()) return null
        return if (compareVersions(current, previous) > 0) current else null
    }

    fun onInstallFailed(context: Context, message: String) {
        prefs(context).edit().putBoolean(KEY_INSTALL_IN_PROGRESS, false).apply()
        val normalized = message.lowercase()
        if ("permission" in normalized || "denied" in normalized || "not allowed" in normalized) {
            return
        }
        showInstallProblem(context, message)
    }

    fun onInstallPendingUserAction(context: Context) {
        prefs(context).edit().putBoolean(KEY_INSTALL_IN_PROGRESS, false).apply()
    }

    private fun stageInstall(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= 31) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }

        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)

        try {
            apk.inputStream().use { input ->
                session.openWrite("azurecord-update.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }

            val callback = Intent(context, AzurecordUpdateReceiver::class.java)
                .setAction("com.azurecord.app.action.UPDATE_INSTALL_STATUS")
                .putExtra("sessionId", sessionId)

            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                callback,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )

            session.commit(pending.intentSender)
        } finally {
            session.close()
        }
    }

    fun showReadyNotification(context: Context, version: String) {
        ensureUpdateChannel(context)
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val open = Intent(context, MainActivity::class.java).apply {
            action = ACTION_INSTALL_READY
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            205,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = Notification.Builder(context, UPDATE_CHANNEL)
            .setSmallIcon(R.drawable.ic_azurecord)
            .setContentTitle("Azurecord " + version + " está pronto")
            .setContentText("Baixado. Abra o Azurecord e escolha Atualizar agora ou Depois.")
            .setContentIntent(pending)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SYSTEM)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(UPDATE_NOTIFICATION_ID, notification)
    }

    private fun showInstallProblem(context: Context, message: String) {
        ensureUpdateChannel(context)
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val notification = Notification.Builder(context, UPDATE_CHANNEL)
            .setSmallIcon(R.drawable.ic_azurecord)
            .setContentTitle("Atualização do Azurecord")
            .setContentText(message.take(150))
            .setAutoCancel(true)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(UPDATE_NOTIFICATION_ID, notification)
    }

    private fun ensureUpdateChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(UPDATE_CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                UPDATE_CHANNEL,
                context.getString(R.string.update_channel),
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Avisa quando uma nova versão do Azurecord foi baixada."
            }
        )
    }

    private fun cancelReadyNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(UPDATE_NOTIFICATION_ID)
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

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Suppress("DEPRECATION")
    private fun installedInfo(manager: PackageManager, packageName: String): PackageInfo? {
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        return try {
            if (Build.VERSION.SDK_INT >= 33) {
                manager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
            } else {
                manager.getPackageInfo(packageName, flags)
            }
        } catch (_: Exception) {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun archiveInfo(manager: PackageManager, apk: File): PackageInfo? {
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        return if (Build.VERSION.SDK_INT >= 33) {
            manager.getPackageArchiveInfo(apk.absolutePath, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            manager.getPackageArchiveInfo(apk.absolutePath, flags)
        }
    }

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else {
            info.signatures ?: return emptySet()
        }

        return signatures.map { signature ->
            val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
            digest.joinToString("") { byte -> "%02x".format(byte) }
        }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun longVersionCode(info: PackageInfo): Long {
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }
}
