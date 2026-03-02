#include "mbedtls/md.h"
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <time.h>

// --- Hardware Pins ---
const int RELAY_PIN = 23;
const int BATTERY_PIN = 34;  // ADC1_CH6
const int OVERRIDE_PIN = 13; // Physical Button
#define FINGER_RX 16
#define FINGER_TX 17

// --- Configuration ---
const char *ssid = "YOUR_WIFI_SSID";
const char *password = "YOUR_WIFI_PASSWORD";
const char *secret_token = "door_secret_pass_123";
const char *backend_url = "http://your_backend_ip:8000";

const float LOW_BATTERY_THRESHOLD = 11.1;
const float CRITICAL_BATTERY_THRESHOLD = 10.5;
const float VOLTAGE_DIVIDER_RATIO =
    5.545; // (10k + 2.2k) / 2.2k (adjusted for ADC)

const long UNLOCK_DURATION = 5000;
const int MAX_FAILED_ATTEMPTS = 5;
const unsigned long LOCKOUT_TIME = 300000; // 5 minutes

// --- Global Objects ---
WebServer server(80);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&Serial2);
unsigned long unlockStartTime = 0;
unsigned long lastBatteryCheck = 0;
bool isUnlocked = false;
bool isPowerSaveMode = false;
int failedAttempts = 0;
unsigned long lockoutStartTime = 0;

// --- Security Helpers ---
String calculateHMAC(String payload, const char *key) {
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)payload.c_str(),
                         payload.length());
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  String hash = "";
  for (int i = 0; i < 32; i++) {
    char str[3];
    sprintf(str, "%02x", (int)hmacResult[i]);
    hash += str;
  }
  return hash;
}

// --- Power Management ---
float readBatteryVoltage() {
  int raw = analogRead(BATTERY_PIN);
  float voltage = (raw / 4095.0) * 3.3 * VOLTAGE_DIVIDER_RATIO;
  return voltage;
}

void notifyBackend(String method, int id, String status = "success",
                   String message = "");

void checkBatteryHealth() {
  float voltage = readBatteryVoltage();
  Serial.printf("🔋 Battery Voltage: %.2fV\n", voltage);

  if (voltage < CRITICAL_BATTERY_THRESHOLD) {
    Serial.println("⚠️ CRITICAL BATTERY: Entering Safe Shutdown!");
    isPowerSaveMode = true;
    notifyBackend("POWER_EVENT", 0, "CRITICAL_BATTERY",
                  "Battery critically low. System entering restricted mode.");
  } else if (voltage < LOW_BATTERY_THRESHOLD) {
    Serial.println("⚠️ LOW BATTERY: Sending Alert.");
    notifyBackend("POWER_EVENT", 0, "LOW_BATTERY",
                  "Battery below 11.1V. Please charge.");
  }
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(OVERRIDE_PIN, INPUT_PULLUP);
  digitalWrite(RELAY_PIN, LOW);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected: " + WiFi.localIP().toString());

  // Init Fingerprint Sensor
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("✅ Found fingerprint sensor!");
  } else {
    Serial.println("❌ Did not find fingerprint sensor :(");
  }

  // Init NTP for Replay Protection
  configTime(0, 0, "pool.ntp.org");

  server.on("/unlock", HTTP_POST, handleRemoteUnlock);
  server.begin();

  checkBatteryHealth(); // Initial check
}

void loop() {
  server.handleClient();
  handleAutoLock();

  // Manual Override Check (Instant)
  if (digitalRead(OVERRIDE_PIN) == LOW) {
    delay(50); // Debounce
    if (digitalRead(OVERRIDE_PIN) == LOW) {
      triggerUnlock("Manual Override", 999);
      while (digitalRead(OVERRIDE_PIN) == LOW)
        ; // Wait for release
    }
  }

  // Periodic Battery Check (Every 10 minutes)
  if (millis() - lastBatteryCheck > 600000) {
    checkBatteryHealth();
    lastBatteryCheck = millis();
  }

  if (millis() - lockoutStartTime > LOCKOUT_TIME || lockoutStartTime == 0) {
    if (!isPowerSaveMode) {
      checkFingerprint();
    }
  } else {
    static unsigned long lastNotify = 0;
    if (millis() - lastNotify > 10000) {
      Serial.println("🔒 System Locked Out due to failed attempts.");
      lastNotify = millis();
    }
  }
}

void handleAutoLock() {
  if (isUnlocked && (millis() - unlockStartTime >= UNLOCK_DURATION)) {
    digitalWrite(RELAY_PIN, LOW);
    isUnlocked = false;
    Serial.println("🔒 Door Auto-Locked.");
  }
}

// --- Face/Remote Unlock Path ---
void handleRemoteUnlock() {
  if (isPowerSaveMode) {
    server.send(503, "application/json",
                "{\"error\":\"Device in Safe Shutdown (Low Battery)\"}");
    return;
  }

  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"error\":\"Missing body\"}");
    return;
  }

  StaticJsonDocument<200> doc;
  deserializeJson(doc, server.arg("plain"));

  long timestamp = doc["timestamp"];
  String signature = doc["signature"];

  // 1. Check Replay Protection (Time Drift)
  time_t now;
  time(&now);
  if (abs(now - timestamp) > 60) {
    Serial.println("❌ Rejected: Stale timestamp (Replay Attack?)");
    server.send(403, "application/json", "{\"error\":\"Stale command\"}");
    return;
  }

  // 2. Verify HMAC Signature
  StaticJsonDocument<100> hmacDoc;
  hmacDoc["timestamp"] = timestamp;
  String payload;
  serializeJson(hmacDoc, payload);

  String expectedSignature = calculateHMAC(payload, secret_token);

  if (signature != expectedSignature) {
    Serial.println("❌ Rejected: Invalid Signature!");
    server.send(401, "application/json", "{\"error\":\"Invalid integrity\"}");
    return;
  }

  triggerUnlock("Remote/Face");
  server.send(200, "application/json", "{\"success\":true}");
}

// --- Fingerprint Path ---
void checkFingerprint() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK)
    return;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK)
    return;

  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    Serial.printf("✅ Match Found! ID #%d with confidence %d\n",
                  finger.fingerID, finger.confidence);
    failedAttempts = 0;
    triggerUnlock("Fingerprint", finger.fingerID);
  } else if (p == FINGERPRINT_NOTFOUND) {
    failedAttempts++;
    Serial.printf("❌ No Match. Failed attempts: %d/%d\n", failedAttempts,
                  MAX_FAILED_ATTEMPTS);
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockoutStartTime = millis();
    }
    delay(1000);
  }
}

void triggerUnlock(String method, int id = 0) {
  Serial.println("🔓 Access Granted: " + method);
  digitalWrite(RELAY_PIN, HIGH);
  unlockStartTime = millis();
  isUnlocked = true;
  notifyBackend(method, id, "success", "Unlocked via " + method);
}

void notifyBackend(String method, int id, String status, String message) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(backend_url) + "/api/logs/iot");
    http.addHeader("Content-Type", "application/json");

    time_t now;
    time(&now);

    StaticJsonDocument<400> doc;
    doc["method"] = method;
    doc["id"] = id;
    doc["status"] = status;
    doc["timestamp"] = (long)now;
    doc["message"] = message;

    // --- Sign the log with HMAC ---
    String payload;
    serializeJson(doc, payload);
    doc["signature"] = calculateHMAC(payload, secret_token);

    String finalJson;
    serializeJson(doc, finalJson);

    int httpCode = http.POST(finalJson);
    http.end();
  }
}
