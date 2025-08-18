import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as msk from 'aws-cdk-lib/aws-msk';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import { Construct } from 'constructs';

export interface ManagedServicesProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  environmentName: string;
  enableEncryption?: boolean;
  enableBackups?: boolean;
  multiAz?: boolean;
}

export class ManagedServicesStack extends cdk.Stack {
  public readonly rdsCluster: rds.DatabaseCluster;
  public readonly redisCluster: elasticache.CfnReplicationGroup;
  public readonly mskCluster: msk.CfnCluster;
  public readonly dataLake: s3.Bucket;
  public readonly modelBucket: s3.Bucket;
  public readonly kinesisStream: kinesis.Stream;

  constructor(scope: Construct, id: string, props: ManagedServicesProps) {
    super(scope, id, props);

    const { vpc, environmentName, enableEncryption = true, enableBackups = true, multiAz = true } = props;

    // Create KMS keys for encryption
    const rdsKmsKey = new kms.Key(this, 'RdsKmsKey', {
      description: 'KMS key for RDS encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const s3KmsKey = new kms.Key(this, 'S3KmsKey', {
      description: 'KMS key for S3 encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create S3 buckets for data lake and model storage
    this.createS3Buckets(s3KmsKey, environmentName, enableEncryption);

    // Create RDS PostgreSQL cluster for metadata and configuration
    this.createRdsCluster(vpc, rdsKmsKey, environmentName, enableEncryption, enableBackups, multiAz);

    // Create ElastiCache Redis cluster for caching
    this.createRedisCluster(vpc, environmentName);

    // Create MSK (Managed Kafka) cluster
    this.createMskCluster(vpc, environmentName, enableEncryption);

    // Create Kinesis Data Streams for real-time ingestion
    this.createKinesisStreams(environmentName);

    // Create SageMaker resources
    this.createSageMakerResources(environmentName);

    // Output connection information
    this.createOutputs();
  }

  private createS3Buckets(kmsKey: kms.Key, environmentName: string, enableEncryption: boolean): void {
    // Data Lake bucket for storing transaction data, logs, and analytics
    this.dataLake = new s3.Bucket(this, 'DataLakeBucket', {
      bucketName: `fraud-detection-data-lake-${environmentName}-${this.account}`,
      versioned: true,
      encryption: enableEncryption ? s3.BucketEncryption.KMS : s3.BucketEncryption.S3_MANAGED,
      encryptionKey: enableEncryption ? kmsKey : undefined,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Model storage bucket for ML models and artifacts
    this.modelBucket = new s3.Bucket(this, 'ModelBucket', {
      bucketName: `fraud-detection-models-${environmentName}-${this.account}`,
      versioned: true,
      encryption: enableEncryption ? s3.BucketEncryption.KMS : s3.BucketEncryption.S3_MANAGED,
      encryptionKey: enableEncryption ? kmsKey : undefined,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'ModelVersioning',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create folders in data lake bucket
    const dataLakeFolders = [
      'raw-transactions/',
      'processed-transactions/',
      'feature-store/',
      'model-training-data/',
      'model-predictions/',
      'audit-logs/',
      'system-metrics/',
    ];

    dataLakeFolders.forEach((folder, index) => {
      new s3deploy.BucketDeployment(this, `DataLakeFolder${index}`, {
        sources: [s3deploy.Source.data(folder, '')],
        destinationBucket: this.dataLake,
        destinationKeyPrefix: folder,
      });
    });
  }

  private createRdsCluster(
    vpc: ec2.Vpc, 
    kmsKey: kms.Key, 
    environmentName: string, 
    enableEncryption: boolean, 
    enableBackups: boolean, 
    multiAz: boolean
  ): void {
    // Create DB subnet group
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      description: 'Subnet group for fraud detection RDS cluster',
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Security group for fraud detection RDS cluster',
      allowAllOutbound: false,
    });

    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from VPC'
    );

    // Create database credentials secret
    const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: `fraud-detection-db-credentials-${environmentName}`,
      description: 'Database credentials for fraud detection system',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'fraud_admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        passwordLength: 32,
      },
    });

    // Create RDS Aurora PostgreSQL cluster
    this.rdsCluster = new rds.DatabaseCluster(this, 'FraudDetectionDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_3,
      }),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      
      // Instance configuration
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
        publiclyAccessible: false,
      }),
      readers: multiAz ? [
        rds.ClusterInstance.provisioned('reader1', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
          publiclyAccessible: false,
        }),
      ] : [],

      // Network configuration
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      
      // Storage and encryption
      storageEncrypted: enableEncryption,
      storageEncryptionKey: enableEncryption ? kmsKey : undefined,
      
      // Backup configuration
      backup: enableBackups ? {
        retention: cdk.Duration.days(7),
        preferredWindow: '03:00-04:00',
      } : undefined,
      
      // Maintenance
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      
      // Monitoring
      monitoring: {
        interval: cdk.Duration.seconds(60),
      },
      
      // Database configuration
      defaultDatabaseName: 'fraud_detection',
      parameters: {
        'log_statement': 'all',
        'log_min_duration_statement': '1000',
        'shared_preload_libraries': 'pg_stat_statements',
      },
      
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createRedisCluster(vpc: ec2.Vpc, environmentName: string): void {
    // Create subnet group for ElastiCache
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Subnet group for fraud detection Redis cluster',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
    });

    // Create security group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for fraud detection Redis cluster',
      allowAllOutbound: false,
    });

    redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from VPC'
    );

    // Create Redis replication group
    this.redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
      replicationGroupDescription: 'Redis cluster for fraud detection caching',
      replicationGroupId: `fraud-detection-redis-${environmentName}`,
      
      // Node configuration
      cacheNodeType: 'cache.r7g.large',
      numCacheClusters: 3,
      engine: 'redis',
      engineVersion: '7.0',
      
      // Network configuration
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
      
      // High availability
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      
      // Backup and maintenance
      snapshotRetentionLimit: 5,
      snapshotWindow: '03:00-05:00',
      preferredMaintenanceWindow: 'sun:05:00-sun:07:00',
      
      // Security
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      
      // Performance
      cacheParameterGroupName: 'default.redis7',
      
      // Notifications
      notificationTopicArn: undefined, // Can be configured later
    });
  }

  private createMskCluster(vpc: ec2.Vpc, environmentName: string, enableEncryption: boolean): void {
    // Create security group for MSK
    const mskSecurityGroup = new ec2.SecurityGroup(this, 'MskSecurityGroup', {
      vpc,
      description: 'Security group for fraud detection MSK cluster',
      allowAllOutbound: false,
    });

    mskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(9092),
      'Allow Kafka plaintext access from VPC'
    );

    mskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(9094),
      'Allow Kafka TLS access from VPC'
    );

    mskSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(2181),
      'Allow ZooKeeper access from VPC'
    );

    // Create MSK configuration
    const mskConfiguration = new msk.CfnConfiguration(this, 'MskConfiguration', {
      name: `fraud-detection-msk-config-${environmentName}`,
      description: 'MSK configuration for fraud detection system',
      kafkaVersionsList: ['2.8.1'],
      serverProperties: [
        'auto.create.topics.enable=false',
        'default.replication.factor=3',
        'min.insync.replicas=2',
        'num.partitions=12',
        'compression.type=snappy',
        'log.retention.hours=168',
        'log.segment.bytes=1073741824',
        'log.retention.check.interval.ms=300000',
        'message.max.bytes=1000000',
        'replica.fetch.max.bytes=1048576',
        'group.initial.rebalance.delay.ms=3000',
      ].join('\n'),
    });

    // Create MSK cluster
    this.mskCluster = new msk.CfnCluster(this, 'MskCluster', {
      clusterName: `fraud-detection-msk-${environmentName}`,
      kafkaVersion: '2.8.1',
      numberOfBrokerNodes: 3,
      
      // Broker configuration
      brokerNodeGroupInfo: {
        instanceType: 'kafka.m5.large',
        clientSubnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroups: [mskSecurityGroup.securityGroupId],
        storageInfo: {
          ebsStorageInfo: {
            volumeSize: 100,
          },
        },
      },
      
      // Configuration
      configurationInfo: {
        arn: mskConfiguration.attrArn,
        revision: 1,
      },
      
      // Encryption
      encryptionInfo: enableEncryption ? {
        encryptionAtRest: {
          dataVolumeKmsKeyId: 'alias/aws/kafka',
        },
        encryptionInTransit: {
          clientBroker: 'TLS',
          inCluster: true,
        },
      } : undefined,
      
      // Enhanced monitoring
      enhancedMonitoring: 'PER_BROKER',
      
      // Logging
      loggingInfo: {
        brokerLogs: {
          cloudWatchLogs: {
            enabled: true,
            logGroup: `/aws/msk/fraud-detection-${environmentName}`,
          },
          s3: {
            enabled: true,
            bucket: this.dataLake.bucketName,
            prefix: 'msk-logs/',
          },
        },
      },
      
      // Client authentication
      clientAuthentication: {
        tls: {
          certificateAuthorityArnList: [], // Configure certificate authorities as needed
        },
        sasl: {
          scram: {
            enabled: true,
          },
        },
      },
    });
  }

  private createKinesisStreams(environmentName: string): void {
    // Main transaction stream
    this.kinesisStream = new kinesis.Stream(this, 'TransactionStream', {
      streamName: `fraud-detection-transactions-${environmentName}`,
      shardCount: 10,
      retentionPeriod: cdk.Duration.hours(24),
      encryption: kinesis.StreamEncryption.KMS,
      encryptionKey: kms.Alias.fromAliasName(this, 'KinesisKmsAlias', 'alias/aws/kinesis'),
    });

    // Additional streams for different data types
    const fraudAlertsStream = new kinesis.Stream(this, 'FraudAlertsStream', {
      streamName: `fraud-detection-alerts-${environmentName}`,
      shardCount: 2,
      retentionPeriod: cdk.Duration.hours(168), // 7 days
      encryption: kinesis.StreamEncryption.KMS,
    });

    const modelMetricsStream = new kinesis.Stream(this, 'ModelMetricsStream', {
      streamName: `fraud-detection-model-metrics-${environmentName}`,
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
      encryption: kinesis.StreamEncryption.KMS,
    });
  }

  private createSageMakerResources(environmentName: string): void {
    // SageMaker execution role
    const sagemakerRole = new iam.Role(this, 'SageMakerExecutionRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });

    // Grant access to S3 buckets
    this.dataLake.grantReadWrite(sagemakerRole);
    this.modelBucket.grantReadWrite(sagemakerRole);

    // SageMaker Model Registry
    const modelPackageGroup = new sagemaker.CfnModelPackageGroup(this, 'FraudDetectionModelGroup', {
      modelPackageGroupName: `fraud-detection-models-${environmentName}`,
      modelPackageGroupDescription: 'Model package group for fraud detection models',
    });

    // Output SageMaker information
    new cdk.CfnOutput(this, 'SageMakerModelGroup', {
      value: modelPackageGroup.modelPackageGroupName,
      description: 'SageMaker Model Package Group Name',
    });
  }

  private createOutputs(): void {
    // RDS outputs
    new cdk.CfnOutput(this, 'RdsClusterEndpoint', {
      value: this.rdsCluster.clusterEndpoint.hostname,
      description: 'RDS Cluster Endpoint',
    });

    new cdk.CfnOutput(this, 'RdsClusterReadEndpoint', {
      value: this.rdsCluster.clusterReadEndpoint.hostname,
      description: 'RDS Cluster Read Endpoint',
    });

    // Redis outputs
    new cdk.CfnOutput(this, 'RedisClusterEndpoint', {
      value: this.redisCluster.attrPrimaryEndPointAddress,
      description: 'Redis Cluster Primary Endpoint',
    });

    new cdk.CfnOutput(this, 'RedisClusterPort', {
      value: this.redisCluster.attrPrimaryEndPointPort.toString(),
      description: 'Redis Cluster Port',
    });

    // MSK outputs
    new cdk.CfnOutput(this, 'MskClusterArn', {
      value: this.mskCluster.ref,
      description: 'MSK Cluster ARN',
    });

    // S3 outputs
    new cdk.CfnOutput(this, 'DataLakeBucketName', {
      value: this.dataLake.bucketName,
      description: 'Data Lake S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'ModelBucketName', {
      value: this.modelBucket.bucketName,
      description: 'Model Storage S3 Bucket Name',
    });

    // Kinesis outputs
    new cdk.CfnOutput(this, 'TransactionStreamName', {
      value: this.kinesisStream.streamName,
      description: 'Kinesis Transaction Stream Name',
    });

    new cdk.CfnOutput(this, 'TransactionStreamArn', {
      value: this.kinesisStream.streamArn,
      description: 'Kinesis Transaction Stream ARN',
    });
  }
}