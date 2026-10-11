#!/usr/bin/env bash
# Runs after "npx cap add android": our own code, the text reader library, camera permission and the app icon.
set -euo pipefail
cd "$(dirname "$0")"
J=android/app/src/main/java/be/brokeuh/nightvault
mkdir -p "$J"
cp plugin/MainActivity.java plugin/NvOcrPlugin.java plugin/NvUpdatePlugin.java plugin/NvCapturePlugin.java plugin/NvCaptureService.java "$J/"
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
# adaptive icon (Android 8+): Android shapes it itself - no white frame on the start-up screen or on Samsung phones
mkdir -p "$R/mipmap-anydpi-v26" "$R/drawable-nodpi"
cp res/mipmap-anydpi-v26/*.xml "$R/mipmap-anydpi-v26/"
cp res/drawable-nodpi/nv_icon_full.png "$R/drawable-nodpi/"
ls "$R/mipmap-anydpi-v26"
grep -n "mlkit\|versionCode" android/app/build.gradle
# screen capture (alpha): floating button over other apps, and the capture service
grep -q 'SYSTEM_ALERT_WINDOW' "$M" || sed -i 's#<uses-permission android:name="android.permission.CAMERA" />#<uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />#' "$M"
grep -q 'NvCaptureService' "$M" || sed -i 's#</application>#    <service android:name=".NvCaptureService" android:exported="false" android:foregroundServiceType="mediaProjection" />\n    </application>#' "$M"
grep -n "CAMERA\|SYSTEM_ALERT\|MEDIA_PROJECTION\|NvCaptureService" "$M"
# start-up screen (Android 12+): the app's dark colour behind the icon instead of a white circle
python3 - <<'PY'
import re
p = "android/app/src/main/res/values/styles.xml"
s = open(p).read()
items = ('<item name="windowSplashScreenBackground">#0C0F12</item>'
         '<item name="windowSplashScreenIconBackgroundColor">#0C0F12</item>')
if "windowSplashScreenIconBackgroundColor" not in s:
    s = re.sub(r'(<style name="AppTheme.NoActionBarLaunch"[^>]*>)', r'\1' + items, s)
open(p, "w").write(s)
print(s)
PY
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
