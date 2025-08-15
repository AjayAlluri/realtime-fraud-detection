package com.frauddetection;

import com.frauddetection.config.JobConfig;
import com.frauddetection.models.Transaction;
import com.frauddetection.processors.TransactionProcessor;
import com.frauddetection.serialization.TransactionDeserializationSchema;
import com.frauddetection.serialization.TransactionSerializationSchema;
import com.frauddetection.sinks.RedisTransactionSink;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.CheckpointingMode;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.connectors.kafka.FlinkKafkaProducer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.Properties;

/**
 * Main Flink job for real-time fraud detection.
 * 
 * This job processes payment transactions from Kafka, applies basic fraud detection logic,
 * enriches transactions with user and merchant data, and outputs results to Redis and Kafka.
 */
public class FraudDetectionJob {
    
    private static final Logger LOG = LoggerFactory.getLogger(FraudDetectionJob.class);
    
    public static void main(String[] args) throws Exception {
        LOG.info("Starting Real-Time Fraud Detection Flink Job");
        
        // Initialize job configuration
        JobConfig config = JobConfig.fromArgs(args);
        LOG.info("Loaded configuration: {}", config);
        
        // Set up the execution environment
        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        
        // Configure checkpointing for fault tolerance
        setupCheckpointing(env, config);
        
        // Configure parallelism
        env.setParallelism(config.getParallelism());
        
        // Create Kafka source for payment transactions
        KafkaSource<Transaction> transactionSource = createTransactionSource(config);
        
        // Create the main data stream
        DataStream<Transaction> transactionStream = env
            .fromSource(transactionSource, WatermarkStrategy.<Transaction>forBoundedOutOfOrderness(Duration.ofSeconds(5))
                .withTimestampAssigner((transaction, timestamp) -> transaction.getTimestamp().toEpochMilli()), "transaction-source")
            .name("Kafka Transaction Source")
            .uid("kafka-transaction-source");
        
        // Process transactions through the fraud detection pipeline
        DataStream<Transaction> processedTransactions = transactionStream
            .process(new TransactionProcessor(config))
            .name("Transaction Processor")
            .uid("transaction-processor");
        
        // Split stream based on fraud score
        DataStream<Transaction> highRiskTransactions = processedTransactions
            .filter(transaction -> transaction.getFraudScore() > 0.7)
            .name("High Risk Filter")
            .uid("high-risk-filter");
        
        DataStream<Transaction> normalTransactions = processedTransactions
            .filter(transaction -> transaction.getFraudScore() <= 0.7)
            .name("Normal Transaction Filter") 
            .uid("normal-transaction-filter");
        
        // Output high-risk transactions to fraud alerts topic
        highRiskTransactions
            .map(transaction -> transaction.toFraudAlert())
            .addSink(createFraudAlertProducer(config))
            .name("Fraud Alert Sink")
            .uid("fraud-alert-sink");
        
        // Output enriched transactions to Redis for real-time lookups
        processedTransactions
            .addSink(new RedisTransactionSink(config))
            .name("Redis Transaction Sink")
            .uid("redis-transaction-sink");
        
        // Output processed transactions to enriched topic
        processedTransactions
            .addSink(createEnrichedTransactionProducer(config))
            .name("Enriched Transaction Sink")
            .uid("enriched-transaction-sink");
        
        // Output transaction features for ML training
        processedTransactions
            .map(transaction -> transaction.extractFeatures())
            .addSink(createTransactionFeaturesProducer(config))
            .name("Transaction Features Sink")
            .uid("transaction-features-sink");
        
        LOG.info("Fraud Detection Job configured successfully");
        LOG.info("Starting job execution...");
        
        // Execute the job
        env.execute("Real-Time Fraud Detection Job");
    }
    
    /**
     * Configure checkpointing for fault tolerance and exactly-once processing.
     */
    private static void setupCheckpointing(StreamExecutionEnvironment env, JobConfig config) {
        // Enable checkpointing with the specified interval
        env.enableCheckpointing(config.getCheckpointInterval());
        
        // Set checkpointing mode to exactly-once
        env.getCheckpointConfig().setCheckpointingMode(CheckpointingMode.EXACTLY_ONCE);
        
        // Set minimum pause between checkpoints
        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(config.getMinPauseBetweenCheckpoints());
        
        // Set checkpoint timeout
        env.getCheckpointConfig().setCheckpointTimeout(config.getCheckpointTimeout());
        
        // Allow max concurrent checkpoints
        env.getCheckpointConfig().setMaxConcurrentCheckpoints(1);
        
        // Enable externalized checkpoints
        env.getCheckpointConfig().setExternalizedCheckpointCleanup(
            org.apache.flink.streaming.api.CheckpointingMode.EXACTLY_ONCE.name().equals("EXACTLY_ONCE") ?
                org.apache.flink.streaming.api.environment.CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION :
                org.apache.flink.streaming.api.environment.CheckpointConfig.ExternalizedCheckpointCleanup.DELETE_ON_CANCELLATION
        );
        
        LOG.info("Checkpointing configured with interval: {}ms", config.getCheckpointInterval());
    }
    
    /**
     * Create Kafka source for consuming payment transactions.
     */
    private static KafkaSource<Transaction> createTransactionSource(JobConfig config) {
        Properties kafkaProps = new Properties();
        kafkaProps.setProperty("bootstrap.servers", config.getKafkaBrokers());
        kafkaProps.setProperty("group.id", config.getConsumerGroupId());
        kafkaProps.setProperty("auto.offset.reset", "latest");
        kafkaProps.setProperty("enable.auto.commit", "false");
        kafkaProps.setProperty("isolation.level", "read_committed");
        
        return KafkaSource.<Transaction>builder()
            .setBootstrapServers(config.getKafkaBrokers())
            .setTopics("payment-transactions")
            .setGroupId(config.getConsumerGroupId())
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new TransactionDeserializationSchema())
            .setProperties(kafkaProps)
            .build();
    }
    
    /**
     * Create Kafka producer for fraud alerts.
     */
    private static FlinkKafkaProducer<String> createFraudAlertProducer(JobConfig config) {
        Properties producerProps = createProducerProperties(config);
        
        return new FlinkKafkaProducer<>(
            "fraud-alerts",
            new SimpleStringSchema(),
            producerProps
        );
    }
    
    /**
     * Create Kafka producer for enriched transactions.
     */
    private static FlinkKafkaProducer<Transaction> createEnrichedTransactionProducer(JobConfig config) {
        Properties producerProps = createProducerProperties(config);
        
        return new FlinkKafkaProducer<>(
            "transaction-enriched",
            new TransactionSerializationSchema(),
            producerProps
        );
    }
    
    /**
     * Create Kafka producer for transaction features.
     */
    private static FlinkKafkaProducer<String> createTransactionFeaturesProducer(JobConfig config) {
        Properties producerProps = createProducerProperties(config);
        
        return new FlinkKafkaProducer<>(
            "transaction-features",
            new SimpleStringSchema(),
            producerProps
        );
    }
    
    /**
     * Create common Kafka producer properties.
     */
    private static Properties createProducerProperties(JobConfig config) {
        Properties props = new Properties();
        props.setProperty("bootstrap.servers", config.getKafkaBrokers());
        props.setProperty("acks", "all");
        props.setProperty("retries", "3");
        props.setProperty("batch.size", "16384");
        props.setProperty("linger.ms", "5");
        props.setProperty("buffer.memory", "33554432");
        props.setProperty("compression.type", "lz4");
        props.setProperty("max.in.flight.requests.per.connection", "5");
        props.setProperty("enable.idempotence", "true");
        return props;
    }
}