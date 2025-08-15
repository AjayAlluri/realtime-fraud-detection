#!/bin/bash

# Real-Time Fraud Detection System - Startup Script
set -e

echo "🚀 Starting Real-Time Fraud Detection System..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Check available ports
echo "🔍 Checking port availability..."
ports=(2181 2182 2183 9092 9093 9094 6379 6380 6381 6382 6383 6384 8081 5432 9090 3000 8082 8083)
for port in "${ports[@]}"; do
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo "❌ Port $port is already in use. Please free it before starting."
        exit 1
    fi
done

echo "✅ All required ports are available"

# Create necessary directories if they don't exist
echo "📁 Creating necessary directories..."
mkdir -p logs/{kafka,flink,redis,postgres}
mkdir -p data/{kafka,flink,redis,postgres}

# Start core infrastructure first
echo "🐘 Starting Zookeeper ensemble..."
docker-compose up -d zookeeper-1 zookeeper-2 zookeeper-3

# Wait for Zookeeper to be ready
echo "⏳ Waiting for Zookeeper ensemble to be ready..."
sleep 30

# Start Kafka cluster
echo "📡 Starting Kafka cluster..."
docker-compose up -d kafka-1 kafka-2 kafka-3

# Wait for Kafka to be ready
echo "⏳ Waiting for Kafka cluster to be ready..."
sleep 45

# Start Redis cluster
echo "🔴 Starting Redis cluster..."
docker-compose up -d redis-master-1 redis-master-2 redis-master-3 redis-slave-1 redis-slave-2 redis-slave-3

# Wait for Redis to be ready
echo "⏳ Waiting for Redis cluster to be ready..."
sleep 20

# Start PostgreSQL
echo "🐘 Starting PostgreSQL..."
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 15

# Start Flink cluster
echo "🌊 Starting Flink cluster..."
docker-compose up -d flink-jobmanager flink-taskmanager-1 flink-taskmanager-2 flink-taskmanager-3

# Wait for Flink to be ready
echo "⏳ Waiting for Flink cluster to be ready..."
sleep 30

# Start Schema Registry and Kafka Connect
echo "📋 Starting Schema Registry and Kafka Connect..."
docker-compose up -d schema-registry kafka-connect

# Wait for Schema Registry to be ready
echo "⏳ Waiting for Schema Registry to be ready..."
sleep 20

# Start monitoring stack
echo "📊 Starting monitoring stack..."
docker-compose up -d prometheus grafana

# Wait for monitoring to be ready
echo "⏳ Waiting for monitoring stack to be ready..."
sleep 15

echo "✅ All services started successfully!"

# Show service status
echo "🔍 Service Status:"
echo "========================"
docker-compose ps

echo ""
echo "🌐 Service URLs:"
echo "========================"
echo "Flink Dashboard:     http://localhost:8081"
echo "Grafana:            http://localhost:3000 (admin/admin123)"
echo "Prometheus:         http://localhost:9090"
echo "Schema Registry:    http://localhost:8082"
echo "Kafka Connect:      http://localhost:8083"
echo ""

echo "📊 Kafka Brokers:"
echo "========================"
echo "Broker 1:           localhost:9092"
echo "Broker 2:           localhost:9093" 
echo "Broker 3:           localhost:9094"
echo ""

echo "🔴 Redis Cluster:"
echo "========================"
echo "Master 1:           localhost:6379"
echo "Master 2:           localhost:6380"
echo "Master 3:           localhost:6381"
echo "Slave 1:            localhost:6382"
echo "Slave 2:            localhost:6383"
echo "Slave 3:            localhost:6384"
echo ""

echo "🐘 PostgreSQL:"
echo "========================"
echo "Host:               localhost:5432"
echo "User:               admin"
echo "Password:           admin123"
echo "Database:           fraud_detection"
echo ""

echo "🎉 System is ready for fraud detection processing!"
echo "💡 Next steps:"
echo "   1. Run './scripts/setup/create-topics.sh' to create Kafka topics"
echo "   2. Run './scripts/setup/health-check.sh' to verify all services"
echo "   3. Start data simulation with './scripts/setup/start-simulation.sh'"