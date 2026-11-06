// Runs after `npx cap add android`: adds alarm permissions, sounds, icons and release signing.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const app = path.join(root, "android", "app");
const res = path.join(app, "src", "main", "res");

// 1) Permissions for exact daily alarms, notifications, reboot survival
const mf = path.join(app, "src", "main", "AndroidManifest.xml");
let m = fs.readFileSync(mf, "utf8");
const perms = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  '<uses-permission android:name="android.permission.VIBRATE" />'
].filter(p => !m.includes(p.match(/name="([^"]+)"/)[1]));
m = m.replace("</manifest>", "    " + perms.join("\n    ") + "\n</manifest>");
fs.writeFileSync(mf, m);

// 2) Alarm sounds -> res/raw
const raw = path.join(res, "raw");
fs.mkdirSync(raw, { recursive: true });
for (const f of fs.readdirSync(path.join(root, "resources", "sounds")))
  fs.copyFileSync(path.join(root, "resources", "sounds", f), path.join(raw, f));

// 3) Launcher + notification icons (use plain PNG icons, drop adaptive XML)
const icons = path.join(root, "resources", "icons");
for (const dir of fs.readdirSync(icons)) {
  const dst = path.join(res, dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(path.join(icons, dir)))
    fs.copyFileSync(path.join(icons, dir, f), path.join(dst, f));
}
fs.rmSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true, force: true });
for (const d of fs.readdirSync(res))
  if (d.startsWith("mipmap-")) fs.rmSync(path.join(res, d, "ic_launcher_foreground.png"), { force: true });

// 4) Release signing with the bundled test keystore (values come from env in CI)
const gradle = path.join(app, "build.gradle");
let g = fs.readFileSync(gradle, "utf8");
if (!g.includes("signingConfigs")) {
  g = g.replace(/android\s*\{/, `android {
    signingConfigs {
        release {
            storeFile file("../../keystore/gita-test.jks")
            storePassword System.getenv("KS_PASS") ?: "gitapathshala"
            keyAlias "gita"
            keyPassword System.getenv("KS_PASS") ?: "gitapathshala"
        }
    }`);
  g = g.replace(/buildTypes\s*\{\s*release\s*\{/, "buildTypes {\n        release {\n            signingConfig signingConfigs.release");
}
fs.writeFileSync(gradle, g);
console.log("Android project patched: permissions, sounds, icons, signing.");
