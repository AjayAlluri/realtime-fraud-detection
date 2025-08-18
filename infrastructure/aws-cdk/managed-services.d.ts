import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as msk from 'aws-cdk-lib/aws-msk';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import { Construct } from 'constructs';
export interface ManagedServicesProps extends cdk.StackProps {
    vpc: ec2.Vpc;
    environmentName: string;
    enableEncryption?: boolean;
    enableBackups?: boolean;
    multiAz?: boolean;
}
export declare class ManagedServicesStack extends cdk.Stack {
    rdsCluster: rds.DatabaseCluster;
    redisCluster: elasticache.CfnReplicationGroup;
    mskCluster: msk.CfnCluster;
    dataLake: s3.Bucket;
    modelBucket: s3.Bucket;
    kinesisStream: kinesis.Stream;
    constructor(scope: Construct, id: string, props: ManagedServicesProps);
    private createS3Buckets;
    private createRdsCluster;
    private createRedisCluster;
    private createMskCluster;
    private createKinesisStreams;
    private createSageMakerResources;
    private createOutputs;
}
