import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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
export declare class EksClusterStack extends cdk.Stack {
    readonly cluster: eks.Cluster;
    readonly vpc: ec2.Vpc;
    constructor(scope: Construct, id: string, props: EksClusterProps);
    private installAddons;
    private createServiceAccounts;
}
