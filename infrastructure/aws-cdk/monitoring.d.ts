import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as msk from 'aws-cdk-lib/aws-msk';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
export interface MonitoringProps extends cdk.StackProps {
    vpc: ec2.Vpc;
    cluster: eks.Cluster;
    rdsCluster: rds.DatabaseCluster;
    redisCluster: elasticache.CfnReplicationGroup;
    mskCluster: msk.CfnCluster;
    environmentName: string;
}
export declare class MonitoringStack extends cdk.Stack {
    readonly alertTopic: sns.Topic;
    dashboard: cloudwatch.Dashboard;
    constructor(scope: Construct, id: string, props: MonitoringProps);
    private createLogGroups;
    private createDashboard;
    private createAlarms;
    private createCustomMetricsLambda;
    private createLogAnalysis;
}
