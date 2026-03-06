# AuraLock Terminal — Build APK Guide

Build last updated: 2026-03-06

## 📋 Prerequisites

Before building, make sure you have:

| Tool | Version | Download |
|---|---|---|
| Android Studio | Hedgehog or newer | [developer.android.com/studio](https://developer.android.com/studio) |
| JDK | 17 or newer | Bundled with Android Studio |
| Android SDK | API 33+ | Install via Android Studio SDK Manager |
| Node.js | 18+ | Already on your machine |

---

## ⚙️ Backend IP Configuration

The APK uses your PC's LAN IP to connect to the backend.

> **If your PC's WiFi IP changes, update this line before rebuilding:**

```jsx
// terminal-app/src/App.jsx — line 10
const API_BASE = 'http://192.168.2.165:8000';
```

**Check your IP:**
```
ipconfig | findstr IPv4
```

Both the phone and PC must be on the **same WiFi network**.

---

## 🔨 Build Commands (Run Every Time You Change Code)

```bash
cd "d:\SMART DOOR LOCK\terminal-app"

# 1. Build the React web app
npm run build

# 2. Sync built assets into the Android project
npx cap sync android
```

---

## 📱 Build the APK in Android Studio

### Step 1 — Open the project
```
File → Open → d:\SMART DOOR LOCK\terminal-app\android
```

### Step 2 — Wait for Gradle sync
Android Studio will download dependencies (~2–5 minutes first time).

### Step 3 — Build Debug APK
```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

The APK will be at:
```
terminal-app\android\app\build\outputs\apk\debug\app-debug.apk
```

### Step 4 — Install on Android phone

**Option A — USB (fastest):**
1. Enable Developer Options on phone (Settings → About → tap Build Number 7 times)
2. Enable USB Debugging
3. Connect phone to PC via USB
4. In Android Studio: `Run → Run 'app'`

**Option B — ADB command:**
```bash
adb install terminal-app\android\app\build\outputs\apk\debug\app-debug.apk
```

**Option C — File transfer:**
Copy `app-debug.apk` to phone → open in file manager → install
(Requires "Install from unknown sources" enabled on the phone)

---

## 🔒 Permissions Required (Auto-requested on first launch)

| Permission | Purpose |
|---|---|
| Camera | Face scan for attendance |
| Biometric/Fingerprint | Fingerprint verify |
| Internet | Connect to backend API |

---

## 🖥️ Kiosk Mode (Automatic)

The app runs in full kiosk mode automatically:
- ✅ Status bar hidden
- ✅ Navigation bar hidden (swipe from edge to temporarily show)
- ✅ Screen stays on permanently
- ✅ Portrait orientation locked

---

## 🌐 Architecture

```
Android Phone
    │
    │ Wi-Fi (same network)
    ▼
Backend PC (192.168.2.165)
    ├── Node.js API (port 8000)
    └── Python Biometric Engine (port 8001)
            │
            ▼
        Supabase (cloud DB)
```

---

## 🔄 Biometric Flow

```
Employee approaches terminal
        │
        ▼
  ┌─────────────────────────────────────┐
  │         HOME SCREEN                 │
  │   [Face Scan]   [Fingerprint]       │
  └─────────────────────────────────────┘
         /                    \
  Camera opens           Employee picker
        │                     │
  Photo captured         Select name
        │                     │
  POST /api/biometrics    POST /api/attendance/mark
  /face/verify
        │
  Face recognized ──────────────────┐
        │                           │
  Attendance recorded         Check-in / Check-out
        │                           │
  WELCOME screen             GOODBYE screen
  (resets in 5s)             (resets in 5s)
```

---

## 🚀 Backend Services (must be running on PC)

The backend is now managed by PM2. If services are stopped:

```bash
# From d:\SMART DOOR LOCK directory:
start_services.bat

# Or manually:
cd "d:\SMART DOOR LOCK"
cmd /c "pm2 start ecosystem.config.js"
```

Check status:
```bash
start_services.bat status
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---|---|
| "Connection refused" | Check backend IP in App.jsx, ensure PC and phone on same WiFi |
| Camera doesn't open | Grant camera permission in phone Settings |
| Fingerprint fails | Shows employee picker as fallback — select manually |
| Gradle sync fails | File → Invalidate Caches → Restart |
| Build fails | Delete `android/` folder, run `npx cap add android && npx cap sync` |
