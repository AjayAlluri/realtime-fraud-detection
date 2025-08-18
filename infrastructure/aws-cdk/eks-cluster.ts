import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface EksClusterProps extends cdk.StackProps {
  clusterName: string;
  region: string;
  kubernetesVersion: eks.KubernetesVersion;
  nodeInstanceTypes: ec2.InstanceType[];
  minSize: number;
  maxSize: number;
  desiredSize: number;
  enableLogging?: boolean;
  enablePrivateEndpoint?: boolean;
}

export class EksClusterStack extends cdk.Stack {
  public readonly cluster: eks.Cluster;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: EksClusterProps) {
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
      defaultCapacity: 0, // We'll add managed node groups separately
      
      // Security and access
      endpointAccess: props.enablePrivateEndpoint 
        ? eks.EndpointAccess.PRIVATE 
        : eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      
      // Encryption
      secretsEncryptionKey: clusterKmsKey,
      
      // Logging (at least API logging is required)
      clusterLogging: props.enableLogging ? [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.SCHEDULER,
      ] : [
        eks.ClusterLoggingTypes.API, // Minimum required logging
      ],

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
      desiredSize: 0, // Scale to 0 by default to save costs
      nodeRole: nodeGroupRole,
      
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      amiType: eks.NodegroupAmiType.AL2_X86_64_GPU,
      capacityType: eks.CapacityType.SPOT, // Use spot instances for cost optimization
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

  private installAddons(): void {
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

  private createServiceAccounts(): void {
    // AWS Load Balancer Controller Service Account
    const albServiceAccount = this.cluster.addServiceAccount('AWSLoadBalancerControllerServiceAccount', {
      name: 'aws-load-balancer-controller',
      namespace: 'kube-system',
    });

    albServiceAccount.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLoadBalancerControllerIAMPolicy')
    );

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

    cloudwatchServiceAccount.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

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