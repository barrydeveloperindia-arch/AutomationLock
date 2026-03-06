@echo off
echo 📱 Initializing Capacitor Android for Terminal App...

cd terminal-app

call npm install
call npm run build

echo 🚀 Adding Android platform...
npx cap add android

echo 🔄 Syncing native code...
npx cap sync

echo ✅ Setup complete! Opening Android Studio...
npx cap open android
