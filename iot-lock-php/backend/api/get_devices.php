<?php
header('Content-Type: application/json');
require_once '../db_config.php';

// API for Dashboard to get all devices with their live status
// Endpoint: GET api/get_devices.php

try {
    // Auto-mark devices as Offline if no ping for 1 minute
    $pdo->exec("UPDATE devices SET status = 'Offline' WHERE last_ping < (NOW() - INTERVAL 1 MINUTE)");

    $stmt = $pdo->query("SELECT * FROM devices ORDER BY created_at DESC");
    $devices = $stmt->fetchAll();

    echo json_encode(['success' => true, 'devices' => $devices]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}
?>