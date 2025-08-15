#!/bin/bash

# Kafka Topics Creation Script for Real-Time Fraud Detection System
set -e

echo "📡 Creating Kafka Topics for Fraud Detection System..."

# Kafka connection details
KAFKA_BROKERS="localhost:9092,localhost:9093,localhost:9094"
REPLICATION_FACTOR=3
MIN_INSYNC_REPLICAS=2

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to create topic
create_topic() {
    local topic_name=$1
    local partitions=$2
    local description=$3
    
    echo -n "Creating topic '$topic_name' with $partitions partitions... "
    
    if docker exec kafka-1 kafka-topics --create \
        --bootstrap-server $KAFKA_BROKERS \
        --topic $topic_name \
        --partitions $partitions \
        --replication-factor $REPLICATION_FACTOR \
        --config min.insync.replicas=$MIN_INSYNC_REPLICAS \
        --config cleanup.policy=delete \
        --config retention.ms=604800000 \
        --config segment.ms=86400000 \
        --config compression.type=lz4 \
        --if-not-exists 2>/dev/null; then
        echo -e "${GREEN}✅ Created${NC} - $description"
    else
        echo -e "${YELLOW}⚠️ Already exists${NC} - $description"
    fi
}

# Function to create compacted topic (for user profiles, etc.)
create_compacted_topic() {
    local topic_name=$1
    local partitions=$2
    local description=$3
    
    echo -n "Creating compacted topic '$topic_name' with $partitions partitions... "
    
    if docker exec kafka-1 kafka-topics --create \
        --bootstrap-server $KAFKA_BROKERS \
        --topic $topic_name \
        --partitions $partitions \
        --replication-factor $REPLICATION_FACTOR \
        --config min.insync.replicas=$MIN_INSYNC_REPLICAS \
        --config cleanup.policy=compact \
        --config segment.ms=86400000 \
        --config compression.type=lz4 \
        --config min.cleanable.dirty.ratio=0.1 \
        --config delete.retention.ms=86400000 \
        --if-not-exists 2>/dev/null; then
        echo -e "${GREEN}✅ Created${NC} - $description"
    else
        echo -e "${YELLOW}⚠️ Already exists${NC} - $description"
    fi
}

# Wait for Kafka to be ready
echo "⏳ Waiting for Kafka cluster to be ready..."
timeout=60
while [ $timeout -gt 0 ]; do
    if docker exec kafka-1 kafka-broker-api-versions --bootstrap-server localhost:9092 &>/dev/null; then
        echo -e "${GREEN}✅ Kafka cluster is ready${NC}"
        break
    fi
    sleep 2
    timeout=$((timeout-2))
done

if [ $timeout -le 0 ]; then
    echo -e "${RED}❌ Kafka cluster not ready after 60 seconds${NC}"
    exit 1
fi

echo ""
echo "🏗️ Creating Core Transaction Topics:"
echo "===================================="

# Core transaction processing topics
create_topic "payment-transactions" 12 "Raw payment transactions from payment gateways"
create_topic "transaction-enriched" 12 "Enriched transactions with user and merchant data"
create_topic "transaction-features" 12 "Transactions with extracted ML features"
create_topic "fraud-predictions" 12 "ML model predictions and scores"
create_topic "fraud-decisions" 6 "Final fraud decisions (APPROVE/DECLINE/REVIEW)"

echo ""
echo "👤 Creating User and Behavioral Topics:"
echo "======================================="

# User behavior and profile topics
create_compacted_topic "user-profiles" 6 "User profile data (compacted for latest state)"
create_topic "user-behavior" 8 "User behavioral events and interactions"
create_topic "device-fingerprints" 4 "Device fingerprinting data"
create_topic "user-sessions" 6 "User session tracking and analytics"
create_topic "login-events" 4 "User authentication and login events"

echo ""
echo "🏪 Creating Merchant and Risk Topics:"
echo "====================================="

# Merchant and risk topics
create_compacted_topic "merchant-profiles" 4 "Merchant profile and risk data"
create_topic "merchant-transactions" 8 "Transaction aggregations by merchant"
create_topic "risk-signals" 6 "Risk signals and indicators"
create_topic "blacklist-updates" 2 "Blacklist and whitelist updates"

echo ""
echo "🚨 Creating Alert and Monitoring Topics:"
echo "========================================"

# Alert and monitoring topics
create_topic "fraud-alerts" 6 "High-priority fraud alerts"
create_topic "system-alerts" 2 "System health and monitoring alerts"
create_topic "audit-logs" 4 "Audit trail for compliance"
create_topic "model-metrics" 2 "ML model performance metrics"

echo ""
echo "🔄 Creating Stream Processing Topics:"
echo "===================================="

# Stream processing and aggregation topics
create_topic "velocity-checks" 8 "Transaction velocity calculations"
create_topic "geographic-analysis" 4 "Geographic risk analysis"
create_topic "pattern-detection" 6 "Behavioral pattern detection"
create_topic "network-analysis" 4 "Transaction network analysis"

echo ""
echo "📊 Creating Analytics and Reporting Topics:"
echo "==========================================="

# Analytics and reporting topics
create_topic "transaction-metrics" 4 "Real-time transaction metrics"
create_topic "fraud-metrics" 2 "Fraud detection performance metrics"
create_topic "dashboard-updates" 2 "Real-time dashboard data"
create_topic "reporting-data" 4 "Data for batch reporting"

echo ""
echo "🧪 Creating Testing and Development Topics:"
echo "==========================================="

# Testing and development topics
create_topic "test-transactions" 4 "Synthetic test transactions"
create_topic "model-experiments" 2 "A/B testing and model experiments"
create_topic "feature-experiments" 2 "Feature engineering experiments"

echo ""
echo "📋 Topic Summary:"
echo "================="

# List all created topics
echo "📊 Created topics:"
docker exec kafka-1 kafka-topics --list --bootstrap-server $KAFKA_BROKERS | sort

echo ""
echo "🔍 Topic Details:"
echo "================"

# Show topic configurations for key topics
key_topics=("payment-transactions" "fraud-decisions" "user-profiles" "fraud-alerts")

for topic in "${key_topics[@]}"; do
    echo ""
    echo "Topic: $topic"
    echo "----------------------------------------"
    docker exec kafka-1 kafka-topics --describe --topic $topic --bootstrap-server $KAFKA_BROKERS 2>/dev/null || echo "Topic not found"
done

echo ""
echo "✅ All Kafka topics created successfully!"
echo ""
echo "🔧 Useful commands:"
echo "=================="
echo "List topics:          docker exec kafka-1 kafka-topics --list --bootstrap-server $KAFKA_BROKERS"
echo "Describe topic:       docker exec kafka-1 kafka-topics --describe --topic TOPIC_NAME --bootstrap-server $KAFKA_BROKERS"
echo "Console producer:     docker exec -it kafka-1 kafka-console-producer --topic TOPIC_NAME --bootstrap-server $KAFKA_BROKERS"
echo "Console consumer:     docker exec -it kafka-1 kafka-console-consumer --topic TOPIC_NAME --from-beginning --bootstrap-server $KAFKA_BROKERS"
echo ""
echo "🎉 Kafka topics are ready for fraud detection processing!"