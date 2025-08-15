package com.frauddetection.processors;

import com.frauddetection.config.JobConfig;
import com.frauddetection.models.MerchantProfile;
import com.frauddetection.models.Transaction;
import com.frauddetection.models.UserProfile;
import com.frauddetection.services.RedisService;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Main transaction processor that enriches transactions with user and merchant data,
 * performs basic fraud detection, and applies business rules.
 */
public class TransactionProcessor extends ProcessFunction<Transaction, Transaction> {
    
    private static final Logger LOG = LoggerFactory.getLogger(TransactionProcessor.class);
    
    private final JobConfig config;
    private transient RedisService redisService;
    
    public TransactionProcessor(JobConfig config) {
        this.config = config;
    }
    
    @Override
    public void open(Configuration parameters) throws Exception {
        super.open(parameters);
        
        // Initialize Redis service for data enrichment
        this.redisService = new RedisService(config);
        
        LOG.info("TransactionProcessor initialized with config: {}", config);
    }
    
    @Override
    public void close() throws Exception {
        if (redisService != null) {
            redisService.close();
        }
        super.close();
    }
    
    @Override
    public void processElement(Transaction transaction, Context context, Collector<Transaction> out) throws Exception {
        long startTime = System.currentTimeMillis();
        
        try {
            // Step 1: Enrich with user profile
            enrichWithUserProfile(transaction);
            
            // Step 2: Enrich with merchant profile  
            enrichWithMerchantProfile(transaction);
            
            // Step 3: Calculate basic fraud features
            calculateBasicFeatures(transaction);
            
            // Step 4: Apply fraud detection rules
            applyFraudDetectionRules(transaction);
            
            // Step 5: Determine final decision
            makeFinalDecision(transaction);
            
            // Step 6: Update processing metrics
            long processingTime = System.currentTimeMillis() - startTime;
            transaction.setProcessingTimeMs((int) processingTime);
            
            // Step 7: Cache transaction for future reference
            cacheTransaction(transaction);
            
            // Output enriched transaction
            out.collect(transaction);
            
            LOG.debug("Processed transaction {} in {}ms with fraud score: {}", 
                    transaction.getTransactionId(), processingTime, transaction.getFraudScore());
                    
        } catch (Exception e) {
            LOG.error("Error processing transaction {}: {}", transaction.getTransactionId(), e.getMessage(), e);
            
            // Still output the transaction but with error indicators
            transaction.setFraudScore(0.5); // Default moderate risk
            transaction.setRiskLevel("ERROR");
            transaction.setDecision("REVIEW");
            out.collect(transaction);
        }
    }
    
    /**
     * Enrich transaction with user profile data from Redis.
     */
    private void enrichWithUserProfile(Transaction transaction) {
        try {
            UserProfile userProfile = redisService.getUserProfile(transaction.getUserId());
            
            if (userProfile != null) {
                transaction.setUserProfile(userProfile);
                LOG.debug("Enriched transaction {} with user profile for user {}", 
                        transaction.getTransactionId(), transaction.getUserId());
            } else {
                LOG.warn("User profile not found for user: {}", transaction.getUserId());
                // Create a minimal profile for new users
                userProfile = createMinimalUserProfile(transaction.getUserId());
                transaction.setUserProfile(userProfile);
            }
        } catch (Exception e) {
            LOG.error("Error enriching with user profile for user {}: {}", 
                    transaction.getUserId(), e.getMessage());
        }
    }
    
    /**
     * Enrich transaction with merchant profile data from Redis.
     */
    private void enrichWithMerchantProfile(Transaction transaction) {
        try {
            MerchantProfile merchantProfile = redisService.getMerchantProfile(transaction.getMerchantId());
            
            if (merchantProfile != null) {
                transaction.setMerchantProfile(merchantProfile);
                LOG.debug("Enriched transaction {} with merchant profile for merchant {}", 
                        transaction.getTransactionId(), transaction.getMerchantId());
            } else {
                LOG.warn("Merchant profile not found for merchant: {}", transaction.getMerchantId());
                // Create a minimal profile for unknown merchants
                merchantProfile = createMinimalMerchantProfile(transaction.getMerchantId());
                transaction.setMerchantProfile(merchantProfile);
            }
        } catch (Exception e) {
            LOG.error("Error enriching with merchant profile for merchant {}: {}", 
                    transaction.getMerchantId(), e.getMessage());
        }
    }
    
    /**
     * Calculate basic fraud detection features.
     */
    private void calculateBasicFeatures(Transaction transaction) {
        // Amount-based features
        calculateAmountFeatures(transaction);
        
        // Time-based features  
        calculateTimeFeatures(transaction);
        
        // Geographic features
        calculateGeographicFeatures(transaction);
        
        // Device features
        calculateDeviceFeatures(transaction);
        
        // User behavior features
        calculateUserBehaviorFeatures(transaction);
        
        // Merchant features
        calculateMerchantFeatures(transaction);
    }
    
    /**
     * Calculate amount-based fraud features.
     */
    private void calculateAmountFeatures(Transaction transaction) {
        Double amount = transaction.getAmount();
        UserProfile userProfile = transaction.getUserProfile();
        
        if (amount != null && userProfile != null) {
            // Amount deviation from user's average
            Double avgAmount = userProfile.getAvgTransactionAmount();
            if (avgAmount != null && avgAmount > 0) {
                double deviationRatio = amount / avgAmount;
                transaction.getFeatures().put("amount_deviation_ratio", deviationRatio);
                
                // Flag large amounts (more than 5x average)
                if (deviationRatio > 5.0) {
                    transaction.getFeatures().put("large_amount_flag", true);
                }
            }
            
            // Round amount detection (fraud often uses round amounts)
            if (amount % 10 == 0 || amount % 100 == 0) {
                transaction.getFeatures().put("round_amount_flag", true);
            }
        }
    }
    
    /**
     * Calculate time-based fraud features.
     */
    private void calculateTimeFeatures(Transaction transaction) {
        Integer hourOfDay = transaction.getHourOfDay();
        Boolean isWeekend = transaction.getIsWeekend();
        UserProfile userProfile = transaction.getUserProfile();
        
        if (hourOfDay != null && userProfile != null) {
            // Check if transaction is outside user's preferred hours
            Integer preferredStart = userProfile.getPreferredTimeStart();
            Integer preferredEnd = userProfile.getPreferredTimeEnd();
            
            if (preferredStart != null && preferredEnd != null) {
                boolean outsidePreferredHours = hourOfDay < preferredStart || hourOfDay > preferredEnd;
                transaction.getFeatures().put("outside_preferred_hours", outsidePreferredHours);
            }
            
            // Flag unusual hours (late night/early morning)
            if (hourOfDay <= 5 || hourOfDay >= 23) {
                transaction.getFeatures().put("unusual_hour_flag", true);
            }
        }
        
        // Weekend activity check
        if (isWeekend != null && userProfile != null) {
            Double weekendActivity = userProfile.getWeekendActivity();
            if (isWeekend && weekendActivity != null && weekendActivity < 0.3) {
                transaction.getFeatures().put("unexpected_weekend_activity", true);
            }
        }
    }
    
    /**
     * Calculate geographic fraud features.
     */
    private void calculateGeographicFeatures(Transaction transaction) {
        // For now, implement basic geographic analysis
        // In Phase 2, this will be enhanced with actual distance calculations
        
        if (transaction.getGeolocation() != null && !transaction.getGeolocation().isEmpty()) {
            transaction.getFeatures().put("has_geolocation", true);
        }
        
        // International transaction detection based on user profile
        UserProfile userProfile = transaction.getUserProfile();
        if (userProfile != null) {
            Double intlPreference = userProfile.getInternationalTransactions();
            if (intlPreference != null && intlPreference < 0.1) {
                // User rarely does international transactions
                transaction.getFeatures().put("potential_international_anomaly", true);
            }
        }
    }
    
    /**
     * Calculate device-based fraud features.
     */
    private void calculateDeviceFeatures(Transaction transaction) {
        String deviceFingerprint = transaction.getDeviceFingerprint();
        UserProfile userProfile = transaction.getUserProfile();
        
        if (deviceFingerprint != null && userProfile != null) {
            // Check if device is known to user
            if (userProfile.getDeviceFingerprints() != null) {
                boolean knownDevice = userProfile.getDeviceFingerprints().contains(deviceFingerprint);
                transaction.getFeatures().put("known_device", knownDevice);
                
                if (!knownDevice) {
                    transaction.getFeatures().put("new_device_flag", true);
                }
            }
        }
    }
    
    /**
     * Calculate user behavior features.
     */
    private void calculateUserBehaviorFeatures(Transaction transaction) {
        UserProfile userProfile = transaction.getUserProfile();
        
        if (userProfile != null) {
            // Account age factor
            Long accountAge = userProfile.getAccountAgeDays();
            if (accountAge != null) {
                transaction.getFeatures().put("account_age_days", accountAge);
                
                if (accountAge < 30) {
                    transaction.getFeatures().put("new_account_flag", true);
                }
            }
            
            // KYC status
            transaction.getFeatures().put("kyc_verified", userProfile.isVerified());
            
            // Risk score from profile
            if (userProfile.getRiskScore() != null) {
                transaction.getFeatures().put("user_risk_score", userProfile.getRiskScore());
            }
        }
    }
    
    /**
     * Calculate merchant-based fraud features.
     */
    private void calculateMerchantFeatures(Transaction transaction) {
        MerchantProfile merchantProfile = transaction.getMerchantProfile();
        
        if (merchantProfile != null) {
            // Merchant risk level
            transaction.getFeatures().put("merchant_risk_level", merchantProfile.getRiskLevel());
            
            // High-risk merchant category
            transaction.getFeatures().put("high_risk_category", merchantProfile.isHighRiskCategory());
            
            // Blacklisted merchant
            if (merchantProfile.getIsBlacklisted() != null && merchantProfile.getIsBlacklisted()) {
                transaction.getFeatures().put("blacklisted_merchant", true);
            }
            
            // Merchant fraud rate
            if (merchantProfile.getFraudRate() != null) {
                transaction.getFeatures().put("merchant_fraud_rate", merchantProfile.getFraudRate());
            }
            
            // Operating hours check
            Integer hourOfDay = transaction.getHourOfDay();
            if (hourOfDay != null) {
                boolean operatingHours = merchantProfile.isOperatingAtHour(hourOfDay);
                transaction.getFeatures().put("within_operating_hours", operatingHours);
            }
        }
    }
    
    /**
     * Apply fraud detection rules and calculate fraud score.
     */
    private void applyFraudDetectionRules(Transaction transaction) {
        double fraudScore = 0.0;
        
        // Base score from existing fraud score (from simulation)
        if (transaction.getFraudScore() != null) {
            fraudScore = transaction.getFraudScore() * 0.5; // Weight existing score
        }
        
        // User-based scoring
        fraudScore += calculateUserRiskScore(transaction);
        
        // Merchant-based scoring
        fraudScore += calculateMerchantRiskScore(transaction);
        
        // Feature-based scoring
        fraudScore += calculateFeatureRiskScore(transaction);
        
        // Normalize score to 0-1 range
        fraudScore = Math.max(0.0, Math.min(1.0, fraudScore));
        
        transaction.setFraudScore(fraudScore);
    }
    
    /**
     * Calculate user-based risk score component.
     */
    private double calculateUserRiskScore(Transaction transaction) {
        double score = 0.0;
        UserProfile userProfile = transaction.getUserProfile();
        
        if (userProfile != null) {
            // User's base risk score
            if (userProfile.getRiskScore() != null) {
                score += userProfile.getRiskScore() * 0.2;
            }
            
            // New account penalty
            if (userProfile.isNewAccount()) {
                score += 0.1;
            }
            
            // Unverified user penalty
            if (!userProfile.isVerified()) {
                score += 0.15;
            }
        }
        
        return score;
    }
    
    /**
     * Calculate merchant-based risk score component.
     */
    private double calculateMerchantRiskScore(Transaction transaction) {
        double score = 0.0;
        MerchantProfile merchantProfile = transaction.getMerchantProfile();
        
        if (merchantProfile != null) {
            // Merchant risk level scoring
            String riskLevel = merchantProfile.getRiskLevel();
            if ("high".equalsIgnoreCase(riskLevel)) {
                score += 0.2;
            } else if ("medium".equalsIgnoreCase(riskLevel)) {
                score += 0.1;
            }
            
            // Blacklisted merchant
            if (merchantProfile.getIsBlacklisted() != null && merchantProfile.getIsBlacklisted()) {
                score += 0.4;
            }
            
            // High fraud rate merchant
            if (merchantProfile.getFraudRate() != null && merchantProfile.getFraudRate() > 0.05) {
                score += merchantProfile.getFraudRate() * 2.0;
            }
            
            // High-risk category
            if (merchantProfile.isHighRiskCategory()) {
                score += 0.15;
            }
        }
        
        return score;
    }
    
    /**
     * Calculate feature-based risk score component.
     */
    private double calculateFeatureRiskScore(Transaction transaction) {
        double score = 0.0;
        
        // Large amount flag
        if (Boolean.TRUE.equals(transaction.getFeatures().get("large_amount_flag"))) {
            score += 0.15;
        }
        
        // New device flag
        if (Boolean.TRUE.equals(transaction.getFeatures().get("new_device_flag"))) {
            score += 0.1;
        }
        
        // Unusual hour flag
        if (Boolean.TRUE.equals(transaction.getFeatures().get("unusual_hour_flag"))) {
            score += 0.05;
        }
        
        // Outside operating hours
        if (Boolean.FALSE.equals(transaction.getFeatures().get("within_operating_hours"))) {
            score += 0.1;
        }
        
        return score;
    }
    
    /**
     * Make final fraud decision based on score and business rules.
     */
    private void makeFinalDecision(Transaction transaction) {
        double fraudScore = transaction.getFraudScore();
        String decision;
        String riskLevel;
        
        if (fraudScore >= 0.9) {
            decision = "DECLINE";
            riskLevel = "CRITICAL";
        } else if (fraudScore >= config.getFraudThreshold()) {
            decision = "REVIEW";
            riskLevel = "HIGH";
        } else if (fraudScore >= 0.5) {
            decision = "APPROVE";
            riskLevel = "MEDIUM";
        } else {
            decision = "APPROVE";
            riskLevel = "LOW";
        }
        
        // Override for blacklisted merchants
        MerchantProfile merchantProfile = transaction.getMerchantProfile();
        if (merchantProfile != null && merchantProfile.getIsBlacklisted() != null && 
            merchantProfile.getIsBlacklisted()) {
            decision = "DECLINE";
            riskLevel = "CRITICAL";
        }
        
        transaction.setDecision(decision);
        transaction.setRiskLevel(riskLevel);
    }
    
    /**
     * Cache transaction in Redis for future reference.
     */
    private void cacheTransaction(Transaction transaction) {
        try {
            redisService.cacheTransaction(transaction);
        } catch (Exception e) {
            LOG.warn("Failed to cache transaction {}: {}", transaction.getTransactionId(), e.getMessage());
        }
    }
    
    /**
     * Create a minimal user profile for unknown users.
     */
    private UserProfile createMinimalUserProfile(String userId) {
        UserProfile profile = new UserProfile();
        profile.setUserId(userId);
        profile.setRiskScore(0.5); // Default moderate risk for unknown users
        profile.setKycStatus("pending");
        profile.setCreatedAt(Instant.now());
        return profile;
    }
    
    /**
     * Create a minimal merchant profile for unknown merchants.
     */
    private MerchantProfile createMinimalMerchantProfile(String merchantId) {
        MerchantProfile profile = new MerchantProfile();
        profile.setMerchantId(merchantId);
        profile.setRiskLevel("medium"); // Default moderate risk for unknown merchants
        profile.setFraudRate(0.05); // Default 5% fraud rate
        profile.setIsBlacklisted(false);
        return profile;
    }
}