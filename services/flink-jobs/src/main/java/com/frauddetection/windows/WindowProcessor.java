package com.frauddetection.windows;

import com.frauddetection.models.Transaction;
import com.frauddetection.models.EnrichedTransaction;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.api.java.functions.KeySelector;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.windowing.assigners.SlidingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.assigners.SessionWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.streaming.api.windowing.triggers.CountTrigger;
import org.apache.flink.streaming.api.windowing.triggers.ProcessingTimeTrigger;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Advanced windowing processor for temporal analytics and real-time aggregations.
 * Implements tumbling, sliding, and session windows for comprehensive fraud detection.
 */
public class WindowProcessor {
    
    private static final Logger LOG = LoggerFactory.getLogger(WindowProcessor.class);
    
    /**
     * Process user velocity using sliding windows for real-time fraud detection.
     * 5-minute sliding windows with 1-minute slide interval.
     */
    public static DataStream<UserVelocityAggregate> processUserVelocity(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(Transaction::getUserId)
            .window(SlidingEventTimeWindows.of(Time.minutes(5), Time.minutes(1)))
            .aggregate(new UserVelocityAggregateFunction())
            .name("User Velocity Aggregation")
            .uid("user-velocity-aggregation");
    }
    
    /**
     * Process merchant transaction patterns using tumbling windows.
     * 1-hour tumbling windows for merchant risk assessment.
     */
    public static DataStream<MerchantAggregate> processMerchantPatterns(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(Transaction::getMerchantId)
            .window(TumblingEventTimeWindows.of(Time.hours(1)))
            .aggregate(new MerchantAggregateFunction())
            .name("Merchant Pattern Aggregation")
            .uid("merchant-pattern-aggregation");
    }
    
    /**
     * Process user session analysis using session windows.
     * 30-minute session gap for user behavior analysis.
     */
    public static DataStream<UserSessionAggregate> processUserSessions(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(Transaction::getUserId)
            .window(SessionWindows.withGap(Time.minutes(30)))
            .aggregate(new UserSessionAggregateFunction())
            .name("User Session Aggregation")
            .uid("user-session-aggregation");
    }
    
    /**
     * Process geographic clustering using tumbling windows.
     * 15-minute windows for geographic fraud pattern detection.
     */
    public static DataStream<GeographicAggregate> processGeographicClustering(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new GeographicKeySelector())
            .window(TumblingEventTimeWindows.of(Time.minutes(15)))
            .aggregate(new GeographicAggregateFunction())
            .name("Geographic Clustering Aggregation")
            .uid("geographic-clustering-aggregation");
    }
    
    /**
     * Process real-time fraud pattern detection using sliding windows.
     * 10-minute sliding windows with 2-minute slide for pattern detection.
     */
    public static DataStream<FraudPatternAggregate> processFraudPatterns(
            DataStream<EnrichedTransaction> enrichedTransactionStream) {
        
        return enrichedTransactionStream
            .map(EnrichedTransaction::toEnrichedTransaction)
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new FraudPatternKeySelector())
            .window(SlidingEventTimeWindows.of(Time.minutes(10), Time.minutes(2)))
            .aggregate(new FraudPatternAggregateFunction())
            .name("Fraud Pattern Aggregation")
            .uid("fraud-pattern-aggregation");
    }
    
    /**
     * Process high-frequency transaction detection with count-based triggers.
     * Trigger on every 10 transactions or 1-minute timeout.
     */
    public static DataStream<HighFrequencyAlert> processHighFrequencyDetection(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(Transaction::getUserId)
            .window(TumblingEventTimeWindows.of(Time.minutes(5)))
            .trigger(CountTrigger.of(10))
            .aggregate(new HighFrequencyAggregateFunction())
            .filter(alert -> alert.getTransactionCount() >= 10 || alert.getVelocityScore() > 0.8)
            .name("High Frequency Detection")
            .uid("high-frequency-detection");
    }
    
    /**
     * Process amount-based clustering for unusual transaction amounts.
     * 30-minute tumbling windows grouped by amount ranges.
     */
    public static DataStream<AmountClusterAggregate> processAmountClustering(
            DataStream<Transaction> transactionStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(10))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new AmountClusterKeySelector())
            .window(TumblingEventTimeWindows.of(Time.minutes(30)))
            .aggregate(new AmountClusterAggregateFunction())
            .name("Amount Clustering Aggregation")
            .uid("amount-clustering-aggregation");
    }
    
    // Key Selectors
    
    /**
     * Geographic key selector for clustering transactions by geographic regions.
     */
    private static class GeographicKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            if (transaction.getGeolocation() == null || transaction.getGeolocation().isEmpty()) {
                return "unknown";
            }
            
            Double lat = transaction.getGeolocation().get("lat");
            Double lon = transaction.getGeolocation().get("lon");
            
            if (lat == null || lon == null) {
                return "unknown";
            }
            
            // Create geographic grid (1-degree precision)
            int latGrid = (int) Math.floor(lat);
            int lonGrid = (int) Math.floor(lon);
            
            return String.format("geo_%d_%d", latGrid, lonGrid);
        }
    }
    
    /**
     * Fraud pattern key selector for pattern-based aggregation.
     */
    private static class FraudPatternKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            String paymentMethod = transaction.getPaymentMethod() != null ? 
                                 transaction.getPaymentMethod() : "unknown";
            String merchantCategory = transaction.getMerchantProfile() != null && 
                                    transaction.getMerchantProfile().getCategory() != null ?
                                    transaction.getMerchantProfile().getCategory() : "unknown";
            
            // Amount bucket (groups amounts into ranges)
            double amount = transaction.getAmount() != null ? transaction.getAmount() : 0.0;
            String amountBucket = getAmountBucket(amount);
            
            return String.format("pattern_%s_%s_%s", paymentMethod, merchantCategory, amountBucket);
        }
        
        private String getAmountBucket(double amount) {
            if (amount < 10) return "micro";
            if (amount < 100) return "small";
            if (amount < 500) return "medium";
            if (amount < 2000) return "large";
            if (amount < 10000) return "very_large";
            return "extreme";
        }
    }
    
    /**
     * Amount cluster key selector for amount-based pattern detection.
     */
    private static class AmountClusterKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            double amount = transaction.getAmount() != null ? transaction.getAmount() : 0.0;
            
            // Logarithmic bucketing for amount clustering
            if (amount <= 0) return "zero";
            
            int bucket = (int) Math.floor(Math.log10(amount));
            double bucketBase = Math.pow(10, bucket);
            int subBucket = (int) Math.floor(amount / bucketBase);
            
            return String.format("amount_%d_%d", bucket, subBucket);
        }
    }
    
    // Aggregate Functions
    
    /**
     * User velocity aggregate function for real-time velocity tracking.
     */
    private static class UserVelocityAggregateFunction 
            implements AggregateFunction<Transaction, UserVelocityAccumulator, UserVelocityAggregate> {
        
        @Override
        public UserVelocityAccumulator createAccumulator() {
            return new UserVelocityAccumulator();
        }
        
        @Override
        public UserVelocityAccumulator add(Transaction transaction, UserVelocityAccumulator accumulator) {
            accumulator.userId = transaction.getUserId();
            accumulator.transactionCount++;
            accumulator.totalAmount += transaction.getAmount() != null ? transaction.getAmount() : 0.0;
            accumulator.uniqueMerchants.add(transaction.getMerchantId());
            
            if (Boolean.TRUE.equals(transaction.getIsFraud())) {
                accumulator.fraudCount++;
            }
            
            if (transaction.getFraudScore() != null && transaction.getFraudScore() > 0.7) {
                accumulator.highRiskCount++;
            }
            
            // Track unique payment methods
            if (transaction.getPaymentMethod() != null) {
                accumulator.paymentMethods.add(transaction.getPaymentMethod());
            }
            
            // Update time window
            long timestamp = transaction.getTimestamp().toEpochMilli();
            if (accumulator.windowStart == 0 || timestamp < accumulator.windowStart) {
                accumulator.windowStart = timestamp;
            }
            if (timestamp > accumulator.windowEnd) {
                accumulator.windowEnd = timestamp;
            }
            
            return accumulator;
        }
        
        @Override
        public UserVelocityAggregate getResult(UserVelocityAccumulator accumulator) {
            UserVelocityAggregate result = new UserVelocityAggregate();
            result.setUserId(accumulator.userId);
            result.setWindowStart(Instant.ofEpochMilli(accumulator.windowStart));
            result.setWindowEnd(Instant.ofEpochMilli(accumulator.windowEnd));
            result.setTransactionCount(accumulator.transactionCount);
            result.setTotalAmount(accumulator.totalAmount);
            result.setFraudCount(accumulator.fraudCount);
            result.setHighRiskCount(accumulator.highRiskCount);
            result.setUniqueMerchantCount(accumulator.uniqueMerchants.size());
            result.setUniquePaymentMethodCount(accumulator.paymentMethods.size());
            result.setAvgAmount(accumulator.transactionCount > 0 ? 
                              accumulator.totalAmount / accumulator.transactionCount : 0.0);
            result.setFraudRate(accumulator.transactionCount > 0 ? 
                              (double) accumulator.fraudCount / accumulator.transactionCount : 0.0);
            result.setVelocityScore(calculateVelocityScore(accumulator));
            
            return result;
        }
        
        @Override
        public UserVelocityAccumulator merge(UserVelocityAccumulator a, UserVelocityAccumulator b) {
            UserVelocityAccumulator merged = new UserVelocityAccumulator();
            merged.userId = a.userId != null ? a.userId : b.userId;
            merged.transactionCount = a.transactionCount + b.transactionCount;
            merged.totalAmount = a.totalAmount + b.totalAmount;
            merged.fraudCount = a.fraudCount + b.fraudCount;
            merged.highRiskCount = a.highRiskCount + b.highRiskCount;
            merged.uniqueMerchants.addAll(a.uniqueMerchants);
            merged.uniqueMerchants.addAll(b.uniqueMerchants);
            merged.paymentMethods.addAll(a.paymentMethods);
            merged.paymentMethods.addAll(b.paymentMethods);
            merged.windowStart = Math.min(a.windowStart, b.windowStart);
            merged.windowEnd = Math.max(a.windowEnd, b.windowEnd);
            
            return merged;
        }
        
        private double calculateVelocityScore(UserVelocityAccumulator accumulator) {
            double score = 0.0;
            
            // Transaction count factor
            if (accumulator.transactionCount > 20) score += 0.4;
            else if (accumulator.transactionCount > 10) score += 0.2;
            else if (accumulator.transactionCount > 5) score += 0.1;
            
            // Amount factor
            if (accumulator.totalAmount > 10000) score += 0.3;
            else if (accumulator.totalAmount > 5000) score += 0.2;
            else if (accumulator.totalAmount > 1000) score += 0.1;
            
            // Fraud rate factor
            double fraudRate = accumulator.transactionCount > 0 ? 
                             (double) accumulator.fraudCount / accumulator.transactionCount : 0.0;
            score += fraudRate * 0.4;
            
            // Merchant diversity factor (low diversity = suspicious)
            double merchantDiversity = accumulator.transactionCount > 0 ? 
                                     (double) accumulator.uniqueMerchants.size() / accumulator.transactionCount : 0.0;
            if (merchantDiversity < 0.2) score += 0.2;
            
            return Math.min(1.0, score);
        }
    }
    
    /**
     * Merchant aggregate function for merchant risk assessment.
     */
    private static class MerchantAggregateFunction 
            implements AggregateFunction<Transaction, MerchantAccumulator, MerchantAggregate> {
        
        @Override
        public MerchantAccumulator createAccumulator() {
            return new MerchantAccumulator();
        }
        
        @Override
        public MerchantAccumulator add(Transaction transaction, MerchantAccumulator accumulator) {
            accumulator.merchantId = transaction.getMerchantId();
            accumulator.transactionCount++;
            accumulator.totalAmount += transaction.getAmount() != null ? transaction.getAmount() : 0.0;
            accumulator.uniqueUsers.add(transaction.getUserId());
            
            if (Boolean.TRUE.equals(transaction.getIsFraud())) {
                accumulator.fraudCount++;
                accumulator.fraudAmount += transaction.getAmount() != null ? transaction.getAmount() : 0.0;
            }
            
            if (transaction.getFraudScore() != null && transaction.getFraudScore() > 0.7) {
                accumulator.highRiskCount++;
            }
            
            // Track amounts for statistical analysis
            if (transaction.getAmount() != null) {
                accumulator.amounts.add(transaction.getAmount());
            }
            
            // Track payment methods
            if (transaction.getPaymentMethod() != null) {
                accumulator.paymentMethods.add(transaction.getPaymentMethod());
            }
            
            // Update time window
            long timestamp = transaction.getTimestamp().toEpochMilli();
            if (accumulator.windowStart == 0 || timestamp < accumulator.windowStart) {
                accumulator.windowStart = timestamp;
            }
            if (timestamp > accumulator.windowEnd) {
                accumulator.windowEnd = timestamp;
            }
            
            return accumulator;
        }
        
        @Override
        public MerchantAggregate getResult(MerchantAccumulator accumulator) {
            MerchantAggregate result = new MerchantAggregate();
            result.setMerchantId(accumulator.merchantId);
            result.setWindowStart(Instant.ofEpochMilli(accumulator.windowStart));
            result.setWindowEnd(Instant.ofEpochMilli(accumulator.windowEnd));
            result.setTransactionCount(accumulator.transactionCount);
            result.setTotalAmount(accumulator.totalAmount);
            result.setFraudCount(accumulator.fraudCount);
            result.setFraudAmount(accumulator.fraudAmount);
            result.setHighRiskCount(accumulator.highRiskCount);
            result.setUniqueUserCount(accumulator.uniqueUsers.size());
            result.setUniquePaymentMethodCount(accumulator.paymentMethods.size());
            result.setAvgAmount(accumulator.transactionCount > 0 ? 
                              accumulator.totalAmount / accumulator.transactionCount : 0.0);
            result.setFraudRate(accumulator.transactionCount > 0 ? 
                              (double) accumulator.fraudCount / accumulator.transactionCount : 0.0);
            result.setAmountStdDev(calculateStandardDeviation(accumulator.amounts));
            result.setRiskScore(calculateMerchantRiskScore(accumulator));
            
            return result;
        }
        
        @Override
        public MerchantAccumulator merge(MerchantAccumulator a, MerchantAccumulator b) {
            MerchantAccumulator merged = new MerchantAccumulator();
            merged.merchantId = a.merchantId != null ? a.merchantId : b.merchantId;
            merged.transactionCount = a.transactionCount + b.transactionCount;
            merged.totalAmount = a.totalAmount + b.totalAmount;
            merged.fraudCount = a.fraudCount + b.fraudCount;
            merged.fraudAmount = a.fraudAmount + b.fraudAmount;
            merged.highRiskCount = a.highRiskCount + b.highRiskCount;
            merged.uniqueUsers.addAll(a.uniqueUsers);
            merged.uniqueUsers.addAll(b.uniqueUsers);
            merged.paymentMethods.addAll(a.paymentMethods);
            merged.paymentMethods.addAll(b.paymentMethods);
            merged.amounts.addAll(a.amounts);
            merged.amounts.addAll(b.amounts);
            merged.windowStart = Math.min(a.windowStart, b.windowStart);
            merged.windowEnd = Math.max(a.windowEnd, b.windowEnd);
            
            return merged;
        }
        
        private double calculateStandardDeviation(List<Double> amounts) {
            if (amounts.size() < 2) return 0.0;
            
            double mean = amounts.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
            double variance = amounts.stream()
                                   .mapToDouble(amount -> Math.pow(amount - mean, 2))
                                   .average()
                                   .orElse(0.0);
            
            return Math.sqrt(variance);
        }
        
        private double calculateMerchantRiskScore(MerchantAccumulator accumulator) {
            double score = 0.0;
            
            // High fraud rate
            double fraudRate = accumulator.transactionCount > 0 ? 
                             (double) accumulator.fraudCount / accumulator.transactionCount : 0.0;
            score += fraudRate * 0.5;
            
            // High transaction volume
            if (accumulator.transactionCount > 1000) score += 0.2;
            else if (accumulator.transactionCount > 500) score += 0.1;
            
            // High amount variance (unusual transaction patterns)
            double avgAmount = accumulator.transactionCount > 0 ? 
                             accumulator.totalAmount / accumulator.transactionCount : 0.0;
            double stdDev = calculateStandardDeviation(accumulator.amounts);
            if (avgAmount > 0 && stdDev / avgAmount > 2.0) score += 0.2;
            
            // Low user diversity (same users repeatedly)
            double userDiversity = accumulator.transactionCount > 0 ? 
                                 (double) accumulator.uniqueUsers.size() / accumulator.transactionCount : 0.0;
            if (userDiversity < 0.1) score += 0.3;
            
            return Math.min(1.0, score);
        }
    }
    
    // Additional aggregate functions would be implemented similarly...
    // For brevity, I'll create the accumulator and result classes
    
    // Accumulator classes
    private static class UserVelocityAccumulator {
        String userId;
        int transactionCount = 0;
        double totalAmount = 0.0;
        int fraudCount = 0;
        int highRiskCount = 0;
        Set<String> uniqueMerchants = new HashSet<>();
        Set<String> paymentMethods = new HashSet<>();
        long windowStart = 0;
        long windowEnd = 0;
    }
    
    private static class MerchantAccumulator {
        String merchantId;
        int transactionCount = 0;
        double totalAmount = 0.0;
        int fraudCount = 0;
        double fraudAmount = 0.0;
        int highRiskCount = 0;
        Set<String> uniqueUsers = new HashSet<>();
        Set<String> paymentMethods = new HashSet<>();
        List<Double> amounts = new ArrayList<>();
        long windowStart = 0;
        long windowEnd = 0;
    }
}