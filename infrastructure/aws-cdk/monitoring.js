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
exports.MonitoringStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const subs = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const cw_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
class MonitoringStack extends cdk.Stack {
    constructor(scope, id, props) {
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
    createLogGroups(environmentName) {
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
    createDashboard(environmentName, rdsCluster, redisCluster, mskCluster) {
        this.dashboard = new cloudwatch.Dashboard(this, 'FraudDetectionDashboard', {
            dashboardName: `FraudDetection-${environmentName}`,
        });
        // Application Metrics Row
        this.dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: `# Fraud Detection System - ${environmentName.toUpperCase()}\n\n## Application Metrics`,
            width: 24,
            height: 2,
        }));
        // Transaction Processing Metrics
        this.dashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }));
        // Infrastructure Metrics Row
        this.dashboard.addWidgets(new cloudwatch.TextWidget({
            markdown: '## Infrastructure Metrics',
            width: 24,
            height: 1,
        }));
        // EKS Cluster Metrics
        this.dashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
            title: 'ElastiCache Performance',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/ElastiCache',
                    metricName: 'CPUUtilization',
                    dimensionsMap: {
                        CacheClusterId: redisCluster.replicationGroupId,
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
                        CacheClusterId: redisCluster.replicationGroupId,
                    },
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            width: 8,
            height: 6,
        }));
        // Kafka Metrics
        this.dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Kafka Metrics',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/Kafka',
                    metricName: 'MessagesInPerSec',
                    dimensionsMap: {
                        'Cluster Name': mskCluster.clusterName,
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
                        'Cluster Name': mskCluster.clusterName,
                    },
                    statistic: 'Average',
                    period: cdk.Duration.minutes(1),
                }),
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.SingleValueWidget({
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
        }));
    }
    createAlarms(environmentName, rdsCluster, redisCluster, mskCluster) {
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
            threshold: 5,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
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
            threshold: 1000,
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
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
            threshold: 0.85,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
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
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
        // Redis CPU alarm
        new cloudwatch.Alarm(this, 'RedisHighCpu', {
            alarmName: `FraudDetection-Redis-HighCPU-${environmentName}`,
            alarmDescription: 'Redis cluster high CPU utilization',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/ElastiCache',
                metricName: 'CPUUtilization',
                dimensionsMap: {
                    CacheClusterId: redisCluster.replicationGroupId,
                },
                statistic: 'Average',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 80,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
        // Kafka lag alarm
        new cloudwatch.Alarm(this, 'KafkaHighLag', {
            alarmName: `FraudDetection-Kafka-HighLag-${environmentName}`,
            alarmDescription: 'Kafka consumer lag is high',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/Kafka',
                metricName: 'EstimatedMaxTimeLag',
                dimensionsMap: {
                    'Cluster Name': mskCluster.clusterName,
                },
                statistic: 'Maximum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 60000,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        }).addAlarmAction(new cw_actions.SnsAction(this.alertTopic));
    }
    createCustomMetricsLambda(environmentName) {
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
    createLogAnalysis(environmentName) {
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
exports.MonitoringStack = MonitoringStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uaXRvcmluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbml0b3JpbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFNbkMsdUVBQXlEO0FBQ3pELDJEQUE2QztBQUM3Qyx5REFBMkM7QUFDM0Msd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQywrREFBaUQ7QUFDakQsK0RBQWlEO0FBQ2pELHdFQUEwRDtBQUMxRCwrRUFBaUU7QUFZakUsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSTVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsZUFBZSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXRGLDhCQUE4QjtRQUM5QixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDNUQsU0FBUyxFQUFFLDBCQUEwQixlQUFlLEVBQUU7WUFDdEQsV0FBVyxFQUFFLCtCQUErQjtTQUM3QyxDQUFDLENBQUM7UUFFSCx5REFBeUQ7UUFDekQsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDekQsSUFBSSxVQUFVLEVBQUU7WUFDZCxJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO1NBQ3pFO1FBRUQsK0JBQStCO1FBQy9CLElBQUksQ0FBQyxlQUFlLENBQUMsZUFBZSxDQUFDLENBQUM7UUFFdEMsOEJBQThCO1FBQzlCLElBQUksQ0FB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QUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7b0NBaUJDLGVBQWU7b0NBQ2YsZUFBZTtvQ0FDZixlQUFlOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7b0JBK0cvQixJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVE7Ozs7Q0FJM0MsQ0FBQztTQUNHLENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBRWhELG9DQUFvQztRQUNwQyxNQUFNLGVBQWUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQy9ELFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2RCxXQUFXLEVBQUUsc0NBQXNDO1NBQ3BELENBQUMsQ0FBQztRQUVILGVBQWUsQ0FBQyxTQUFTLENBQUMsSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQztJQUMzRSxDQUFDO0NBQ0Y7QUE3b0JELDBDQTZvQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJztcbmltcG9ydCAqIGFzIG1zayBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbXNrJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzdWJzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XG5pbXBvcnQgKiBhcyBjd19hY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoLWFjdGlvbnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTW9uaXRvcmluZ1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICB2cGM6IGVjMi5WcGM7XG4gIGNsdXN0ZXI6IGVrcy5DbHVzdGVyO1xuICByZHNDbHVzdGVyOiByZHMuRGF0YWJhc2VDbHVzdGVyO1xuICByZWRpc0NsdXN0ZXI6IGVsYXN0aWNhY2hlLkNmblJlcGxpY2F0aW9uR3JvdXA7XG4gIG1za0NsdXN0ZXI6IG1zay5DZm5DbHVzdGVyO1xuICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIE1vbml0b3JpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhbGVydFRvcGljOiBzbnMuVG9waWM7XG4gIHB1YmxpYyBkYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBNb25pdG9yaW5nUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgdnBjLCBjbHVzdGVyLCByZHNDbHVzdGVyLCByZWRpc0NsdXN0ZXIsIG1za0NsdXN0ZXIsIGVudmlyb25tZW50TmFtZSB9ID0gcHJvcHM7XG5cbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBhbGVydHNcbiAgICB0aGlzLmFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdGcmF1ZERldGVjdGlvbkFsZXJ0cycsIHtcbiAgICAgIHRvcGljTmFtZTogYGZyYXVkLWRldGVjdGlvbi1hbGVydHMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRpc3BsYXlOYW1lOiAnRnJhdWQgRGV0ZWN0aW9uIFN5c3RlbSBBbGVydHMnLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGVtYWlsIHN1YnNjcmlwdGlvbiAoY2FuIGJlIGNvbmZpZ3VyZWQgdmlhIGNvbnRleHQpXG4gICAgY29uc3QgYWxlcnRFbWFpbCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhbGVydEVtYWlsJyk7XG4gICAgaWYgKGFsZXJ0RW1haWwpIHtcbiAgICAgIHRoaXMuYWxlcnRUb3BpYy5hZGRTdWJzY3JpcHRpb24obmV3IHN1YnMuRW1haWxTdWJzY3JpcHRpb24oYWxlcnRFbWFpbCkpO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIExvZyBHcm91cHNcbiAgICB0aGlzLmNyZWF0ZUxvZ0dyb3VwcyhlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggRGFzaGJvYXJkXG4gICAgdGhpcy5jcmVhdGVEYXNoYm9hcmQoZW52aXJvbm1lbnROYW1lLCByZHNDbHVzdGVyLCByZWRpc0NsdXN0ZXIsIG1za0NsdXN0ZXIpO1xuXG4gICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggQWxhcm1zXG4gICAgdGhpcy5jcmVhdGVBbGFybXMoZW52aXJvbm1lbnROYW1lLCByZHNDbHVzdGVyLCByZWRpc0NsdXN0ZXIsIG1za0NsdXN0ZXIpO1xuXG4gICAgLy8gQ3JlYXRlIGN1c3RvbSBtZXRyaWNzIExhbWJkYVxuICAgIHRoaXMuY3JlYXRlQ3VzdG9tTWV0cmljc0xhbWJkYShlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQ3JlYXRlIGxvZyBhbmFseXNpc1xuICAgIHRoaXMuY3JlYXRlTG9nQW5hbHlzaXMoZW52aXJvbm1lbnROYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTG9nR3JvdXBzKGVudmlyb25tZW50TmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgLy8gQXBwbGljYXRpb24gbG9nIGdyb3Vwc1xuICAgIGNvbnN0IGFwcExvZ0dyb3VwcyA9IFtcbiAgICAgICdmcmF1ZC1kZXRlY3Rpb24tYXBpJyxcbiAgICAgICdmcmF1ZC1kZXRlY3Rpb24tbWwtbW9kZWxzJyxcbiAgICAgICdmcmF1ZC1kZXRlY3Rpb24tZmxpbmsnLFxuICAgICAgJ2ZyYXVkLWRldGVjdGlvbi1kYXRhLXNpbXVsYXRvcicsXG4gICAgICAnZnJhdWQtZGV0ZWN0aW9uLWZlYXR1cmUtc3RvcmUnLFxuICAgIF07XG5cbiAgICBhcHBMb2dHcm91cHMuZm9yRWFjaChsb2dHcm91cE5hbWUgPT4ge1xuICAgICAgbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgYCR7bG9nR3JvdXBOYW1lfS1sb2dzYCwge1xuICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2ZyYXVkLWRldGVjdGlvbi8ke2Vudmlyb25tZW50TmFtZX0vJHtsb2dHcm91cE5hbWV9YCxcbiAgICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBJbmZyYXN0cnVjdHVyZSBsb2cgZ3JvdXBzXG4gICAgbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0Vrc0NsdXN0ZXJMb2dzJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9la3MvZnJhdWQtZGV0ZWN0aW9uLSR7ZW52aXJvbm1lbnROYW1lfS9jbHVzdGVyYCxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLlRXT19XRUVLUyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTXNrTG9ncycsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbXNrL2ZyYXVkLWRldGVjdGlvbi0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVEYXNoYm9hcmQoXG4gICAgZW52aXJvbm1lbnROYW1lOiBzdHJpbmcsXG4gICAgcmRzQ2x1c3RlcjogcmRzLkRhdGFiYXNlQ2x1c3RlcixcbiAgICByZWRpc0NsdXN0ZXI6IGVsYXN0aWNhY2hlLkNmblJlcGxpY2F0aW9uR3JvdXAsXG4gICAgbXNrQ2x1c3RlcjogbXNrLkNmbkNsdXN0ZXJcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5kYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0ZyYXVkRGV0ZWN0aW9uRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYEZyYXVkRGV0ZWN0aW9uLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICAvLyBBcHBsaWNhdGlvbiBNZXRyaWNzIFJvd1xuICAgIHRoaXMuZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IGAjIEZyYXVkIERldGVjdGlvbiBTeXN0ZW0gLSAke2Vudmlyb25tZW50TmFtZS50b1VwcGVyQ2FzZSgpfVxcblxcbiMjIEFwcGxpY2F0aW9uIE1ldHJpY3NgLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFRyYW5zYWN0aW9uIFByb2Nlc3NpbmcgTWV0cmljc1xuICAgIHRoaXMuZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnVHJhbnNhY3Rpb24gUHJvY2Vzc2luZyBSYXRlJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGcmF1ZERldGVjdGlvbi9UcmFuc2FjdGlvbnMnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1Byb2Nlc3NlZFRyYW5zYWN0aW9ucycsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnRnJhdWREZXRlY3Rpb24vVHJhbnNhY3Rpb25zJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdGcmF1ZERldGVjdGVkJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ01MIE1vZGVsIFBlcmZvcm1hbmNlJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGcmF1ZERldGVjdGlvbi9NTE1vZGVscycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUHJlZGljdGlvbkxhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGcmF1ZERldGVjdGlvbi9NTE1vZGVscycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnTW9kZWxBY2N1cmFjeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gSW5mcmFzdHJ1Y3R1cmUgTWV0cmljcyBSb3dcbiAgICB0aGlzLmRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiAnIyMgSW5mcmFzdHJ1Y3R1cmUgTWV0cmljcycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gRUtTIENsdXN0ZXIgTWV0cmljc1xuICAgIHRoaXMuZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnRUtTIENsdXN0ZXIgQ1BVICYgTWVtb3J5JyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRUtTJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdub2RlX2NwdV91dGlsaXphdGlvbicsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FS1MnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ25vZGVfbWVtb3J5X3V0aWxpemF0aW9uJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDgsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1JEUyBQZXJmb3JtYW5jZScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1JEUycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ1BVVXRpbGl6YXRpb24nLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBEQkNsdXN0ZXJJZGVudGlmaWVyOiByZHNDbHVzdGVyLmNsdXN0ZXJJZGVudGlmaWVyLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1JEUycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnRGF0YWJhc2VDb25uZWN0aW9ucycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIERCQ2x1c3RlcklkZW50aWZpZXI6IHJkc0NsdXN0ZXIuY2x1c3RlcklkZW50aWZpZXIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogOCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnRWxhc3RpQ2FjaGUgUGVyZm9ybWFuY2UnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FbGFzdGlDYWNoZScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ1BVVXRpbGl6YXRpb24nLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBDYWNoZUNsdXN0ZXJJZDogcmVkaXNDbHVzdGVyLnJlcGxpY2F0aW9uR3JvdXBJZCEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICByaWdodDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRWxhc3RpQ2FjaGUnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0N1cnJDb25uZWN0aW9ucycsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIENhY2hlQ2x1c3RlcklkOiByZWRpc0NsdXN0ZXIucmVwbGljYXRpb25Hcm91cElkISxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiA4LFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBLYWZrYSBNZXRyaWNzXG4gICAgdGhpcy5kYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdLYWZrYSBNZXRyaWNzJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvS2Fma2EnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ01lc3NhZ2VzSW5QZXJTZWMnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAnQ2x1c3RlciBOYW1lJzogbXNrQ2x1c3Rlci5jbHVzdGVyTmFtZSEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICByaWdodDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvS2Fma2EnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0J5dGVzSW5QZXJTZWMnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAnQ2x1c3RlciBOYW1lJzogbXNrQ2x1c3Rlci5jbHVzdGVyTmFtZSEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1N5c3RlbSBIZWFsdGgnLFxuICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0ZyYXVkRGV0ZWN0aW9uL0hlYWx0aCcsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnT3ZlcmFsbEhlYWx0aFNjb3JlJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFsYXJtcyhcbiAgICBlbnZpcm9ubWVudE5hbWU6IHN0cmluZyxcbiAgICByZHNDbHVzdGVyOiByZHMuRGF0YWJhc2VDbHVzdGVyLFxuICAgIHJlZGlzQ2x1c3RlcjogZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCxcbiAgICBtc2tDbHVzdGVyOiBtc2suQ2ZuQ2x1c3RlclxuICApOiB2b2lkIHtcbiAgICAvLyBIaWdoIGVycm9yIHJhdGUgYWxhcm1cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnSGlnaEVycm9yUmF0ZScsIHtcbiAgICAgIGFsYXJtTmFtZTogYEZyYXVkRGV0ZWN0aW9uLUhpZ2hFcnJvclJhdGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdIaWdoIGVycm9yIHJhdGUgaW4gZnJhdWQgZGV0ZWN0aW9uIHN5c3RlbScsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0ZyYXVkRGV0ZWN0aW9uL0Vycm9ycycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvclJhdGUnLFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA1LCAvLyA1JSBlcnJvciByYXRlXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICB9KS5hZGRBbGFybUFjdGlvbihuZXcgY3dfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKSk7XG5cbiAgICAvLyBIaWdoIGxhdGVuY3kgYWxhcm1cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnSGlnaExhdGVuY3knLCB7XG4gICAgICBhbGFybU5hbWU6IGBGcmF1ZERldGVjdGlvbi1IaWdoTGF0ZW5jeS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0hpZ2ggbGF0ZW5jeSBpbiBNTCBtb2RlbCBwcmVkaWN0aW9ucycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0ZyYXVkRGV0ZWN0aW9uL01MTW9kZWxzJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1ByZWRpY3Rpb25MYXRlbmN5JyxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMTAwMCwgLy8gMSBzZWNvbmRcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjd19hY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpKTtcblxuICAgIC8vIExvdyBtb2RlbCBhY2N1cmFjeSBhbGFybVxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMb3dNb2RlbEFjY3VyYWN5Jywge1xuICAgICAgYWxhcm1OYW1lOiBgRnJhdWREZXRlY3Rpb24tTG93TW9kZWxBY2N1cmFjeS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ01MIG1vZGVsIGFjY3VyYWN5IGJlbG93IHRocmVzaG9sZCcsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0ZyYXVkRGV0ZWN0aW9uL01MTW9kZWxzJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ01vZGVsQWNjdXJhY3knLFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMC44NSwgLy8gODUlIGFjY3VyYWN5XG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuTEVTU19USEFOX1RIUkVTSE9MRCxcbiAgICB9KS5hZGRBbGFybUFjdGlvbihuZXcgY3dfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKSk7XG5cbiAgICAvLyBSRFMgQ1BVIGFsYXJtXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1Jkc0hpZ2hDcHUnLCB7XG4gICAgICBhbGFybU5hbWU6IGBGcmF1ZERldGVjdGlvbi1SRFMtSGlnaENQVS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ1JEUyBjbHVzdGVyIGhpZ2ggQ1BVIHV0aWxpemF0aW9uJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1JEUycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdDUFVVdGlsaXphdGlvbicsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBEQkNsdXN0ZXJJZGVudGlmaWVyOiByZHNDbHVzdGVyLmNsdXN0ZXJJZGVudGlmaWVyLFxuICAgICAgICB9LFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA4MCxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjd19hY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpKTtcblxuICAgIC8vIFJlZGlzIENQVSBhbGFybVxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdSZWRpc0hpZ2hDcHUnLCB7XG4gICAgICBhbGFybU5hbWU6IGBGcmF1ZERldGVjdGlvbi1SZWRpcy1IaWdoQ1BVLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnUmVkaXMgY2x1c3RlciBoaWdoIENQVSB1dGlsaXphdGlvbicsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FbGFzdGlDYWNoZScsXG4gICAgICAgIG1ldHJpY05hbWU6ICdDUFVVdGlsaXphdGlvbicsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBDYWNoZUNsdXN0ZXJJZDogcmVkaXNDbHVzdGVyLnJlcGxpY2F0aW9uR3JvdXBJZCEsXG4gICAgICAgIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDgwLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgfSkuYWRkQWxhcm1BY3Rpb24obmV3IGN3X2FjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxlcnRUb3BpYykpO1xuXG4gICAgLy8gS2Fma2EgbGFnIGFsYXJtXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0thZmthSGlnaExhZycsIHtcbiAgICAgIGFsYXJtTmFtZTogYEZyYXVkRGV0ZWN0aW9uLUthZmthLUhpZ2hMYWctJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdLYWZrYSBjb25zdW1lciBsYWcgaXMgaGlnaCcsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0FXUy9LYWZrYScsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFc3RpbWF0ZWRNYXhUaW1lTGFnJyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICdDbHVzdGVyIE5hbWUnOiBtc2tDbHVzdGVyLmNsdXN0ZXJOYW1lISxcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiAnTWF4aW11bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNjAwMDAsIC8vIDYwIHNlY29uZHNcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjd19hY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQ3VzdG9tTWV0cmljc0xhbWJkYShlbnZpcm9ubWVudE5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIC8vIElBTSByb2xlIGZvciBjdXN0b20gbWV0cmljcyBMYW1iZGFcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDdXN0b21NZXRyaWNzTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hGdWxsQWNjZXNzJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBjdXN0b20gbWV0cmljc1xuICAgIGNvbnN0IGN1c3RvbU1ldHJpY3NMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDdXN0b21NZXRyaWNzTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgZnJhdWQtZGV0ZWN0aW9uLWN1c3RvbS1tZXRyaWNzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM185LFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuaW1wb3J0IGpzb25cbmltcG9ydCBib3RvM1xuaW1wb3J0IHJlcXVlc3RzXG5mcm9tIGRhdGV0aW1lIGltcG9ydCBkYXRldGltZVxuXG5jbG91ZHdhdGNoID0gYm90bzMuY2xpZW50KCdjbG91ZHdhdGNoJylcblxuZGVmIGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpOlxuICAgIFwiXCJcIlxuICAgIEN1c3RvbSBtZXRyaWNzIGNvbGxlY3Rpb24gZm9yIGZyYXVkIGRldGVjdGlvbiBzeXN0ZW1cbiAgICBcIlwiXCJcbiAgICB0cnk6XG4gICAgICAgICMgQ29sbGVjdCBoZWFsdGggbWV0cmljcyBmcm9tIHZhcmlvdXMgc2VydmljZXNcbiAgICAgICAgaGVhbHRoX21ldHJpY3MgPSBjb2xsZWN0X2hlYWx0aF9tZXRyaWNzKClcbiAgICAgICAgXG4gICAgICAgICMgQ29sbGVjdCBidXNpbmVzcyBtZXRyaWNzXG4gICAgICAgIGJ1c2luZXNzX21ldHJpY3MgPSBjb2xsZWN0X2J1c2luZXNzX21ldHJpY3MoKVxuICAgICAgICBcbiAgICAgICAgIyBTZW5kIG1ldHJpY3MgdG8gQ2xvdWRXYXRjaFxuICAgICAgICBzZW5kX21ldHJpY3NfdG9fY2xvdWR3YXRjaChoZWFsdGhfbWV0cmljcyArIGJ1c2luZXNzX21ldHJpY3MpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgJ3N0YXR1c0NvZGUnOiAyMDAsXG4gICAgICAgICAgICAnYm9keSc6IGpzb24uZHVtcHMoJ01ldHJpY3MgY29sbGVjdGVkIHN1Y2Nlc3NmdWxseScpXG4gICAgICAgIH1cbiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6XG4gICAgICAgIHByaW50KGZcIkVycm9yIGNvbGxlY3RpbmcgbWV0cmljczoge3N0cihlKX1cIilcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICdzdGF0dXNDb2RlJzogNTAwLFxuICAgICAgICAgICAgJ2JvZHknOiBqc29uLmR1bXBzKGYnRXJyb3I6IHtzdHIoZSl9JylcbiAgICAgICAgfVxuXG5kZWYgY29sbGVjdF9oZWFsdGhfbWV0cmljcygpOlxuICAgIFwiXCJcIkNvbGxlY3Qgc3lzdGVtIGhlYWx0aCBtZXRyaWNzXCJcIlwiXG4gICAgbWV0cmljcyA9IFtdXG4gICAgXG4gICAgIyBDYWxjdWxhdGUgb3ZlcmFsbCBoZWFsdGggc2NvcmUgYmFzZWQgb24gdmFyaW91cyBmYWN0b3JzXG4gICAgaGVhbHRoX3Njb3JlID0gY2FsY3VsYXRlX2hlYWx0aF9zY29yZSgpXG4gICAgXG4gICAgbWV0cmljcy5hcHBlbmQoe1xuICAgICAgICAnTWV0cmljTmFtZSc6ICdPdmVyYWxsSGVhbHRoU2NvcmUnLFxuICAgICAgICAnVmFsdWUnOiBoZWFsdGhfc2NvcmUsXG4gICAgICAgICdVbml0JzogJ1BlcmNlbnQnLFxuICAgICAgICAnVGltZXN0YW1wJzogZGF0ZXRpbWUudXRjbm93KClcbiAgICB9KVxuICAgIFxuICAgIHJldHVybiBtZXRyaWNzXG5cbmRlZiBjb2xsZWN0X2J1c2luZXNzX21ldHJpY3MoKTpcbiAgICBcIlwiXCJDb2xsZWN0IGJ1c2luZXNzLXNwZWNpZmljIG1ldHJpY3NcIlwiXCJcbiAgICBtZXRyaWNzID0gW11cbiAgICBcbiAgICAjIEV4YW1wbGU6IEZyYXVkIGRldGVjdGlvbiByYXRlXG4gICAgZnJhdWRfcmF0ZSA9IGdldF9mcmF1ZF9kZXRlY3Rpb25fcmF0ZSgpXG4gICAgXG4gICAgbWV0cmljcy5hcHBlbmQoe1xuICAgICAgICAnTWV0cmljTmFtZSc6ICdGcmF1ZERldGVjdGlvblJhdGUnLFxuICAgICAgICAnVmFsdWUnOiBmcmF1ZF9yYXRlLFxuICAgICAgICAnVW5pdCc6ICdQZXJjZW50JyxcbiAgICAgICAgJ1RpbWVzdGFtcCc6IGRhdGV0aW1lLnV0Y25vdygpXG4gICAgfSlcbiAgICBcbiAgICByZXR1cm4gbWV0cmljc1xuXG5kZWYgY2FsY3VsYXRlX2hlYWx0aF9zY29yZSgpOlxuICAgIFwiXCJcIkNhbGN1bGF0ZSBvdmVyYWxsIHN5c3RlbSBoZWFsdGggc2NvcmVcIlwiXCJcbiAgICAjIFRoaXMgd291bGQgaW50ZWdyYXRlIHdpdGggeW91ciBhY3R1YWwgaGVhbHRoIGNoZWNrIGVuZHBvaW50c1xuICAgICMgRm9yIG5vdywgcmV0dXJuIGEgc2FtcGxlIHZhbHVlXG4gICAgcmV0dXJuIDk1LjBcblxuZGVmIGdldF9mcmF1ZF9kZXRlY3Rpb25fcmF0ZSgpOlxuICAgIFwiXCJcIkdldCBjdXJyZW50IGZyYXVkIGRldGVjdGlvbiByYXRlXCJcIlwiXG4gICAgIyBUaGlzIHdvdWxkIHF1ZXJ5IHlvdXIgYWN0dWFsIGZyYXVkIGRldGVjdGlvbiBtZXRyaWNzXG4gICAgIyBGb3Igbm93LCByZXR1cm4gYSBzYW1wbGUgdmFsdWVcbiAgICByZXR1cm4gNC4yXG5cbmRlZiBzZW5kX21ldHJpY3NfdG9fY2xvdWR3YXRjaChtZXRyaWNzKTpcbiAgICBcIlwiXCJTZW5kIG1ldHJpY3MgdG8gQ2xvdWRXYXRjaFwiXCJcIlxuICAgIGZvciBtZXRyaWMgaW4gbWV0cmljczpcbiAgICAgICAgY2xvdWR3YXRjaC5wdXRfbWV0cmljX2RhdGEoXG4gICAgICAgICAgICBOYW1lc3BhY2U9J0ZyYXVkRGV0ZWN0aW9uL0N1c3RvbScsXG4gICAgICAgICAgICBNZXRyaWNEYXRhPVt7XG4gICAgICAgICAgICAgICAgJ01ldHJpY05hbWUnOiBtZXRyaWNbJ01ldHJpY05hbWUnXSxcbiAgICAgICAgICAgICAgICAnVmFsdWUnOiBtZXRyaWNbJ1ZhbHVlJ10sXG4gICAgICAgICAgICAgICAgJ1VuaXQnOiBtZXRyaWNbJ1VuaXQnXSxcbiAgICAgICAgICAgICAgICAnVGltZXN0YW1wJzogbWV0cmljWydUaW1lc3RhbXAnXVxuICAgICAgICAgICAgfV1cbiAgICAgICAgKVxuYCksXG4gICAgfSk7XG5cbiAgICAvLyBFdmVudEJyaWRnZSBydWxlIHRvIHRyaWdnZXIgY3VzdG9tIG1ldHJpY3MgY29sbGVjdGlvblxuICAgIGNvbnN0IG1ldHJpY3NDb2xsZWN0aW9uUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnTWV0cmljc0NvbGxlY3Rpb25SdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5taW51dGVzKDUpKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVHJpZ2dlciBjdXN0b20gbWV0cmljcyBjb2xsZWN0aW9uIGV2ZXJ5IDUgbWludXRlcycsXG4gICAgfSk7XG5cbiAgICBtZXRyaWNzQ29sbGVjdGlvblJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGN1c3RvbU1ldHJpY3NMYW1iZGEpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTG9nQW5hbHlzaXMoZW52aXJvbm1lbnROYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAvLyBMYW1iZGEgZm9yIGxvZyBhbmFseXNpcyBhbmQgYW5vbWFseSBkZXRlY3Rpb25cbiAgICBjb25zdCBsb2dBbmFseXNpc1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xvZ0FuYWx5c2lzTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hMb2dzRnVsbEFjY2VzcycpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hGdWxsQWNjZXNzJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbG9nQW5hbHlzaXNMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdMb2dBbmFseXNpc0xhbWJkYScsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGZyYXVkLWRldGVjdGlvbi1sb2ctYW5hbHlzaXMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzksXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICByb2xlOiBsb2dBbmFseXNpc1JvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuaW1wb3J0IGpzb25cbmltcG9ydCBib3RvM1xuaW1wb3J0IHJlXG5mcm9tIGRhdGV0aW1lIGltcG9ydCBkYXRldGltZSwgdGltZWRlbHRhXG5cbmxvZ3NfY2xpZW50ID0gYm90bzMuY2xpZW50KCdsb2dzJylcbmNsb3Vkd2F0Y2ggPSBib3RvMy5jbGllbnQoJ2Nsb3Vkd2F0Y2gnKVxuc25zID0gYm90bzMuY2xpZW50KCdzbnMnKVxuXG5kZWYgaGFuZGxlcihldmVudCwgY29udGV4dCk6XG4gICAgXCJcIlwiXG4gICAgQW5hbHl6ZSBsb2dzIGZvciBhbm9tYWxpZXMgYW5kIHNlY3VyaXR5IGlzc3Vlc1xuICAgIFwiXCJcIlxuICAgIHRyeTpcbiAgICAgICAgIyBBbmFseXplIGRpZmZlcmVudCBsb2cgZ3JvdXBzXG4gICAgICAgIGxvZ19ncm91cHMgPSBbXG4gICAgICAgICAgICAnL2F3cy9mcmF1ZC1kZXRlY3Rpb24vJHtlbnZpcm9ubWVudE5hbWV9L2ZyYXVkLWRldGVjdGlvbi1hcGknLFxuICAgICAgICAgICAgJy9hd3MvZnJhdWQtZGV0ZWN0aW9uLyR7ZW52aXJvbm1lbnROYW1lfS9mcmF1ZC1kZXRlY3Rpb24tbWwtbW9kZWxzJyxcbiAgICAgICAgICAgICcvYXdzL2ZyYXVkLWRldGVjdGlvbi8ke2Vudmlyb25tZW50TmFtZX0vZnJhdWQtZGV0ZWN0aW9uLWZsaW5rJ1xuICAgICAgICBdXG4gICAgICAgIFxuICAgICAgICBmb3IgbG9nX2dyb3VwIGluIGxvZ19ncm91cHM6XG4gICAgICAgICAgICBhbmFseXplX2xvZ19ncm91cChsb2dfZ3JvdXApXG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgJ3N0YXR1c0NvZGUnOiAyMDAsXG4gICAgICAgICAgICAnYm9keSc6IGpzb24uZHVtcHMoJ0xvZyBhbmFseXNpcyBjb21wbGV0ZWQnKVxuICAgICAgICB9XG4gICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOlxuICAgICAgICBwcmludChmXCJFcnJvciBpbiBsb2cgYW5hbHlzaXM6IHtzdHIoZSl9XCIpXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAnc3RhdHVzQ29kZSc6IDUwMCxcbiAgICAgICAgICAgICdib2R5JzoganNvbi5kdW1wcyhmJ0Vycm9yOiB7c3RyKGUpfScpXG4gICAgICAgIH1cblxuZGVmIGFuYWx5emVfbG9nX2dyb3VwKGxvZ19ncm91cF9uYW1lKTpcbiAgICBcIlwiXCJBbmFseXplIGEgc3BlY2lmaWMgbG9nIGdyb3VwIGZvciBhbm9tYWxpZXNcIlwiXCJcbiAgICB0cnk6XG4gICAgICAgICMgR2V0IGxvZ3MgZnJvbSBsYXN0IDUgbWludXRlc1xuICAgICAgICBlbmRfdGltZSA9IGRhdGV0aW1lLnV0Y25vdygpXG4gICAgICAgIHN0YXJ0X3RpbWUgPSBlbmRfdGltZSAtIHRpbWVkZWx0YShtaW51dGVzPTUpXG4gICAgICAgIFxuICAgICAgICByZXNwb25zZSA9IGxvZ3NfY2xpZW50LmZpbHRlcl9sb2dfZXZlbnRzKFxuICAgICAgICAgICAgbG9nR3JvdXBOYW1lPWxvZ19ncm91cF9uYW1lLFxuICAgICAgICAgICAgc3RhcnRUaW1lPWludChzdGFydF90aW1lLnRpbWVzdGFtcCgpICogMTAwMCksXG4gICAgICAgICAgICBlbmRUaW1lPWludChlbmRfdGltZS50aW1lc3RhbXAoKSAqIDEwMDApXG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIGV2ZW50cyA9IHJlc3BvbnNlLmdldCgnZXZlbnRzJywgW10pXG4gICAgICAgIFxuICAgICAgICAjIEFuYWx5emUgZXZlbnRzIGZvciBwYXR0ZXJuc1xuICAgICAgICBlcnJvcl9jb3VudCA9IGNvdW50X2Vycm9ycyhldmVudHMpXG4gICAgICAgIHNlY3VyaXR5X2lzc3VlcyA9IGRldGVjdF9zZWN1cml0eV9pc3N1ZXMoZXZlbnRzKVxuICAgICAgICBcbiAgICAgICAgIyBTZW5kIG1ldHJpY3NcbiAgICAgICAgaWYgZXJyb3JfY291bnQgPiAwOlxuICAgICAgICAgICAgc2VuZF9tZXRyaWMoJ0Vycm9yQ291bnQnLCBlcnJvcl9jb3VudCwgbG9nX2dyb3VwX25hbWUpXG4gICAgICAgIFxuICAgICAgICBpZiBzZWN1cml0eV9pc3N1ZXMgPiAwOlxuICAgICAgICAgICAgc2VuZF9tZXRyaWMoJ1NlY3VyaXR5SXNzdWVzJywgc2VjdXJpdHlfaXNzdWVzLCBsb2dfZ3JvdXBfbmFtZSlcbiAgICAgICAgICAgIHNlbmRfc2VjdXJpdHlfYWxlcnQobG9nX2dyb3VwX25hbWUsIHNlY3VyaXR5X2lzc3VlcylcbiAgICAgICAgICAgIFxuICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZTpcbiAgICAgICAgcHJpbnQoZlwiRXJyb3IgYW5hbHl6aW5nIGxvZyBncm91cCB7bG9nX2dyb3VwX25hbWV9OiB7c3RyKGUpfVwiKVxuXG5kZWYgY291bnRfZXJyb3JzKGV2ZW50cyk6XG4gICAgXCJcIlwiQ291bnQgZXJyb3IgZXZlbnRzXCJcIlwiXG4gICAgZXJyb3JfcGF0dGVybnMgPSBbXG4gICAgICAgIHInRVJST1InLFxuICAgICAgICByJ0V4Y2VwdGlvbicsXG4gICAgICAgIHInRmFpbGVkJyxcbiAgICAgICAgcidFcnJvcjonXG4gICAgXVxuICAgIFxuICAgIGVycm9yX2NvdW50ID0gMFxuICAgIGZvciBldmVudCBpbiBldmVudHM6XG4gICAgICAgIG1lc3NhZ2UgPSBldmVudC5nZXQoJ21lc3NhZ2UnLCAnJylcbiAgICAgICAgZm9yIHBhdHRlcm4gaW4gZXJyb3JfcGF0dGVybnM6XG4gICAgICAgICAgICBpZiByZS5zZWFyY2gocGF0dGVybiwgbWVzc2FnZSwgcmUuSUdOT1JFQ0FTRSk6XG4gICAgICAgICAgICAgICAgZXJyb3JfY291bnQgKz0gMVxuICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgXG4gICAgcmV0dXJuIGVycm9yX2NvdW50XG5cbmRlZiBkZXRlY3Rfc2VjdXJpdHlfaXNzdWVzKGV2ZW50cyk6XG4gICAgXCJcIlwiRGV0ZWN0IHBvdGVudGlhbCBzZWN1cml0eSBpc3N1ZXNcIlwiXCJcbiAgICBzZWN1cml0eV9wYXR0ZXJucyA9IFtcbiAgICAgICAgcid1bmF1dGhvcml6ZWQnLFxuICAgICAgICByJ2ZvcmJpZGRlbicsXG4gICAgICAgIHInYXV0aGVudGljYXRpb24gZmFpbGVkJyxcbiAgICAgICAgcidzdXNwaWNpb3VzJyxcbiAgICAgICAgcidhdHRhY2snLFxuICAgICAgICByJ21hbGljaW91cydcbiAgICBdXG4gICAgXG4gICAgc2VjdXJpdHlfY291bnQgPSAwXG4gICAgZm9yIGV2ZW50IGluIGV2ZW50czpcbiAgICAgICAgbWVzc2FnZSA9IGV2ZW50LmdldCgnbWVzc2FnZScsICcnKVxuICAgICAgICBmb3IgcGF0dGVybiBpbiBzZWN1cml0eV9wYXR0ZXJuczpcbiAgICAgICAgICAgIGlmIHJlLnNlYXJjaChwYXR0ZXJuLCBtZXNzYWdlLCByZS5JR05PUkVDQVNFKTpcbiAgICAgICAgICAgICAgICBzZWN1cml0eV9jb3VudCArPSAxXG4gICAgICAgICAgICAgICAgYnJlYWtcbiAgICBcbiAgICByZXR1cm4gc2VjdXJpdHlfY291bnRcblxuZGVmIHNlbmRfbWV0cmljKG1ldHJpY19uYW1lLCB2YWx1ZSwgbG9nX2dyb3VwKTpcbiAgICBcIlwiXCJTZW5kIG1ldHJpYyB0byBDbG91ZFdhdGNoXCJcIlwiXG4gICAgY2xvdWR3YXRjaC5wdXRfbWV0cmljX2RhdGEoXG4gICAgICAgIE5hbWVzcGFjZT0nRnJhdWREZXRlY3Rpb24vTG9nQW5hbHlzaXMnLFxuICAgICAgICBNZXRyaWNEYXRhPVt7XG4gICAgICAgICAgICAnTWV0cmljTmFtZSc6IG1ldHJpY19uYW1lLFxuICAgICAgICAgICAgJ1ZhbHVlJzogdmFsdWUsXG4gICAgICAgICAgICAnVW5pdCc6ICdDb3VudCcsXG4gICAgICAgICAgICAnRGltZW5zaW9ucyc6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICdOYW1lJzogJ0xvZ0dyb3VwJyxcbiAgICAgICAgICAgICAgICAgICAgJ1ZhbHVlJzogbG9nX2dyb3VwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICdUaW1lc3RhbXAnOiBkYXRldGltZS51dGNub3coKVxuICAgICAgICB9XVxuICAgIClcblxuZGVmIHNlbmRfc2VjdXJpdHlfYWxlcnQobG9nX2dyb3VwLCBjb3VudCk6XG4gICAgXCJcIlwiU2VuZCBzZWN1cml0eSBhbGVydCB2aWEgU05TXCJcIlwiXG4gICAgbWVzc2FnZSA9IGZcIlNlY3VyaXR5IGlzc3VlcyBkZXRlY3RlZCBpbiB7bG9nX2dyb3VwfToge2NvdW50fSBwb3RlbnRpYWwgaXNzdWVzIGZvdW5kXCJcbiAgICBcbiAgICAjIFRoaXMgd291bGQgdXNlIHRoZSBhY3R1YWwgU05TIHRvcGljIEFSTlxuICAgIHNucy5wdWJsaXNoKFxuICAgICAgICBUb3BpY0Fybj0nJHt0aGlzLmFsZXJ0VG9waWMudG9waWNBcm59JyxcbiAgICAgICAgTWVzc2FnZT1tZXNzYWdlLFxuICAgICAgICBTdWJqZWN0PSdGcmF1ZCBEZXRlY3Rpb24gU2VjdXJpdHkgQWxlcnQnXG4gICAgKVxuYCksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBwdWJsaXNoIHRvIFNOU1xuICAgIHRoaXMuYWxlcnRUb3BpYy5ncmFudFB1Ymxpc2gobG9nQW5hbHlzaXNMYW1iZGEpO1xuXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZSBmb3IgbG9nIGFuYWx5c2lzXG4gICAgY29uc3QgbG9nQW5hbHlzaXNSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdMb2dBbmFseXNpc1J1bGUnLCB7XG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUoY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkpLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VyIGxvZyBhbmFseXNpcyBldmVyeSA1IG1pbnV0ZXMnLFxuICAgIH0pO1xuXG4gICAgbG9nQW5hbHlzaXNSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihsb2dBbmFseXNpc0xhbWJkYSkpO1xuICB9XG59Il19