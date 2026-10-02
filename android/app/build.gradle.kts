plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Azurecord 4.0.4 synchronized mobile/desktop release
android {
    namespace = "com.azurecord.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.azurecord.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 404
        versionName = "4.0.4"
    }

    signingConfigs {
        create("release") {
            val signingFile = System.getenv("AZURECORD_SIGNING_STORE_FILE")
            if (!signingFile.isNullOrBlank()) {
                storeFile = file(signingFile)
                storePassword = System.getenv("AZURECORD_SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("AZURECORD_SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("AZURECORD_SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!System.getenv("AZURECORD_SIGNING_STORE_FILE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/DEPENDENCIES"
            )
        }
    }
}

dependencies {
    implementation("io.github.webrtc-sdk:android:150.7871.01")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}
