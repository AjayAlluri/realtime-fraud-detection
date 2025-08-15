package com.frauddetection.sinks;

import com.frauddetection.config.JobConfig;
import com.frauddetection.models.Transaction;
import com.frauddetection.services.RedisService;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.sink.RichSinkFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Flink sink function for writing enriched transactions to Redis.
 * Stores transactions for real-time lookups, velocity calculations, and feature storage.
 */
public class RedisTransactionSink extends RichSinkFunction<Transaction> {
    
    private static final Logger LOG = LoggerFactory.getLogger(RedisTransactionSink.class);
    
    private final JobConfig config;
    private transient RedisService redisService;
    
    // Metrics
    private transient long processedCount = 0;
    private transient long errorCount = 0;
    private transient long lastLogTime = 0;
    
    public RedisTransactionSink(JobConfig config) {
        this.config = config;
    }
    
    @Override
    public void open(Configuration parameters) throws Exception {
        super.open(parameters);
        
        // Initialize Redis service
        this.redisService = new RedisService(config);
        this.lastLogTime = System.currentTimeMillis();
        
        LOG.info("RedisTransactionSink initialized");
    }
    
    @Override
    public void close() throws Exception {
        if (redisService != null) {
            redisService.close();
        }
        
        LOG.info("RedisTransactionSink closed. Processed: {}, Errors: {}", processedCount, errorCount);
        super.close();
    }
    
    @Override
    public void invoke(Transaction transaction, Context context) throws Exception {
        try {
            // Store the enriched transaction
            redisService.cacheTransaction(transaction);
            
            // Store features separately for ML training
            if (transaction.getFeatures() != null && !transaction.getFeatures().isEmpty()) {
                redisService.storeFeatures(transaction.getTransactionId(), transaction.getFeatures());
            }
            
            // Update velocity metrics
            updateVelocityMetrics(transaction);
            
            // Update aggregations
            updateAggregations(transaction);
            
            processedCount++;
            
            // Log progress periodically
            logProgress();
            
        } catch (Exception e) {
            errorCount++;
            LOG.error("Error processing transaction {} in Redis sink: {}", 
                    transaction.getTransactionId(), e.getMessage(), e);
            
            // Don't throw exception to avoid failing the entire job
            // In production, you might want to send to a dead letter queue
        }
    }
    
    /**
     * Update velocity metrics for the user.
     */
    private void updateVelocityMetrics(Transaction transaction) {
        try {
            String userId = transaction.getUserId();
            Double amount = transaction.getAmount();
            
            if (userId != null && amount != null) {
                // Get current velocity metrics
                var velocity5min = redisService.getVelocityMetrics(userId, "5min");
                var velocity1hour = redisService.getVelocityMetrics(userId, "1hour");
                var velocity24hour = redisService.getVelocityMetrics(userId, "24hour");
                
                // Update 5-minute window
                updateVelocityWindow(userId, "5min", amount, velocity5min);
                
                // Update 1-hour window
                updateVelocityWindow(userId, "1hour", amount, velocity1hour);
                
                // Update 24-hour window
                updateVelocityWindow(userId, "24hour", amount, velocity24hour);
            }
        } catch (Exception e) {
            LOG.warn("Error updating velocity metrics for transaction {}: {}", 
                    transaction.getTransactionId(), e.getMessage());
        }
    }
    
    /**
     * Update velocity window with new transaction.
     */
    private void updateVelocityWindow(String userId, String window, Double amount, 
                                    java.util.Map<String, String> currentVelocity) {
        try {
            double currentAmount = 0.0;
            int currentCount = 0;
            
            if (currentVelocity != null && !currentVelocity.isEmpty()) {
                currentAmount = Double.parseDouble(currentVelocity.getOrDefault("amount", "0"));
                currentCount = Integer.parseInt(currentVelocity.getOrDefault("count", "0"));
            }
            
            double newAmount = currentAmount + amount;
            int newCount = currentCount + 1;
            
            redisService.storeVelocityMetrics(userId, window, newAmount, newCount);
            
        } catch (Exception e) {
            LOG.warn("Error updating velocity window {} for user {}: {}", window, userId, e.getMessage());
        }
    }
    
    /**
     * Update aggregated metrics.
     */
    private void updateAggregations(Transaction transaction) {
        try {
            long timestamp = transaction.getTimestamp().toEpochMilli();
            long hourKey = timestamp / (1000 * 60 * 60); // Hour bucket
            long dayKey = timestamp / (1000 * 60 * 60 * 24); // Day bucket
            
            // Update hourly aggregations
            updateHourlyAggregations(transaction, hourKey);
            
            // Update daily aggregations
            updateDailyAggregations(transaction, dayKey);
            
            // Update merchant aggregations
            updateMerchantAggregations(transaction, hourKey);
            
        } catch (Exception e) {
            LOG.warn("Error updating aggregations for transaction {}: {}", 
                    transaction.getTransactionId(), e.getMessage());
        }
    }
    
    /**
     * Update hourly transaction aggregations.
     */
    private void updateHourlyAggregations(Transaction transaction, long hourKey) {
        String aggregationKey = "hourly:" + hourKey;
        var currentAgg = redisService.getAggregation(aggregationKey);
        
        // Update counters
        long totalCount = ((Number) currentAgg.getOrDefault("total_count", 0)).longValue() + 1;
        double totalAmount = ((Number) currentAgg.getOrDefault("total_amount", 0.0)).doubleValue() + 
                           (transaction.getAmount() != null ? transaction.getAmount() : 0.0);
        
        long fraudCount = ((Number) currentAgg.getOrDefault("fraud_count", 0)).longValue();
        if (Boolean.TRUE.equals(transaction.getIsFraud())) {
            fraudCount++;
        }
        
        long highRiskCount = ((Number) currentAgg.getOrDefault("high_risk_count", 0)).longValue();
        if (transaction.getFraudScore() != null && transaction.getFraudScore() > 0.7) {
            highRiskCount++;
        }
        
        // Create updated aggregation
        var updatedAgg = new java.util.HashMap<String, Object>();
        updatedAgg.put("total_count", totalCount);
        updatedAgg.put("total_amount", totalAmount);
        updatedAgg.put("fraud_count", fraudCount);
        updatedAgg.put("high_risk_count", highRiskCount);
        updatedAgg.put("fraud_rate", (double) fraudCount / totalCount);
        updatedAgg.put("avg_amount", totalAmount / totalCount);
        updatedAgg.put("last_updated", System.currentTimeMillis());
        
        redisService.storeAggregation(aggregationKey, updatedAgg);
    }
    
    /**
     * Update daily transaction aggregations.
     */
    private void updateDailyAggregations(Transaction transaction, long dayKey) {
        String aggregationKey = "daily:" + dayKey;
        var currentAgg = redisService.getAggregation(aggregationKey);
        
        // Similar to hourly but with different retention and granularity
        long totalCount = ((Number) currentAgg.getOrDefault("total_count", 0)).longValue() + 1;
        double totalAmount = ((Number) currentAgg.getOrDefault("total_amount", 0.0)).doubleValue() + 
                           (transaction.getAmount() != null ? transaction.getAmount() : 0.0);
        
        long fraudCount = ((Number) currentAgg.getOrDefault("fraud_count", 0)).longValue();
        if (Boolean.TRUE.equals(transaction.getIsFraud())) {
            fraudCount++;
        }
        
        var updatedAgg = new java.util.HashMap<String, Object>();
        updatedAgg.put("total_count", totalCount);
        updatedAgg.put("total_amount", totalAmount);
        updatedAgg.put("fraud_count", fraudCount);
        updatedAgg.put("fraud_rate", (double) fraudCount / totalCount);
        updatedAgg.put("avg_amount", totalAmount / totalCount);
        updatedAgg.put("last_updated", System.currentTimeMillis());
        
        redisService.storeAggregation(aggregationKey, updatedAgg);
    }
    
    /**
     * Update merchant-specific aggregations.
     */
    private void updateMerchantAggregations(Transaction transaction, long hourKey) {
        String merchantId = transaction.getMerchantId();
        if (merchantId == null) return;
        
        String aggregationKey = "merchant:" + merchantId + ":" + hourKey;
        var currentAgg = redisService.getAggregation(aggregationKey);
        
        long totalCount = ((Number) currentAgg.getOrDefault("total_count", 0)).longValue() + 1;
        double totalAmount = ((Number) currentAgg.getOrDefault("total_amount", 0.0)).doubleValue() + 
                           (transaction.getAmount() != null ? transaction.getAmount() : 0.0);
        
        long fraudCount = ((Number) currentAgg.getOrDefault("fraud_count", 0)).longValue();
        if (Boolean.TRUE.equals(transaction.getIsFraud())) {
            fraudCount++;
        }
        
        // Track unique users
        var uniqueUsers = new java.util.HashSet<String>();
        if (currentAgg.containsKey("unique_users")) {
            uniqueUsers.addAll((java.util.Collection<String>) currentAgg.get("unique_users"));
        }
        uniqueUsers.add(transaction.getUserId());
        
        var updatedAgg = new java.util.HashMap<String, Object>();
        updatedAgg.put("merchant_id", merchantId);
        updatedAgg.put("total_count", totalCount);
        updatedAgg.put("total_amount", totalAmount);
        updatedAgg.put("fraud_count", fraudCount);
        updatedAgg.put("fraud_rate", (double) fraudCount / totalCount);
        updatedAgg.put("avg_amount", totalAmount / totalCount);
        updatedAgg.put("unique_users", uniqueUsers);
        updatedAgg.put("unique_user_count", uniqueUsers.size());
        updatedAgg.put("last_updated", System.currentTimeMillis());
        
        redisService.storeAggregation(aggregationKey, updatedAgg);
    }
    
    /**
     * Log processing progress periodically.
     */
    private void logProgress() {
        long currentTime = System.currentTimeMillis();
        
        // Log every 10 seconds
        if (currentTime - lastLogTime > 10000) {
            LOG.info("Redis sink processed {} transactions, {} errors", processedCount, errorCount);
            lastLogTime = currentTime;
        }
    }
}