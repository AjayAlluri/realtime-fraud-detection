# Kubernetes Deployment

This directory contains Kubernetes manifests and Helm charts for deploying the fraud detection system in production.

## Structure

- `helm/` - Helm charts for package management
- `manifests/` - Raw Kubernetes YAML files
- `operators/` - Custom operators for advanced automation

## Quick Deploy

```bash
# Deploy with Helm
helm install fraud-detection ./helm/fraud-detection

# Or deploy raw manifests
kubectl apply -f manifests/
```

## Features

- **Auto-scaling**: HorizontalPodAutoscaler for Flink jobs
- **High Availability**: StatefulSets for stateful services
- **Service Mesh**: Istio integration for secure communication
- **Monitoring**: Prometheus/Grafana stack
- **Storage**: Persistent volumes for Kafka/Redis data
- **Security**: RBAC, NetworkPolicies, PodSecurityPolicies

## Prerequisites

- Kubernetes 1.20+
- Helm 3.0+
- kubectl configured
- Sufficient cluster resources (8+ nodes recommended)

## Resource Requirements

- **Total CPU**: 16 cores minimum
- **Total Memory**: 32GB minimum
- **Storage**: 500GB+ for persistent volumes