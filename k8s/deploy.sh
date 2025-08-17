#!/bin/bash

# Fraud Detection System Kubernetes Deployment Script
# This script deploys the entire fraud detection system to Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="fraud-detection"
MANIFESTS_DIR="$(dirname "$0")/manifests"
HELM_CHART_DIR="$(dirname "$0")/helm/fraud-detection"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check Helm (optional)
    if command -v helm &> /dev/null; then
        log_info "Helm is available"
        HELM_AVAILABLE=true
    else
        log_warn "Helm is not available, using kubectl only"
        HELM_AVAILABLE=false
    fi
    
    log_success "Prerequisites check completed"
}

create_namespace() {
    log_info "Creating namespace: $NAMESPACE"
    
    if kubectl get namespace $NAMESPACE &> /dev/null; then
        log_warn "Namespace $NAMESPACE already exists"
    else
        kubectl apply -f "$MANIFESTS_DIR/namespace.yaml"
        log_success "Namespace $NAMESPACE created"
    fi
}

deploy_infrastructure() {
    log_info "Deploying infrastructure components..."
    
    # Deploy in order to handle dependencies
    components=(
        "zookeeper-deployment.yaml"
        "kafka-deployment.yaml"
        "redis-deployment.yaml"
    )
    
    for component in "${components[@]}"; do
        log_info "Deploying $component..."
        kubectl apply -f "$MANIFESTS_DIR/$component"
        
        # Wait for deployment to be ready
        if [[ $component == *"deployment"* ]]; then
            deployment_name=$(kubectl get -f "$MANIFESTS_DIR/$component" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
            if [[ -n "$deployment_name" ]]; then
                log_info "Waiting for $deployment_name to be ready..."
                kubectl rollout status deployment/$deployment_name -n $NAMESPACE --timeout=300s
            fi
        fi
        
        log_success "$component deployed"
    done
}

deploy_processing() {
    log_info "Deploying stream processing components..."
    
    kubectl apply -f "$MANIFESTS_DIR/flink-deployment.yaml"
    
    # Wait for Flink JobManager
    log_info "Waiting for Flink JobManager to be ready..."
    kubectl rollout status deployment/flink-jobmanager -n $NAMESPACE --timeout=300s
    
    # Wait for Flink TaskManager
    log_info "Waiting for Flink TaskManager to be ready..."
    kubectl rollout status deployment/flink-taskmanager -n $NAMESPACE --timeout=300s
    
    log_success "Stream processing components deployed"
}

deploy_ml_services() {
    log_info "Deploying ML services..."
    
    kubectl apply -f "$MANIFESTS_DIR/ml-models-deployment.yaml"
    
    # Wait for ML models service
    log_info "Waiting for ML models service to be ready..."
    kubectl rollout status deployment/ml-models-service -n $NAMESPACE --timeout=600s
    
    # Wait for TensorFlow Serving
    log_info "Waiting for TensorFlow Serving to be ready..."
    kubectl rollout status deployment/tensorflow-serving -n $NAMESPACE --timeout=300s
    
    log_success "ML services deployed"
}

deploy_networking() {
    log_info "Deploying networking components..."
    
    # Deploy services
    kubectl apply -f "$MANIFESTS_DIR/services.yaml"
    log_success "Services deployed"
    
    # Deploy ingress
    kubectl apply -f "$MANIFESTS_DIR/ingress.yaml"
    log_success "Ingress deployed"
}

deploy_monitoring() {
    log_info "Deploying monitoring stack..."
    
    kubectl apply -f "$MANIFESTS_DIR/monitoring.yaml"
    
    # Wait for Prometheus
    log_info "Waiting for Prometheus to be ready..."
    kubectl rollout status deployment/prometheus -n $NAMESPACE --timeout=300s
    
    # Wait for Grafana
    log_info "Waiting for Grafana to be ready..."
    kubectl rollout status deployment/grafana -n $NAMESPACE --timeout=300s
    
    log_success "Monitoring stack deployed"
}

deploy_ci_cd() {
    log_info "Deploying CI/CD pipeline..."
    
    kubectl apply -f "$MANIFESTS_DIR/ci-cd-pipeline.yaml"
    
    # Wait for Jenkins
    log_info "Waiting for Jenkins to be ready..."
    kubectl rollout status deployment/jenkins -n $NAMESPACE --timeout=600s
    
    log_success "CI/CD pipeline deployed"
}

wait_for_services() {
    log_info "Waiting for all services to be ready..."
    
    # Wait for all pods to be running
    log_info "Waiting for all pods to be running..."
    kubectl wait --for=condition=Ready pods --all -n $NAMESPACE --timeout=900s
    
    log_success "All services are ready"
}

verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check pod status
    log_info "Pod status:"
    kubectl get pods -n $NAMESPACE -o wide
    
    # Check service status
    log_info "Service status:"
    kubectl get services -n $NAMESPACE
    
    # Check ingress status
    log_info "Ingress status:"
    kubectl get ingress -n $NAMESPACE
    
    # Health checks
    log_info "Performing health checks..."
    
    # Check if services are responding
    services_to_check=(
        "flink-jobmanager-service:8081"
        "ml-models-service:8000/health"
        "prometheus-service:9090/-/healthy"
        "grafana-service:3000/api/health"
    )
    
    for service in "${services_to_check[@]}"; do
        service_name=$(echo $service | cut -d':' -f1)
        service_port=$(echo $service | cut -d':' -f2)
        
        if kubectl get service $service_name -n $NAMESPACE &> /dev/null; then
            log_info "✓ $service_name is available"
        else
            log_warn "✗ $service_name is not available"
        fi
    done
    
    log_success "Deployment verification completed"
}

print_access_info() {
    log_info "Access Information:"
    echo ""
    echo "Namespace: $NAMESPACE"
    echo ""
    echo "Services:"
    echo "- Flink Web UI: http://flink.fraud-detection.local"
    echo "- ML API: http://ml-api.fraud-detection.local"
    echo "- TensorFlow Serving: http://tf-serving.fraud-detection.local"
    echo "- Grafana: http://localhost:30300 (admin/admin123)"
    echo "- Jenkins: http://localhost:30808 (admin/admin123)"
    echo "- Prometheus: http://localhost:9090"
    echo ""
    echo "External Access (if LoadBalancer is available):"
    kubectl get services -n $NAMESPACE -o wide | grep LoadBalancer
    echo ""
    echo "To access services locally, you can use port-forwarding:"
    echo "kubectl port-forward -n $NAMESPACE service/grafana-service 3000:3000"
    echo "kubectl port-forward -n $NAMESPACE service/jenkins-service 8080:8080"
    echo "kubectl port-forward -n $NAMESPACE service/flink-jobmanager-service 8081:8081"
    echo ""
}

# Main deployment flow
main() {
    log_info "Starting Fraud Detection System deployment..."
    
    check_prerequisites
    create_namespace
    
    # Deploy components in order
    deploy_infrastructure
    deploy_processing
    deploy_ml_services
    deploy_networking
    deploy_monitoring
    deploy_ci_cd
    
    wait_for_services
    verify_deployment
    print_access_info
    
    log_success "Fraud Detection System deployment completed successfully!"
}

# Handle command line arguments
case "${1:-}" in
    "infrastructure")
        check_prerequisites
        create_namespace
        deploy_infrastructure
        ;;
    "processing")
        deploy_processing
        ;;
    "ml")
        deploy_ml_services
        ;;
    "networking")
        deploy_networking
        ;;
    "monitoring")
        deploy_monitoring
        ;;
    "ci-cd")
        deploy_ci_cd
        ;;
    "verify")
        verify_deployment
        ;;
    "clean")
        log_warn "Cleaning up deployment..."
        kubectl delete namespace $NAMESPACE --ignore-not-found=true
        log_success "Cleanup completed"
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [COMMAND]"
        echo ""
        echo "Commands:"
        echo "  infrastructure  Deploy infrastructure components only"
        echo "  processing      Deploy stream processing components only"
        echo "  ml              Deploy ML services only"
        echo "  networking      Deploy networking components only"
        echo "  monitoring      Deploy monitoring stack only"
        echo "  ci-cd           Deploy CI/CD pipeline only"
        echo "  verify          Verify deployment status"
        echo "  clean           Remove all deployed components"
        echo "  help            Show this help message"
        echo ""
        echo "No command: Deploy everything"
        ;;
    "")
        main
        ;;
    *)
        log_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac