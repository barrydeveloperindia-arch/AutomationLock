<?php
header('Content-Type: application/json');
require_once '../db_config.php';

// API for Admin to trigger unlock
// Endpoint: POST api/unlock_command.php
// Params: device_id

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $device_id = $data['device_id'] ?? null;

    if (!$device_id) {
        echo json_encode(['success' => false, 'message' => 'Missing device_id']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("UPDATE devices SET command = 'unlock' WHERE device_unique_id = ?");
        $stmt->execute([$device_id]);

        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => 'Unlock command queued']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Device not found or command already set']);
        }
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['success' => false, 'message' => 'Only POST method allowed']);
}
?>