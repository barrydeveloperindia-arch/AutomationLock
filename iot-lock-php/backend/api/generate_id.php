<?php
header('Content-Type: application/json');
require_once '../db_config.php';

// API to generate a new Device ID
// Endpoint: GET api/generate_id.php

$unique_id = 'AURA-' . strtoupper(substr(md5(uniqid(mt_rand(), true)), 0, 8));

echo json_encode(['success' => true, 'device_id' => $unique_id]);
?>