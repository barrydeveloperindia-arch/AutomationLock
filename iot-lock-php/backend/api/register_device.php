<?php
header('Content-Type: application/json');
require_once '../db_config.php';

// API to register a new hardware device
// Endpoint: POST api/register_device.php
// Params: device_id (unique id), name (optional)
// Params: device_id (unique id), name (optional), ip_address, port (optional, default 80)

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);

    $device_id = $data['device_id'] ?? null;
    $name = $data['name'] ?? 'Smart Lock';
    $ip_address = $data['ip_address'] ?? null;
    $port = $data['port'] ?? 80;

    if (!$device_id || !$ip_address) {
        echo json_encode(['success' => false, 'message' => 'Missing device_id or ip_address']);
        exit;
    }

    try {
        // Check if device already exists
        $stmt = $pdo->prepare("SELECT id FROM devices WHERE device_unique_id = ?");
        $stmt->execute([$device_id]);

        if ($stmt->fetch()) {
            // Update existing device
            $stmt = $pdo->prepare("UPDATE devices SET name = ?, ip_address = ?, port = ? WHERE device_unique_id = ?");
            $stmt->execute([$name, $ip_address, $port, $device_id]);
            echo json_encode(['success' => true, 'message' => 'Device updated successfully']);
        } else {
            // Insert new device
            $stmt = $pdo->prepare("INSERT INTO devices (device_unique_id, name, ip_address, port) VALUES (?, ?, ?, ?)");
            $stmt->execute([$device_id, $name, $ip_address, $port]);
            echo json_encode(['success' => true, 'message' => 'Device registered successfully']);
        }
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['success' => false, 'message' => 'Only POST method allowed']);
}
?>