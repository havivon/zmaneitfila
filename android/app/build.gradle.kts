plugins { id("com.android.application") }

android {
    namespace = "com.zmaneitfila.yechezkel"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zmaneitfila.yechezkel"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            // חתימה בחתימת ה‑debug כדי שאפשר יהיה להתקין ישירות מהטלפון
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
}
