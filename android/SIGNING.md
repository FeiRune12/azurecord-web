# Android signing

Android releases must use one permanent signing key so the native updater can install future versions.

Configure these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The workflow publishes `Azurecord-Android-X.Y.Z.apk` only when all four secrets are present. Otherwise it creates an `UNSIGNED-TEST` Actions artifact and deliberately does not publish it as an updater-compatible release asset.

Old ephemeral debug installations require one manual reinstall when moving to the first permanently signed APK. After that, later signed versions update normally.

Never commit the keystore or secret values.
