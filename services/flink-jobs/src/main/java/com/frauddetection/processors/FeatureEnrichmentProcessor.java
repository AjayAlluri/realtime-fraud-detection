package com.frauddetection.processors;

import com.frauddetection.config.JobConfig;
import com.frauddetection.features.FeatureExtractor;
import com.frauddetection.models.Transaction;
import com.frauddetection.services.RedisService;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * Flink processor that enriches transactions with advanced features for ML models.
 * Generates 50+ features across multiple categories for real-time fraud detection.
 */
public class FeatureEnrichmentProcessor extends ProcessFunction<Transaction, Transaction> {
    
    private static final Logger LOG = LoggerFactory.getLogger(FeatureEnrichmentProcessor.class);
    
    private final JobConfig config;
    private transient RedisService redisService;
    private transient FeatureExtractor featureExtractor;
    
    // Performance metrics
    private transient long processedCount = 0;
    private transient long errorCount = 0;
    private transient long totalFeatureExtractionTime = 0;
    private transient long lastLogTime = 0;
    
    public FeatureEnrichmentProcessor(JobConfig config) {
        this.config = config;
    }
    
    @Override
    public void open(Configuration parameters) throws Exception {
        super.open(parameters);
        
        // Initialize services
        this.redisService = new RedisService(config);
        this.featureExtractor = new FeatureExtractor(redisService);
        this.lastLogTime = System.currentTimeMillis();
        
        LOG.info("FeatureEnrichmentProcessor initialized");
    }
    
    @Override
    public void close() throws Exception {
        if (redisService != null) {
            redisService.close();
        }
        
        LOG.info("FeatureEnrichmentProcessor closed. Processed: {}, Errors: {}, Avg feature extraction time: {}ms",
                processedCount, errorCount, 
                processedCount > 0 ? totalFeatureExtractionTime / processedCount : 0);
        
        super.close();
    }
    
    @Override
    public void processElement(Transaction transaction, Context context, Collector<Transaction> out) throws Exception {
        long startTime = System.currentTimeMillis();
        
        try {
            // Extract all features for the transaction
            Map<String, Object> extractedFeatures = featureExtractor.extractAllFeatures(transaction);
            
            // Merge with existing features
            Map<String, Object> allFeatures = transaction.getFeatures();
            if (allFeatures == null) {
                allFeatures = extractedFeatures;
            } else {
                allFeatures.putAll(extractedFeatures);
            }
            
            transaction.setFeatures(allFeatures);
            
            // Calculate feature-based fraud score adjustment
            double featureBasedScore = calculateFeatureBasedFraudScore(extractedFeatures);
            
            // Combine with existing fraud score
            Double existingScore = transaction.getFraudScore();
            if (existingScore != null) {
                double combinedScore = (existingScore * 0.6) + (featureBasedScore * 0.4);
                transaction.setFraudScore(Math.max(0.0, Math.min(1.0, combinedScore)));
            } else {
                transaction.setFraudScore(featureBasedScore);
            }
            
            // Update risk level based on enhanced scoring
            updateRiskLevel(transaction);
            
            // Update performance metrics
            long processingTime = System.currentTimeMillis() - startTime;
            totalFeatureExtractionTime += processingTime;
            processedCount++;
            
            // Output enriched transaction
            out.collect(transaction);
            
            // Log progress periodically
            logProgress(processingTime);
            
            LOG.debug("Enriched transaction {} with {} features in {}ms", 
                    transaction.getTransactionId(), extractedFeatures.size(), processingTime);
                    
        } catch (Exception e) {
            errorCount++;
            LOG.error("Error enriching transaction {} with features: {}", 
                    transaction.getTransactionId(), e.getMessage(), e);
            
            // Still output the transaction to avoid breaking the pipeline
            out.collect(transaction);
        }
    }
    
    /**
     * Calculate fraud score based on extracted features.
     */
    private double calculateFeatureBasedFraudScore(Map<String, Object> features) {
        double score = 0.0;
        
        try {
            // Amount-based scoring (weight: 0.2)
            score += calculateAmountScore(features) * 0.2;
            
            // Temporal scoring (weight: 0.1)
            score += calculateTemporalScore(features) * 0.1;
            
            // User behavior scoring (weight: 0.25)
            score += calculateUserBehaviorScore(features) * 0.25;
            
            // Merchant risk scoring (weight: 0.2)
            score += calculateMerchantRiskScore(features) * 0.2;
            
            // Velocity scoring (weight: 0.15)
            score += calculateVelocityScore(features) * 0.15;
            
            // Device/Network scoring (weight: 0.1)
            score += calculateDeviceNetworkScore(features) * 0.1;
            
        } catch (Exception e) {
            LOG.warn("Error calculating feature-based fraud score: {}", e.getMessage());
            score = 0.5; // Default moderate risk
        }
        
        return Math.max(0.0, Math.min(1.0, score));
    }
    
    /**
     * Calculate amount-based risk score.
     */
    private double calculateAmountScore(Map<String, Object> features) {
        double score = 0.0;
        
        // Large amounts relative to user average
        Boolean isLargeForUser = (Boolean) features.get("is_large_for_user");
        if (Boolean.TRUE.equals(isLargeForUser)) {
            score += 0.3;
        }
        
        // Round amounts (often used in fraud)
        Boolean isRound100 = (Boolean) features.get("is_round_100");
        if (Boolean.TRUE.equals(isRound100)) {
            score += 0.1;
        }
        
        // Amount category risk
        String amountCategory = (String) features.get("amount_category");
        if ("very_large".equals(amountCategory)) {
            score += 0.2;
        } else if ("micro".equals(amountCategory)) {
            score += 0.1; // Micro payments can indicate card testing
        }
        
        return score;
    }
    
    /**
     * Calculate temporal-based risk score.
     */
    private double calculateTemporalScore(Map<String, Object> features) {
        double score = 0.0;
        
        // Night time transactions
        Boolean isNightTime = (Boolean) features.get("is_night_time");
        if (Boolean.TRUE.equals(isNightTime)) {
            score += 0.2;
        }
        
        // Outside user's preferred time
        Boolean inPreferredTime = (Boolean) features.get("in_user_preferred_time");
        if (Boolean.FALSE.equals(inPreferredTime)) {
            score += 0.15;
        }
        
        // Weekend activity for non-weekend users
        Boolean isWeekend = (Boolean) features.get("is_weekend");
        Double weekendFactor = (Double) features.get("weekend_activity_factor");
        if (Boolean.TRUE.equals(isWeekend) && weekendFactor != null && weekendFactor < 0.3) {
            score += 0.1;
        }
        
        return score;
    }
    
    /**
     * Calculate user behavior-based risk score.
     */
    private double calculateUserBehaviorScore(Map<String, Object> features) {
        double score = 0.0;
        
        // New account risk
        Boolean isVeryNewAccount = (Boolean) features.get("is_very_new_account");
        if (Boolean.TRUE.equals(isVeryNewAccount)) {
            score += 0.4;
        } else {
            Boolean isNewAccount = (Boolean) features.get("is_new_account");
            if (Boolean.TRUE.equals(isNewAccount)) {
                score += 0.2;
            }
        }
        
        // KYC verification status
        Boolean isKycVerified = (Boolean) features.get("is_kyc_verified");
        if (Boolean.FALSE.equals(isKycVerified)) {
            score += 0.3;
        }
        
        // User risk score
        Double userRiskScore = (Double) features.get("user_risk_score");
        if (userRiskScore != null) {
            score += userRiskScore * 0.5;
        }
        
        return score;
    }
    
    /**
     * Calculate merchant risk-based score.
     */
    private double calculateMerchantRiskScore(Map<String, Object> features) {
        double score = 0.0;
        
        // Blacklisted merchant
        Boolean isBlacklisted = (Boolean) features.get("is_blacklisted_merchant");
        if (Boolean.TRUE.equals(isBlacklisted)) {
            score += 0.8;
        }
        
        // High-risk category
        Boolean isHighRiskCategory = (Boolean) features.get("is_high_risk_category");
        if (Boolean.TRUE.equals(isHighRiskCategory)) {
            score += 0.3;
        }
        
        // Merchant fraud rate
        Double fraudRate = (Double) features.get("merchant_fraud_rate");
        if (fraudRate != null) {
            score += fraudRate * 2.0; // Scale fraud rate impact
        }
        
        // Suspicious merchant name
        Boolean suspiciousName = (Boolean) features.get("suspicious_merchant_name");
        if (Boolean.TRUE.equals(suspiciousName)) {
            score += 0.2;
        }
        
        // Outside operating hours
        Boolean withinHours = (Boolean) features.get("within_merchant_hours");
        if (Boolean.FALSE.equals(withinHours)) {
            score += 0.15;
        }
        
        return score;
    }
    
    /**
     * Calculate velocity-based risk score.
     */
    private double calculateVelocityScore(Map<String, Object> features) {
        double score = 0.0;
        
        // High velocity in short time frames
        Boolean highVelocity5min = (Boolean) features.get("high_velocity_5min");
        if (Boolean.TRUE.equals(highVelocity5min)) {
            score += 0.6;
        }
        
        Boolean highVelocity1hour = (Boolean) features.get("high_velocity_1hour");
        if (Boolean.TRUE.equals(highVelocity1hour)) {
            score += 0.4;
        }
        
        // Transaction count thresholds
        Integer count5min = (Integer) features.get("velocity_5min_count");
        if (count5min != null && count5min > 3) {
            score += 0.2;
        }
        
        Integer count1hour = (Integer) features.get("velocity_1hour_count");
        if (count1hour != null && count1hour > 10) {
            score += 0.15;
        }
        
        return score;
    }
    
    /**
     * Calculate device/network-based risk score.
     */
    private double calculateDeviceNetworkScore(Map<String, Object> features) {
        double score = 0.0;
        
        // New device
        Boolean isNewDevice = (Boolean) features.get("is_new_device");
        if (Boolean.TRUE.equals(isNewDevice)) {
            score += 0.3;
        }
        
        // IP risk
        Double ipRiskScore = (Double) features.get("ip_risk_score");
        if (ipRiskScore != null) {
            score += ipRiskScore;
        }
        
        // Suspicious user agent
        Boolean suspiciousUA = (Boolean) features.get("suspicious_user_agent");
        if (Boolean.TRUE.equals(suspiciousUA)) {
            score += 0.2;
        }
        
        return score;
    }
    
    /**
     * Update risk level based on enhanced fraud score.
     */
    private void updateRiskLevel(Transaction transaction) {
        Double fraudScore = transaction.getFraudScore();
        if (fraudScore == null) return;
        
        String riskLevel;
        String decision;
        
        if (fraudScore >= 0.95) {
            riskLevel = "CRITICAL";
            decision = "DECLINE";
        } else if (fraudScore >= 0.8) {
            riskLevel = "HIGH";
            decision = "REVIEW";
        } else if (fraudScore >= 0.6) {
            riskLevel = "MEDIUM";
            decision = "REVIEW";
        } else if (fraudScore >= 0.3) {
            riskLevel = "LOW";
            decision = "APPROVE";
        } else {
            riskLevel = "VERY_LOW";
            decision = "APPROVE";
        }
        
        transaction.setRiskLevel(riskLevel);
        transaction.setDecision(decision);
    }
    
    /**
     * Log processing progress and performance metrics.
     */
    private void logProgress(long processingTime) {
        long currentTime = System.currentTimeMillis();
        
        // Log every 30 seconds
        if (currentTime - lastLogTime > 30000) {
            double avgProcessingTime = processedCount > 0 ? 
                (double) totalFeatureExtractionTime / processedCount : 0;
            double errorRate = processedCount > 0 ? 
                (double) errorCount / processedCount * 100 : 0;
            
            LOG.info("Feature enrichment stats - Processed: {}, Errors: {} ({:.2f}%), " +
                    "Avg processing time: {:.2f}ms, Current processing time: {}ms",
                    processedCount, errorCount, errorRate, avgProcessingTime, processingTime);
            
            lastLogTime = currentTime;
        }
    }
}