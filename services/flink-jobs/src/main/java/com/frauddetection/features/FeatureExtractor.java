package com.frauddetection.features;

import com.frauddetection.models.MerchantProfile;
import com.frauddetection.models.Transaction;
import com.frauddetection.models.UserProfile;
import com.frauddetection.services.RedisService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Advanced feature extractor that generates 50+ real-time features for fraud detection ML models.
 * Features are categorized into: Amount, Temporal, Geographic, User Behavior, Merchant Risk,
 * Device/Network, Velocity, and Contextual features.
 */
public class FeatureExtractor {
    
    private static final Logger LOG = LoggerFactory.getLogger(FeatureExtractor.class);
    
    private final RedisService redisService;
    
    // Regex patterns for suspicious merchant names
    private static final Pattern CRYPTO_PATTERN = Pattern.compile(
        "(?i)(bitcoin|crypto|coinbase|binance|blockchain|wallet|mining|exchange)"
    );
    private static final Pattern GIFT_CARD_PATTERN = Pattern.compile(
        "(?i)(gift\\s*card|prepaid|reload|vanilla|amazon\\s*gift|itunes)"
    );
    private static final Pattern MONEY_TRANSFER_PATTERN = Pattern.compile(
        "(?i)(western\\s*union|moneygram|remit|transfer|wire|paypal|venmo)"
    );
    private static final Pattern HIGH_RISK_PATTERN = Pattern.compile(
        "(?i)(casino|gambling|betting|lottery|forex|trading|investment|loan)"
    );
    
    public FeatureExtractor(RedisService redisService) {
        this.redisService = redisService;
    }
    
    /**
     * Extract all features for a transaction.
     */
    public Map<String, Object> extractAllFeatures(Transaction transaction) {
        Map<String, Object> features = new HashMap<>();
        
        try {
            // 1. Amount-based features (12 features)
            extractAmountFeatures(transaction, features);
            
            // 2. Temporal features (8 features)
            extractTemporalFeatures(transaction, features);
            
            // 3. Geographic features (6 features)
            extractGeographicFeatures(transaction, features);
            
            // 4. User behavior features (10 features)
            extractUserBehaviorFeatures(transaction, features);
            
            // 5. Merchant risk features (8 features)
            extractMerchantRiskFeatures(transaction, features);
            
            // 6. Device and network features (5 features)
            extractDeviceNetworkFeatures(transaction, features);
            
            // 7. Velocity features (8 features)
            extractVelocityFeatures(transaction, features);
            
            // 8. Contextual features (5 features)
            extractContextualFeatures(transaction, features);
            
            LOG.debug("Extracted {} features for transaction {}", 
                    features.size(), transaction.getTransactionId());
                    
        } catch (Exception e) {
            LOG.error("Error extracting features for transaction {}: {}", 
                    transaction.getTransactionId(), e.getMessage(), e);
        }
        
        return features;
    }
    
    /**
     * Extract amount-based features (12 features).
     */
    private void extractAmountFeatures(Transaction transaction, Map<String, Object> features) {
        Double amount = transaction.getAmount();
        UserProfile userProfile = transaction.getUserProfile();
        MerchantProfile merchantProfile = transaction.getMerchantProfile();
        
        if (amount != null) {
            // Basic amount features
            features.put("amount", amount);
            features.put("amount_log", Math.log(amount + 1));
            features.put("amount_sqrt", Math.sqrt(amount));
            
            // Round amount indicators
            features.put("is_round_amount", amount % 1.0 == 0.0);
            features.put("is_round_10", amount % 10.0 == 0.0);
            features.put("is_round_100", amount % 100.0 == 0.0);
            
            // User-relative amount features
            if (userProfile != null && userProfile.getAvgTransactionAmount() != null) {
                double avgAmount = userProfile.getAvgTransactionAmount();
                if (avgAmount > 0) {
                    double deviationRatio = amount / avgAmount;
                    features.put("amount_to_user_avg_ratio", deviationRatio);
                    features.put("amount_deviation_zscore", (amount - avgAmount) / avgAmount);
                    features.put("is_large_for_user", deviationRatio > 3.0);
                }
            }
            
            // Merchant-relative amount features
            if (merchantProfile != null && merchantProfile.getAvgTransactionAmount() != null) {
                double merchantAvg = merchantProfile.getAvgTransactionAmount();
                if (merchantAvg > 0) {
                    features.put("amount_to_merchant_avg_ratio", amount / merchantAvg);
                    features.put("is_large_for_merchant", amount > merchantAvg * 2.0);
                }
            }
            
            // Amount range categorization
            features.put("amount_category", categorizeAmount(amount));
        }
    }
    
    /**
     * Extract temporal features (8 features).
     */
    private void extractTemporalFeatures(Transaction transaction, Map<String, Object> features) {
        Instant timestamp = transaction.getTimestamp();
        Integer hourOfDay = transaction.getHourOfDay();
        Boolean isWeekend = transaction.getIsWeekend();
        UserProfile userProfile = transaction.getUserProfile();
        
        if (timestamp != null) {
            LocalDateTime dateTime = LocalDateTime.ofInstant(timestamp, ZoneOffset.UTC);
            
            // Basic temporal features
            features.put("hour_of_day", hourOfDay != null ? hourOfDay : dateTime.getHour());
            features.put("day_of_week", dateTime.getDayOfWeek().getValue());
            features.put("day_of_month", dateTime.getDayOfMonth());
            features.put("is_weekend", isWeekend != null ? isWeekend : dateTime.getDayOfWeek().getValue() >= 6);
            
            // Time period categorization
            int hour = hourOfDay != null ? hourOfDay : dateTime.getHour();
            features.put("time_period", categorizeTimePeriod(hour));
            features.put("is_business_hours", hour >= 9 && hour <= 17);
            features.put("is_night_time", hour <= 6 || hour >= 22);
            
            // User behavior alignment
            if (userProfile != null) {
                Integer prefStart = userProfile.getPreferredTimeStart();
                Integer prefEnd = userProfile.getPreferredTimeEnd();
                
                if (prefStart != null && prefEnd != null) {
                    boolean inPreferredWindow = hour >= prefStart && hour <= prefEnd;
                    features.put("in_user_preferred_time", inPreferredWindow);
                }
            }
        }
    }
    
    /**
     * Extract geographic features (6 features).
     */
    private void extractGeographicFeatures(Transaction transaction, Map<String, Object> features) {
        Map<String, Double> geolocation = transaction.getGeolocation();
        Map<String, Double> merchantLocation = transaction.getMerchantLocation();
        UserProfile userProfile = transaction.getUserProfile();
        
        // Basic geographic features
        features.put("has_geolocation", geolocation != null && !geolocation.isEmpty());
        features.put("has_merchant_location", merchantLocation != null && !merchantLocation.isEmpty());
        
        if (geolocation != null && !geolocation.isEmpty()) {
            Double lat = geolocation.get("lat");
            Double lon = geolocation.get("lon");
            
            if (lat != null && lon != null) {
                features.put("latitude", lat);
                features.put("longitude", lon);
                
                // Geographic risk indicators
                features.put("is_high_risk_country", isHighRiskLocation(lat, lon));
                
                // Distance calculation (simplified)
                if (merchantLocation != null && merchantLocation.get("lat") != null && merchantLocation.get("lon") != null) {
                    double distance = calculateDistance(lat, lon, 
                                                      merchantLocation.get("lat"), 
                                                      merchantLocation.get("lon"));
                    features.put("distance_to_merchant_km", distance);
                }
            }
        }
        
        // International transaction detection
        if (userProfile != null) {
            Double intlPreference = userProfile.getInternationalTransactions();
            if (intlPreference != null) {
                features.put("user_intl_preference", intlPreference);
                features.put("unexpected_intl_transaction", intlPreference < 0.1);
            }
        }
    }
    
    /**
     * Extract user behavior features (10 features).
     */
    private void extractUserBehaviorFeatures(Transaction transaction, Map<String, Object> features) {
        UserProfile userProfile = transaction.getUserProfile();
        
        if (userProfile != null) {
            // Account characteristics
            Long accountAge = userProfile.getAccountAgeDays();
            features.put("account_age_days", accountAge != null ? accountAge : 0);
            features.put("is_new_account", accountAge != null && accountAge < 30);
            features.put("is_very_new_account", accountAge != null && accountAge < 7);
            
            // Risk and verification status
            features.put("user_risk_score", userProfile.getRiskScore() != null ? userProfile.getRiskScore() : 0.5);
            features.put("is_kyc_verified", userProfile.isVerified());
            features.put("kyc_status", userProfile.getKycStatus() != null ? userProfile.getKycStatus() : "unknown");
            
            // Behavioral patterns
            if (userProfile.getBehavioralPatterns() != null) {
                Map<String, Object> patterns = userProfile.getBehavioralPatterns();
                features.put("weekend_activity_factor", getPatternValue(patterns, "weekend_activity", 0.5));
                features.put("online_preference", getPatternValue(patterns, "online_preference", 0.7));
            }
            
            // Transaction history
            features.put("user_avg_amount", userProfile.getAvgTransactionAmount() != null ? 
                        userProfile.getAvgTransactionAmount() : 0.0);
            features.put("user_transaction_frequency", userProfile.getTransactionFrequency() != null ? 
                        userProfile.getTransactionFrequency() : 0);
        } else {
            // Default values for unknown users
            features.put("account_age_days", 0);
            features.put("is_new_account", true);
            features.put("is_very_new_account", true);
            features.put("user_risk_score", 0.8); // Higher risk for unknown users
            features.put("is_kyc_verified", false);
            features.put("kyc_status", "unknown");
        }
    }
    
    /**
     * Extract merchant risk features (8 features).
     */
    private void extractMerchantRiskFeatures(Transaction transaction, Map<String, Object> features) {
        MerchantProfile merchantProfile = transaction.getMerchantProfile();
        
        if (merchantProfile != null) {
            // Basic merchant risk
            features.put("merchant_risk_level", merchantProfile.getRiskLevel() != null ? 
                        merchantProfile.getRiskLevel() : "unknown");
            features.put("merchant_fraud_rate", merchantProfile.getFraudRate() != null ? 
                        merchantProfile.getFraudRate() : 0.05);
            features.put("is_blacklisted_merchant", merchantProfile.getIsBlacklisted() != null ? 
                        merchantProfile.getIsBlacklisted() : false);
            
            // Category-based risk
            String category = merchantProfile.getCategory();
            features.put("merchant_category", category != null ? category : "unknown");
            features.put("is_high_risk_category", merchantProfile.isHighRiskCategory());
            
            // Operating hours
            Integer hourOfDay = transaction.getHourOfDay();
            if (hourOfDay != null) {
                features.put("within_merchant_hours", merchantProfile.isOperatingAtHour(hourOfDay));
            }
            
            // Risk multiplier
            features.put("merchant_risk_multiplier", merchantProfile.getRiskMultiplier());
            
            // Merchant name analysis
            if (merchantProfile.getName() != null) {
                features.put("suspicious_merchant_name", analyzeMerchantName(merchantProfile.getName()));
            }
        } else {
            // Default values for unknown merchants
            features.put("merchant_risk_level", "unknown");
            features.put("merchant_fraud_rate", 0.1); // Higher default risk
            features.put("is_blacklisted_merchant", false);
            features.put("merchant_category", "unknown");
            features.put("is_high_risk_category", false);
            features.put("merchant_risk_multiplier", 2.0);
        }
    }
    
    /**
     * Extract device and network features (5 features).
     */
    private void extractDeviceNetworkFeatures(Transaction transaction, Map<String, Object> features) {
        String deviceFingerprint = transaction.getDeviceFingerprint();
        String ipAddress = transaction.getIpAddress();
        String userAgent = transaction.getUserAgent();
        UserProfile userProfile = transaction.getUserProfile();
        
        // Device recognition
        boolean knownDevice = false;
        if (deviceFingerprint != null && userProfile != null && userProfile.getDeviceFingerprints() != null) {
            knownDevice = userProfile.getDeviceFingerprints().contains(deviceFingerprint);
        }
        features.put("is_known_device", knownDevice);
        features.put("is_new_device", !knownDevice);
        
        // IP analysis (simplified)
        if (ipAddress != null) {
            features.put("is_private_ip", isPrivateIP(ipAddress));
            features.put("ip_risk_score", calculateIPRiskScore(ipAddress));
        }
        
        // User agent analysis
        if (userAgent != null) {
            features.put("suspicious_user_agent", analyzeSuspiciousUserAgent(userAgent));
        }
    }
    
    /**
     * Extract velocity features (8 features).
     */
    private void extractVelocityFeatures(Transaction transaction, Map<String, Object> features) {
        String userId = transaction.getUserId();
        
        if (userId != null && redisService != null) {
            try {
                // Get velocity metrics for different time windows
                var velocity5min = redisService.getVelocityMetrics(userId, "5min");
                var velocity1hour = redisService.getVelocityMetrics(userId, "1hour");
                var velocity24hour = redisService.getVelocityMetrics(userId, "24hour");
                
                // 5-minute velocity
                features.put("velocity_5min_count", getVelocityCount(velocity5min));
                features.put("velocity_5min_amount", getVelocityAmount(velocity5min));
                
                // 1-hour velocity
                features.put("velocity_1hour_count", getVelocityCount(velocity1hour));
                features.put("velocity_1hour_amount", getVelocityAmount(velocity1hour));
                
                // 24-hour velocity
                features.put("velocity_24hour_count", getVelocityCount(velocity24hour));
                features.put("velocity_24hour_amount", getVelocityAmount(velocity24hour));
                
                // High velocity flags
                features.put("high_velocity_5min", getVelocityCount(velocity5min) > 5);
                features.put("high_velocity_1hour", getVelocityCount(velocity1hour) > 20);
                
            } catch (Exception e) {
                LOG.warn("Error extracting velocity features for user {}: {}", userId, e.getMessage());
                setDefaultVelocityFeatures(features);
            }
        } else {
            setDefaultVelocityFeatures(features);
        }
    }
    
    /**
     * Extract contextual features (5 features).
     */
    private void extractContextualFeatures(Transaction transaction, Map<String, Object> features) {
        // Payment method analysis
        String paymentMethod = transaction.getPaymentMethod();
        features.put("payment_method", paymentMethod != null ? paymentMethod : "unknown");
        features.put("is_high_risk_payment", isHighRiskPaymentMethod(paymentMethod));
        
        // Transaction type
        String transactionType = transaction.getTransactionType();
        features.put("transaction_type", transactionType != null ? transactionType : "unknown");
        features.put("is_refund", "refund".equalsIgnoreCase(transactionType));
        
        // Card type analysis
        String cardType = transaction.getCardType();
        features.put("card_type", cardType != null ? cardType : "unknown");
    }
    
    // Helper methods
    
    private String categorizeAmount(double amount) {
        if (amount < 10) return "micro";
        if (amount < 100) return "small";
        if (amount < 1000) return "medium";
        if (amount < 10000) return "large";
        return "very_large";
    }
    
    private String categorizeTimePeriod(int hour) {
        if (hour >= 6 && hour < 12) return "morning";
        if (hour >= 12 && hour < 18) return "afternoon";
        if (hour >= 18 && hour < 22) return "evening";
        return "night";
    }
    
    private boolean isHighRiskLocation(double lat, double lon) {
        // Simplified risk assessment based on coordinates
        // In production, this would use a comprehensive geo-risk database
        return Math.abs(lat) > 60 || (Math.abs(lat) < 10 && Math.abs(lon) < 10);
    }
    
    private double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        // Simplified Haversine formula
        double R = 6371; // Earth's radius in km
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    private double getPatternValue(Map<String, Object> patterns, String key, double defaultValue) {
        Object value = patterns.get(key);
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        return defaultValue;
    }
    
    private boolean analyzeMerchantName(String merchantName) {
        return CRYPTO_PATTERN.matcher(merchantName).find() ||
               GIFT_CARD_PATTERN.matcher(merchantName).find() ||
               MONEY_TRANSFER_PATTERN.matcher(merchantName).find() ||
               HIGH_RISK_PATTERN.matcher(merchantName).find();
    }
    
    private boolean isPrivateIP(String ipAddress) {
        return ipAddress.startsWith("192.168.") || 
               ipAddress.startsWith("10.") || 
               ipAddress.startsWith("172.16.");
    }
    
    private double calculateIPRiskScore(String ipAddress) {
        // Simplified IP risk scoring
        if (isPrivateIP(ipAddress)) return 0.1;
        // In production, this would query threat intelligence databases
        return 0.3;
    }
    
    private boolean analyzeSuspiciousUserAgent(String userAgent) {
        return userAgent.contains("bot") || 
               userAgent.contains("crawler") || 
               userAgent.length() < 20;
    }
    
    private int getVelocityCount(Map<String, String> velocity) {
        if (velocity != null && velocity.containsKey("count")) {
            try {
                return Integer.parseInt(velocity.get("count"));
            } catch (NumberFormatException e) {
                return 0;
            }
        }
        return 0;
    }
    
    private double getVelocityAmount(Map<String, String> velocity) {
        if (velocity != null && velocity.containsKey("amount")) {
            try {
                return Double.parseDouble(velocity.get("amount"));
            } catch (NumberFormatException e) {
                return 0.0;
            }
        }
        return 0.0;
    }
    
    private void setDefaultVelocityFeatures(Map<String, Object> features) {
        features.put("velocity_5min_count", 0);
        features.put("velocity_5min_amount", 0.0);
        features.put("velocity_1hour_count", 0);
        features.put("velocity_1hour_amount", 0.0);
        features.put("velocity_24hour_count", 0);
        features.put("velocity_24hour_amount", 0.0);
        features.put("high_velocity_5min", false);
        features.put("high_velocity_1hour", false);
    }
    
    private boolean isHighRiskPaymentMethod(String paymentMethod) {
        if (paymentMethod == null) return false;
        String lower = paymentMethod.toLowerCase();
        return lower.contains("prepaid") || 
               lower.contains("gift") || 
               lower.contains("crypto") ||
               lower.contains("wire");
    }
}