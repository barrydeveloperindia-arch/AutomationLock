/*
 * AuraLock - IoT ESP32-S3 Server Firmware (IP-Based)
 * Listens for incoming HTTP commands from the Admin Panel.
 *
 * Hardware: ESP32-S3, Relay on GPIO 23
 */

#include <WebServer.h>
#include <WiFi.h>

const char *ssid = "Redmi Note 11";
const char *password = "Shiv1234";

const int RELAY_PIN = 23;
WebServer server(80);

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n✅ WiFi connected");
  Serial.print("📍 IP: ");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET,
            []() { server.send(200, "text/plain", "AuraLock Server Online"); });

  server.on("/status", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json",
                "{\"status\":\"online\",\"device\":\"AuraLock\",\"ip\":\"" +
                    WiFi.localIP().toString() +
                    "\",\"mac\":\"58:8c:81:cc:65:28\"}");
  });

  server.on("/unlock", HTTP_GET, []() {
    Serial.println("Unlock triggered!");
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(
        200, "application/json",
        "{\"success\":true,\"message\":\"Relay activated for 5 seconds\"}");
    digitalWrite(RELAY_PIN, HIGH);
    delay(5000);
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("Relay deactivated.");
  });

  server.begin();
}

void loop() { server.handleClient(); }
