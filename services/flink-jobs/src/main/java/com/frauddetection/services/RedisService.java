package com.frauddetection.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.frauddetection.config.JobConfig;
import com.frauddetection.models.MerchantProfile;
import com.frauddetection.models.Transaction;
import com.frauddetection.models.UserProfile;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.exceptions.JedisException;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Redis service for caching user profiles, merchant data, transactions,
 * and real-time feature computations.
 */
public class RedisService implements AutoCloseable {
    
    private static final Logger LOG = LoggerFactory.getLogger(RedisService.class);
    
    private final JobConfig config;
    private final JedisPool jedisPool;
    private final ObjectMapper objectMapper;
    
    // Key prefixes for different data types
    private static final String USER_PROFILE_PREFIX = "user:";
    private static final String MERCHANT_PROFILE_PREFIX = "merchant:";
    private static final String TRANSACTION_PREFIX = "transaction:";
    private static final String USER_TRANSACTIONS_PREFIX = "user_transactions:";
    private static final String MERCHANT_TRANSACTIONS_PREFIX = "merchant_transactions:";
    private static final String VELOCITY_PREFIX = "velocity:";
    private static final String FEATURES_PREFIX = "features:";
    private static final String AGGREGATIONS_PREFIX = "agg:";
    
    // TTL values in seconds
    private static final int TRANSACTION_TTL = 86400; // 24 hours
    private static final int VELOCITY_TTL = 3600; // 1 hour
    private static final int FEATURES_TTL = 7200; // 2 hours
    private static final int AGGREGATIONS_TTL = 1800; // 30 minutes
    
    public RedisService(JobConfig config) {
        this.config = config;
        this.objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        this.jedisPool = createJedisPool();
        
        LOG.info("Redis service initialized with host: {}:{}", config.getRedisHost(), config.getRedisPort());
    }
    
    /**
     * Create and configure Jedis connection pool.
     */
    private JedisPool createJedisPool() {
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(config.getRedisMaxConnections());
        poolConfig.setMaxIdle(config.getRedisMaxConnections() / 2);
        poolConfig.setMinIdle(5);
        poolConfig.setTestOnBorrow(true);
        poolConfig.setTestOnReturn(true);
        poolConfig.setTestWhileIdle(true);
        poolConfig.setMinEvictableIdleTimeMillis(Duration.ofSeconds(60).toMillis());
        poolConfig.setTimeBetweenEvictionRunsMillis(Duration.ofSeconds(30).toMillis());
        poolConfig.setNumTestsPerEvictionRun(3);
        poolConfig.setBlockWhenExhausted(true);
        poolConfig.setMaxWaitMillis(config.getRedisTimeout());
        
        return new JedisPool(poolConfig, config.getRedisHost(), config.getRedisPort(), 
                           config.getRedisTimeout(), config.getRedisPassword());
    }
    
    /**
     * Get user profile from Redis cache.
     */
    public UserProfile getUserProfile(String userId) {
        String key = USER_PROFILE_PREFIX + userId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            Map<String, String> userMap = jedis.hgetAll(key);
            
            if (userMap != null && !userMap.isEmpty()) {
                return mapToUserProfile(userMap);
            }
            
            LOG.debug("User profile not found in cache for user: {}", userId);
            return null;
            
        } catch (JedisException e) {
            LOG.error("Error retrieving user profile for user {}: {}", userId, e.getMessage());
            return null;
        }
    }
    
    /**
     * Get merchant profile from Redis cache.
     */
    public MerchantProfile getMerchantProfile(String merchantId) {
        String key = MERCHANT_PROFILE_PREFIX + merchantId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            Map<String, String> merchantMap = jedis.hgetAll(key);
            
            if (merchantMap != null && !merchantMap.isEmpty()) {
                return mapToMerchantProfile(merchantMap);
            }
            
            LOG.debug("Merchant profile not found in cache for merchant: {}", merchantId);
            return null;
            
        } catch (JedisException e) {
            LOG.error("Error retrieving merchant profile for merchant {}: {}", merchantId, e.getMessage());
            return null;
        }
    }
    
    /**
     * Cache transaction in Redis for future reference.
     */
    public void cacheTransaction(Transaction transaction) {
        String key = TRANSACTION_PREFIX + transaction.getTransactionId();
        
        try (Jedis jedis = jedisPool.getResource()) {
            String transactionJson = objectMapper.writeValueAsString(transaction);
            jedis.setex(key, TRANSACTION_TTL, transactionJson);
            
            // Also add to user's transaction list
            addToUserTransactions(jedis, transaction);
            
            // Add to merchant's transaction list
            addToMerchantTransactions(jedis, transaction);
            
            LOG.debug("Cached transaction: {}", transaction.getTransactionId());
            
        } catch (Exception e) {
            LOG.error("Error caching transaction {}: {}", transaction.getTransactionId(), e.getMessage());
        }
    }
    
    /**
     * Get user's recent transactions for velocity and pattern analysis.
     */
    public List<String> getUserRecentTransactions(String userId, int limit) {
        String key = USER_TRANSACTIONS_PREFIX + userId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            return jedis.lrange(key, 0, limit - 1);
        } catch (JedisException e) {
            LOG.error("Error retrieving user transactions for user {}: {}", userId, e.getMessage());
            return List.of();
        }
    }
    
    /**
     * Get merchant's recent transactions for pattern analysis.
     */
    public List<String> getMerchantRecentTransactions(String merchantId, int limit) {
        String key = MERCHANT_TRANSACTIONS_PREFIX + merchantId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            return jedis.lrange(key, 0, limit - 1);
        } catch (JedisException e) {
            LOG.error("Error retrieving merchant transactions for merchant {}: {}", merchantId, e.getMessage());
            return List.of();
        }
    }
    
    /**
     * Store velocity metrics for user.
     */
    public void storeVelocityMetrics(String userId, String timeWindow, double amount, int count) {
        String key = VELOCITY_PREFIX + userId + ":" + timeWindow;
        
        try (Jedis jedis = jedisPool.getResource()) {
            Map<String, String> velocityData = new HashMap<>();
            velocityData.put("amount", String.valueOf(amount));
            velocityData.put("count", String.valueOf(count));
            velocityData.put("timestamp", String.valueOf(Instant.now().toEpochMilli()));
            
            jedis.hset(key, velocityData);
            jedis.expire(key, VELOCITY_TTL);
            
        } catch (JedisException e) {
            LOG.error("Error storing velocity metrics for user {}: {}", userId, e.getMessage());
        }
    }
    
    /**
     * Get velocity metrics for user.
     */
    public Map<String, String> getVelocityMetrics(String userId, String timeWindow) {
        String key = VELOCITY_PREFIX + userId + ":" + timeWindow;
        
        try (Jedis jedis = jedisPool.getResource()) {
            return jedis.hgetAll(key);
        } catch (JedisException e) {
            LOG.error("Error retrieving velocity metrics for user {}: {}", userId, e.getMessage());
            return new HashMap<>();
        }
    }
    
    /**
     * Store computed features for a transaction.
     */
    public void storeFeatures(String transactionId, Map<String, Object> features) {
        String key = FEATURES_PREFIX + transactionId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            String featuresJson = objectMapper.writeValueAsString(features);
            jedis.setex(key, FEATURES_TTL, featuresJson);
            
        } catch (Exception e) {
            LOG.error("Error storing features for transaction {}: {}", transactionId, e.getMessage());
        }
    }
    
    /**
     * Get computed features for a transaction.
     */
    public Map<String, Object> getFeatures(String transactionId) {
        String key = FEATURES_PREFIX + transactionId;
        
        try (Jedis jedis = jedisPool.getResource()) {
            String featuresJson = jedis.get(key);
            if (featuresJson != null) {
                return objectMapper.readValue(featuresJson, Map.class);
            }
            return new HashMap<>();
            
        } catch (Exception e) {
            LOG.error("Error retrieving features for transaction {}: {}", transactionId, e.getMessage());
            return new HashMap<>();
        }
    }
    
    /**
     * Store aggregated metrics (hourly, daily summaries).
     */
    public void storeAggregation(String aggregationKey, Map<String, Object> data) {
        String key = AGGREGATIONS_PREFIX + aggregationKey;
        
        try (Jedis jedis = jedisPool.getResource()) {
            String dataJson = objectMapper.writeValueAsString(data);
            jedis.setex(key, AGGREGATIONS_TTL, dataJson);
            
        } catch (Exception e) {
            LOG.error("Error storing aggregation {}: {}", aggregationKey, e.getMessage());
        }
    }
    
    /**
     * Get aggregated metrics.
     */
    public Map<String, Object> getAggregation(String aggregationKey) {
        String key = AGGREGATIONS_PREFIX + aggregationKey;
        
        try (Jedis jedis = jedisPool.getResource()) {
            String dataJson = jedis.get(key);
            if (dataJson != null) {
                return objectMapper.readValue(dataJson, Map.class);
            }
            return new HashMap<>();
            
        } catch (Exception e) {
            LOG.error("Error retrieving aggregation {}: {}", aggregationKey, e.getMessage());
            return new HashMap<>();
        }
    }
    
    /**
     * Increment counter with TTL.
     */
    public long incrementCounter(String counterKey, int ttl) {
        try (Jedis jedis = jedisPool.getResource()) {
            long value = jedis.incr(counterKey);
            if (value == 1) {
                jedis.expire(counterKey, ttl);
            }
            return value;
        } catch (JedisException e) {
            LOG.error("Error incrementing counter {}: {}", counterKey, e.getMessage());
            return 0;
        }
    }
    
    /**
     * Add transaction to user's transaction list.
     */
    private void addToUserTransactions(Jedis jedis, Transaction transaction) {
        String key = USER_TRANSACTIONS_PREFIX + transaction.getUserId();
        String transactionData = String.format("%s:%f:%d", 
            transaction.getTransactionId(), 
            transaction.getAmount(),
            transaction.getTimestamp().toEpochMilli());
        
        jedis.lpush(key, transactionData);
        jedis.ltrim(key, 0, 99); // Keep last 100 transactions
        jedis.expire(key, TRANSACTION_TTL);
    }
    
    /**
     * Add transaction to merchant's transaction list.
     */
    private void addToMerchantTransactions(Jedis jedis, Transaction transaction) {
        String key = MERCHANT_TRANSACTIONS_PREFIX + transaction.getMerchantId();
        String transactionData = String.format("%s:%f:%d", 
            transaction.getTransactionId(), 
            transaction.getAmount(),
            transaction.getTimestamp().toEpochMilli());
        
        jedis.lpush(key, transactionData);
        jedis.ltrim(key, 0, 499); // Keep last 500 transactions for merchants
        jedis.expire(key, TRANSACTION_TTL);
    }
    
    /**
     * Convert Redis hash map to UserProfile object.
     */
    private UserProfile mapToUserProfile(Map<String, String> userMap) {
        try {
            return objectMapper.readValue(objectMapper.writeValueAsString(userMap), UserProfile.class);
        } catch (Exception e) {
            LOG.error("Error converting map to UserProfile: {}", e.getMessage());
            return null;
        }
    }
    
    /**
     * Convert Redis hash map to MerchantProfile object.
     */
    private MerchantProfile mapToMerchantProfile(Map<String, String> merchantMap) {
        try {
            return objectMapper.readValue(objectMapper.writeValueAsString(merchantMap), MerchantProfile.class);
        } catch (Exception e) {
            LOG.error("Error converting map to MerchantProfile: {}", e.getMessage());
            return null;
        }
    }
    
    /**
     * Get Redis cluster health status.
     */
    public boolean isHealthy() {
        try (Jedis jedis = jedisPool.getResource()) {
            String response = jedis.ping();
            return "PONG".equals(response);
        } catch (Exception e) {
            LOG.error("Redis health check failed: {}", e.getMessage());
            return false;
        }
    }
    
    /**
     * Get Redis statistics.
     */
    public Map<String, String> getStats() {
        try (Jedis jedis = jedisPool.getResource()) {
            String info = jedis.info();
            Map<String, String> stats = new HashMap<>();
            
            for (String line : info.split("\r\n")) {
                if (line.contains(":")) {
                    String[] parts = line.split(":", 2);
                    stats.put(parts[0], parts[1]);
                }
            }
            
            return stats;
        } catch (Exception e) {
            LOG.error("Error retrieving Redis stats: {}", e.getMessage());
            return new HashMap<>();
        }
    }
    
    /**
     * Clean up expired keys (maintenance operation).
     */
    public void cleanup() {
        try (Jedis jedis = jedisPool.getResource()) {
            // Get all keys with our prefixes
            Set<String> expiredKeys = jedis.keys("*:expired:*");
            if (!expiredKeys.isEmpty()) {
                jedis.del(expiredKeys.toArray(new String[0]));
                LOG.info("Cleaned up {} expired keys", expiredKeys.size());
            }
        } catch (Exception e) {
            LOG.error("Error during Redis cleanup: {}", e.getMessage());
        }
    }
    
    @Override
    public void close() {
        if (jedisPool != null && !jedisPool.isClosed()) {
            jedisPool.close();
            LOG.info("Redis service closed");
        }
    }
}