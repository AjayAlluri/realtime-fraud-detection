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
exports.EksClusterStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const eks = __importStar(require("aws-cdk-lib/aws-eks"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
class EksClusterStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC for EKS cluster
        this.vpc = new ec2.Vpc(this, 'FraudDetectionVPC', {
            cidr: '10.0.0.0/16',
            maxAzs: 3,
            natGateways: 2,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 28,
                    name: 'Database',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
            enableDnsHostnames: true,
            enableDnsSupport: true,
        });
        // KMS key for EKS cluster encryption
        const clusterKmsKey = new kms.Key(this, 'EksClusterKmsKey', {
            description: 'KMS key for EKS cluster encryption',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // EKS Service Role
        const eksServiceRole = new iam.Role(this, 'EksServiceRole', {
            assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
            ],
        });
        // Node Group Role
        const nodeGroupRole = new iam.Role(this, 'NodeGroupRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
            ],
        });
        // Additional permissions for fraud detection workloads
        nodeGroupRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:GetSecretValue',
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
                'kms:Decrypt',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                'sagemaker:InvokeEndpoint',
                'kinesis:PutRecord',
                'kinesis:PutRecords',
                'kinesis:GetRecords',
                'kinesis:GetShardIterator',
                'kinesis:DescribeStream',
                'kinesis:ListStreams',
            ],
            resources: ['*'],
        }));
        // CloudWatch Log Group for EKS cluster
        const logGroup = new logs.LogGroup(this, 'EksClusterLogGroup', {
            logGroupName: `/aws/eks/${props.clusterName}/cluster`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Create EKS Cluster
        this.cluster = new eks.Cluster(this, 'FraudDetectionCluster', {
            clusterName: props.clusterName,
            version: props.kubernetesVersion,
            vpc: this.vpc,
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
            defaultCapacity: 0,
            // Security and access
            endpointAccess: props.enablePrivateEndpoint
                ? eks.EndpointAccess.PRIVATE
                : eks.EndpointAccess.PUBLIC_AND_PRIVATE,
            // Encryption
            secretsEncryptionKey: clusterKmsKey,
            // Logging
            clusterLogging: props.enableLogging ? [
                eks.ClusterLoggingTypes.API,
                eks.ClusterLoggingTypes.AUDIT,
                eks.ClusterLoggingTypes.AUTHENTICATOR,
                eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
                eks.ClusterLoggingTypes.SCHEDULER,
            ] : [],
            // Service role
            role: eksServiceRole,
            // Add-ons
            defaultCapacityType: eks.DefaultCapacityType.NODEGROUP,
        });
        // Primary Node Group for general workloads
        const primaryNodeGroup = this.cluster.addNodegroupCapacity('PrimaryNodeGroup', {
            instanceTypes: props.nodeInstanceTypes,
            minSize: props.minSize,
            maxSize: props.maxSize,
            desiredSize: props.desiredSize,
            nodeRole: nodeGroupRole,
            // Subnet configuration
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            // AMI and capacity
            amiType: eks.NodegroupAmiType.AL2_X86_64,
            capacityType: eks.CapacityType.ON_DEMAND,
            // Disk configuration
            diskSize: 100,
            // Scaling configuration
            forceUpdate: true,
            // Labels and taints
            labels: {
                'workload-type': 'general',
                'node-group': 'primary',
            },
        });
        // ML/GPU Node Group for ML workloads (optional)
        const mlNodeGroup = this.cluster.addNodegroupCapacity('MLNodeGroup', {
            instanceTypes: [ec2.InstanceType.of(ec2.InstanceClass.P3, ec2.InstanceSize.XLARGE2)],
            minSize: 0,
            maxSize: 5,
            desiredSize: 0,
            nodeRole: nodeGroupRole,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            amiType: eks.NodegroupAmiType.AL2_X86_64_GPU,
            capacityType: eks.CapacityType.SPOT,
            diskSize: 200,
            labels: {
                'workload-type': 'ml',
                'node-group': 'ml',
                'nvidia.com/gpu': 'true',
            },
            taints: [{
                    key: 'nvidia.com/gpu',
                    value: 'true',
                    effect: eks.TaintEffect.NO_SCHEDULE,
                }],
        });
        // Install essential add-ons
        this.installAddons();
        // Create service accounts and RBAC
        this.createServiceAccounts();
        // Output important information
        new cdk.CfnOutput(this, 'ClusterName', {
            value: this.cluster.clusterName,
            description: 'EKS Cluster Name',
        });
        new cdk.CfnOutput(this, 'ClusterEndpoint', {
            value: this.cluster.clusterEndpoint,
            description: 'EKS Cluster Endpoint',
        });
        new cdk.CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            description: 'EKS Cluster ARN',
        });
        new cdk.CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            description: 'VPC ID',
        });
        new cdk.CfnOutput(this, 'KubectlCommand', {
            value: `aws eks update-kubeconfig --region ${props.region} --name ${props.clusterName}`,
            description: 'Command to configure kubectl',
        });
    }
    installAddons() {
        // AWS Load Balancer Controller
        const albController = this.cluster.addHelmChart('AWSLoadBalancerController', {
            chart: 'aws-load-balancer-controller',
            repository: 'https://aws.github.io/eks-charts',
            namespace: 'kube-system',
            values: {
                clusterName: this.cluster.clusterName,
                serviceAccount: {
                    create: false,
                    name: 'aws-load-balancer-controller',
                },
            },
        });
        // Cluster Autoscaler
        const clusterAutoscaler = this.cluster.addHelmChart('ClusterAutoscaler', {
            chart: 'cluster-autoscaler',
            repository: 'https://kubernetes.github.io/autoscaler',
            namespace: 'kube-system',
            values: {
                autoDiscovery: {
                    clusterName: this.cluster.clusterName,
                },
                awsRegion: this.region,
                rbac: {
                    serviceAccount: {
                        create: false,
                        name: 'cluster-autoscaler',
                    },
                },
            },
        });
        // Metrics Server
        const metricsServer = this.cluster.addHelmChart('MetricsServer', {
            chart: 'metrics-server',
            repository: 'https://kubernetes-sigs.github.io/metrics-server/',
            namespace: 'kube-system',
        });
        // Container Insights (CloudWatch)
        const containerInsights = this.cluster.addManifest('ContainerInsights', {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: { name: 'amazon-cloudwatch' },
        });
    }
    createServiceAccounts() {
        // AWS Load Balancer Controller Service Account
        const albServiceAccount = this.cluster.addServiceAccount('AWSLoadBalancerControllerServiceAccount', {
            name: 'aws-load-balancer-controller',
            namespace: 'kube-system',
        });
        albServiceAccount.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLoadBalancerControllerIAMPolicy'));
        // Cluster Autoscaler Service Account
        const autoscalerServiceAccount = this.cluster.addServiceAccount('ClusterAutoscalerServiceAccount', {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
        });
        autoscalerServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'autoscaling:DescribeAutoScalingGroups',
                'autoscaling:DescribeAutoScalingInstances',
                'autoscaling:DescribeLaunchConfigurations',
                'autoscaling:DescribeTags',
                'autoscaling:SetDesiredCapacity',
                'autoscaling:TerminateInstanceInAutoScalingGroup',
                'ec2:DescribeLaunchTemplateVersions',
                'ec2:DescribeImages',
                'ec2:GetInstanceTypesFromInstanceRequirements',
                'eks:DescribeNodegroup',
            ],
            resources: ['*'],
        }));
        // CloudWatch Service Account for logging
        const cloudwatchServiceAccount = this.cluster.addServiceAccount('CloudWatchServiceAccount', {
            name: 'cloudwatch-agent',
            namespace: 'amazon-cloudwatch',
        });
        cloudwatchServiceAccount.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
        // External DNS Service Account (optional)
        const externalDnsServiceAccount = this.cluster.addServiceAccount('ExternalDNSServiceAccount', {
            name: 'external-dns',
            namespace: 'kube-system',
        });
        externalDnsServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'route53:ChangeResourceRecordSets',
                'route53:ListHostedZones',
                'route53:ListResourceRecordSets',
            ],
            resources: ['*'],
        }));
    }
}
exports.EksClusterStack = EksClusterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWtzLWNsdXN0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJla3MtY2x1c3Rlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBZTdDLE1BQWEsZUFBZ0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUk1QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDaEQsSUFBSSxFQUFFLGFBQWE7WUFDbkIsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO2lCQUNsQztnQkFDRDtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsU0FBUztvQkFDZixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7aUJBQy9DO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxVQUFVO29CQUNoQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7WUFDRCxrQkFBa0IsRUFBRSxJQUFJO1lBQ3hCLGdCQUFnQixFQUFFLElBQUk7U0FDdkIsQ0FBQyxDQUFDO1FBRUgscUNBQXFDO1FBQ3JDLE1BQU0sYUFBYSxHQUFHLElBQUksR0FB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O1lBQ3hCLE9BQU8sRUFBRTtnQkFDUCxrQ0FBa0M7Z0JBQ2xDLHlCQUF5QjtnQkFDekIsZ0NBQWdDO2FBQ2pDO1lBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztDQUNGO0FBN1RELDBDQTZUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBla3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVrcyc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVrc0NsdXN0ZXJQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgY2x1c3Rlck5hbWU6IHN0cmluZztcbiAgcmVnaW9uOiBzdHJpbmc7XG4gIGt1YmVybmV0ZXNWZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb247XG4gIG5vZGVJbnN0YW5jZVR5cGVzOiBlYzIuSW5zdGFuY2VUeXBlW107XG4gIG1pblNpemU6IG51bWJlcjtcbiAgbWF4U2l6ZTogbnVtYmVyO1xuICBkZXNpcmVkU2l6ZTogbnVtYmVyO1xuICBlbmFibGVMb2dnaW5nPzogYm9vbGVhbjtcbiAgZW5hYmxlUHJpdmF0ZUVuZHBvaW50PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIEVrc0NsdXN0ZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBjbHVzdGVyOiBla3MuQ2x1c3RlcjtcbiAgcHVibGljIHJlYWRvbmx5IHZwYzogZWMyLlZwYztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRWtzQ2x1c3RlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgVlBDIGZvciBFS1MgY2x1c3RlclxuICAgIHRoaXMudnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0ZyYXVkRGV0ZWN0aW9uVlBDJywge1xuICAgICAgY2lkcjogJzEwLjAuMC4wLzE2JyxcbiAgICAgIG1heEF6czogMyxcbiAgICAgIG5hdEdhdGV3YXlzOiAyLFxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdQdWJsaWMnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyOCxcbiAgICAgICAgICBuYW1lOiAnRGF0YWJhc2UnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZW5hYmxlRG5zSG9zdG5hbWVzOiB0cnVlLFxuICAgICAgZW5hYmxlRG5zU3VwcG9ydDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEtNUyBrZXkgZm9yIEVLUyBjbHVzdGVyIGVuY3J5cHRpb25cbiAgICBjb25zdCBjbHVzdGVyS21zS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ0Vrc0NsdXN0ZXJLbXNLZXknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIEVLUyBjbHVzdGVyIGVuY3J5cHRpb24nLFxuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gRUtTIFNlcnZpY2UgUm9sZVxuICAgIGNvbnN0IGVrc1NlcnZpY2VSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFa3NTZXJ2aWNlUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdla3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uRUtTQ2x1c3RlclBvbGljeScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIE5vZGUgR3JvdXAgUm9sZVxuICAgIGNvbnN0IG5vZGVHcm91cFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ05vZGVHcm91cFJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvbkVLU1dvcmtlck5vZGVQb2xpY3knKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25FS1NfQ05JX1BvbGljeScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvbkVDMkNvbnRhaW5lclJlZ2lzdHJ5UmVhZE9ubHknKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdDbG91ZFdhdGNoQWdlbnRTZXJ2ZXJQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGRpdGlvbmFsIHBlcm1pc3Npb25zIGZvciBmcmF1ZCBkZXRlY3Rpb24gd29ya2xvYWRzXG4gICAgbm9kZUdyb3VwUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzc206R2V0UGFyYW1ldGVyJyxcbiAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXJzJyxcbiAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXJzQnlQYXRoJyxcbiAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgJ3MzOkdldE9iamVjdCcsXG4gICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgICAnczM6RGVsZXRlT2JqZWN0JyxcbiAgICAgICAgJ3NhZ2VtYWtlcjpJbnZva2VFbmRwb2ludCcsXG4gICAgICAgICdraW5lc2lzOlB1dFJlY29yZCcsXG4gICAgICAgICdraW5lc2lzOlB1dFJlY29yZHMnLFxuICAgICAgICAna2luZXNpczpHZXRSZWNvcmRzJyxcbiAgICAgICAgJ2tpbmVzaXM6R2V0U2hhcmRJdGVyYXRvcicsXG4gICAgICAgICdraW5lc2lzOkRlc2NyaWJlU3RyZWFtJyxcbiAgICAgICAgJ2tpbmVzaXM6TGlzdFN0cmVhbXMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIEVLUyBjbHVzdGVyXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnRWtzQ2x1c3RlckxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9la3MvJHtwcm9wcy5jbHVzdGVyTmFtZX0vY2x1c3RlcmAsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEVLUyBDbHVzdGVyXG4gICAgdGhpcy5jbHVzdGVyID0gbmV3IGVrcy5DbHVzdGVyKHRoaXMsICdGcmF1ZERldGVjdGlvbkNsdXN0ZXInLCB7XG4gICAgICBjbHVzdGVyTmFtZTogcHJvcHMuY2x1c3Rlck5hbWUsXG4gICAgICB2ZXJzaW9uOiBwcm9wcy5rdWJlcm5ldGVzVmVyc2lvbixcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICB2cGNTdWJuZXRzOiBbeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH1dLFxuICAgICAgZGVmYXVsdENhcGFjaXR5OiAwLCAvLyBXZSdsbCBhZGQgbWFuYWdlZCBub2RlIGdyb3VwcyBzZXBhcmF0ZWx5XG4gICAgICBcbiAgICAgIC8vIFNlY3VyaXR5IGFuZCBhY2Nlc3NcbiAgICAgIGVuZHBvaW50QWNjZXNzOiBwcm9wcy5lbmFibGVQcml2YXRlRW5kcG9pbnQgXG4gICAgICAgID8gZWtzLkVuZHBvaW50QWNjZXNzLlBSSVZBVEUgXG4gICAgICAgIDogZWtzLkVuZHBvaW50QWNjZXNzLlBVQkxJQ19BTkRfUFJJVkFURSxcbiAgICAgIFxuICAgICAgLy8gRW5jcnlwdGlvblxuICAgICAgc2VjcmV0c0VuY3J5cHRpb25LZXk6IGNsdXN0ZXJLbXNLZXksXG4gICAgICBcbiAgICAgIC8vIExvZ2dpbmdcbiAgICAgIGNsdXN0ZXJMb2dnaW5nOiBwcm9wcy5lbmFibGVMb2dnaW5nID8gW1xuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5BUEksXG4gICAgICAgIGVrcy5DbHVzdGVyTG9nZ2luZ1R5cGVzLkFVRElULFxuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5BVVRIRU5USUNBVE9SLFxuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5DT05UUk9MTEVSX01BTkFHRVIsXG4gICAgICAgIGVrcy5DbHVzdGVyTG9nZ2luZ1R5cGVzLlNDSEVEVUxFUixcbiAgICAgIF0gOiBbXSxcblxuICAgICAgLy8gU2VydmljZSByb2xlXG4gICAgICByb2xlOiBla3NTZXJ2aWNlUm9sZSxcblxuICAgICAgLy8gQWRkLW9uc1xuICAgICAgZGVmYXVsdENhcGFjaXR5VHlwZTogZWtzLkRlZmF1bHRDYXBhY2l0eVR5cGUuTk9ERUdST1VQLFxuICAgIH0pO1xuXG4gICAgLy8gUHJpbWFyeSBOb2RlIEdyb3VwIGZvciBnZW5lcmFsIHdvcmtsb2Fkc1xuICAgIGNvbnN0IHByaW1hcnlOb2RlR3JvdXAgPSB0aGlzLmNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ1ByaW1hcnlOb2RlR3JvdXAnLCB7XG4gICAgICBpbnN0YW5jZVR5cGVzOiBwcm9wcy5ub2RlSW5zdGFuY2VUeXBlcyxcbiAgICAgIG1pblNpemU6IHByb3BzLm1pblNpemUsXG4gICAgICBtYXhTaXplOiBwcm9wcy5tYXhTaXplLFxuICAgICAgZGVzaXJlZFNpemU6IHByb3BzLmRlc2lyZWRTaXplLFxuICAgICAgbm9kZVJvbGU6IG5vZGVHcm91cFJvbGUsXG4gICAgICBcbiAgICAgIC8vIFN1Ym5ldCBjb25maWd1cmF0aW9uXG4gICAgICBzdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIFxuICAgICAgLy8gQU1JIGFuZCBjYXBhY2l0eVxuICAgICAgYW1pVHlwZTogZWtzLk5vZGVncm91cEFtaVR5cGUuQUwyX1g4Nl82NCxcbiAgICAgIGNhcGFjaXR5VHlwZTogZWtzLkNhcGFjaXR5VHlwZS5PTl9ERU1BTkQsXG4gICAgICBcbiAgICAgIC8vIERpc2sgY29uZmlndXJhdGlvblxuICAgICAgZGlza1NpemU6IDEwMCxcbiAgICAgIFxuICAgICAgLy8gU2NhbGluZyBjb25maWd1cmF0aW9uXG4gICAgICBmb3JjZVVwZGF0ZTogdHJ1ZSxcbiAgICAgIFxuICAgICAgLy8gTGFiZWxzIGFuZCB0YWludHNcbiAgICAgIGxhYmVsczoge1xuICAgICAgICAnd29ya2xvYWQtdHlwZSc6ICdnZW5lcmFsJyxcbiAgICAgICAgJ25vZGUtZ3JvdXAnOiAncHJpbWFyeScsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gTUwvR1BVIE5vZGUgR3JvdXAgZm9yIE1MIHdvcmtsb2FkcyAob3B0aW9uYWwpXG4gICAgY29uc3QgbWxOb2RlR3JvdXAgPSB0aGlzLmNsdXN0ZXIuYWRkTm9kZWdyb3VwQ2FwYWNpdHkoJ01MTm9kZUdyb3VwJywge1xuICAgICAgaW5zdGFuY2VUeXBlczogW2VjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuUDMsIGVjMi5JbnN0YW5jZVNpemUuWExBUkdFMildLFxuICAgICAgbWluU2l6ZTogMCxcbiAgICAgIG1heFNpemU6IDUsXG4gICAgICBkZXNpcmVkU2l6ZTogMCwgLy8gU2NhbGUgdG8gMCBieSBkZWZhdWx0IHRvIHNhdmUgY29zdHNcbiAgICAgIG5vZGVSb2xlOiBub2RlR3JvdXBSb2xlLFxuICAgICAgXG4gICAgICBzdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGFtaVR5cGU6IGVrcy5Ob2RlZ3JvdXBBbWlUeXBlLkFMMl9YODZfNjRfR1BVLFxuICAgICAgY2FwYWNpdHlUeXBlOiBla3MuQ2FwYWNpdHlUeXBlLlNQT1QsIC8vIFVzZSBzcG90IGluc3RhbmNlcyBmb3IgY29zdCBvcHRpbWl6YXRpb25cbiAgICAgIGRpc2tTaXplOiAyMDAsXG4gICAgICBcbiAgICAgIGxhYmVsczoge1xuICAgICAgICAnd29ya2xvYWQtdHlwZSc6ICdtbCcsXG4gICAgICAgICdub2RlLWdyb3VwJzogJ21sJyxcbiAgICAgICAgJ252aWRpYS5jb20vZ3B1JzogJ3RydWUnLFxuICAgICAgfSxcbiAgICAgIFxuICAgICAgdGFpbnRzOiBbe1xuICAgICAgICBrZXk6ICdudmlkaWEuY29tL2dwdScsXG4gICAgICAgIHZhbHVlOiAndHJ1ZScsXG4gICAgICAgIGVmZmVjdDogZWtzLlRhaW50RWZmZWN0Lk5PX1NDSEVEVUxFLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBJbnN0YWxsIGVzc2VudGlhbCBhZGQtb25zXG4gICAgdGhpcy5pbnN0YWxsQWRkb25zKCk7XG5cbiAgICAvLyBDcmVhdGUgc2VydmljZSBhY2NvdW50cyBhbmQgUkJBQ1xuICAgIHRoaXMuY3JlYXRlU2VydmljZUFjY291bnRzKCk7XG5cbiAgICAvLyBPdXRwdXQgaW1wb3J0YW50IGluZm9ybWF0aW9uXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NsdXN0ZXJOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUtTIENsdXN0ZXIgTmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2x1c3RlckVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VLUyBDbHVzdGVyIEVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdFS1MgQ2x1c3RlciBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgSUQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0t1YmVjdGxDb21tYW5kJywge1xuICAgICAgdmFsdWU6IGBhd3MgZWtzIHVwZGF0ZS1rdWJlY29uZmlnIC0tcmVnaW9uICR7cHJvcHMucmVnaW9ufSAtLW5hbWUgJHtwcm9wcy5jbHVzdGVyTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDb21tYW5kIHRvIGNvbmZpZ3VyZSBrdWJlY3RsJyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgaW5zdGFsbEFkZG9ucygpOiB2b2lkIHtcbiAgICAvLyBBV1MgTG9hZCBCYWxhbmNlciBDb250cm9sbGVyXG4gICAgY29uc3QgYWxiQ29udHJvbGxlciA9IHRoaXMuY2x1c3Rlci5hZGRIZWxtQ2hhcnQoJ0FXU0xvYWRCYWxhbmNlckNvbnRyb2xsZXInLCB7XG4gICAgICBjaGFydDogJ2F3cy1sb2FkLWJhbGFuY2VyLWNvbnRyb2xsZXInLFxuICAgICAgcmVwb3NpdG9yeTogJ2h0dHBzOi8vYXdzLmdpdGh1Yi5pby9la3MtY2hhcnRzJyxcbiAgICAgIG5hbWVzcGFjZTogJ2t1YmUtc3lzdGVtJyxcbiAgICAgIHZhbHVlczoge1xuICAgICAgICBjbHVzdGVyTmFtZTogdGhpcy5jbHVzdGVyLmNsdXN0ZXJOYW1lLFxuICAgICAgICBzZXJ2aWNlQWNjb3VudDoge1xuICAgICAgICAgIGNyZWF0ZTogZmFsc2UsXG4gICAgICAgICAgbmFtZTogJ2F3cy1sb2FkLWJhbGFuY2VyLWNvbnRyb2xsZXInLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENsdXN0ZXIgQXV0b3NjYWxlclxuICAgIGNvbnN0IGNsdXN0ZXJBdXRvc2NhbGVyID0gdGhpcy5jbHVzdGVyLmFkZEhlbG1DaGFydCgnQ2x1c3RlckF1dG9zY2FsZXInLCB7XG4gICAgICBjaGFydDogJ2NsdXN0ZXItYXV0b3NjYWxlcicsXG4gICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLmdpdGh1Yi5pby9hdXRvc2NhbGVyJyxcbiAgICAgIG5hbWVzcGFjZTogJ2t1YmUtc3lzdGVtJyxcbiAgICAgIHZhbHVlczoge1xuICAgICAgICBhdXRvRGlzY292ZXJ5OiB7XG4gICAgICAgICAgY2x1c3Rlck5hbWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgYXdzUmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgcmJhYzoge1xuICAgICAgICAgIHNlcnZpY2VBY2NvdW50OiB7XG4gICAgICAgICAgICBjcmVhdGU6IGZhbHNlLFxuICAgICAgICAgICAgbmFtZTogJ2NsdXN0ZXItYXV0b3NjYWxlcicsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBNZXRyaWNzIFNlcnZlclxuICAgIGNvbnN0IG1ldHJpY3NTZXJ2ZXIgPSB0aGlzLmNsdXN0ZXIuYWRkSGVsbUNoYXJ0KCdNZXRyaWNzU2VydmVyJywge1xuICAgICAgY2hhcnQ6ICdtZXRyaWNzLXNlcnZlcicsXG4gICAgICByZXBvc2l0b3J5OiAnaHR0cHM6Ly9rdWJlcm5ldGVzLXNpZ3MuZ2l0aHViLmlvL21ldHJpY3Mtc2VydmVyLycsXG4gICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXG4gICAgfSk7XG5cbiAgICAvLyBDb250YWluZXIgSW5zaWdodHMgKENsb3VkV2F0Y2gpXG4gICAgY29uc3QgY29udGFpbmVySW5zaWdodHMgPSB0aGlzLmNsdXN0ZXIuYWRkTWFuaWZlc3QoJ0NvbnRhaW5lckluc2lnaHRzJywge1xuICAgICAgYXBpVmVyc2lvbjogJ3YxJyxcbiAgICAgIGtpbmQ6ICdOYW1lc3BhY2UnLFxuICAgICAgbWV0YWRhdGE6IHsgbmFtZTogJ2FtYXpvbi1jbG91ZHdhdGNoJyB9LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTZXJ2aWNlQWNjb3VudHMoKTogdm9pZCB7XG4gICAgLy8gQVdTIExvYWQgQmFsYW5jZXIgQ29udHJvbGxlciBTZXJ2aWNlIEFjY291bnRcbiAgICBjb25zdCBhbGJTZXJ2aWNlQWNjb3VudCA9IHRoaXMuY2x1c3Rlci5hZGRTZXJ2aWNlQWNjb3VudCgnQVdTTG9hZEJhbGFuY2VyQ29udHJvbGxlclNlcnZpY2VBY2NvdW50Jywge1xuICAgICAgbmFtZTogJ2F3cy1sb2FkLWJhbGFuY2VyLWNvbnRyb2xsZXInLFxuICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxuICAgIH0pO1xuXG4gICAgYWxiU2VydmljZUFjY291bnQucm9sZS5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBV1NMb2FkQmFsYW5jZXJDb250cm9sbGVySUFNUG9saWN5JylcbiAgICApO1xuXG4gICAgLy8gQ2x1c3RlciBBdXRvc2NhbGVyIFNlcnZpY2UgQWNjb3VudFxuICAgIGNvbnN0IGF1dG9zY2FsZXJTZXJ2aWNlQWNjb3VudCA9IHRoaXMuY2x1c3Rlci5hZGRTZXJ2aWNlQWNjb3VudCgnQ2x1c3RlckF1dG9zY2FsZXJTZXJ2aWNlQWNjb3VudCcsIHtcbiAgICAgIG5hbWU6ICdjbHVzdGVyLWF1dG9zY2FsZXInLFxuICAgICAgbmFtZXNwYWNlOiAna3ViZS1zeXN0ZW0nLFxuICAgIH0pO1xuXG4gICAgYXV0b3NjYWxlclNlcnZpY2VBY2NvdW50LmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2F1dG9zY2FsaW5nOkRlc2NyaWJlQXV0b1NjYWxpbmdHcm91cHMnLFxuICAgICAgICAnYXV0b3NjYWxpbmc6RGVzY3JpYmVBdXRvU2NhbGluZ0luc3RhbmNlcycsXG4gICAgICAgICdhdXRvc2NhbGluZzpEZXNjcmliZUxhdW5jaENvbmZpZ3VyYXRpb25zJyxcbiAgICAgICAgJ2F1dG9zY2FsaW5nOkRlc2NyaWJlVGFncycsXG4gICAgICAgICdhdXRvc2NhbGluZzpTZXREZXNpcmVkQ2FwYWNpdHknLFxuICAgICAgICAnYXV0b3NjYWxpbmc6VGVybWluYXRlSW5zdGFuY2VJbkF1dG9TY2FsaW5nR3JvdXAnLFxuICAgICAgICAnZWMyOkRlc2NyaWJlTGF1bmNoVGVtcGxhdGVWZXJzaW9ucycsXG4gICAgICAgICdlYzI6RGVzY3JpYmVJbWFnZXMnLFxuICAgICAgICAnZWMyOkdldEluc3RhbmNlVHlwZXNGcm9tSW5zdGFuY2VSZXF1aXJlbWVudHMnLFxuICAgICAgICAnZWtzOkRlc2NyaWJlTm9kZWdyb3VwJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggU2VydmljZSBBY2NvdW50IGZvciBsb2dnaW5nXG4gICAgY29uc3QgY2xvdWR3YXRjaFNlcnZpY2VBY2NvdW50ID0gdGhpcy5jbHVzdGVyLmFkZFNlcnZpY2VBY2NvdW50KCdDbG91ZFdhdGNoU2VydmljZUFjY291bnQnLCB7XG4gICAgICBuYW1lOiAnY2xvdWR3YXRjaC1hZ2VudCcsXG4gICAgICBuYW1lc3BhY2U6ICdhbWF6b24tY2xvdWR3YXRjaCcsXG4gICAgfSk7XG5cbiAgICBjbG91ZHdhdGNoU2VydmljZUFjY291bnQucm9sZS5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdDbG91ZFdhdGNoQWdlbnRTZXJ2ZXJQb2xpY3knKVxuICAgICk7XG5cbiAgICAvLyBFeHRlcm5hbCBETlMgU2VydmljZSBBY2NvdW50IChvcHRpb25hbClcbiAgICBjb25zdCBleHRlcm5hbERuc1NlcnZpY2VBY2NvdW50ID0gdGhpcy5jbHVzdGVyLmFkZFNlcnZpY2VBY2NvdW50KCdFeHRlcm5hbEROU1NlcnZpY2VBY2NvdW50Jywge1xuICAgICAgbmFtZTogJ2V4dGVybmFsLWRucycsXG4gICAgICBuYW1lc3BhY2U6ICdrdWJlLXN5c3RlbScsXG4gICAgfSk7XG5cbiAgICBleHRlcm5hbERuc1NlcnZpY2VBY2NvdW50LmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3JvdXRlNTM6Q2hhbmdlUmVzb3VyY2VSZWNvcmRTZXRzJyxcbiAgICAgICAgJ3JvdXRlNTM6TGlzdEhvc3RlZFpvbmVzJyxcbiAgICAgICAgJ3JvdXRlNTM6TGlzdFJlc291cmNlUmVjb3JkU2V0cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG4gIH1cbn0iXX0=