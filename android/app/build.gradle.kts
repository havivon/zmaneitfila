plugins { id("com.android.application") }

android {
    namespace = "com.zmaneitfila.yechezkel"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zmaneitfila.yechezkel"
        minSdk = 26
        targetSdk = 34
        // מספר הגרסה עולה בכל בנייה, כדי שאנדרואיד יזהה עדכון
        versionCode = (project.findProperty("appVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("appVersionName") as String?) ?: "1.0"
    }

    signingConfigs {
        // מפתח חתימה קבוע ששמור במאגר: בלי זה כל בנייה נחתמת במפתח אחר,
        // ואנדרואיד מסרב להתקין עדכון על גרסה שנחתמה במפתח שונה.
        create("shared") {
            storeFile = rootProject.file("keystore/zmanei-tfila.jks")
            storePassword = "zmanei-tfila"
            keyAlias = "zmanei-tfila"
            keyPassword = "zmanei-tfila"
            // כל סכימות החתימה, כדי שגם מתקין חבילות ותיק יזהה את החתימה
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug {
            signingConfig = signingConfigs.getByName("shared")
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
