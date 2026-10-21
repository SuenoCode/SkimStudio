# SkimStudio Captions

A focused caption-video app. The workflow contains only video import, narration audio import, script entry, local speech recognition with word-timed captions, caption presets, preview, and export.

## Run

Use Node.js 22 or later:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The speech model downloads on the first caption run and then recognizes speech locally. The current recognizer is English (`Xenova/whisper-base.en`).

## Android APK

The debug APK is [SkimStudio-Captions-debug.apk](release/SkimStudio-Captions-debug.apk). Rebuild with `npm run android:apk` on the development machine. The packaging script needs Android API 36/build-tools 36.0.0 in `.android-sdk` and JDK 17 at `C:\Program Files (x86)\Android\openjdk\jdk-17.0.14`. The native WebView host lives in `android-lite/`; its system file picker imports media and fonts, and its Save As bridge writes exports.

The APK is debug-signed. The signature and ZIP alignment were verified. This environment has no connected Android device or working emulator, so runtime behavior has not been verified on hardware.

## Scope

The app does not load the previous multi-video editor, timeline, story planner, AI auditor, effects inspector, or their server gateway. `src/captionApp.js` is the app entry. The existing speech worker and caption preset renderer provide word recognition and the three caption styles. Vite builds only the focused app.
