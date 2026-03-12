/*
 * ESP32 Smart Door Lock Firmware
 * Controls a Magnetic Lock via a Relay
 *
 * Hardware Setup:
 * - ESP32
 * - Relay Module on Pin 23
 * - Magnetic Lock (12V) connected to Relay COM and NC (or NO depending on lock
 * type)
 *
 * Endpoint: GET http://<IP_ADDRESS>/unlock
 */

#include <WebServer.h>
#include <WiFi.h>

// --- Configuration ---
const char *ssid = "YOUR_WIFI_SSID";
const char *password = "YOUR_WIFI_PASSWORD";

const int RELAY_PIN = 23;     // GPIO pin 23 (connected to relay IN)
const int UNLOCK_TIME = 5000; // Time to keep door unlocked (ms)

WebServer server(80);

unsigned long unlockStartTime = 0;
bool doorIsUnlocked = false;

void setup() {
  Serial.begin(115200);

  // Initialize Relay
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with door locked

  // Connect to WiFi
  Serial.println("\nConnecting to WiFi...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("✅ WiFi connected");
  Serial.print("📍 IP address: ");
  Serial.println(WiFi.localIP());

  // Define HTTP Routes
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain", "Door Lock System Online");
  });

  server.on("/unlock", HTTP_GET, handleUnlock);

  server.begin();
  Serial.println("🚀 HTTP Server started");
}

void loop() {
  server.handleClient();

  // Handle Auto-Lock Logic (Non-blocking)
  if (doorIsUnlocked && (millis() - unlockStartTime >= UNLOCK_TIME)) {
    Serial.println("🔒 Door Auto-Locked");
    digitalWrite(RELAY_PIN, LOW);
    doorIsUnlocked = false;
  }
}

void handleUnlock() {
  Serial.println("🔓 Unlock command received");

  // Activate Relay
  digitalWrite(RELAY_PIN, HIGH);
  unlockStartTime = millis();
  doorIsUnlocked = true;

  // Send Response
  server.send(200, "application/json",
              "{\"success\": true, \"message\": \"Door Unlocked\"}");
}
