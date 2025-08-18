#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import { EksClusterStack } from './eks-cluster';
import { ManagedServicesStack } from './managed-services';
import { MonitoringStack } from './monitoring';

const app = new cdk.App();

// Environment configuration
const environment = app.node.tryGetContext('environment') || 'dev';
const region = app.node.tryGetContext('region') || 'us-west-2';
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;

// Stack configuration
const stackProps: cdk.StackProps = {
  env: {
    account,
    region,
  },
  description: `Fraud Detection System - ${environment.toUpperCase()}`,
  tags: {
    Environment: environment,
    Project: 'FraudDetection',
    ManagedBy: 'CDK',
    CostCenter: 'Engineering',
  },
};

// EKS Cluster Stack
const eksStack = new EksClusterStack(app, `FraudDetection-EKS-${environment}`, {
  ...stackProps,
  clusterName: `fraud-detection-${environment}`,
  region,
  kubernetesVersion: eks.KubernetesVersion.V1_27,
  nodeInstanceTypes: [
    ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE),
    ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
  ],
  minSize: 2,
  maxSize: 10,
  desiredSize: 3,
  enableLogging: environment === 'prod',
  enablePrivateEndpoint: environment === 'prod',
});

// Managed Services Stack
const servicesStack = new ManagedServicesStack(app, `FraudDetection-Services-${environment}`, {
  ...stackProps,
  vpc: eksStack.vpc,
  environmentName: environment,
  enableEncryption: environment === 'prod',
  enableBackups: environment === 'prod',
  multiAz: environment === 'prod',
});

// Monitoring Stack
const monitoringStack = new MonitoringStack(app, `FraudDetection-Monitoring-${environment}`, {
  ...stackProps,
  vpc: eksStack.vpc,
  cluster: eksStack.cluster,
  rdsCluster: servicesStack.rdsCluster,
  redisCluster: servicesStack.redisCluster,
  mskCluster: servicesStack.mskCluster,
  environmentName: environment,
});

// Add dependencies
servicesStack.addDependency(eksStack);
monitoringStack.addDependency(servicesStack);

// Stack outputs
new cdk.CfnOutput(eksStack, 'DeploymentInstructions', {
  value: [
    '1. Configure kubectl:',
    `   aws eks update-kubeconfig --region ${region} --name fraud-detection-${environment}`,
    '',
    '2. Deploy applications:',
    '   cd k8s && ./deploy.sh',
    '',
    '3. Access services:',
    '   kubectl get services -n fraud-detection',
  ].join('\n'),
  description: 'Deployment Instructions',
});

app.synth();