<?php
header('Content-Type: application/json');
require_once '../db_config.php';

// Polling endpoint for ESP32 to report health and check for commands
// Endpoint: POST api/device_status.php
// Params: device_id

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $device_id = $data['device_id'] ?? null;

    if (!$device_id) {
        echo json_encode(['success' => false, 'message' => 'Missing device_id']);
        exit;
    }

    try {
        // Update device as Online and refresh last_ping
        $stmt = $pdo->prepare("UPDATE devices SET status = 'Online', last_ping = CURRENT_TIMESTAMP WHERE device_unique_id = ?");
        $stmt->execute([$device_id]);

        // Check for pending commands
        $stmt = $pdo->prepare("SELECT command FROM devices WHERE device_unique_id = ?");
        $stmt->execute([$device_id]);
        $device = $stmt->fetch();

        if ($device) {
            $current_command = $device['command'];

            // If command is 'unlock', clear it after sending
            if ($current_command === 'unlock') {
                $pdo->prepare("UPDATE devices SET command = 'none' WHERE device_unique_id = ?")->execute([$device_id]);
                // Log the action
                $pdo->prepare("INSERT INTO device_logs (device_id, action) SELECT id, 'Remotely Unlocked' FROM devices WHERE device_unique_id = ?")->execute([$device_id]);
            }

            echo json_encode([
                'success' => true,
                'command' => $current_command,
                'server_time' => date('Y-m-d H:i:s')
            ]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Device not found']);
        }

    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['success' => false, 'message' => 'Only POST method allowed']);
}
?>