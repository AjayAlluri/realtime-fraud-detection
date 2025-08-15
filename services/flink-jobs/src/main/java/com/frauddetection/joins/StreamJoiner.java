package com.frauddetection.joins;

import com.frauddetection.models.Transaction;
import com.frauddetection.models.UserProfile;
import com.frauddetection.models.MerchantProfile;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.JoinFunction;
import org.apache.flink.api.java.functions.KeySelector;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;

/**
 * Stream joiner for correlating transactions with user behavior, merchant data,
 * and historical patterns using Flink's advanced joining capabilities.
 */
public class StreamJoiner {
    
    private static final Logger LOG = LoggerFactory.getLogger(StreamJoiner.class);
    
    /**
     * Join transactions with user behavior events within a time window.
     * This correlates real-time transactions with recent user activities.
     */
    public static DataStream<EnrichedTransaction> joinTransactionWithUserBehavior(
            DataStream<Transaction> transactionStream,
            DataStream<UserBehaviorEvent> userBehaviorStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new TransactionUserKeySelector())
            .join(userBehaviorStream
                .assignTimestampsAndWatermarks(
                    WatermarkStrategy.<UserBehaviorEvent>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                        .withTimestampAssigner((event, timestamp) -> 
                            event.getTimestamp().toEpochMilli()))
                .keyBy(new UserBehaviorKeySelector()))
            .where(new TransactionUserKeySelector())
            .equalTo(new UserBehaviorKeySelector())
            .window(TumblingEventTimeWindows.of(Time.minutes(5)))
            .apply(new TransactionUserBehaviorJoinFunction());
    }
    
    /**
     * Join transactions with merchant profile updates.
     * This captures changes in merchant risk profiles in real-time.
     */
    public static DataStream<EnrichedTransaction> joinTransactionWithMerchantUpdates(
            DataStream<Transaction> transactionStream,
            DataStream<MerchantProfileUpdate> merchantUpdateStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new TransactionMerchantKeySelector())
            .join(merchantUpdateStream
                .assignTimestampsAndWatermarks(
                    WatermarkStrategy.<MerchantProfileUpdate>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                        .withTimestampAssigner((update, timestamp) -> 
                            update.getTimestamp().toEpochMilli()))
                .keyBy(new MerchantUpdateKeySelector()))
            .where(new TransactionMerchantKeySelector())
            .equalTo(new MerchantUpdateKeySelector())
            .window(TumblingEventTimeWindows.of(Time.minutes(10)))
            .apply(new TransactionMerchantUpdateJoinFunction());
    }
    
    /**
     * Join transactions with historical fraud patterns.
     * This correlates current transactions with similar past fraud cases.
     */
    public static DataStream<EnrichedTransaction> joinTransactionWithHistoricalPatterns(
            DataStream<Transaction> transactionStream,
            DataStream<HistoricalFraudPattern> historicalPatternStream) {
        
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(new TransactionPatternKeySelector())
            .join(historicalPatternStream
                .assignTimestampsAndWatermarks(
                    WatermarkStrategy.<HistoricalFraudPattern>forBoundedOutOfOrderness(Duration.ofMinutes(1))
                        .withTimestampAssigner((pattern, timestamp) -> 
                            pattern.getTimestamp().toEpochMilli()))
                .keyBy(new HistoricalPatternKeySelector()))
            .where(new TransactionPatternKeySelector())
            .equalTo(new HistoricalPatternKeySelector())
            .window(TumblingEventTimeWindows.of(Time.hours(1)))
            .apply(new TransactionHistoricalPatternJoinFunction());
    }
    
    /**
     * Connect multiple streams for complex correlation analysis.
     * This enables cross-stream pattern detection and anomaly identification.
     */
    public static DataStream<ComplexEvent> connectMultipleStreams(
            DataStream<Transaction> transactionStream,
            DataStream<UserBehaviorEvent> userBehaviorStream,
            DataStream<DeviceEvent> deviceEventStream,
            DataStream<NetworkEvent> networkEventStream) {
        
        // Create a connected stream for complex event processing
        return transactionStream
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                    .withTimestampAssigner((transaction, timestamp) -> 
                        transaction.getTimestamp().toEpochMilli()))
            .keyBy(Transaction::getUserId)
            .connect(userBehaviorStream
                .assignTimestampsAndWatermarks(
                    WatermarkStrategy.<UserBehaviorEvent>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                        .withTimestampAssigner((event, timestamp) -> 
                            event.getTimestamp().toEpochMilli()))
                .keyBy(UserBehaviorEvent::getUserId))
            .process(new MultiStreamCorrelationFunction(deviceEventStream, networkEventStream));
    }
    
    // Key Selectors
    
    private static class TransactionUserKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            return transaction.getUserId();
        }
    }
    
    private static class UserBehaviorKeySelector implements KeySelector<UserBehaviorEvent, String> {
        @Override
        public String getKey(UserBehaviorEvent event) {
            return event.getUserId();
        }
    }
    
    private static class TransactionMerchantKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            return transaction.getMerchantId();
        }
    }
    
    private static class MerchantUpdateKeySelector implements KeySelector<MerchantProfileUpdate, String> {
        @Override
        public String getKey(MerchantProfileUpdate update) {
            return update.getMerchantId();
        }
    }
    
    private static class TransactionPatternKeySelector implements KeySelector<Transaction, String> {
        @Override
        public String getKey(Transaction transaction) {
            // Create a composite key for pattern matching
            return String.format("%s:%s:%.0f", 
                transaction.getPaymentMethod(),
                transaction.getMerchantProfile() != null ? 
                    transaction.getMerchantProfile().getCategory() : "unknown",
                Math.floor(transaction.getAmount() / 100) * 100); // Amount bucket
        }
    }
    
    private static class HistoricalPatternKeySelector implements KeySelector<HistoricalFraudPattern, String> {
        @Override
        public String getKey(HistoricalFraudPattern pattern) {
            return String.format("%s:%s:%.0f", 
                pattern.getPaymentMethod(),
                pattern.getMerchantCategory(),
                Math.floor(pattern.getAmountRange() / 100) * 100);
        }
    }
    
    // Join Functions
    
    private static class TransactionUserBehaviorJoinFunction 
            implements JoinFunction<Transaction, UserBehaviorEvent, EnrichedTransaction> {
        
        @Override
        public EnrichedTransaction join(Transaction transaction, UserBehaviorEvent userBehavior) {
            EnrichedTransaction enriched = new EnrichedTransaction(transaction);
            
            // Add user behavior context
            enriched.addUserBehaviorContext(userBehavior);
            
            // Calculate behavior-based risk factors
            enriched.addRiskFactor("recent_login_anomaly", 
                userBehavior.isAnomalousLogin() ? 0.3 : 0.0);
            enriched.addRiskFactor("session_duration_anomaly", 
                userBehavior.isShortSession() ? 0.2 : 0.0);
            enriched.addRiskFactor("navigation_pattern_anomaly", 
                userBehavior.isAnomalousNavigation() ? 0.25 : 0.0);
            
            LOG.debug("Joined transaction {} with user behavior for user {}", 
                transaction.getTransactionId(), transaction.getUserId());
            
            return enriched;
        }
    }
    
    private static class TransactionMerchantUpdateJoinFunction 
            implements JoinFunction<Transaction, MerchantProfileUpdate, EnrichedTransaction> {
        
        @Override
        public EnrichedTransaction join(Transaction transaction, MerchantProfileUpdate merchantUpdate) {
            EnrichedTransaction enriched = new EnrichedTransaction(transaction);
            
            // Add merchant update context
            enriched.addMerchantUpdateContext(merchantUpdate);
            
            // Calculate update-based risk factors
            if (merchantUpdate.isRiskLevelIncreased()) {
                enriched.addRiskFactor("merchant_risk_increase", 0.4);
            }
            
            if (merchantUpdate.isFraudRateIncreased()) {
                enriched.addRiskFactor("merchant_fraud_rate_increase", 0.3);
            }
            
            if (merchantUpdate.isNewlyBlacklisted()) {
                enriched.addRiskFactor("merchant_newly_blacklisted", 0.8);
            }
            
            LOG.debug("Joined transaction {} with merchant update for merchant {}", 
                transaction.getTransactionId(), transaction.getMerchantId());
            
            return enriched;
        }
    }
    
    private static class TransactionHistoricalPatternJoinFunction 
            implements JoinFunction<Transaction, HistoricalFraudPattern, EnrichedTransaction> {
        
        @Override
        public EnrichedTransaction join(Transaction transaction, HistoricalFraudPattern pattern) {
            EnrichedTransaction enriched = new EnrichedTransaction(transaction);
            
            // Add historical pattern context
            enriched.addHistoricalPatternContext(pattern);
            
            // Calculate pattern-based risk factors
            double patternSimilarity = calculatePatternSimilarity(transaction, pattern);
            enriched.addRiskFactor("historical_pattern_similarity", 
                patternSimilarity * pattern.getFraudRate());
            
            // Add temporal pattern risk
            if (pattern.isRecentPattern() && pattern.getFraudRate() > 0.5) {
                enriched.addRiskFactor("recent_high_fraud_pattern", 0.4);
            }
            
            // Add frequency-based risk
            if (pattern.getOccurrenceCount() > 100 && pattern.getFraudRate() > 0.3) {
                enriched.addRiskFactor("frequent_fraud_pattern", 0.3);
            }
            
            LOG.debug("Joined transaction {} with historical pattern (fraud rate: {:.2f})", 
                transaction.getTransactionId(), pattern.getFraudRate());
            
            return enriched;
        }
        
        private double calculatePatternSimilarity(Transaction transaction, HistoricalFraudPattern pattern) {
            double similarity = 0.0;
            
            // Payment method similarity
            if (transaction.getPaymentMethod() != null && 
                transaction.getPaymentMethod().equals(pattern.getPaymentMethod())) {
                similarity += 0.3;
            }
            
            // Amount range similarity
            double amountDiff = Math.abs(transaction.getAmount() - pattern.getAmountRange());
            double amountSimilarity = Math.max(0, 1.0 - (amountDiff / Math.max(transaction.getAmount(), pattern.getAmountRange())));
            similarity += amountSimilarity * 0.4;
            
            // Time pattern similarity
            if (transaction.getHourOfDay() != null && pattern.getHourOfDay() != null) {
                int hourDiff = Math.abs(transaction.getHourOfDay() - pattern.getHourOfDay());
                double timeSimilarity = Math.max(0, 1.0 - (hourDiff / 12.0)); // Normalize by half day
                similarity += timeSimilarity * 0.3;
            }
            
            return Math.min(1.0, similarity);
        }
    }
}