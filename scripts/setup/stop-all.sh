#!/bin/bash

# Real-Time Fraud Detection System - Shutdown Script
set -e

echo "🛑 Stopping Real-Time Fraud Detection System..."

# Stop all services gracefully
echo "⏹️ Stopping all services..."
docker-compose down

# Optional: Remove volumes (uncomment if you want to clear all data)
# echo "🗑️ Removing volumes..."
# docker-compose down -v

# Optional: Remove images (uncomment if you want to remove images)
# echo "🗑️ Removing images..."
# docker-compose down --rmi all

echo "✅ All services stopped successfully!"

# Show remaining containers (should be empty)
echo "🔍 Remaining containers:"
docker-compose ps

echo ""
echo "💡 To start the system again, run:"
echo "   ./scripts/setup/start-all.sh"
echo ""
echo "🗑️ To completely clean up (remove volumes and data):"
echo "   docker-compose down -v"
echo "   docker system prune -f"