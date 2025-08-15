package com.frauddetection.serialization;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.frauddetection.models.Transaction;
import org.apache.flink.api.common.serialization.DeserializationSchema;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * Deserialization schema for converting Kafka JSON messages to Transaction objects.
 */
public class TransactionDeserializationSchema implements DeserializationSchema<Transaction> {
    
    private static final Logger LOG = LoggerFactory.getLogger(TransactionDeserializationSchema.class);
    
    private final ObjectMapper objectMapper;
    
    public TransactionDeserializationSchema() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }
    
    @Override
    public Transaction deserialize(byte[] message) {
        try {
            String jsonString = new String(message, StandardCharsets.UTF_8);
            Transaction transaction = objectMapper.readValue(jsonString, Transaction.class);
            
            LOG.debug("Deserialized transaction: {}", transaction.getTransactionId());
            return transaction;
            
        } catch (Exception e) {
            LOG.error("Error deserializing transaction: {}", e.getMessage());
            
            // Return a placeholder transaction to avoid breaking the stream
            // In production, you might want to send to a dead letter queue
            Transaction errorTransaction = new Transaction();
            errorTransaction.setTransactionId("ERROR_" + System.currentTimeMillis());
            errorTransaction.setFraudScore(0.5); // Default moderate risk
            errorTransaction.setRiskLevel("ERROR");
            errorTransaction.setDecision("REVIEW");
            
            return errorTransaction;
        }
    }
    
    @Override
    public boolean isEndOfStream(Transaction nextElement) {
        return false; // Stream should never end
    }
    
    @Override
    public TypeInformation<Transaction> getProducedType() {
        return TypeInformation.of(Transaction.class);
    }
}