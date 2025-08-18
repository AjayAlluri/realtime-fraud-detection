#!/bin/bash

# AWS Deployment Script for Fraud Detection System
# This script deploys the entire fraud detection system to AWS using CDK and Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
REGION=${2:-us-west-2}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CDK_DIR="$PROJECT_ROOT/infrastructure/aws-cdk"
K8S_DIR="$PROJECT_ROOT/k8s"

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
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed or not in PATH"
        exit 1
    fi
    
    # Check CDK
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK is not installed or not in PATH"
        log_info "Install CDK with: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed or not in PATH"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured or invalid"
        log_info "Configure credentials with: aws configure"
        exit 1
    fi
    
    # Verify region
    CURRENT_REGION=$(aws configure get region)
    if [[ "$CURRENT_REGION" != "$REGION" ]]; then
        log_warn "Current AWS region ($CURRENT_REGION) differs from target region ($REGION)"
        log_info "Setting region to $REGION for this deployment"
        export AWS_DEFAULT_REGION=$REGION
    fi
    
    log_success "Prerequisites check completed"
}

setup_cdk() {
    log_info "Setting up CDK environment..."
    
    cd "$CDK_DIR"
    
    # Install dependencies
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing CDK dependencies..."
        npm install
    fi
    
    # Get AWS account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    # Bootstrap CDK (if not already done)
    log_info "Bootstrapping CDK for account $ACCOUNT_ID in region $REGION..."
    cdk bootstrap aws://$ACCOUNT_ID/$REGION --context environment=$ENVIRONMENT
    
    log_success "CDK environment setup completed"
}

deploy_infrastructure() {
    log_info "Deploying AWS infrastructure..."
    
    cd "$CDK_DIR"
    
    # Build CDK project
    log_info "Building CDK project..."
    npm run build
    
    # Deploy infrastructure stacks
    log_info "Deploying infrastructure stacks for environment: $ENVIRONMENT"
    npm run deploy:$ENVIRONMENT || npm run deploy -- --context environment=$ENVIRONMENT
    
    # Wait for deployment to complete
    log_info "Waiting for infrastructure deployment to complete..."
    sleep 30
    
    log_success "Infrastructure deployment completed"
}

configure_kubectl() {
    log_info "Configuring kubectl for EKS cluster..."
    
    # Get cluster name from CDK outputs
    CLUSTER_NAME="fraud-detection-$ENVIRONMENT"
    
    # Update kubeconfig
    log_info "Updating kubeconfig for cluster: $CLUSTER_NAME"
    aws eks update-kubeconfig --region $REGION --name $CLUSTER_NAME
    
    # Verify connection
    if kubectl cluster-info &> /dev/null; then
        log_success "Successfully connected to EKS cluster"
    else
        log_error "Failed to connect to EKS cluster"
        exit 1
    fi
    
    # Wait for nodes to be ready
    log_info "Waiting for EKS nodes to be ready..."
    kubectl wait --for=condition=Ready nodes --all --timeout=600s
    
    log_success "kubectl configuration completed"
}

deploy_kubernetes_apps() {
    log_info "Deploying Kubernetes applications..."
    
    cd "$K8S_DIR"
    
    # Update namespace in manifests for environment
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        log_info "Updating namespace for environment: $ENVIRONMENT"
        sed -i.bak "s/namespace: fraud-detection/namespace: fraud-detection-$ENVIRONMENT/g" manifests/*.yaml
    fi
    
    # Deploy applications using our deployment script
    log_info "Running Kubernetes deployment script..."
    ./deploy.sh
    
    # Restore original manifests if modified
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        log_info "Restoring original manifest files..."
        find manifests/ -name "*.yaml.bak" -exec bash -c 'mv "$1" "${1%.bak}"' _ {} \;
    fi
    
    log_success "Kubernetes applications deployment completed"
}

verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check AWS resources
    log_info "Checking AWS resources..."
    
    # Check EKS cluster
    CLUSTER_STATUS=$(aws eks describe-cluster --name "fraud-detection-$ENVIRONMENT" --region $REGION --query 'cluster.status' --output text)
    if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
        log_success "✓ EKS cluster is active"
    else
        log_warn "✗ EKS cluster status: $CLUSTER_STATUS"
    fi
    
    # Check RDS cluster
    RDS_STATUS=$(aws rds describe-db-clusters --db-cluster-identifier "fraud-detection-$ENVIRONMENT" --region $REGION --query 'DBClusters[0].Status' --output text 2>/dev/null || echo "not found")
    if [[ "$RDS_STATUS" == "available" ]]; then
        log_success "✓ RDS cluster is available"
    else
        log_warn "✗ RDS cluster status: $RDS_STATUS"
    fi
    
    # Check Kubernetes resources
    log_info "Checking Kubernetes resources..."
    
    NAMESPACE="fraud-detection"
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        NAMESPACE="fraud-detection-$ENVIRONMENT"
    fi
    
    # Check if namespace exists
    if kubectl get namespace $NAMESPACE &> /dev/null; then
        log_success "✓ Namespace $NAMESPACE exists"
        
        # Check pod status
        PENDING_PODS=$(kubectl get pods -n $NAMESPACE --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l || echo "0")
        RUNNING_PODS=$(kubectl get pods -n $NAMESPACE --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l || echo "0")
        FAILED_PODS=$(kubectl get pods -n $NAMESPACE --field-selector=status.phase=Failed --no-headers 2>/dev/null | wc -l || echo "0")
        
        log_info "Pod status: $RUNNING_PODS running, $PENDING_PODS pending, $FAILED_PODS failed"
        
        if [[ $RUNNING_PODS -gt 0 && $FAILED_PODS -eq 0 ]]; then
            log_success "✓ Kubernetes applications are running"
        else
            log_warn "✗ Some Kubernetes applications may have issues"
        fi
    else
        log_warn "✗ Namespace $NAMESPACE not found"
    fi
    
    log_success "Deployment verification completed"
}

get_access_information() {
    log_info "Getting access information..."
    
    NAMESPACE="fraud-detection"
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        NAMESPACE="fraud-detection-$ENVIRONMENT"
    fi
    
    echo ""
    echo "=== Fraud Detection System Access Information ==="
    echo "Environment: $ENVIRONMENT"
    echo "Region: $REGION"
    echo "Namespace: $NAMESPACE"
    echo ""
    
    # Get LoadBalancer services
    echo "External Services:"
    kubectl get services -n $NAMESPACE -o wide | grep LoadBalancer || echo "No LoadBalancer services found"
    echo ""
    
    # Get ingress information
    echo "Ingress Information:"
    kubectl get ingress -n $NAMESPACE || echo "No ingress found"
    echo ""
    
    # Get cluster endpoint
    CLUSTER_ENDPOINT=$(aws eks describe-cluster --name "fraud-detection-$ENVIRONMENT" --region $REGION --query 'cluster.endpoint' --output text)
    echo "EKS Cluster Endpoint: $CLUSTER_ENDPOINT"
    echo ""
    
    # Port forwarding commands
    echo "Port Forwarding Commands:"
    echo "Grafana:    kubectl port-forward -n $NAMESPACE service/grafana-service 3000:3000"
    echo "Flink UI:   kubectl port-forward -n $NAMESPACE service/flink-jobmanager-service 8081:8081"
    echo "ML API:     kubectl port-forward -n $NAMESPACE service/ml-models-service 8000:8000"
    echo ""
    
    # Dashboard URL (if available)
    echo "Dashboard Access:"
    echo "Run the port-forward commands above and access:"
    echo "- Grafana: http://localhost:3000 (admin/admin123)"
    echo "- Flink:   http://localhost:8081"
    echo "- ML API:  http://localhost:8000/docs"
    echo ""
}

cleanup_failed_deployment() {
    log_warn "Cleaning up failed deployment..."
    
    # Delete Kubernetes resources
    cd "$K8S_DIR"
    kubectl delete namespace "fraud-detection-$ENVIRONMENT" --ignore-not-found=true
    
    # Optionally destroy CDK stacks (commented out for safety)
    # cd "$CDK_DIR"
    # cdk destroy --all --force --context environment=$ENVIRONMENT
    
    log_info "Cleanup completed"
}

# Main deployment flow
main() {
    log_info "Starting AWS deployment for Fraud Detection System..."
    log_info "Environment: $ENVIRONMENT"
    log_info "Region: $REGION"
    echo ""
    
    # Set trap for cleanup on failure
    trap cleanup_failed_deployment ERR
    
    check_prerequisites
    setup_cdk
    deploy_infrastructure
    configure_kubectl
    deploy_kubernetes_apps
    verify_deployment
    get_access_information
    
    log_success "Fraud Detection System deployment completed successfully!"
    log_info "Check the access information above to connect to your services."
}

# Handle command line arguments
case "${1:-}" in
    "infrastructure")
        check_prerequisites
        setup_cdk
        deploy_infrastructure
        ;;
    "kubernetes")
        configure_kubectl
        deploy_kubernetes_apps
        ;;
    "verify")
        verify_deployment
        ;;
    "cleanup")
        cleanup_failed_deployment
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [ENVIRONMENT] [REGION] [COMMAND]"
        echo ""
        echo "ENVIRONMENT: dev, staging, or prod (default: dev)"
        echo "REGION: AWS region (default: us-west-2)"
        echo ""
        echo "Commands:"
        echo "  infrastructure  Deploy AWS infrastructure only"
        echo "  kubernetes      Deploy Kubernetes applications only"
        echo "  verify          Verify deployment status"
        echo "  cleanup         Clean up failed deployment"
        echo "  help            Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0                     # Deploy to dev environment in us-west-2"
        echo "  $0 prod us-east-1      # Deploy to prod environment in us-east-1"
        echo "  $0 staging             # Deploy to staging environment in us-west-2"
        echo "  $0 dev us-west-2 verify # Verify dev deployment"
        ;;
    "dev"|"staging"|"prod")
        # If first argument is environment, shift arguments
        ENVIRONMENT="$1"
        REGION="${2:-us-west-2}"
        COMMAND="${3:-}"
        
        if [[ -n "$COMMAND" ]]; then
            case "$COMMAND" in
                "infrastructure"|"kubernetes"|"verify"|"cleanup")
                    $COMMAND
                    ;;
                *)
                    log_error "Unknown command: $COMMAND"
                    exit 1
                    ;;
            esac
        else
            main
        fi
        ;;
    "")
        main
        ;;
    *)
        log_error "Unknown argument: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac