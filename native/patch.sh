#!/usr/bin/env bash
# Runs after "npx cap add android": our own code, the text reader library, camera permission and the app icon.
set -euo pipefail
cd "$(dirname "$0")"
J=android/app/src/main/java/be/brokeuh/nightvault
mkdir -p "$J"
cp plugin/MainActivity.java plugin/NvOcrPlugin.java plugin/NvTranslatePlugin.java plugin/NvUpdatePlugin.java plugin/NvCapturePlugin.java plugin/NvCaptureService.java plugin/NvMediaPlugin.java plugin/NvMediaService.java plugin/NvFilesPlugin.java plugin/NvLogPlugin.java plugin/NvPcPlugin.java plugin/NvPrintPlugin.java plugin/NvBggPlugin.java plugin/NvLaunchPlugin.java plugin/NvTvPlugin.java plugin/NvTtsPlugin.java "$J/"
# Google ML Kit text recognition (the model is inside the app, works without internet)
sed -i "s#^dependencies {#dependencies {\n    implementation 'com.google.mlkit:text-recognition:16.0.1'\n    implementation 'com.google.mlkit:translate:17.0.3'\n    implementation 'com.google.mlkit:barcode-scanning:17.3.0'#" android/app/build.gradle
# read aloud, Nightvault's own natural voices (NvTts "@nv"): the sherpa-onnx engine (Kokoro / Piper), a ready-made Android library
SHERPA=1.13.7
mkdir -p android/app/libs
curl -sSfL -o android/app/libs/sherpa-onnx.aar "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA/sherpa-onnx-$SHERPA.aar"
ls -la android/app/libs/sherpa-onnx.aar
sed -i "s#^dependencies {#dependencies {\n    implementation files('libs/sherpa-onnx.aar')#" android/app/build.gradle
# version shown in Android settings: the build number
sed -i "s/versionCode 1$/versionCode ${BUILD_NUMBER:-1}/; s/versionName \"1.0\"/versionName \"0.1.${BUILD_NUMBER:-1}\"/" android/app/build.gradle
M=android/app/src/main/AndroidManifest.xml
grep -q 'android.permission.CAMERA' "$M" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />#' "$M"
# Take with me: the app talks to the owner's PC on the home network over plain http (NvPcPlugin) - Android blocks that unless allowed
grep -q 'usesCleartextTraffic' "$M" || sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$M"
grep -q 'usesCleartextTraffic' "$M"
# Games: see which emulator apps are installed (NvLaunch). Only the emulator packages listed in games/play.js are made visible
# (<queries>) - NOT QUERY_ALL_PACKAGES: together with screen capture and the overlay that made Google Play Protect block the app (20 Oct).
Q=$(grep -o "pkgs:\[[^]]*\]" ../games/play.js | grep -o "'[^']*'" | tr -d "'" | sort -u | sed 's#.*#        <package android:name="&" />#' | tr '\n' '~')
[ -n "$Q" ] || { echo "no emulator packages found in games/play.js"; exit 1; }
grep -q '<queries>' "$M" || sed -i "s#</manifest>#    <queries>~${Q}    </queries>~</manifest>#" "$M"
sed -i 's#~#\n#g' "$M"
! grep -q 'QUERY_ALL_PACKAGES' "$M"
grep -q 'com.retroarch' "$M"
# Cinema "Play on TV": find the TVs on the Wi-Fi (SSDP multicast needs a multicast lock)
grep -q 'CHANGE_WIFI_MULTICAST_STATE' "$M" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />\n    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />#' "$M"
grep -q 'CHANGE_WIFI_MULTICAST_STATE' "$M"
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
# read aloud (NvTts): Android 11+ only lets the app see the phone's text-to-speech engines when it says so
grep -q 'android.intent.action.TTS_SERVICE' "$M" || sed -i 's#<application#<queries><intent><action android:name="android.intent.action.TTS_SERVICE" /></intent></queries>\n    <application#' "$M"
grep -n "TTS_SERVICE" "$M"
# audio player (Nightvault Audio): media notification + keeps playing with the screen off
grep -q 'FOREGROUND_SERVICE_MEDIA_PLAYBACK' "$M" || sed -i 's#<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />#<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />#' "$M"
grep -q 'NvMediaService' "$M" || sed -i 's#</application>#    <service android:name=".NvMediaService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n    </application>#' "$M"
grep -n "CAMERA\|SYSTEM_ALERT\|MEDIA_PROJECTION\|MEDIA_PLAYBACK\|NvCaptureService\|NvMediaService" "$M"
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
    // phones with 64-bit and 32-bit ARM chips (all ordinary Android phones); keeps the app smaller now it has the voice engine
    defaultConfig { ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' } }
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
