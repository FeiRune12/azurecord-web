package com.azurecord.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

class AzurecordUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_SUCCESS -> {
                AzurecordUpdater.clearReady(context)
            }

            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                AzurecordUpdater.onInstallPendingUserAction(context)
                val confirmation = confirmationIntent(intent)
                if (confirmation != null) {
                    confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(confirmation)
                    } catch (_: Exception) {
                        AzurecordUpdater.onInstallFailed(
                            context,
                            "Toque novamente na atualização para concluir a instalação."
                        )
                    }
                }
            }

            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    ?: "O Android não conseguiu instalar a atualização."
                AzurecordUpdater.onInstallFailed(context, message)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun confirmationIntent(intent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }
    }
}
