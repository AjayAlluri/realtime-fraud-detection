#!/bin/bash

# Real-Time Fraud Detection System - Health Check Script
set -e

echo "🏥 Health Check - Real-Time Fraud Detection System"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check service health
check_service() {
    local service_name=$1
    local url=$2
    local expected_status=${3:-200}
    
    echo -n "Checking $service_name... "
    
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "$expected_status"; then
        echo -e "${GREEN}✅ Healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ Unhealthy${NC}"
        return 1
    fi
}

# Function to check port connectivity
check_port() {
    local service_name=$1
    local host=$2
    local port=$3
    
    echo -n "Checking $service_name port $port... "
    
    if nc -z "$host" "$port" 2>/dev/null; then
        echo -e "${GREEN}✅ Open${NC}"
        return 0
    else
        echo -e "${RED}❌ Closed${NC}"
        return 1
    fi
}

# Function to check Docker container status
check_container() {
    local container_name=$1
    
    echo -n "Checking container $container_name... "
    
    if docker ps --format "table {{.Names}}" | grep -q "^$container_name$"; then
        echo -e "${GREEN}✅ Running${NC}"
        return 0
    else
        echo -e "${RED}❌ Not Running${NC}"
        return 1
    fi
}

echo "🐳 Docker Container Status:"
echo "=============================="

# Check all containers
containers=(
    "zookeeper-1" "zookeeper-2" "zookeeper-3"
    "kafka-1" "kafka-2" "kafka-3"
    "redis-master-1" "redis-master-2" "redis-master-3"
    "redis-slave-1" "redis-slave-2" "redis-slave-3"
    "flink-jobmanager" "flink-taskmanager-1" "flink-taskmanager-2" "flink-taskmanager-3"
    "postgres" "prometheus" "grafana" "schema-registry" "kafka-connect"
)

container_health=0
for container in "${containers[@]}"; do
    check_container "$container" || container_health=1
done

echo ""
echo "🔌 Port Connectivity:"
echo "====================="

# Check critical ports
port_health=0
check_port "Zookeeper-1" "localhost" "2181" || port_health=1
check_port "Zookeeper-2" "localhost" "2182" || port_health=1
check_port "Zookeeper-3" "localhost" "2183" || port_health=1
check_port "Kafka-1" "localhost" "9092" || port_health=1
check_port "Kafka-2" "localhost" "9093" || port_health=1
check_port "Kafka-3" "localhost" "9094" || port_health=1
check_port "Redis-Master-1" "localhost" "6379" || port_health=1
check_port "Redis-Master-2" "localhost" "6380" || port_health=1
check_port "Redis-Master-3" "localhost" "6381" || port_health=1
check_port "Flink JobManager" "localhost" "8081" || port_health=1
check_port "PostgreSQL" "localhost" "5432" || port_health=1
check_port "Prometheus" "localhost" "9090" || port_health=1
check_port "Grafana" "localhost" "3000" || port_health=1
check_port "Schema Registry" "localhost" "8082" || port_health=1

echo ""
echo "🌐 Service Health Endpoints:"
echo "============================="

# Check service health endpoints
service_health=0
check_service "Flink Dashboard" "http://localhost:8081" || service_health=1
check_service "Prometheus" "http://localhost:9090/-/healthy" || service_health=1
check_service "Grafana" "http://localhost:3000/api/health" || service_health=1
check_service "Schema Registry" "http://localhost:8082/subjects" || service_health=1

echo ""
echo "📊 Kafka Cluster Status:"
echo "========================"

# Check Kafka topics (if any exist)
echo -n "Kafka broker list... "
if docker exec kafka-1 kafka-broker-api-versions --bootstrap-server localhost:9092 &>/dev/null; then
    echo -e "${GREEN}✅ Accessible${NC}"
    
    echo "Available topics:"
    docker exec kafka-1 kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null || echo "No topics created yet"
else
    echo -e "${RED}❌ Not accessible${NC}"
    service_health=1
fi

echo ""
echo "🔴 Redis Cluster Status:"
echo "========================"

# Check Redis cluster
echo -n "Redis cluster info... "
if docker exec redis-master-1 redis-cli -a redis123 --no-auth-warning cluster nodes &>/dev/null; then
    echo -e "${GREEN}✅ Cluster mode active${NC}"
else
    echo -e "${YELLOW}⚠️ Standalone mode (cluster setup needed)${NC}"
fi

echo ""
echo "🐘 PostgreSQL Status:"
echo "===================="

# Check PostgreSQL databases
echo -n "Database connectivity... "
if docker exec postgres psql -U admin -d fraud_detection -c "SELECT 1;" &>/dev/null; then
    echo -e "${GREEN}✅ Connected${NC}"
    
    echo "Available databases:"
    docker exec postgres psql -U admin -d fraud_detection -c "\l" 2>/dev/null | grep -E "(fraud_detection|flink_metadata|feature_store|user_profiles)" || echo "Databases not initialized"
else
    echo -e "${RED}❌ Cannot connect${NC}"
    service_health=1
fi

echo ""
echo "📈 Overall Health Summary:"
echo "=========================="

total_health=$((container_health + port_health + service_health))

if [ $total_health -eq 0 ]; then
    echo -e "${GREEN}🎉 All systems operational!${NC}"
    echo ""
    echo "🌐 Access URLs:"
    echo "  - Flink Dashboard: http://localhost:8081"
    echo "  - Grafana: http://localhost:3000 (admin/admin123)"
    echo "  - Prometheus: http://localhost:9090"
    echo ""
    echo "📊 System is ready for fraud detection processing!"
    exit 0
else
    echo -e "${RED}⚠️ Some issues detected. Please check the details above.${NC}"
    echo ""
    echo "🔧 Troubleshooting tips:"
    echo "  - Wait a few more minutes for services to fully start"
    echo "  - Run 'docker-compose logs [service-name]' to check logs"
    echo "  - Run './scripts/setup/start-all.sh' to restart services"
    echo "  - Check Docker resources (CPU/Memory) allocation"
    exit 1
fi