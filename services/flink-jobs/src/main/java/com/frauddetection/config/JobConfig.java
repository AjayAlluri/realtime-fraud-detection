package com.frauddetection.config;

import java.io.Serializable;
import java.util.Arrays;

/**
 * Configuration class for Flink fraud detection job.
 * Contains all configurable parameters with sensible defaults.
 */
public class JobConfig implements Serializable {
    
    private static final long serialVersionUID = 1L;
    
    // Kafka Configuration
    private String kafkaBrokers = "localhost:9092,localhost:9093,localhost:9094";
    private String consumerGroupId = "fraud-detection-flink-job";
    private String schemaRegistryUrl = "http://localhost:8082";
    
    // Redis Configuration
    private String redisHost = "localhost";
    private int redisPort = 6379;
    private String redisPassword = "redis123";
    private int redisMaxConnections = 20;
    private int redisTimeout = 5000;
    
    // PostgreSQL Configuration
    private String postgresHost = "localhost";
    private int postgresPort = 5432;
    private String postgresDatabase = "fraud_detection";
    private String postgresUsername = "admin";
    private String postgresPassword = "admin123";
    
    // Flink Job Configuration
    private int parallelism = 12;
    private long checkpointInterval = 10000; // 10 seconds
    private long minPauseBetweenCheckpoints = 5000; // 5 seconds
    private long checkpointTimeout = 60000; // 60 seconds
    private int maxConcurrentCheckpoints = 1;
    
    // Feature Store Configuration
    private boolean enableFeatureStore = true;
    private int featureStoreTtl = 3600; // 1 hour
    private int featureStoreMaxSize = 100000;
    
    // ML Model Configuration
    private boolean enableRealTimeScoring = true;
    private double fraudThreshold = 0.7;
    private String modelPath = "/opt/flink/models";
    
    // Windowing Configuration
    private long velocityWindowSize = 300000; // 5 minutes in milliseconds
    private long sessionWindowGap = 1800000; // 30 minutes in milliseconds
    private long patternWindowSize = 3600000; // 1 hour in milliseconds
    
    // Metrics Configuration
    private boolean enableMetrics = true;
    private String metricsReporter = "prometheus";
    private int metricsPort = 9249;
    
    // Alert Configuration
    private boolean enableAlerting = true;
    private double criticalAlertThreshold = 0.9;
    private double highAlertThreshold = 0.8;
    private int maxAlertsPerMinute = 100;
    
    /**
     * Create configuration from command line arguments.
     */
    public static JobConfig fromArgs(String[] args) {
        JobConfig config = new JobConfig();
        
        for (int i = 0; i < args.length; i += 2) {
            if (i + 1 >= args.length) break;
            
            String key = args[i];
            String value = args[i + 1];
            
            switch (key) {
                case "--kafka-brokers":
                    config.kafkaBrokers = value;
                    break;
                case "--consumer-group-id":
                    config.consumerGroupId = value;
                    break;
                case "--redis-host":
                    config.redisHost = value;
                    break;
                case "--redis-port":
                    config.redisPort = Integer.parseInt(value);
                    break;
                case "--redis-password":
                    config.redisPassword = value;
                    break;
                case "--parallelism":
                    config.parallelism = Integer.parseInt(value);
                    break;
                case "--checkpoint-interval":
                    config.checkpointInterval = Long.parseLong(value);
                    break;
                case "--fraud-threshold":
                    config.fraudThreshold = Double.parseDouble(value);
                    break;
                case "--postgres-host":
                    config.postgresHost = value;
                    break;
                case "--postgres-port":
                    config.postgresPort = Integer.parseInt(value);
                    break;
                case "--postgres-database":
                    config.postgresDatabase = value;
                    break;
                case "--postgres-username":
                    config.postgresUsername = value;
                    break;
                case "--postgres-password":
                    config.postgresPassword = value;
                    break;
                case "--enable-feature-store":
                    config.enableFeatureStore = Boolean.parseBoolean(value);
                    break;
                case "--enable-real-time-scoring":
                    config.enableRealTimeScoring = Boolean.parseBoolean(value);
                    break;
                case "--model-path":
                    config.modelPath = value;
                    break;
                case "--velocity-window-size":
                    config.velocityWindowSize = Long.parseLong(value);
                    break;
                case "--enable-metrics":
                    config.enableMetrics = Boolean.parseBoolean(value);
                    break;
                case "--metrics-port":
                    config.metricsPort = Integer.parseInt(value);
                    break;
                case "--enable-alerting":
                    config.enableAlerting = Boolean.parseBoolean(value);
                    break;
                default:
                    // Ignore unknown parameters
                    break;
            }
        }
        
        return config;
    }
    
    /**
     * Get Redis connection URL.
     */
    public String getRedisUrl() {
        return String.format("redis://:%s@%s:%d", redisPassword, redisHost, redisPort);
    }
    
    /**
     * Get PostgreSQL JDBC URL.
     */
    public String getPostgresJdbcUrl() {
        return String.format("jdbc:postgresql://%s:%d/%s", postgresHost, postgresPort, postgresDatabase);
    }
    
    /**
     * Get Kafka broker list as array.
     */
    public String[] getKafkaBrokerArray() {
        return kafkaBrokers.split(",");
    }
    
    /**
     * Validate configuration parameters.
     */
    public void validate() {
        if (kafkaBrokers == null || kafkaBrokers.trim().isEmpty()) {
            throw new IllegalArgumentException("Kafka brokers cannot be null or empty");
        }
        
        if (consumerGroupId == null || consumerGroupId.trim().isEmpty()) {
            throw new IllegalArgumentException("Consumer group ID cannot be null or empty");
        }
        
        if (redisHost == null || redisHost.trim().isEmpty()) {
            throw new IllegalArgumentException("Redis host cannot be null or empty");
        }
        
        if (redisPort <= 0 || redisPort > 65535) {
            throw new IllegalArgumentException("Redis port must be between 1 and 65535");
        }
        
        if (parallelism <= 0) {
            throw new IllegalArgumentException("Parallelism must be greater than 0");
        }
        
        if (checkpointInterval <= 0) {
            throw new IllegalArgumentException("Checkpoint interval must be greater than 0");
        }
        
        if (fraudThreshold < 0.0 || fraudThreshold > 1.0) {
            throw new IllegalArgumentException("Fraud threshold must be between 0.0 and 1.0");
        }
    }
    
    // Getters and Setters
    public String getKafkaBrokers() { return kafkaBrokers; }
    public void setKafkaBrokers(String kafkaBrokers) { this.kafkaBrokers = kafkaBrokers; }
    
    public String getConsumerGroupId() { return consumerGroupId; }
    public void setConsumerGroupId(String consumerGroupId) { this.consumerGroupId = consumerGroupId; }
    
    public String getSchemaRegistryUrl() { return schemaRegistryUrl; }
    public void setSchemaRegistryUrl(String schemaRegistryUrl) { this.schemaRegistryUrl = schemaRegistryUrl; }
    
    public String getRedisHost() { return redisHost; }
    public void setRedisHost(String redisHost) { this.redisHost = redisHost; }
    
    public int getRedisPort() { return redisPort; }
    public void setRedisPort(int redisPort) { this.redisPort = redisPort; }
    
    public String getRedisPassword() { return redisPassword; }
    public void setRedisPassword(String redisPassword) { this.redisPassword = redisPassword; }
    
    public int getRedisMaxConnections() { return redisMaxConnections; }
    public void setRedisMaxConnections(int redisMaxConnections) { this.redisMaxConnections = redisMaxConnections; }
    
    public int getRedisTimeout() { return redisTimeout; }
    public void setRedisTimeout(int redisTimeout) { this.redisTimeout = redisTimeout; }
    
    public String getPostgresHost() { return postgresHost; }
    public void setPostgresHost(String postgresHost) { this.postgresHost = postgresHost; }
    
    public int getPostgresPort() { return postgresPort; }
    public void setPostgresPort(int postgresPort) { this.postgresPort = postgresPort; }
    
    public String getPostgresDatabase() { return postgresDatabase; }
    public void setPostgresDatabase(String postgresDatabase) { this.postgresDatabase = postgresDatabase; }
    
    public String getPostgresUsername() { return postgresUsername; }
    public void setPostgresUsername(String postgresUsername) { this.postgresUsername = postgresUsername; }
    
    public String getPostgresPassword() { return postgresPassword; }
    public void setPostgresPassword(String postgresPassword) { this.postgresPassword = postgresPassword; }
    
    public int getParallelism() { return parallelism; }
    public void setParallelism(int parallelism) { this.parallelism = parallelism; }
    
    public long getCheckpointInterval() { return checkpointInterval; }
    public void setCheckpointInterval(long checkpointInterval) { this.checkpointInterval = checkpointInterval; }
    
    public long getMinPauseBetweenCheckpoints() { return minPauseBetweenCheckpoints; }
    public void setMinPauseBetweenCheckpoints(long minPauseBetweenCheckpoints) { this.minPauseBetweenCheckpoints = minPauseBetweenCheckpoints; }
    
    public long getCheckpointTimeout() { return checkpointTimeout; }
    public void setCheckpointTimeout(long checkpointTimeout) { this.checkpointTimeout = checkpointTimeout; }
    
    public int getMaxConcurrentCheckpoints() { return maxConcurrentCheckpoints; }
    public void setMaxConcurrentCheckpoints(int maxConcurrentCheckpoints) { this.maxConcurrentCheckpoints = maxConcurrentCheckpoints; }
    
    public boolean isEnableFeatureStore() { return enableFeatureStore; }
    public void setEnableFeatureStore(boolean enableFeatureStore) { this.enableFeatureStore = enableFeatureStore; }
    
    public int getFeatureStoreTtl() { return featureStoreTtl; }
    public void setFeatureStoreTtl(int featureStoreTtl) { this.featureStoreTtl = featureStoreTtl; }
    
    public int getFeatureStoreMaxSize() { return featureStoreMaxSize; }
    public void setFeatureStoreMaxSize(int featureStoreMaxSize) { this.featureStoreMaxSize = featureStoreMaxSize; }
    
    public boolean isEnableRealTimeScoring() { return enableRealTimeScoring; }
    public void setEnableRealTimeScoring(boolean enableRealTimeScoring) { this.enableRealTimeScoring = enableRealTimeScoring; }
    
    public double getFraudThreshold() { return fraudThreshold; }
    public void setFraudThreshold(double fraudThreshold) { this.fraudThreshold = fraudThreshold; }
    
    public String getModelPath() { return modelPath; }
    public void setModelPath(String modelPath) { this.modelPath = modelPath; }
    
    public long getVelocityWindowSize() { return velocityWindowSize; }
    public void setVelocityWindowSize(long velocityWindowSize) { this.velocityWindowSize = velocityWindowSize; }
    
    public long getSessionWindowGap() { return sessionWindowGap; }
    public void setSessionWindowGap(long sessionWindowGap) { this.sessionWindowGap = sessionWindowGap; }
    
    public long getPatternWindowSize() { return patternWindowSize; }
    public void setPatternWindowSize(long patternWindowSize) { this.patternWindowSize = patternWindowSize; }
    
    public boolean isEnableMetrics() { return enableMetrics; }
    public void setEnableMetrics(boolean enableMetrics) { this.enableMetrics = enableMetrics; }
    
    public String getMetricsReporter() { return metricsReporter; }
    public void setMetricsReporter(String metricsReporter) { this.metricsReporter = metricsReporter; }
    
    public int getMetricsPort() { return metricsPort; }
    public void setMetricsPort(int metricsPort) { this.metricsPort = metricsPort; }
    
    public boolean isEnableAlerting() { return enableAlerting; }
    public void setEnableAlerting(boolean enableAlerting) { this.enableAlerting = enableAlerting; }
    
    public double getCriticalAlertThreshold() { return criticalAlertThreshold; }
    public void setCriticalAlertThreshold(double criticalAlertThreshold) { this.criticalAlertThreshold = criticalAlertThreshold; }
    
    public double getHighAlertThreshold() { return highAlertThreshold; }
    public void setHighAlertThreshold(double highAlertThreshold) { this.highAlertThreshold = highAlertThreshold; }
    
    public int getMaxAlertsPerMinute() { return maxAlertsPerMinute; }
    public void setMaxAlertsPerMinute(int maxAlertsPerMinute) { this.maxAlertsPerMinute = maxAlertsPerMinute; }
    
    @Override
    public String toString() {
        return "JobConfig{" +
                "kafkaBrokers='" + kafkaBrokers + '\'' +
                ", consumerGroupId='" + consumerGroupId + '\'' +
                ", redisHost='" + redisHost + '\'' +
                ", redisPort=" + redisPort +
                ", parallelism=" + parallelism +
                ", checkpointInterval=" + checkpointInterval +
                ", fraudThreshold=" + fraudThreshold +
                ", enableFeatureStore=" + enableFeatureStore +
                ", enableRealTimeScoring=" + enableRealTimeScoring +
                ", enableMetrics=" + enableMetrics +
                ", enableAlerting=" + enableAlerting +
                '}';
    }
}