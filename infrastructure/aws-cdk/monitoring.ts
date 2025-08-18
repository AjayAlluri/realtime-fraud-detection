import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as msk from 'aws-cdk-lib/aws-msk';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export interface MonitoringProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  cluster: eks.Cluster;
  rdsCluster: rds.DatabaseCluster;
  redisCluster: elasticache.CfnReplicationGroup;
  mskCluster: msk.CfnCluster;
  environmentName: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id, props);

    const { vpc, cluster, rdsCluster, redisCluster, mskCluster, environmentName } = props;

    // Create SNS topic for alerts
    this.alertTopic = new sns.Topic(this, 'FraudDetectionAlerts', {
      topicName: `fraud-detection-alerts-${environmentName}`,
      displayName: 'Fraud Detection System Alerts',
    });

    // Add email subscription (can be configured via context)
    const alertEmail = this.node.tryGetContext('alertEmail');
    if (alertEmail) {
      this.alertTopic.addSubscription(new subs.EmailSubscription(alertEmail));
    }

    // Create CloudWatch Log Groups
    this.createLogGroups(environmentName);

    // Create CloudWatch Dashboard
    this.createDashboard(environmentName, rdsCluster, redisCluster, mskCluster);

    // Create CloudWatch Alarms
    this.createAlarms(environmentName, rdsCluster, redisCluster, mskCluster);

    // Create custom metrics Lambda
    this.createCustomMetricsLambda(environmentName);

    // Create log analysis
    this.createLogAnalysis(environmentName);
  }

  private createLogGroups(environmentName: string): void {
    // Application log groups
    const appLogGroups = [
      'fraud-detection-api',
      'fraud-detection-ml-models',
      'fraud-detection-flink',
      'fraud-detection-data-simulator',
      'fraud-detection-feature-store',
    ];

    appLogGroups.forEach(logGroupName => {
      new logs.LogGroup(this, `${logGroupName}-logs`, {
        logGroupName: `/aws/fraud-detection/${environmentName}/${logGroupName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    });

    // Infrastructure log groups
    new logs.LogGroup(this, 'EksClusterLogs', {
      logGroupName: `/aws/eks/fraud-detection-${environmentName}/cluster`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'MskLogs', {
      logGroupName: `/aws/msk/fraud-detection-${environmentName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createDashboard(
    environmentName: string,
    rdsCluster: rds.DatabaseCluster,
    redisCluster: elasticache.CfnReplicationGroup,
    mskCluster: msk.CfnCluster
  ): void {
    this.dashboard = new cloudwatch.Dashboard(this, 'FraudDetectionDashboard', {
      dashboardName: `FraudDetection-${environmentName}`,
    });

    // Application Metrics Row
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# Fraud Detection System - ${environmentName.toUpperCase()}\n\n## Application Metrics`,
        width: 24,
        height: 2,
      })
    );

    // Transaction Processing Metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Transaction Processing Rate',
        left: [
          new cloudwatch.Metric({
            namespace: 'FraudDetection/Transactions',
            metricName: 'ProcessedTransactions',
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'FraudDetection/Transactions',
            metricName: 'FraudDetected',
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ML Model Performance',
        left: [
          new cloudwatch.Metric({
            namespace: 'FraudDetection/MLModels',
            metricName: 'PredictionLatency',
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'FraudDetection/MLModels',
            metricName: 'ModelAccuracy',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    // Infrastructure Metrics Row
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## Infrastructure Metrics',
        width: 24,
        height: 1,
      })
    );

    // EKS Cluster Metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'EKS Cluster CPU & Memory',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EKS',
            metricName: 'node_cpu_utilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/EKS',
            metricName: 'node_memory_utilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS Performance',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              DBClusterIdentifier: rdsCluster.clusterIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: {
              DBClusterIdentifier: rdsCluster.clusterIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ElastiCache Performance',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              CacheClusterId: redisCluster.replicationGroupId!,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'CurrConnections',
            dimensionsMap: {
              CacheClusterId: redisCluster.replicationGroupId!,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 6,
      })
    );

    // Kafka Metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Kafka Metrics',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Kafka',
            metricName: 'MessagesInPerSec',
            dimensionsMap: {
              'Cluster Name': mskCluster.clusterName!,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/Kafka',
            metricName: 'BytesInPerSec',
            dimensionsMap: {
              'Cluster Name': mskCluster.clusterName!,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'System Health',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'FraudDetection/Health',
            metricName: 'OverallHealthScore',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      })
    );
  }

  private createAlarms(
    environmentName: string,
    rdsCluster: rds.DatabaseCluster,
    redisCluster: elasticache.CfnReplicationGroup,
    mskCluster: msk.CfnCluster
  ): void {
    // High error rate alarm
    new cloudwatch.Alarm(this, 'HighErrorRate', {
      alarmName: `FraudDetection-HighErrorRate-${environmentName}`,
      alarmDescription: 'High error rate in fraud detection system',
      metric: new cloudwatch.Metric({
        namespace: 'FraudDetection/Errors',
        metricName: 'ErrorRate',
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5, // 5% error rate
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));

    // High latency alarm
    new cloudwatch.Alarm(this, 'HighLatency', {
      alarmName: `FraudDetection-HighLatency-${environmentName}`,
      alarmDescription: 'High latency in ML model predictions',
      metric: new cloudwatch.Metric({
        namespace: 'FraudDetection/MLModels',
        metricName: 'PredictionLatency',
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1000, // 1 second
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));

    // Low model accuracy alarm
    new cloudwatch.Alarm(this, 'LowModelAccuracy', {
      alarmName: `FraudDetection-LowModelAccuracy-${environmentName}`,
      alarmDescription: 'ML model accuracy below threshold',
      metric: new cloudwatch.Metric({
        namespace: 'FraudDetection/MLModels',
        metricName: 'ModelAccuracy',
        statistic: 'Average',
        period: cdk.Duration.minutes(15),
      }),
      threshold: 0.85, // 85% accuracy
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));

    // RDS CPU alarm
    new cloudwatch.Alarm(this, 'RdsHighCpu', {
      alarmName: `FraudDetection-RDS-HighCPU-${environmentName}`,
      alarmDescription: 'RDS cluster high CPU utilization',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBClusterIdentifier: rdsCluster.clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));

    // Redis CPU alarm
    new cloudwatch.Alarm(this, 'RedisHighCpu', {
      alarmName: `FraudDetection-Redis-HighCPU-${environmentName}`,
      alarmDescription: 'Redis cluster high CPU utilization',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          CacheClusterId: redisCluster.replicationGroupId!,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));

    // Kafka lag alarm
    new cloudwatch.Alarm(this, 'KafkaHighLag', {
      alarmName: `FraudDetection-Kafka-HighLag-${environmentName}`,
      alarmDescription: 'Kafka consumer lag is high',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Kafka',
        metricName: 'EstimatedMaxTimeLag',
        dimensionsMap: {
          'Cluster Name': mskCluster.clusterName!,
        },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 60000, // 60 seconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));
  }

  private createCustomMetricsLambda(environmentName: string): void {
    // IAM role for custom metrics Lambda
    const lambdaRole = new iam.Role(this, 'CustomMetricsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
      ],
    });

    // Lambda function for custom metrics
    const customMetricsLambda = new lambda.Function(this, 'CustomMetricsLambda', {
      functionName: `fraud-detection-custom-metrics-${environmentName}`,
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      code: lambda.Code.fromInline(`
import json
import boto3
import requests
from datetime import datetime

cloudwatch = boto3.client('cloudwatch')

def handler(event, context):
    """
    Custom metrics collection for fraud detection system
    """
    try:
        # Collect health metrics from various services
        health_metrics = collect_health_metrics()
        
        # Collect business metrics
        business_metrics = collect_business_metrics()
        
        # Send metrics to CloudWatch
        send_metrics_to_cloudwatch(health_metrics + business_metrics)
        
        return {
            'statusCode': 200,
            'body': json.dumps('Metrics collected successfully')
        }
    except Exception as e:
        print(f"Error collecting metrics: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }

def collect_health_metrics():
    """Collect system health metrics"""
    metrics = []
    
    # Calculate overall health score based on various factors
    health_score = calculate_health_score()
    
    metrics.append({
        'MetricName': 'OverallHealthScore',
        'Value': health_score,
        'Unit': 'Percent',
        'Timestamp': datetime.utcnow()
    })
    
    return metrics

def collect_business_metrics():
    """Collect business-specific metrics"""
    metrics = []
    
    # Example: Fraud detection rate
    fraud_rate = get_fraud_detection_rate()
    
    metrics.append({
        'MetricName': 'FraudDetectionRate',
        'Value': fraud_rate,
        'Unit': 'Percent',
        'Timestamp': datetime.utcnow()
    })
    
    return metrics

def calculate_health_score():
    """Calculate overall system health score"""
    # This would integrate with your actual health check endpoints
    # For now, return a sample value
    return 95.0

def get_fraud_detection_rate():
    """Get current fraud detection rate"""
    # This would query your actual fraud detection metrics
    # For now, return a sample value
    return 4.2

def send_metrics_to_cloudwatch(metrics):
    """Send metrics to CloudWatch"""
    for metric in metrics:
        cloudwatch.put_metric_data(
            Namespace='FraudDetection/Custom',
            MetricData=[{
                'MetricName': metric['MetricName'],
                'Value': metric['Value'],
                'Unit': metric['Unit'],
                'Timestamp': metric['Timestamp']
            }]
        )
`),
    });

    // EventBridge rule to trigger custom metrics collection
    const metricsCollectionRule = new events.Rule(this, 'MetricsCollectionRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Trigger custom metrics collection every 5 minutes',
    });

    metricsCollectionRule.addTarget(new targets.LambdaFunction(customMetricsLambda));
  }

  private createLogAnalysis(environmentName: string): void {
    // Lambda for log analysis and anomaly detection
    const logAnalysisRole = new iam.Role(this, 'LogAnalysisLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
      ],
    });

    const logAnalysisLambda = new lambda.Function(this, 'LogAnalysisLambda', {
      functionName: `fraud-detection-log-analysis-${environmentName}`,
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      role: logAnalysisRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromInline(`
import json
import boto3
import re
from datetime import datetime, timedelta

logs_client = boto3.client('logs')
cloudwatch = boto3.client('cloudwatch')
sns = boto3.client('sns')

def handler(event, context):
    """
    Analyze logs for anomalies and security issues
    """
    try:
        # Analyze different log groups
        log_groups = [
            '/aws/fraud-detection/${environmentName}/fraud-detection-api',
            '/aws/fraud-detection/${environmentName}/fraud-detection-ml-models',
            '/aws/fraud-detection/${environmentName}/fraud-detection-flink'
        ]
        
        for log_group in log_groups:
            analyze_log_group(log_group)
        
        return {
            'statusCode': 200,
            'body': json.dumps('Log analysis completed')
        }
    except Exception as e:
        print(f"Error in log analysis: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }

def analyze_log_group(log_group_name):
    """Analyze a specific log group for anomalies"""
    try:
        # Get logs from last 5 minutes
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(minutes=5)
        
        response = logs_client.filter_log_events(
            logGroupName=log_group_name,
            startTime=int(start_time.timestamp() * 1000),
            endTime=int(end_time.timestamp() * 1000)
        )
        
        events = response.get('events', [])
        
        # Analyze events for patterns
        error_count = count_errors(events)
        security_issues = detect_security_issues(events)
        
        # Send metrics
        if error_count > 0:
            send_metric('ErrorCount', error_count, log_group_name)
        
        if security_issues > 0:
            send_metric('SecurityIssues', security_issues, log_group_name)
            send_security_alert(log_group_name, security_issues)
            
    except Exception as e:
        print(f"Error analyzing log group {log_group_name}: {str(e)}")

def count_errors(events):
    """Count error events"""
    error_patterns = [
        r'ERROR',
        r'Exception',
        r'Failed',
        r'Error:'
    ]
    
    error_count = 0
    for event in events:
        message = event.get('message', '')
        for pattern in error_patterns:
            if re.search(pattern, message, re.IGNORECASE):
                error_count += 1
                break
    
    return error_count

def detect_security_issues(events):
    """Detect potential security issues"""
    security_patterns = [
        r'unauthorized',
        r'forbidden',
        r'authentication failed',
        r'suspicious',
        r'attack',
        r'malicious'
    ]
    
    security_count = 0
    for event in events:
        message = event.get('message', '')
        for pattern in security_patterns:
            if re.search(pattern, message, re.IGNORECASE):
                security_count += 1
                break
    
    return security_count

def send_metric(metric_name, value, log_group):
    """Send metric to CloudWatch"""
    cloudwatch.put_metric_data(
        Namespace='FraudDetection/LogAnalysis',
        MetricData=[{
            'MetricName': metric_name,
            'Value': value,
            'Unit': 'Count',
            'Dimensions': [
                {
                    'Name': 'LogGroup',
                    'Value': log_group
                }
            ],
            'Timestamp': datetime.utcnow()
        }]
    )

def send_security_alert(log_group, count):
    """Send security alert via SNS"""
    message = f"Security issues detected in {log_group}: {count} potential issues found"
    
    # This would use the actual SNS topic ARN
    sns.publish(
        TopicArn='${this.alertTopic.topicArn}',
        Message=message,
        Subject='Fraud Detection Security Alert'
    )
`),
    });

    // Grant permissions to publish to SNS
    this.alertTopic.grantPublish(logAnalysisLambda);

    // EventBridge rule for log analysis
    const logAnalysisRule = new events.Rule(this, 'LogAnalysisRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Trigger log analysis every 5 minutes',
    });

    logAnalysisRule.addTarget(new targets.LambdaFunction(logAnalysisLambda));
  }
}