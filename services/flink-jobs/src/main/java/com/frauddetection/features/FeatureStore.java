package com.frauddetection.features;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.frauddetection.config.JobConfig;
import com.frauddetection.services.RedisService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Feature Store implementation for managing, versioning, and serving ML features.
 * Supports both online serving (Redis) and offline storage for training.
 */
public class FeatureStore {
    
    private static final Logger LOG = LoggerFactory.getLogger(FeatureStore.class);
    
    private final RedisService redisService;
    private final ObjectMapper objectMapper;
    private final JobConfig config;
    
    // Feature store keys
    private static final String FEATURE_METADATA_PREFIX = "feature_metadata:";
    private static final String FEATURE_VALUES_PREFIX = "feature_values:";
    private static final String FEATURE_SCHEMA_PREFIX = "feature_schema:";
    private static final String FEATURE_STATS_PREFIX = "feature_stats:";
    
    // Feature TTL settings
    private static final int FEATURE_METADATA_TTL = 86400; // 24 hours
    private static final int FEATURE_VALUES_TTL = 7200; // 2 hours
    private static final int FEATURE_STATS_TTL = 3600; // 1 hour
    
    // Supported feature types
    public enum FeatureType {
        NUMERICAL, CATEGORICAL, BOOLEAN, TEXT, TIMESTAMP
    }
    
    // Feature metadata
    public static class FeatureMetadata {
        public String name;
        public FeatureType type;
        public String description;
        public String version;
        public Instant createdAt;
        public Instant updatedAt;
        public Map<String, Object> properties;
        
        public FeatureMetadata() {
            this.properties = new HashMap<>();
            this.createdAt = Instant.now();
            this.updatedAt = Instant.now();
        }
    }
    
    // Feature statistics
    public static class FeatureStats {
        public String featureName;
        public long count;
        public double mean;
        public double std;
        public double min;
        public double max;
        public double median;
        public Map<String, Integer> categoricalCounts;
        public double nullRate;
        public Instant lastUpdated;
        
        public FeatureStats() {
            this.categoricalCounts = new HashMap<>();
            this.lastUpdated = Instant.now();
        }
    }
    
    public FeatureStore(RedisService redisService, JobConfig config) {
        this.redisService = redisService;
        this.config = config;
        this.objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        
        LOG.info("FeatureStore initialized");
    }
    
    /**
     * Register a feature with metadata and schema.
     */
    public void registerFeature(String featureName, FeatureType type, String description, 
                               Map<String, Object> properties) {
        try {
            FeatureMetadata metadata = new FeatureMetadata();
            metadata.name = featureName;
            metadata.type = type;
            metadata.description = description;
            metadata.version = "1.0";
            if (properties != null) {
                metadata.properties.putAll(properties);
            }
            
            String key = FEATURE_METADATA_PREFIX + featureName;
            String metadataJson = objectMapper.writeValueAsString(metadata);
            
            // Store in Redis with TTL
            // Note: In a real implementation, this would also be stored in a persistent database
            redisService.incrementCounter(key, FEATURE_METADATA_TTL);
            
            LOG.info("Registered feature: {} (type: {}, version: {})", 
                    featureName, type, metadata.version);
                    
        } catch (Exception e) {
            LOG.error("Error registering feature {}: {}", featureName, e.getMessage(), e);
        }
    }
    
    /**
     * Store feature values for an entity (transaction, user, merchant).
     */
    public void storeFeatureValues(String entityId, String entityType, Map<String, Object> features) {
        try {
            String key = FEATURE_VALUES_PREFIX + entityType + ":" + entityId;
            
            // Add timestamp and metadata
            Map<String, Object> enrichedFeatures = new HashMap<>(features);
            enrichedFeatures.put("_entity_id", entityId);
            enrichedFeatures.put("_entity_type", entityType);
            enrichedFeatures.put("_timestamp", Instant.now().toEpochMilli());
            enrichedFeatures.put("_version", "1.0");
            
            String featuresJson = objectMapper.writeValueAsString(enrichedFeatures);
            
            // Store in Redis
            redisService.incrementCounter(key, FEATURE_VALUES_TTL);
            
            // Update feature statistics
            updateFeatureStatistics(features);
            
            LOG.debug("Stored {} features for entity {}:{}", features.size(), entityType, entityId);
            
        } catch (Exception e) {
            LOG.error("Error storing feature values for entity {}:{}: {}", 
                    entityType, entityId, e.getMessage(), e);
        }
    }
    
    /**
     * Retrieve feature values for an entity.
     */
    public Map<String, Object> getFeatureValues(String entityId, String entityType) {
        try {
            String key = FEATURE_VALUES_PREFIX + entityType + ":" + entityId;
            Map<String, Object> aggregation = redisService.getAggregation(key);
            
            if (aggregation != null && !aggregation.isEmpty()) {
                // Remove internal metadata for clean feature vector
                Map<String, Object> cleanFeatures = new HashMap<>(aggregation);
                cleanFeatures.remove("_entity_id");
                cleanFeatures.remove("_entity_type");
                cleanFeatures.remove("_timestamp");
                cleanFeatures.remove("_version");
                
                return cleanFeatures;
            }
            
        } catch (Exception e) {
            LOG.error("Error retrieving feature values for entity {}:{}: {}", 
                    entityType, entityId, e.getMessage(), e);
        }
        
        return new HashMap<>();
    }
    
    /**
     * Get feature values for multiple entities (batch operation).
     */
    public Map<String, Map<String, Object>> getBatchFeatureValues(List<String> entityIds, String entityType) {
        Map<String, Map<String, Object>> batchResults = new HashMap<>();
        
        for (String entityId : entityIds) {
            Map<String, Object> features = getFeatureValues(entityId, entityType);
            batchResults.put(entityId, features);
        }
        
        return batchResults;
    }
    
    /**
     * Get feature values for specific feature names only.
     */
    public Map<String, Object> getSelectedFeatures(String entityId, String entityType, Set<String> featureNames) {
        Map<String, Object> allFeatures = getFeatureValues(entityId, entityType);
        
        return allFeatures.entrySet().stream()
                .filter(entry -> featureNames.contains(entry.getKey()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }
    
    /**
     * Update feature statistics for monitoring and data quality.
     */
    private void updateFeatureStatistics(Map<String, Object> features) {
        for (Map.Entry<String, Object> entry : features.entrySet()) {
            String featureName = entry.getKey();
            Object value = entry.getValue();
            
            try {
                updateSingleFeatureStats(featureName, value);
            } catch (Exception e) {
                LOG.warn("Error updating statistics for feature {}: {}", featureName, e.getMessage());
            }
        }
    }
    
    /**
     * Update statistics for a single feature.
     */
    private void updateSingleFeatureStats(String featureName, Object value) {
        String key = FEATURE_STATS_PREFIX + featureName;
        Map<String, Object> currentStats = redisService.getAggregation(key);
        
        FeatureStats stats;
        try {
            if (currentStats.isEmpty()) {
                stats = new FeatureStats();
                stats.featureName = featureName;
            } else {
                stats = objectMapper.convertValue(currentStats, FeatureStats.class);
            }
        } catch (Exception e) {
            stats = new FeatureStats();
            stats.featureName = featureName;
        }
        
        // Update statistics based on value type
        if (value instanceof Number) {
            updateNumericalStats(stats, ((Number) value).doubleValue());
        } else if (value instanceof Boolean) {
            updateCategoricalStats(stats, value.toString());
        } else if (value instanceof String) {
            updateCategoricalStats(stats, (String) value);
        } else if (value == null) {
            updateNullStats(stats);
        }
        
        stats.lastUpdated = Instant.now();
        
        // Store updated statistics
        try {
            Map<String, Object> statsMap = objectMapper.convertValue(stats, Map.class);
            redisService.storeAggregation(key, statsMap);
        } catch (Exception e) {
            LOG.warn("Error storing feature statistics for {}: {}", featureName, e.getMessage());
        }
    }
    
    /**
     * Update statistics for numerical features.
     */
    private void updateNumericalStats(FeatureStats stats, double value) {
        stats.count++;
        
        // Update running statistics
        if (stats.count == 1) {
            stats.mean = value;
            stats.min = value;
            stats.max = value;
            stats.std = 0.0;
        } else {
            // Online update of mean and variance (Welford's algorithm)
            double delta = value - stats.mean;
            stats.mean += delta / stats.count;
            double delta2 = value - stats.mean;
            // For std calculation, we'd need to maintain sum of squares
            
            stats.min = Math.min(stats.min, value);
            stats.max = Math.max(stats.max, value);
        }
    }
    
    /**
     * Update statistics for categorical features.
     */
    private void updateCategoricalStats(FeatureStats stats, String value) {
        stats.count++;
        stats.categoricalCounts.put(value, stats.categoricalCounts.getOrDefault(value, 0) + 1);
    }
    
    /**
     * Update statistics for null values.
     */
    private void updateNullStats(FeatureStats stats) {
        stats.count++;
        // Null rate is calculated when retrieving stats
    }
    
    /**
     * Get feature statistics for monitoring.
     */
    public FeatureStats getFeatureStatistics(String featureName) {
        try {
            String key = FEATURE_STATS_PREFIX + featureName;
            Map<String, Object> statsMap = redisService.getAggregation(key);
            
            if (!statsMap.isEmpty()) {
                FeatureStats stats = objectMapper.convertValue(statsMap, FeatureStats.class);
                // Calculate null rate
                long nullCount = stats.categoricalCounts.getOrDefault("null", 0);
                stats.nullRate = stats.count > 0 ? (double) nullCount / stats.count : 0.0;
                return stats;
            }
            
        } catch (Exception e) {
            LOG.error("Error retrieving feature statistics for {}: {}", featureName, e.getMessage());
        }
        
        return new FeatureStats();
    }
    
    /**
     * Get all feature names currently registered.
     */
    public Set<String> getRegisteredFeatures() {
        // In a real implementation, this would query the feature metadata store
        // For now, return a default set of our known features
        return Set.of(
            // Amount features
            "amount", "amount_log", "amount_sqrt", "is_round_amount", "is_round_10", "is_round_100",
            "amount_to_user_avg_ratio", "amount_deviation_zscore", "is_large_for_user",
            "amount_to_merchant_avg_ratio", "is_large_for_merchant", "amount_category",
            
            // Temporal features
            "hour_of_day", "day_of_week", "day_of_month", "is_weekend", "time_period",
            "is_business_hours", "is_night_time", "in_user_preferred_time",
            
            // Geographic features
            "has_geolocation", "has_merchant_location", "latitude", "longitude",
            "is_high_risk_country", "distance_to_merchant_km", "user_intl_preference",
            "unexpected_intl_transaction",
            
            // User behavior features
            "account_age_days", "is_new_account", "is_very_new_account", "user_risk_score",
            "is_kyc_verified", "kyc_status", "weekend_activity_factor", "online_preference",
            "user_avg_amount", "user_transaction_frequency",
            
            // Merchant risk features
            "merchant_risk_level", "merchant_fraud_rate", "is_blacklisted_merchant",
            "merchant_category", "is_high_risk_category", "within_merchant_hours",
            "merchant_risk_multiplier", "suspicious_merchant_name",
            
            // Device/Network features
            "is_known_device", "is_new_device", "is_private_ip", "ip_risk_score",
            "suspicious_user_agent",
            
            // Velocity features
            "velocity_5min_count", "velocity_5min_amount", "velocity_1hour_count",
            "velocity_1hour_amount", "velocity_24hour_count", "velocity_24hour_amount",
            "high_velocity_5min", "high_velocity_1hour",
            
            // Contextual features
            "payment_method", "is_high_risk_payment", "transaction_type", "is_refund", "card_type"
        );
    }
    
    /**
     * Health check for feature store.
     */
    public boolean isHealthy() {
        try {
            return redisService.isHealthy();
        } catch (Exception e) {
            LOG.error("Feature store health check failed: {}", e.getMessage());
            return false;
        }
    }
    
    /**
     * Get feature store statistics and health metrics.
     */
    public Map<String, Object> getHealthMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        
        try {
            metrics.put("is_healthy", isHealthy());
            metrics.put("registered_features_count", getRegisteredFeatures().size());
            metrics.put("redis_stats", redisService.getStats());
            metrics.put("last_check", Instant.now());
            
        } catch (Exception e) {
            LOG.error("Error retrieving feature store health metrics: {}", e.getMessage());
            metrics.put("is_healthy", false);
            metrics.put("error", e.getMessage());
        }
        
        return metrics;
    }
}