#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <time.h>

// --- Configuration ---
const char *ssid = "YOUR_WIFI_SSID";
const char *password = "YOUR_WIFI_PASSWORD";
const char *secret_token = "door_secret_pass_123";

const int RELAY_PIN = 23;
const long UNLOCK_DURATION = 5000; // 5 seconds
const int MAX_TIME_DRIFT = 60;     // 60 seconds replay window

// --- Global State ---
WebServer server(80);
unsigned long unlockStartTime = 0;
bool isUnlocked = false;
long lastProcessedTimestamp = 0;

// NTP Settings
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 0; // Set to your UTC offset
const int daylightOffset_sec = 0;

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected: " + WiFi.localIP().toString());

  // Initialize NTP
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  Serial.println("🕒 Syncing time...");

  server.on("/unlock", HTTP_POST, handleUnlock);
  server.begin();
}

void loop() {
  server.handleClient();
  handleAutoLock();
}

void handleAutoLock() {
  if (isUnlocked && (millis() - unlockStartTime >= UNLOCK_DURATION)) {
    digitalWrite(RELAY_PIN, LOW);
    isUnlocked = false;
    Serial.println("🔒 Door Auto-Locked.");
  }
}

long getCurrentEpoch() {
  time_t now;
  time(&now);
  return (long)now;
}

void handleUnlock() {
  // 1. Bearer Token Validation
  if (!server.hasHeader("Authorization")) {
    server.send(401, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }

  String authHeader = server.header("Authorization");
  if (authHeader != "Bearer " + String(secret_token)) {
    Serial.println("❌ Invalid Token Attempt");
    server.send(403, "application/json", "{\"error\":\"Forbidden\"}");
    return;
  }

  // 2. Parse JSON Body
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, server.arg("plain"));

  if (error) {
    server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }

  long requestTimestamp = doc["timestamp"];
  long currentTimestamp = getCurrentEpoch();

  // 3. Replay Protection (Timestamp Check)
  if (requestTimestamp <= lastProcessedTimestamp) {
    Serial.println("❌ Replay Detected: Duplicate or old timestamp");
    server.send(403, "application/json",
                "{\"error\":\"Replay attempt blocked\"}");
    return;
  }

  if (abs(currentTimestamp - requestTimestamp) > MAX_TIME_DRIFT) {
    Serial.printf("❌ Time Drift Error: Req %ld, Local %ld\n", requestTimestamp,
                  currentTimestamp);
    server.send(403, "application/json",
                "{\"error\":\"Timestamp too far from current time\"}");
    return;
  }

  // 4. Secure Action
  lastProcessedTimestamp = requestTimestamp;
  Serial.println("🔓 Access Granted: Remote Unlock Triggered");
  digitalWrite(RELAY_PIN, HIGH);
  unlockStartTime = millis();
  isUnlocked = true;

  server.send(200, "application/json",
              "{\"success\":true, \"message\":\"Unlocked\"}");
}
