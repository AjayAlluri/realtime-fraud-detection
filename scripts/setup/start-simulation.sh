#!/bin/bash

# Real-Time Fraud Detection System - Data Simulation Startup Script
set -e

echo "🎯 Starting Fraud Detection Data Simulation..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default parameters
TPS=100
USERS=10000
MERCHANTS=5000
KAFKA_BROKERS="localhost:9092,localhost:9093,localhost:9094"
REDIS_HOST="localhost"
REDIS_PORT=6379
METRICS_PORT=8000

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --tps)
            TPS="$2"
            shift 2
            ;;
        --users)
            USERS="$2"
            shift 2
            ;;
        --merchants)
            MERCHANTS="$2"
            shift 2
            ;;
        --kafka-brokers)
            KAFKA_BROKERS="$2"
            shift 2
            ;;
        --redis-host)
            REDIS_HOST="$2"
            shift 2
            ;;
        --redis-port)
            REDIS_PORT="$2"
            shift 2
            ;;
        --metrics-port)
            METRICS_PORT="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --tps TPS                    Transactions per second (default: 100)"
            echo "  --users USERS                Number of users to generate (default: 10000)"
            echo "  --merchants MERCHANTS        Number of merchants to generate (default: 5000)"
            echo "  --kafka-brokers BROKERS      Kafka broker list (default: localhost:9092,localhost:9093,localhost:9094)"
            echo "  --redis-host HOST            Redis host (default: localhost)"
            echo "  --redis-port PORT            Redis port (default: 6379)"
            echo "  --metrics-port PORT          Prometheus metrics port (default: 8000)"
            echo "  --help                       Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Function to check if service is ready
check_service() {
    local service_name=$1
    local host=$2
    local port=$3
    local max_attempts=30
    local attempt=1
    
    echo -n "Checking $service_name connectivity... "
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z "$host" "$port" 2>/dev/null; then
            echo -e "${GREEN}✅ Connected${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    
    echo -e "${RED}❌ Failed to connect after $max_attempts attempts${NC}"
    return 1
}

# Function to check Kafka topics
check_kafka_topics() {
    echo -n "Checking Kafka topics... "
    
    # Extract first broker for connection test
    first_broker=$(echo $KAFKA_BROKERS | cut -d',' -f1)
    
    if docker exec kafka-1 kafka-topics --list --bootstrap-server $KAFKA_BROKERS 2>/dev/null | grep -q "payment-transactions"; then
        echo -e "${GREEN}✅ Topics exist${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️ Topics not found${NC}"
        echo "Creating Kafka topics first..."
        ./scripts/setup/create-topics.sh
        return $?
    fi
}

# Validate prerequisites
echo "🔍 Validating prerequisites..."
echo "================================"

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Please run this script from the project root directory${NC}"
    exit 1
fi

# Check if Kafka brokers are accessible
IFS=',' read -ra BROKER_ARRAY <<< "$KAFKA_BROKERS"
for broker in "${BROKER_ARRAY[@]}"; do
    IFS=':' read -ra BROKER_PARTS <<< "$broker"
    host=${BROKER_PARTS[0]}
    port=${BROKER_PARTS[1]}
    check_service "Kafka ($broker)" "$host" "$port" || exit 1
done

# Check Redis connectivity
check_service "Redis" "$REDIS_HOST" "$REDIS_PORT" || exit 1

# Check and create Kafka topics if needed
check_kafka_topics || exit 1

echo ""
echo "📊 Simulation Configuration:"
echo "============================"
echo "Transactions per second: $TPS"
echo "Number of users:         $USERS"
echo "Number of merchants:     $MERCHANTS"
echo "Kafka brokers:          $KAFKA_BROKERS"
echo "Redis:                  $REDIS_HOST:$REDIS_PORT"
echo "Metrics port:           $METRICS_PORT"
echo ""

# Check if Python environment is ready
echo "🐍 Setting up Python environment..."
if [ ! -d "services/data-simulator/venv" ]; then
    echo "Creating Python virtual environment..."
    cd services/data-simulator
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    cd ../..
    echo -e "${GREEN}✅ Python environment created${NC}"
else
    echo -e "${GREEN}✅ Python environment exists${NC}"
fi

# Activate virtual environment and start simulation
echo ""
echo "🚀 Starting data simulation..."
echo "=============================="

cd services/data-simulator
source venv/bin/activate

# Start the simulator
python src/main/python/simulator.py \
    --tps $TPS \
    --users $USERS \
    --merchants $MERCHANTS \
    --kafka-brokers $KAFKA_BROKERS \
    --redis-host $REDIS_HOST \
    --redis-port $REDIS_PORT \
    --metrics-port $METRICS_PORT &

SIMULATOR_PID=$!

# Store PID for later cleanup
echo $SIMULATOR_PID > ../../simulator.pid

echo ""
echo -e "${GREEN}🎉 Data simulator started successfully!${NC}"
echo ""
echo "📊 Monitoring URLs:"
echo "==================="
echo "Prometheus Metrics: http://localhost:$METRICS_PORT/metrics"
echo "Flink Dashboard:    http://localhost:8081"
echo "Grafana:           http://localhost:3000"
echo ""
echo "📡 Kafka Topics Receiving Data:"
echo "==============================="
echo "- payment-transactions"
echo "- user-behavior"
echo "- fraud-alerts"
echo ""
echo "🔧 Useful Commands:"
echo "==================="
echo "Stop simulation:    kill $SIMULATOR_PID"
echo "View logs:          tail -f logs/simulator.log"
echo "Check metrics:      curl http://localhost:$METRICS_PORT/metrics"
echo ""
echo "📈 Expected Fraud Rate: ~5-8% of transactions"
echo "🎯 Target TPS: $TPS transactions per second"
echo ""

# Monitor simulation for a few seconds
echo "📊 Monitoring simulation startup..."
sleep 10

# Check if simulator is still running
if kill -0 $SIMULATOR_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Simulator is running successfully${NC}"
    
    # Show initial metrics if available
    echo ""
    echo "📊 Initial Metrics:"
    echo "=================="
    curl -s "http://localhost:$METRICS_PORT/metrics" | grep -E "(transactions_generated_total|fraud_transactions_total)" || echo "Metrics not yet available"
else
    echo -e "${RED}❌ Simulator failed to start${NC}"
    exit 1
fi

echo ""
echo "🎉 Data simulation is now generating realistic payment transactions!"
echo "💡 Press Ctrl+C to stop the simulation when ready"

# Wait for user interrupt
trap 'echo ""; echo "🛑 Stopping data simulation..."; kill $SIMULATOR_PID 2>/dev/null; rm -f ../../simulator.pid; echo "✅ Simulation stopped"; exit 0' INT

# Keep script running
wait $SIMULATOR_PID