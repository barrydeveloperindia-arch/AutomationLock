-- Database Schema for IoT Door Lock System (PostgreSQL/Supabase compatible)

-- Table for admin users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table for registered devices
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_unique_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100),
    ip_address VARCHAR(45),
    port INT DEFAULT 80,
    status VARCHAR(20) DEFAULT 'Offline' CHECK (status IN ('Online', 'Offline')),
    last_ping TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table for access and system logs
CREATE TABLE IF NOT EXISTS device_logs (
    id SERIAL PRIMARY KEY,
    device_id INT REFERENCES devices(id) ON DELETE CASCADE,
    action VARCHAR(255) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed default admin (Password: Admin@123)
INSERT INTO users (username, password) 
VALUES ('admin', 'Admin@123')
ON CONFLICT (username) DO NOTHING;
