-- PostgreSQL Initialization Script for Fraud Detection System

-- Create databases
CREATE DATABASE flink_metadata;
CREATE DATABASE feature_store;
CREATE DATABASE user_profiles;

-- Create users
CREATE USER flink_user WITH PASSWORD 'flink123';
CREATE USER feature_user WITH PASSWORD 'feature123';
CREATE USER profile_user WITH PASSWORD 'profile123';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE flink_metadata TO flink_user;
GRANT ALL PRIVILEGES ON DATABASE feature_store TO feature_user;
GRANT ALL PRIVILEGES ON DATABASE user_profiles TO profile_user;

-- Connect to flink_metadata database
\c flink_metadata;

-- Create Flink metadata tables
CREATE TABLE IF NOT EXISTS flink_jobs (
    job_id VARCHAR(32) PRIMARY KEY,
    job_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    parallelism INTEGER,
    checkpoints_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flink_checkpoints (
    checkpoint_id BIGINT PRIMARY KEY,
    job_id VARCHAR(32) REFERENCES flink_jobs(job_id),
    checkpoint_path VARCHAR(500),
    checkpoint_size BIGINT,
    duration_ms BIGINT,
    status VARCHAR(20),
    trigger_timestamp TIMESTAMP,
    completion_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flink_savepoints (
    savepoint_id VARCHAR(32) PRIMARY KEY,
    job_id VARCHAR(32) REFERENCES flink_jobs(job_id),
    savepoint_path VARCHAR(500),
    savepoint_size BIGINT,
    trigger_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Connect to feature_store database
\c feature_store;

-- Create feature store tables
CREATE TABLE IF NOT EXISTS feature_groups (
    feature_group_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    version VARCHAR(20),
    schema_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS features (
    feature_id VARCHAR(32) PRIMARY KEY,
    feature_group_id VARCHAR(32) REFERENCES feature_groups(feature_group_id),
    name VARCHAR(255) NOT NULL,
    data_type VARCHAR(50),
    description TEXT,
    is_primary_key BOOLEAN DEFAULT false,
    is_event_time BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_values (
    value_id BIGSERIAL PRIMARY KEY,
    feature_id VARCHAR(32) REFERENCES features(feature_id),
    entity_id VARCHAR(255),
    feature_value JSONB,
    event_timestamp TIMESTAMP,
    ingestion_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ttl_timestamp TIMESTAMP
);

-- Create indexes for feature store
CREATE INDEX idx_feature_values_entity_id ON feature_values(entity_id);
CREATE INDEX idx_feature_values_feature_id ON feature_values(feature_id);
CREATE INDEX idx_feature_values_event_timestamp ON feature_values(event_timestamp);
CREATE INDEX idx_feature_values_ttl ON feature_values(ttl_timestamp);

-- Connect to user_profiles database
\c user_profiles;

-- Create user profile tables
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(32) PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    risk_score DECIMAL(5,4) DEFAULT 0.0000,
    kyc_status VARCHAR(20) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS user_devices (
    device_id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) REFERENCES users(user_id),
    device_fingerprint VARCHAR(255),
    device_type VARCHAR(50),
    os VARCHAR(50),
    browser VARCHAR(50),
    ip_address INET,
    country VARCHAR(2),
    city VARCHAR(100),
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_trusted BOOLEAN DEFAULT false,
    risk_score DECIMAL(5,4) DEFAULT 0.0000
);

CREATE TABLE IF NOT EXISTS user_behavior (
    behavior_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(32) REFERENCES users(user_id),
    session_id VARCHAR(32),
    event_type VARCHAR(50),
    event_data JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    geolocation POINT
);

CREATE TABLE IF NOT EXISTS merchants (
    merchant_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    mcc VARCHAR(4),
    country VARCHAR(2),
    risk_level VARCHAR(20) DEFAULT 'low',
    is_blacklisted BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) REFERENCES users(user_id),
    merchant_id VARCHAR(32) REFERENCES merchants(merchant_id),
    amount DECIMAL(15,2),
    currency VARCHAR(3),
    transaction_type VARCHAR(50),
    status VARCHAR(20),
    payment_method VARCHAR(50),
    card_type VARCHAR(20),
    card_last_four VARCHAR(4),
    is_fraud BOOLEAN,
    fraud_score DECIMAL(5,4),
    fraud_reason TEXT,
    processing_time_ms INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    geolocation POINT,
    device_id VARCHAR(32) REFERENCES user_devices(device_id)
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_risk_score ON users(risk_score);
CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_user_devices_fingerprint ON user_devices(device_fingerprint);
CREATE INDEX idx_user_behavior_user_id ON user_behavior(user_id);
CREATE INDEX idx_user_behavior_timestamp ON user_behavior(timestamp);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX idx_transactions_is_fraud ON transactions(is_fraud);
CREATE INDEX idx_transactions_fraud_score ON transactions(fraud_score);

-- Insert sample data
INSERT INTO users (user_id, email, phone, status, risk_score, kyc_status) VALUES
('user_001', 'john.doe@email.com', '+1234567890', 'active', 0.1500, 'verified'),
('user_002', 'jane.smith@email.com', '+1234567891', 'active', 0.0800, 'verified'),
('user_003', 'bob.wilson@email.com', '+1234567892', 'active', 0.9200, 'pending'),
('user_004', 'alice.brown@email.com', '+1234567893', 'active', 0.0300, 'verified'),
('user_005', 'charlie.davis@email.com', '+1234567894', 'suspended', 0.9800, 'rejected');

INSERT INTO merchants (merchant_id, name, category, mcc, country, risk_level) VALUES
('merchant_001', 'Amazon', 'retail', '5399', 'US', 'low'),
('merchant_002', 'Walmart', 'retail', '5411', 'US', 'low'),
('merchant_003', 'Casino Royal', 'gambling', '7995', 'US', 'high'),
('merchant_004', 'Gas Station', 'fuel', '5542', 'US', 'medium'),
('merchant_005', 'Online Pharmacy', 'healthcare', '5912', 'US', 'medium');

-- Grant permissions to users
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO profile_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO profile_user;

\c feature_store;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feature_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO feature_user;

\c flink_metadata;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flink_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flink_user;