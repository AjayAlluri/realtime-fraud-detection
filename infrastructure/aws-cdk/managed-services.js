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
exports.ManagedServicesStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const rds = __importStar(require("aws-cdk-lib/aws-rds"));
const elasticache = __importStar(require("aws-cdk-lib/aws-elasticache"));
const msk = __importStar(require("aws-cdk-lib/aws-msk"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const kinesis = __importStar(require("aws-cdk-lib/aws-kinesis"));
const sagemaker = __importStar(require("aws-cdk-lib/aws-sagemaker"));
class ManagedServicesStack extends cdk.Stack {
    constructor(scope, id, props) {
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
    createS3Buckets(kmsKey, environmentName, enableEncryption) {
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
        // Note: S3 folders will be created automatically when objects are uploaded to them
        // No need to explicitly create empty folders as S3 is object-based storage
    }
    createRdsCluster(vpc, kmsKey, environmentName, enableEncryption, enableBackups, multiAz) {
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
        dbSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow PostgreSQL access from VPC');
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
                version: rds.AuroraPostgresEngineVersion.VER_14_6,
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
    createRedisCluster(vpc, environmentName) {
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
        redisSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(6379), 'Allow Redis access from VPC');
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
    createMskCluster(vpc, environmentName, enableEncryption) {
        // Create security group for MSK
        const mskSecurityGroup = new ec2.SecurityGroup(this, 'MskSecurityGroup', {
            vpc,
            description: 'Security group for fraud detection MSK cluster',
            allowAllOutbound: false,
        });
        mskSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(9092), 'Allow Kafka plaintext access from VPC');
        mskSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(9094), 'Allow Kafka TLS access from VPC');
        mskSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(2181), 'Allow ZooKeeper access from VPC');
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
    createKinesisStreams(environmentName) {
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
            retentionPeriod: cdk.Duration.hours(168),
            encryption: kinesis.StreamEncryption.KMS,
        });
        const modelMetricsStream = new kinesis.Stream(this, 'ModelMetricsStream', {
            streamName: `fraud-detection-model-metrics-${environmentName}`,
            shardCount: 1,
            retentionPeriod: cdk.Duration.hours(24),
            encryption: kinesis.StreamEncryption.KMS,
        });
    }
    createSageMakerResources(environmentName) {
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
    createOutputs() {
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
exports.ManagedServicesStack = ManagedServicesStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlZC1zZXJ2aWNlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1hbmFnZWQtc2VydmljZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5RUFBMkQ7QUFDM0QseURBQTJDO0FBQzNDLHVEQUF5QztBQUV6Qyx5REFBMkM7QUFDM0MsK0VBQWlFO0FBQ2pFLHlEQUEyQztBQUMzQyxpRUFBbUQ7QUFDbkQscUVBQXVEO0FBV3ZELE1BQWEsb0JBQXFCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFRakQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsR0FBRyxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsR0FBRyxJQUFJLEVBQUUsYUFBYSxHQUFHLElBQUksRUFBRSxPQUFPLEdBQUcsSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXRHLGlDQUFpQztRQUNqQyxNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUMvQyxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUN6QyxDQUFDLENBQUM7UUFFSCxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUM3QyxXQUFXLEVBQUUsMkJBQTJCO1lBQ3hDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUN6QyxDQUFDLENBQUM7UUFFSCxvREFBb0Q7UUFDcEQsSUFBSSxDQUFD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QVEsQ0FBQyxVQUFVO1lBQy9CLFdBQVcsRUFBRSwwQkFBMEI7U0FDeEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxVQUFVO1lBQ2xDLFdBQVcsRUFBRSw4QkFBOEI7U0FDNUMsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBQ2xCLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVTtZQUNwQyxXQUFXLEVBQUUsaUNBQWlDO1NBQy9DLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUztZQUNuQyxXQUFXLEVBQUUsZ0NBQWdDO1NBQzlDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdjRCxvREE2Y0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJztcbmltcG9ydCAqIGFzIG1zayBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbXNrJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuaW1wb3J0ICogYXMga2luZXNpcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta2luZXNpcyc7XG5pbXBvcnQgKiBhcyBzYWdlbWFrZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNhZ2VtYWtlcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBNYW5hZ2VkU2VydmljZXNQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjOiBlYzIuVnBjO1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcbiAgZW5hYmxlRW5jcnlwdGlvbj86IGJvb2xlYW47XG4gIGVuYWJsZUJhY2t1cHM/OiBib29sZWFuO1xuICBtdWx0aUF6PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIE1hbmFnZWRTZXJ2aWNlc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJkc0NsdXN0ZXIhOiByZHMuRGF0YWJhc2VDbHVzdGVyO1xuICBwdWJsaWMgcmVkaXNDbHVzdGVyITogZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cDtcbiAgcHVibGljIG1za0NsdXN0ZXIhOiBtc2suQ2ZuQ2x1c3RlcjtcbiAgcHVibGljIGRhdGFMYWtlITogczMuQnVja2V0O1xuICBwdWJsaWMgbW9kZWxCdWNrZXQhOiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyBraW5lc2lzU3RyZWFtIToga2luZXNpcy5TdHJlYW07XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE1hbmFnZWRTZXJ2aWNlc1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IHZwYywgZW52aXJvbm1lbnROYW1lLCBlbmFibGVFbmNyeXB0aW9uID0gdHJ1ZSwgZW5hYmxlQmFja3VwcyA9IHRydWUsIG11bHRpQXogPSB0cnVlIH0gPSBwcm9wcztcblxuICAgIC8vIENyZWF0ZSBLTVMga2V5cyBmb3IgZW5jcnlwdGlvblxuICAgIGNvbnN0IHJkc0ttc0tleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdSZHNLbXNLZXknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIFJEUyBlbmNyeXB0aW9uJyxcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHMzS21zS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ1MzS21zS2V5Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBTMyBlbmNyeXB0aW9uJyxcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBTMyBidWNrZXRzIGZvciBkYXRhIGxha2UgYW5kIG1vZGVsIHN0b3JhZ2VcbiAgICB0aGlzLmNyZWF0ZVMzQnVja2V0cyhzM0ttc0tleSwgZW52aXJvbm1lbnROYW1lLCBlbmFibGVFbmNyeXB0aW9uKTtcblxuICAgIC8vIENyZWF0ZSBSRFMgUG9zdGdyZVNRTCBjbHVzdGVyIGZvciBtZXRhZGF0YSBhbmQgY29uZmlndXJhdGlvblxuICAgIHRoaXMuY3JlYXRlUmRzQ2x1c3Rlcih2cGMsIHJkc0ttc0tleSwgZW52aXJvbm1lbnROYW1lLCBlbmFibGVFbmNyeXB0aW9uLCBlbmFibGVCYWNrdXBzLCBtdWx0aUF6KTtcblxuICAgIC8vIENyZWF0ZSBFbGFzdGlDYWNoZSBSZWRpcyBjbHVzdGVyIGZvciBjYWNoaW5nXG4gICAgdGhpcy5jcmVhdGVSZWRpc0NsdXN0ZXIodnBjLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQ3JlYXRlIE1TSyAoTWFuYWdlZCBLYWZrYSkgY2x1c3RlclxuICAgIHRoaXMuY3JlYXRlTXNrQ2x1c3Rlcih2cGMsIGVudmlyb25tZW50TmFtZSwgZW5hYmxlRW5jcnlwdGlvbik7XG5cbiAgICAvLyBDcmVhdGUgS2luZXNpcyBEYXRhIFN0cmVhbXMgZm9yIHJlYWwtdGltZSBpbmdlc3Rpb25cbiAgICB0aGlzLmNyZWF0ZUtpbmVzaXNTdHJlYW1zKGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBDcmVhdGUgU2FnZU1ha2VyIHJlc291cmNlc1xuICAgIHRoaXMuY3JlYXRlU2FnZU1ha2VyUmVzb3VyY2VzKGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBPdXRwdXQgY29ubmVjdGlvbiBpbmZvcm1hdGlvblxuICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTM0J1Y2tldHMoa21zS2V5OiBrbXMuS2V5LCBlbnZpcm9ubWVudE5hbWU6IHN0cmluZywgZW5hYmxlRW5jcnlwdGlvbjogYm9vbGVhbik6IHZvaWQge1xuICAgIC8vIERhdGEgTGFrZSBidWNrZXQgZm9yIHN0b3JpbmcgdHJhbnNhY3Rpb24gZGF0YSwgbG9ncywgYW5kIGFuYWx5dGljc1xuICAgIHRoaXMuZGF0YUxha2UgPSBuZXcgczMuQnVja2V0KHRoaXMsICdEYXRhTGFrZUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBmcmF1ZC1kZXRlY3Rpb24tZGF0YS1sYWtlLSR7ZW52aXJvbm1lbnROYW1lfS0ke3RoaXMuYWNjb3VudH1gLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogZW5hYmxlRW5jcnlwdGlvbiA/IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TIDogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogZW5hYmxlRW5jcnlwdGlvbiA/IGttc0tleSA6IHVuZGVmaW5lZCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdUcmFuc2l0aW9uVG9JQScsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzMCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkRFRVBfQVJDSElWRSxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzNjUpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBNb2RlbCBzdG9yYWdlIGJ1Y2tldCBmb3IgTUwgbW9kZWxzIGFuZCBhcnRpZmFjdHNcbiAgICB0aGlzLm1vZGVsQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnTW9kZWxCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgZnJhdWQtZGV0ZWN0aW9uLW1vZGVscy0ke2Vudmlyb25tZW50TmFtZX0tJHt0aGlzLmFjY291bnR9YCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IGVuYWJsZUVuY3J5cHRpb24gPyBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyA6IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGVuY3J5cHRpb25LZXk6IGVuYWJsZUVuY3J5cHRpb24gPyBrbXNLZXkgOiB1bmRlZmluZWQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnTW9kZWxWZXJzaW9uaW5nJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBOb3RlOiBTMyBmb2xkZXJzIHdpbGwgYmUgY3JlYXRlZCBhdXRvbWF0aWNhbGx5IHdoZW4gb2JqZWN0cyBhcmUgdXBsb2FkZWQgdG8gdGhlbVxuICAgIC8vIE5vIG5lZWQgdG8gZXhwbGljaXRseSBjcmVhdGUgZW1wdHkgZm9sZGVycyBhcyBTMyBpcyBvYmplY3QtYmFzZWQgc3RvcmFnZVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVSZHNDbHVzdGVyKFxuICAgIHZwYzogZWMyLlZwYywgXG4gICAga21zS2V5OiBrbXMuS2V5LCBcbiAgICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZywgXG4gICAgZW5hYmxlRW5jcnlwdGlvbjogYm9vbGVhbiwgXG4gICAgZW5hYmxlQmFja3VwczogYm9vbGVhbiwgXG4gICAgbXVsdGlBejogYm9vbGVhblxuICApOiB2b2lkIHtcbiAgICAvLyBDcmVhdGUgREIgc3VibmV0IGdyb3VwXG4gICAgY29uc3QgZGJTdWJuZXRHcm91cCA9IG5ldyByZHMuU3VibmV0R3JvdXAodGhpcywgJ0RiU3VibmV0R3JvdXAnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1N1Ym5ldCBncm91cCBmb3IgZnJhdWQgZGV0ZWN0aW9uIFJEUyBjbHVzdGVyJyxcbiAgICAgIHZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIHNlY3VyaXR5IGdyb3VwIGZvciBSRFNcbiAgICBjb25zdCBkYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0RiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIGZyYXVkIGRldGVjdGlvbiBSRFMgY2x1c3RlcicsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIGRiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQodnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoNTQzMiksXG4gICAgICAnQWxsb3cgUG9zdGdyZVNRTCBhY2Nlc3MgZnJvbSBWUEMnXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBkYXRhYmFzZSBjcmVkZW50aWFscyBzZWNyZXRcbiAgICBjb25zdCBkYkNyZWRlbnRpYWxzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnRGJDcmVkZW50aWFscycsIHtcbiAgICAgIHNlY3JldE5hbWU6IGBmcmF1ZC1kZXRlY3Rpb24tZGItY3JlZGVudGlhbHMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGF0YWJhc2UgY3JlZGVudGlhbHMgZm9yIGZyYXVkIGRldGVjdGlvbiBzeXN0ZW0nLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHsgdXNlcm5hbWU6ICdmcmF1ZF9hZG1pbicgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAncGFzc3dvcmQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcXFwnJyxcbiAgICAgICAgcGFzc3dvcmRMZW5ndGg6IDMyLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBSRFMgQXVyb3JhIFBvc3RncmVTUUwgY2x1c3RlclxuICAgIHRoaXMucmRzQ2x1c3RlciA9IG5ldyByZHMuRGF0YWJhc2VDbHVzdGVyKHRoaXMsICdGcmF1ZERldGVjdGlvbkRiJywge1xuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYVBvc3RncmVzKHtcbiAgICAgICAgdmVyc2lvbjogcmRzLkF1cm9yYVBvc3RncmVzRW5naW5lVmVyc2lvbi5WRVJfMTRfNixcbiAgICAgIH0pLFxuICAgICAgY3JlZGVudGlhbHM6IHJkcy5DcmVkZW50aWFscy5mcm9tU2VjcmV0KGRiQ3JlZGVudGlhbHMpLFxuICAgICAgXG4gICAgICAvLyBJbnN0YW5jZSBjb25maWd1cmF0aW9uXG4gICAgICB3cml0ZXI6IHJkcy5DbHVzdGVySW5zdGFuY2UucHJvdmlzaW9uZWQoJ3dyaXRlcicsIHtcbiAgICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlI2RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSksXG4gICAgICAgIHB1YmxpY2x5QWNjZXNzaWJsZTogZmFsc2UsXG4gICAgICB9KSxcbiAgICAgIHJlYWRlcnM6IG11bHRpQXogPyBbXG4gICAgICAgIHJkcy5DbHVzdGVySW5zdGFuY2UucHJvdmlzaW9uZWQoJ3JlYWRlcjEnLCB7XG4gICAgICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlI2RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSksXG4gICAgICAgICAgcHVibGljbHlBY2Nlc3NpYmxlOiBmYWxzZSxcbiAgICAgICAgfSksXG4gICAgICBdIDogW10sXG5cbiAgICAgIC8vIE5ldHdvcmsgY29uZmlndXJhdGlvblxuICAgICAgdnBjLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEIH0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW2RiU2VjdXJpdHlHcm91cF0sXG4gICAgICBcbiAgICAgIC8vIFN0b3JhZ2UgYW5kIGVuY3J5cHRpb25cbiAgICAgIHN0b3JhZ2VFbmNyeXB0ZWQ6IGVuYWJsZUVuY3J5cHRpb24sXG4gICAgICBzdG9yYWdlRW5jcnlwdGlvbktleTogZW5hYmxlRW5jcnlwdGlvbiA/IGttc0tleSA6IHVuZGVmaW5lZCxcbiAgICAgIFxuICAgICAgLy8gQmFja3VwIGNvbmZpZ3VyYXRpb25cbiAgICAgIGJhY2t1cDogZW5hYmxlQmFja3VwcyA/IHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgICAgcHJlZmVycmVkV2luZG93OiAnMDM6MDAtMDQ6MDAnLFxuICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgIFxuICAgICAgLy8gTWFpbnRlbmFuY2VcbiAgICAgIHByZWZlcnJlZE1haW50ZW5hbmNlV2luZG93OiAnc3VuOjA0OjAwLXN1bjowNTowMCcsXG4gICAgICBcbiAgICAgIC8vIERhdGFiYXNlIGNvbmZpZ3VyYXRpb25cbiAgICAgIGRlZmF1bHREYXRhYmFzZU5hbWU6ICdmcmF1ZF9kZXRlY3Rpb24nLFxuICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAnbG9nX3N0YXRlbWVudCc6ICdhbGwnLFxuICAgICAgICAnbG9nX21pbl9kdXJhdGlvbl9zdGF0ZW1lbnQnOiAnMTAwMCcsXG4gICAgICAgICdzaGFyZWRfcHJlbG9hZF9saWJyYXJpZXMnOiAncGdfc3RhdF9zdGF0ZW1lbnRzJyxcbiAgICAgIH0sXG4gICAgICBcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVJlZGlzQ2x1c3Rlcih2cGM6IGVjMi5WcGMsIGVudmlyb25tZW50TmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgLy8gQ3JlYXRlIHN1Ym5ldCBncm91cCBmb3IgRWxhc3RpQ2FjaGVcbiAgICBjb25zdCBjYWNoZVN1Ym5ldEdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwKHRoaXMsICdDYWNoZVN1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdWJuZXQgZ3JvdXAgZm9yIGZyYXVkIGRldGVjdGlvbiBSZWRpcyBjbHVzdGVyJyxcbiAgICAgIHN1Ym5ldElkczogdnBjLnByaXZhdGVTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBzZWN1cml0eSBncm91cCBmb3IgUmVkaXNcbiAgICBjb25zdCByZWRpc1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1JlZGlzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIGZyYXVkIGRldGVjdGlvbiBSZWRpcyBjbHVzdGVyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgcmVkaXNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuaXB2NCh2cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg2Mzc5KSxcbiAgICAgICdBbGxvdyBSZWRpcyBhY2Nlc3MgZnJvbSBWUEMnXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBSZWRpcyByZXBsaWNhdGlvbiBncm91cFxuICAgIHRoaXMucmVkaXNDbHVzdGVyID0gbmV3IGVsYXN0aWNhY2hlLkNmblJlcGxpY2F0aW9uR3JvdXAodGhpcywgJ1JlZGlzQ2x1c3RlcicsIHtcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBEZXNjcmlwdGlvbjogJ1JlZGlzIGNsdXN0ZXIgZm9yIGZyYXVkIGRldGVjdGlvbiBjYWNoaW5nJyxcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBJZDogYGZyYXVkLWRldGVjdGlvbi1yZWRpcy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgXG4gICAgICAvLyBOb2RlIGNvbmZpZ3VyYXRpb25cbiAgICAgIGNhY2hlTm9kZVR5cGU6ICdjYWNoZS5yN2cubGFyZ2UnLFxuICAgICAgbnVtQ2FjaGVDbHVzdGVyczogMyxcbiAgICAgIGVuZ2luZTogJ3JlZGlzJyxcbiAgICAgIGVuZ2luZVZlcnNpb246ICc3LjAnLFxuICAgICAgXG4gICAgICAvLyBOZXR3b3JrIGNvbmZpZ3VyYXRpb25cbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiBjYWNoZVN1Ym5ldEdyb3VwLnJlZixcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IFtyZWRpc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSxcbiAgICAgIFxuICAgICAgLy8gSGlnaCBhdmFpbGFiaWxpdHlcbiAgICAgIGF1dG9tYXRpY0ZhaWxvdmVyRW5hYmxlZDogdHJ1ZSxcbiAgICAgIG11bHRpQXpFbmFibGVkOiB0cnVlLFxuICAgICAgXG4gICAgICAvLyBCYWNrdXAgYW5kIG1haW50ZW5hbmNlXG4gICAgICBzbmFwc2hvdFJldGVudGlvbkxpbWl0OiA1LFxuICAgICAgc25hcHNob3RXaW5kb3c6ICcwMzowMC0wNTowMCcsXG4gICAgICBwcmVmZXJyZWRNYWludGVuYW5jZVdpbmRvdzogJ3N1bjowNTowMC1zdW46MDc6MDAnLFxuICAgICAgXG4gICAgICAvLyBTZWN1cml0eVxuICAgICAgYXRSZXN0RW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICB0cmFuc2l0RW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICBcbiAgICAgIC8vIFBlcmZvcm1hbmNlXG4gICAgICBjYWNoZVBhcmFtZXRlckdyb3VwTmFtZTogJ2RlZmF1bHQucmVkaXM3JyxcbiAgICAgIFxuICAgICAgLy8gTm90aWZpY2F0aW9uc1xuICAgICAgbm90aWZpY2F0aW9uVG9waWNBcm46IHVuZGVmaW5lZCwgLy8gQ2FuIGJlIGNvbmZpZ3VyZWQgbGF0ZXJcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTXNrQ2x1c3Rlcih2cGM6IGVjMi5WcGMsIGVudmlyb25tZW50TmFtZTogc3RyaW5nLCBlbmFibGVFbmNyeXB0aW9uOiBib29sZWFuKTogdm9pZCB7XG4gICAgLy8gQ3JlYXRlIHNlY3VyaXR5IGdyb3VwIGZvciBNU0tcbiAgICBjb25zdCBtc2tTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdNc2tTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgZnJhdWQgZGV0ZWN0aW9uIE1TSyBjbHVzdGVyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgbXNrU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQodnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoOTA5MiksXG4gICAgICAnQWxsb3cgS2Fma2EgcGxhaW50ZXh0IGFjY2VzcyBmcm9tIFZQQydcbiAgICApO1xuXG4gICAgbXNrU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQodnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoOTA5NCksXG4gICAgICAnQWxsb3cgS2Fma2EgVExTIGFjY2VzcyBmcm9tIFZQQydcbiAgICApO1xuXG4gICAgbXNrU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQodnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoMjE4MSksXG4gICAgICAnQWxsb3cgWm9vS2VlcGVyIGFjY2VzcyBmcm9tIFZQQydcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIE1TSyBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgbXNrQ29uZmlndXJhdGlvbiA9IG5ldyBtc2suQ2ZuQ29uZmlndXJhdGlvbih0aGlzLCAnTXNrQ29uZmlndXJhdGlvbicsIHtcbiAgICAgIG5hbWU6IGBmcmF1ZC1kZXRlY3Rpb24tbXNrLWNvbmZpZy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdNU0sgY29uZmlndXJhdGlvbiBmb3IgZnJhdWQgZGV0ZWN0aW9uIHN5c3RlbScsXG4gICAgICBrYWZrYVZlcnNpb25zTGlzdDogWycyLjguMSddLFxuICAgICAgc2VydmVyUHJvcGVydGllczogW1xuICAgICAgICAnYXV0by5jcmVhdGUudG9waWNzLmVuYWJsZT1mYWxzZScsXG4gICAgICAgICdkZWZhdWx0LnJlcGxpY2F0aW9uLmZhY3Rvcj0zJyxcbiAgICAgICAgJ21pbi5pbnN5bmMucmVwbGljYXM9MicsXG4gICAgICAgICdudW0ucGFydGl0aW9ucz0xMicsXG4gICAgICAgICdjb21wcmVzc2lvbi50eXBlPXNuYXBweScsXG4gICAgICAgICdsb2cucmV0ZW50aW9uLmhvdXJzPTE2OCcsXG4gICAgICAgICdsb2cuc2VnbWVudC5ieXRlcz0xMDczNzQxODI0JyxcbiAgICAgICAgJ2xvZy5yZXRlbnRpb24uY2hlY2suaW50ZXJ2YWwubXM9MzAwMDAwJyxcbiAgICAgICAgJ21lc3NhZ2UubWF4LmJ5dGVzPTEwMDAwMDAnLFxuICAgICAgICAncmVwbGljYS5mZXRjaC5tYXguYnl0ZXM9MTA0ODU3NicsXG4gICAgICAgICdncm91cC5pbml0aWFsLnJlYmFsYW5jZS5kZWxheS5tcz0zMDAwJyxcbiAgICAgIF0uam9pbignXFxuJyksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgTVNLIGNsdXN0ZXJcbiAgICB0aGlzLm1za0NsdXN0ZXIgPSBuZXcgbXNrLkNmbkNsdXN0ZXIodGhpcywgJ01za0NsdXN0ZXInLCB7XG4gICAgICBjbHVzdGVyTmFtZTogYGZyYXVkLWRldGVjdGlvbi1tc2stJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGthZmthVmVyc2lvbjogJzIuOC4xJyxcbiAgICAgIG51bWJlck9mQnJva2VyTm9kZXM6IDMsXG4gICAgICBcbiAgICAgIC8vIEJyb2tlciBjb25maWd1cmF0aW9uXG4gICAgICBicm9rZXJOb2RlR3JvdXBJbmZvOiB7XG4gICAgICAgIGluc3RhbmNlVHlwZTogJ2thZmthLm01LmxhcmdlJyxcbiAgICAgICAgY2xpZW50U3VibmV0czogdnBjLnByaXZhdGVTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IFttc2tTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZF0sXG4gICAgICAgIHN0b3JhZ2VJbmZvOiB7XG4gICAgICAgICAgZWJzU3RvcmFnZUluZm86IHtcbiAgICAgICAgICAgIHZvbHVtZVNpemU6IDEwMCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIFxuICAgICAgLy8gQ29uZmlndXJhdGlvblxuICAgICAgY29uZmlndXJhdGlvbkluZm86IHtcbiAgICAgICAgYXJuOiBtc2tDb25maWd1cmF0aW9uLmF0dHJBcm4sXG4gICAgICAgIHJldmlzaW9uOiAxLFxuICAgICAgfSxcbiAgICAgIFxuICAgICAgLy8gRW5jcnlwdGlvblxuICAgICAgZW5jcnlwdGlvbkluZm86IGVuYWJsZUVuY3J5cHRpb24gPyB7XG4gICAgICAgIGVuY3J5cHRpb25BdFJlc3Q6IHtcbiAgICAgICAgICBkYXRhVm9sdW1lS21zS2V5SWQ6ICdhbGlhcy9hd3Mva2Fma2EnLFxuICAgICAgICB9LFxuICAgICAgICBlbmNyeXB0aW9uSW5UcmFuc2l0OiB7XG4gICAgICAgICAgY2xpZW50QnJva2VyOiAnVExTJyxcbiAgICAgICAgICBpbkNsdXN0ZXI6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgXG4gICAgICAvLyBFbmhhbmNlZCBtb25pdG9yaW5nXG4gICAgICBlbmhhbmNlZE1vbml0b3Jpbmc6ICdQRVJfQlJPS0VSJyxcbiAgICAgIFxuICAgICAgLy8gTG9nZ2luZ1xuICAgICAgbG9nZ2luZ0luZm86IHtcbiAgICAgICAgYnJva2VyTG9nczoge1xuICAgICAgICAgIGNsb3VkV2F0Y2hMb2dzOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL21zay9mcmF1ZC1kZXRlY3Rpb24tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHMzOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgYnVja2V0OiB0aGlzLmRhdGFMYWtlLmJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBwcmVmaXg6ICdtc2stbG9ncy8nLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgXG4gICAgICAvLyBDbGllbnQgYXV0aGVudGljYXRpb25cbiAgICAgIGNsaWVudEF1dGhlbnRpY2F0aW9uOiB7XG4gICAgICAgIHRsczoge1xuICAgICAgICAgIGNlcnRpZmljYXRlQXV0aG9yaXR5QXJuTGlzdDogW10sIC8vIENvbmZpZ3VyZSBjZXJ0aWZpY2F0ZSBhdXRob3JpdGllcyBhcyBuZWVkZWRcbiAgICAgICAgfSxcbiAgICAgICAgc2FzbDoge1xuICAgICAgICAgIHNjcmFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVLaW5lc2lzU3RyZWFtcyhlbnZpcm9ubWVudE5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIC8vIE1haW4gdHJhbnNhY3Rpb24gc3RyZWFtXG4gICAgdGhpcy5raW5lc2lzU3RyZWFtID0gbmV3IGtpbmVzaXMuU3RyZWFtKHRoaXMsICdUcmFuc2FjdGlvblN0cmVhbScsIHtcbiAgICAgIHN0cmVhbU5hbWU6IGBmcmF1ZC1kZXRlY3Rpb24tdHJhbnNhY3Rpb25zLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBzaGFyZENvdW50OiAxMCxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIGVuY3J5cHRpb246IGtpbmVzaXMuU3RyZWFtRW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBrbXMuQWxpYXMuZnJvbUFsaWFzTmFtZSh0aGlzLCAnS2luZXNpc0ttc0FsaWFzJywgJ2FsaWFzL2F3cy9raW5lc2lzJyksXG4gICAgfSk7XG5cbiAgICAvLyBBZGRpdGlvbmFsIHN0cmVhbXMgZm9yIGRpZmZlcmVudCBkYXRhIHR5cGVzXG4gICAgY29uc3QgZnJhdWRBbGVydHNTdHJlYW0gPSBuZXcga2luZXNpcy5TdHJlYW0odGhpcywgJ0ZyYXVkQWxlcnRzU3RyZWFtJywge1xuICAgICAgc3RyZWFtTmFtZTogYGZyYXVkLWRldGVjdGlvbi1hbGVydHMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHNoYXJkQ291bnQ6IDIsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxNjgpLCAvLyA3IGRheXNcbiAgICAgIGVuY3J5cHRpb246IGtpbmVzaXMuU3RyZWFtRW5jcnlwdGlvbi5LTVMsXG4gICAgfSk7XG5cbiAgICBjb25zdCBtb2RlbE1ldHJpY3NTdHJlYW0gPSBuZXcga2luZXNpcy5TdHJlYW0odGhpcywgJ01vZGVsTWV0cmljc1N0cmVhbScsIHtcbiAgICAgIHN0cmVhbU5hbWU6IGBmcmF1ZC1kZXRlY3Rpb24tbW9kZWwtbWV0cmljcy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgc2hhcmRDb3VudDogMSxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIGVuY3J5cHRpb246IGtpbmVzaXMuU3RyZWFtRW5jcnlwdGlvbi5LTVMsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNhZ2VNYWtlclJlc291cmNlcyhlbnZpcm9ubWVudE5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIC8vIFNhZ2VNYWtlciBleGVjdXRpb24gcm9sZVxuICAgIGNvbnN0IHNhZ2VtYWtlclJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1NhZ2VNYWtlckV4ZWN1dGlvblJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnc2FnZW1ha2VyLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNhZ2VNYWtlckZ1bGxBY2Nlc3MnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBhY2Nlc3MgdG8gUzMgYnVja2V0c1xuICAgIHRoaXMuZGF0YUxha2UuZ3JhbnRSZWFkV3JpdGUoc2FnZW1ha2VyUm9sZSk7XG4gICAgdGhpcy5tb2RlbEJ1Y2tldC5ncmFudFJlYWRXcml0ZShzYWdlbWFrZXJSb2xlKTtcblxuICAgIC8vIFNhZ2VNYWtlciBNb2RlbCBSZWdpc3RyeVxuICAgIGNvbnN0IG1vZGVsUGFja2FnZUdyb3VwID0gbmV3IHNhZ2VtYWtlci5DZm5Nb2RlbFBhY2thZ2VHcm91cCh0aGlzLCAnRnJhdWREZXRlY3Rpb25Nb2RlbEdyb3VwJywge1xuICAgICAgbW9kZWxQYWNrYWdlR3JvdXBOYW1lOiBgZnJhdWQtZGV0ZWN0aW9uLW1vZGVscy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgbW9kZWxQYWNrYWdlR3JvdXBEZXNjcmlwdGlvbjogJ01vZGVsIHBhY2thZ2UgZ3JvdXAgZm9yIGZyYXVkIGRldGVjdGlvbiBtb2RlbHMnLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IFNhZ2VNYWtlciBpbmZvcm1hdGlvblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTYWdlTWFrZXJNb2RlbEdyb3VwJywge1xuICAgICAgdmFsdWU6IG1vZGVsUGFja2FnZUdyb3VwLm1vZGVsUGFja2FnZUdyb3VwTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2FnZU1ha2VyIE1vZGVsIFBhY2thZ2UgR3JvdXAgTmFtZScsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZU91dHB1dHMoKTogdm9pZCB7XG4gICAgLy8gUkRTIG91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmRzQ2x1c3RlckVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMucmRzQ2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBDbHVzdGVyIEVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZHNDbHVzdGVyUmVhZEVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMucmRzQ2x1c3Rlci5jbHVzdGVyUmVhZEVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdSRFMgQ2x1c3RlciBSZWFkIEVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIC8vIFJlZGlzIG91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNDbHVzdGVyRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlZGlzIENsdXN0ZXIgUHJpbWFyeSBFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNDbHVzdGVyUG9ydCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlZGlzQ2x1c3Rlci5hdHRyUHJpbWFyeUVuZFBvaW50UG9ydC50b1N0cmluZygpLFxuICAgICAgZGVzY3JpcHRpb246ICdSZWRpcyBDbHVzdGVyIFBvcnQnLFxuICAgIH0pO1xuXG4gICAgLy8gTVNLIG91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTXNrQ2x1c3RlckFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm1za0NsdXN0ZXIucmVmLFxuICAgICAgZGVzY3JpcHRpb246ICdNU0sgQ2x1c3RlciBBUk4nLFxuICAgIH0pO1xuXG4gICAgLy8gUzMgb3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhTGFrZUJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhTGFrZS5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhIExha2UgUzMgQnVja2V0IE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01vZGVsQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm1vZGVsQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ01vZGVsIFN0b3JhZ2UgUzMgQnVja2V0IE5hbWUnLFxuICAgIH0pO1xuXG4gICAgLy8gS2luZXNpcyBvdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RyYW5zYWN0aW9uU3RyZWFtTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmtpbmVzaXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS2luZXNpcyBUcmFuc2FjdGlvbiBTdHJlYW0gTmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVHJhbnNhY3Rpb25TdHJlYW1Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5raW5lc2lzU3RyZWFtLnN0cmVhbUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnS2luZXNpcyBUcmFuc2FjdGlvbiBTdHJlYW0gQVJOJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==