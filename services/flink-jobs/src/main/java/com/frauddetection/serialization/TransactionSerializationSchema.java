package com.frauddetection.serialization;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.frauddetection.models.Transaction;
import org.apache.flink.api.common.serialization.SerializationSchema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * Serialization schema for converting Transaction objects to JSON for Kafka output.
 */
public class TransactionSerializationSchema implements SerializationSchema<Transaction> {
    
    private static final Logger LOG = LoggerFactory.getLogger(TransactionSerializationSchema.class);
    
    private final ObjectMapper objectMapper;
    
    public TransactionSerializationSchema() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }
    
    @Override
    public byte[] serialize(Transaction transaction) {
        try {
            String jsonString = objectMapper.writeValueAsString(transaction);
            LOG.debug("Serialized transaction: {}", transaction.getTransactionId());
            return jsonString.getBytes(StandardCharsets.UTF_8);
            
        } catch (Exception e) {
            LOG.error("Error serializing transaction {}: {}", transaction.getTransactionId(), e.getMessage());
            
            // Return minimal JSON to avoid breaking the stream
            String errorJson = String.format(
                "{\"transaction_id\":\"%s\",\"error\":\"serialization_failed\",\"timestamp\":\"%s\"}",
                transaction.getTransactionId(),
                java.time.Instant.now().toString()
            );
            
            return errorJson.getBytes(StandardCharsets.UTF_8);
        }
    }
}