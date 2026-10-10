#!/usr/bin/env bash
# Runs after "npx cap add android": our own code, the text reader library, camera permission and the app icon.
set -euo pipefail
cd "$(dirname "$0")"
J=android/app/src/main/java/be/brokeuh/nightvault
mkdir -p "$J"
cp plugin/MainActivity.java plugin/NvOcrPlugin.java plugin/NvUpdatePlugin.java "$J/"
# Google ML Kit text recognition (the model is inside the app, works without internet)
sed -i "s#^dependencies {#dependencies {\n    implementation 'com.google.mlkit:text-recognition:16.0.1'#" android/app/build.gradle
# version shown in Android settings: the build number
sed -i "s/versionCode 1$/versionCode ${BUILD_NUMBER:-1}/; s/versionName \"1.0\"/versionName \"0.1.${BUILD_NUMBER:-1}\"/" android/app/build.gradle
M=android/app/src/main/AndroidManifest.xml
grep -q 'android.permission.CAMERA' "$M" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />#' "$M"
# icon
R=android/app/src/main/res
rm -rf "$R/mipmap-anydpi-v26"
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do cp res/mipmap-$d/*.png "$R/mipmap-$d/"; done
grep -n "mlkit\|versionCode" android/app/build.gradle
grep -n "CAMERA" "$M"
# Always sign with the key in this folder, so every new build installs over the previous one
cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        nightvault {
            storeFile file("$rootDir/../debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
    buildTypes {
        debug { signingConfig signingConfigs.nightvault }
    }
}
GRADLE
