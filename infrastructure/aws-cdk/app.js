#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const eks = __importStar(require("aws-cdk-lib/aws-eks"));
const eks_cluster_1 = require("./eks-cluster");
const managed_services_1 = require("./managed-services");
const monitoring_1 = require("./monitoring");
const app = new cdk.App();
// Environment configuration
const environment = app.node.tryGetContext('environment') || 'dev';
const region = app.node.tryGetContext('region') || 'us-west-2';
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
// Stack configuration
const stackProps = {
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
const eksStack = new eks_cluster_1.EksClusterStack(app, `FraudDetection-EKS-${environment}`, {
    ...stackProps,
    clusterName: `fraud-detection-${environment}`,
    region,
    kubernetesVersion: eks.KubernetesVersion.V1_26,
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
const servicesStack = new managed_services_1.ManagedServicesStack(app, `FraudDetection-Services-${environment}`, {
    ...stackProps,
    vpc: eksStack.vpc,
    environmentName: environment,
    enableEncryption: environment === 'prod',
    enableBackups: environment === 'prod',
    multiAz: environment === 'prod',
});
// Monitoring Stack
const monitoringStack = new monitoring_1.MonitoringStack(app, `FraudDetection-Monitoring-${environment}`, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsdUNBQXFDO0FBQ3JDLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLCtDQUFnRDtBQUNoRCx5REFBMEQ7QUFDMUQsNkNBQStDO0FBRS9DLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLDRCQUE0QjtBQUM1QixNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxLQUFLLENBQUM7QUFDbkUsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLElBQUksV0FBVyxDQUFDO0FBQy9ELE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7QUFFckYsc0JBQXNCO0FBQ3RCLE1BQU0sVUFBVSxHQUFtQjtJQUNqQyxHQUFHLEVBQUU7UUFDSCxPQUFPO1FBQ1AsTUFBTTtLQUNQO0lBQ0QsV0FBVyxFQUFFLDRCQUE0QixXQUFXLENBQUMsV0FBVyxFQUFFLEVBQUU7SUFDcEUsSUFBSSxFQUFFO1FBQ0osV0FBVyxFQUFFLFdBQVc7UUFDeEIsT0FBTyxFQUFFLGdCQUFnQjtRQUN6QixTQUFTLEVBQUUsS0FBSztRQUNoQixVQUFVLEVBQUUsYUFBYTtLQUMxQjtDQUNGLENBQUM7QUFFRixvQkFBb0I7QUFDcEIsTUFBTSxRQUFRLEdBQUcsSUFBSSw2QkFBZSxDQUFDLEdBQUcsRUFBRSxzQkFBc0IsV0FBVyxFQUFFLEVBQUU7SUFDN0UsR0FBRyxVQUFVO0lBQ2IsV0FBVyxFQUFFLG1CQUFtQixXQUFXLEVBQUU7SUFDN0MsTUFBTTtJQUNOLGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLO0lBQzlDLGlCQUFpQixFQUFFO1FBQ2pCLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDO1FBQ2pFLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDO0tBQ25FO0lBQ0QsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsRUFBRTtJQUNYLFdBQVcsRUFBRSxDQUFDO0lBQ2QsYUFBYSxFQUFFLFdBQVcsS0FBSyxNQUFNO0lBQ3JDLHFCQUFxQixFQUFFLFdBQVcsS0FBSyxNQUFNO0NBQzlDLENBQUMsQ0FBQztBQUVILHlCQUF5QjtBQUN6QixNQUFNLGFBQWEsR0FBRyxJQUFJLHVDQUFvQixDQUFDLEdBQUcsRUFBRSwyQkFBMkIsV0FBVyxFQUFFLEVBQUU7SUFDNUYsR0FBRyxVQUFVO0lBQ2IsR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHO0lBQ2pCLGVBQWUsRUFBRSxXQUFXO0lBQzVCLGdCQUFnQixFQUFFLFdBQVcsS0FBSyxNQUFNO0lBQ3hDLGFBQWEsRUFBRSxXQUFXLEtBQUssTUFBTTtJQUNyQyxPQUFPLEVBQUUsV0FBVyxLQUFLLE1BQU07Q0FDaEMsQ0FBQyxDQUFDO0FBRUgsbUJBQW1CO0FBQ25CLE1BQU0sZUFBZSxHQUFHLElBQUksNEJBQWUsQ0FBQyxHQUFHLEVBQUUsNkJBQTZCLFdBQVcsRUFBRSxFQUFFO0lBQzNGLEdBQUcsVUFBVTtJQUNiLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRztJQUNqQixPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU87SUFDekIsVUFBVSxFQUFFLGFBQWEsQ0FBQyxVQUFVO0lBQ3BDLFlBQVksRUFBRSxhQUFhLENBQUMsWUFBWTtJQUN4QyxVQUFVLEVBQUUsYUFBYSxDQUFDLFVBQVU7SUFDcEMsZUFBZSxFQUFFLFdBQVc7Q0FDN0IsQ0FBQyxDQUFDO0FBRUgsbUJBQW1CO0FBQ25CLGFBQWEsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDdEMsZUFBZSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUU3QyxnQkFBZ0I7QUFDaEIsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSx3QkFBd0IsRUFBRTtJQUNwRCxLQUFLLEVBQUU7UUFDTCx1QkFBdUI7UUFDdkIseUNBQXlDLE1BQU0sMkJBQTJCLFdBQVcsRUFBRTtRQUN2RixFQUFFO1FBQ0YseUJBQXlCO1FBQ3pCLDBCQUEwQjtRQUMxQixFQUFFO1FBQ0YscUJBQXFCO1FBQ3JCLDRDQUE0QztLQUM3QyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDWixXQUFXLEVBQUUseUJBQXlCO0NBQ3ZDLENBQUMsQ0FBQztBQUVILEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XG5pbXBvcnQgeyBFa3NDbHVzdGVyU3RhY2sgfSBmcm9tICcuL2Vrcy1jbHVzdGVyJztcbmltcG9ydCB7IE1hbmFnZWRTZXJ2aWNlc1N0YWNrIH0gZnJvbSAnLi9tYW5hZ2VkLXNlcnZpY2VzJztcbmltcG9ydCB7IE1vbml0b3JpbmdTdGFjayB9IGZyb20gJy4vbW9uaXRvcmluZyc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIEVudmlyb25tZW50IGNvbmZpZ3VyYXRpb25cbmNvbnN0IGVudmlyb25tZW50ID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52aXJvbm1lbnQnKSB8fCAnZGV2JztcbmNvbnN0IHJlZ2lvbiA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ3JlZ2lvbicpIHx8ICd1cy13ZXN0LTInO1xuY29uc3QgYWNjb3VudCA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2FjY291bnQnKSB8fCBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5UO1xuXG4vLyBTdGFjayBjb25maWd1cmF0aW9uXG5jb25zdCBzdGFja1Byb3BzOiBjZGsuU3RhY2tQcm9wcyA9IHtcbiAgZW52OiB7XG4gICAgYWNjb3VudCxcbiAgICByZWdpb24sXG4gIH0sXG4gIGRlc2NyaXB0aW9uOiBgRnJhdWQgRGV0ZWN0aW9uIFN5c3RlbSAtICR7ZW52aXJvbm1lbnQudG9VcHBlckNhc2UoKX1gLFxuICB0YWdzOiB7XG4gICAgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIFByb2plY3Q6ICdGcmF1ZERldGVjdGlvbicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICBDb3N0Q2VudGVyOiAnRW5naW5lZXJpbmcnLFxuICB9LFxufTtcblxuLy8gRUtTIENsdXN0ZXIgU3RhY2tcbmNvbnN0IGVrc1N0YWNrID0gbmV3IEVrc0NsdXN0ZXJTdGFjayhhcHAsIGBGcmF1ZERldGVjdGlvbi1FS1MtJHtlbnZpcm9ubWVudH1gLCB7XG4gIC4uLnN0YWNrUHJvcHMsXG4gIGNsdXN0ZXJOYW1lOiBgZnJhdWQtZGV0ZWN0aW9uLSR7ZW52aXJvbm1lbnR9YCxcbiAgcmVnaW9uLFxuICBrdWJlcm5ldGVzVmVyc2lvbjogZWtzLkt1YmVybmV0ZXNWZXJzaW9uLlYxXzI2LFxuICBub2RlSW5zdGFuY2VUeXBlczogW1xuICAgIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTUsIGVjMi5JbnN0YW5jZVNpemUuTEFSR0UpLFxuICAgIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTUsIGVjMi5JbnN0YW5jZVNpemUuWExBUkdFKSxcbiAgXSxcbiAgbWluU2l6ZTogMixcbiAgbWF4U2l6ZTogMTAsXG4gIGRlc2lyZWRTaXplOiAzLFxuICBlbmFibGVMb2dnaW5nOiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnLFxuICBlbmFibGVQcml2YXRlRW5kcG9pbnQ6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG59KTtcblxuLy8gTWFuYWdlZCBTZXJ2aWNlcyBTdGFja1xuY29uc3Qgc2VydmljZXNTdGFjayA9IG5ldyBNYW5hZ2VkU2VydmljZXNTdGFjayhhcHAsIGBGcmF1ZERldGVjdGlvbi1TZXJ2aWNlcy0ke2Vudmlyb25tZW50fWAsIHtcbiAgLi4uc3RhY2tQcm9wcyxcbiAgdnBjOiBla3NTdGFjay52cGMsXG4gIGVudmlyb25tZW50TmFtZTogZW52aXJvbm1lbnQsXG4gIGVuYWJsZUVuY3J5cHRpb246IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gIGVuYWJsZUJhY2t1cHM6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gIG11bHRpQXo6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG59KTtcblxuLy8gTW9uaXRvcmluZyBTdGFja1xuY29uc3QgbW9uaXRvcmluZ1N0YWNrID0gbmV3IE1vbml0b3JpbmdTdGFjayhhcHAsIGBGcmF1ZERldGVjdGlvbi1Nb25pdG9yaW5nLSR7ZW52aXJvbm1lbnR9YCwge1xuICAuLi5zdGFja1Byb3BzLFxuICB2cGM6IGVrc1N0YWNrLnZwYyxcbiAgY2x1c3RlcjogZWtzU3RhY2suY2x1c3RlcixcbiAgcmRzQ2x1c3Rlcjogc2VydmljZXNTdGFjay5yZHNDbHVzdGVyLFxuICByZWRpc0NsdXN0ZXI6IHNlcnZpY2VzU3RhY2sucmVkaXNDbHVzdGVyLFxuICBtc2tDbHVzdGVyOiBzZXJ2aWNlc1N0YWNrLm1za0NsdXN0ZXIsXG4gIGVudmlyb25tZW50TmFtZTogZW52aXJvbm1lbnQsXG59KTtcblxuLy8gQWRkIGRlcGVuZGVuY2llc1xuc2VydmljZXNTdGFjay5hZGREZXBlbmRlbmN5KGVrc1N0YWNrKTtcbm1vbml0b3JpbmdTdGFjay5hZGREZXBlbmRlbmN5KHNlcnZpY2VzU3RhY2spO1xuXG4vLyBTdGFjayBvdXRwdXRzXG5uZXcgY2RrLkNmbk91dHB1dChla3NTdGFjaywgJ0RlcGxveW1lbnRJbnN0cnVjdGlvbnMnLCB7XG4gIHZhbHVlOiBbXG4gICAgJzEuIENvbmZpZ3VyZSBrdWJlY3RsOicsXG4gICAgYCAgIGF3cyBla3MgdXBkYXRlLWt1YmVjb25maWcgLS1yZWdpb24gJHtyZWdpb259IC0tbmFtZSBmcmF1ZC1kZXRlY3Rpb24tJHtlbnZpcm9ubWVudH1gLFxuICAgICcnLFxuICAgICcyLiBEZXBsb3kgYXBwbGljYXRpb25zOicsXG4gICAgJyAgIGNkIGs4cyAmJiAuL2RlcGxveS5zaCcsXG4gICAgJycsXG4gICAgJzMuIEFjY2VzcyBzZXJ2aWNlczonLFxuICAgICcgICBrdWJlY3RsIGdldCBzZXJ2aWNlcyAtbiBmcmF1ZC1kZXRlY3Rpb24nLFxuICBdLmpvaW4oJ1xcbicpLFxuICBkZXNjcmlwdGlvbjogJ0RlcGxveW1lbnQgSW5zdHJ1Y3Rpb25zJyxcbn0pO1xuXG5hcHAuc3ludGgoKTsiXX0=