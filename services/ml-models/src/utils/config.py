"""
Configuration management for the ML Models service.
"""
import os
from typing import Dict, Any, List
from dataclasses import dataclass, field


@dataclass
class ModelConfig:
    """Configuration for individual ML models."""
    name: str
    model_type: str  # 'xgboost', 'tensorflow', 'pytorch', 'sklearn'
    model_path: str
    weight: float = 1.0
    enabled: bool = True
    preprocessing_steps: List[str] = field(default_factory=list)
    hyperparameters: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EnsembleConfig:
    """Configuration for ensemble prediction."""
    strategy: str = "weighted_average"  # 'weighted_average', 'voting', 'stacking'
    confidence_threshold: float = 0.7
    fraud_threshold: float = 0.5
    enable_explanation: bool = True


@dataclass
class RedisConfig:
    """Redis connection configuration."""
    host: str = "localhost"
    port: int = 6379
    db: int = 0
    password: str = None
    socket_timeout: float = 5.0
    connection_pool_size: int = 20


@dataclass
class KafkaConfig:
    """Kafka connection configuration."""
    bootstrap_servers: List[str] = field(default_factory=lambda: ["localhost:9092"])
    security_protocol: str = "PLAINTEXT"
    sasl_mechanism: str = None
    sasl_username: str = None
    sasl_password: str = None


@dataclass
class MonitoringConfig:
    """Monitoring and metrics configuration."""
    enable_prometheus: bool = True
    prometheus_port: int = 8081
    log_level: str = "INFO"
    enable_performance_tracking: bool = True
    enable_drift_detection: bool = True


class Config:
    """Main configuration class for the ML Models service."""
    
    def __init__(self):
        self.load_from_environment()
        self.setup_model_configs()
        
    def load_from_environment(self):
        """Load configuration from environment variables."""
        
        # Service configuration
        self.service_name = os.getenv("SERVICE_NAME", "ml-models")
        self.service_port = int(os.getenv("ML_SERVICE_PORT", "8080"))
        self.service_host = os.getenv("ML_SERVICE_HOST", "0.0.0.0")
        self.environment = os.getenv("ENVIRONMENT", "development")
        
        # Model paths
        self.models_base_path = os.getenv("MODELS_PATH", "/app/models")
        self.model_cache_size = int(os.getenv("MODEL_CACHE_SIZE", "5"))
        
        # Feature processing
        self.feature_cache_ttl = int(os.getenv("FEATURE_CACHE_TTL", "3600"))
        self.max_feature_age_seconds = int(os.getenv("MAX_FEATURE_AGE_SECONDS", "300"))
        
        # Performance settings
        self.max_concurrent_predictions = int(os.getenv("MAX_CONCURRENT_PREDICTIONS", "100"))
        self.prediction_timeout_seconds = float(os.getenv("PREDICTION_TIMEOUT_SECONDS", "5.0"))
        self.batch_size_limit = int(os.getenv("BATCH_SIZE_LIMIT", "1000"))
        
        # Redis configuration
        self.redis = RedisConfig(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            db=int(os.getenv("REDIS_DB", "0")),
            password=os.getenv("REDIS_PASSWORD"),
            socket_timeout=float(os.getenv("REDIS_TIMEOUT", "5.0")),
            connection_pool_size=int(os.getenv("REDIS_POOL_SIZE", "20"))
        )
        
        # Kafka configuration
        self.kafka = KafkaConfig(
            bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092").split(","),
            security_protocol=os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
            sasl_mechanism=os.getenv("KAFKA_SASL_MECHANISM"),
            sasl_username=os.getenv("KAFKA_SASL_USERNAME"),
            sasl_password=os.getenv("KAFKA_SASL_PASSWORD")
        )
        
        # Monitoring configuration
        self.monitoring = MonitoringConfig(
            enable_prometheus=os.getenv("ENABLE_PROMETHEUS", "true").lower() == "true",
            prometheus_port=int(os.getenv("PROMETHEUS_PORT", "8081")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            enable_performance_tracking=os.getenv("ENABLE_PERFORMANCE_TRACKING", "true").lower() == "true",
            enable_drift_detection=os.getenv("ENABLE_DRIFT_DETECTION", "true").lower() == "true"
        )
        
        # Ensemble configuration
        self.ensemble = EnsembleConfig(
            strategy=os.getenv("ENSEMBLE_STRATEGY", "weighted_average"),
            confidence_threshold=float(os.getenv("CONFIDENCE_THRESHOLD", "0.7")),
            fraud_threshold=float(os.getenv("FRAUD_THRESHOLD", "0.5")),
            enable_explanation=os.getenv("ENABLE_EXPLANATION", "true").lower() == "true"
        )
    
    def setup_model_configs(self):
        """Setup configurations for individual models."""
        self.models = {
            "xgboost_primary": ModelConfig(
                name="xgboost_primary",
                model_type="xgboost",
                model_path=os.path.join(self.models_base_path, "xgboost", "fraud_classifier.json"),
                weight=0.4,
                enabled=True,
                preprocessing_steps=["normalize", "handle_missing"],
                hyperparameters={
                    "n_estimators": 100,
                    "max_depth": 6,
                    "learning_rate": 0.1,
                    "subsample": 0.8,
                    "colsample_bytree": 0.8
                }
            ),
            
            "lstm_sequential": ModelConfig(
                name="lstm_sequential",
                model_type="tensorflow",
                model_path=os.path.join(self.models_base_path, "tensorflow", "lstm_fraud_model.h5"),
                weight=0.25,
                enabled=True,
                preprocessing_steps=["sequence_padding", "normalize"],
                hyperparameters={
                    "sequence_length": 10,
                    "hidden_units": 128,
                    "dropout": 0.2
                }
            ),
            
            "bert_text": ModelConfig(
                name="bert_text",
                model_type="transformers",
                model_path=os.path.join(self.models_base_path, "transformers", "distilbert-fraud"),
                weight=0.15,
                enabled=True,
                preprocessing_steps=["tokenize", "truncate"],
                hyperparameters={
                    "max_length": 512,
                    "model_name": "distilbert-base-uncased"
                }
            ),
            
            "graph_neural": ModelConfig(
                name="graph_neural",
                model_type="pytorch",
                model_path=os.path.join(self.models_base_path, "pytorch", "gnn_fraud_model.pth"),
                weight=0.15,
                enabled=True,
                preprocessing_steps=["graph_construction", "normalize"],
                hyperparameters={
                    "hidden_channels": 64,
                    "num_layers": 3,
                    "dropout": 0.1
                }
            ),
            
            "isolation_forest": ModelConfig(
                name="isolation_forest",
                model_type="sklearn",
                model_path=os.path.join(self.models_base_path, "sklearn", "isolation_forest.joblib"),
                weight=0.05,
                enabled=True,
                preprocessing_steps=["normalize"],
                hyperparameters={
                    "contamination": 0.1,
                    "n_estimators": 100,
                    "random_state": 42
                }
            )
        }
    
    def get_model_config(self, model_name: str) -> ModelConfig:
        """Get configuration for a specific model."""
        if model_name not in self.models:
            raise ValueError(f"Model '{model_name}' not found in configuration")
        return self.models[model_name]
    
    def get_enabled_models(self) -> Dict[str, ModelConfig]:
        """Get all enabled model configurations."""
        return {name: config for name, config in self.models.items() if config.enabled}
    
    def update_model_weight(self, model_name: str, weight: float):
        """Update the weight of a specific model."""
        if model_name in self.models:
            self.models[model_name].weight = weight
            
    def disable_model(self, model_name: str):
        """Disable a specific model."""
        if model_name in self.models:
            self.models[model_name].enabled = False
            
    def enable_model(self, model_name: str):
        """Enable a specific model."""
        if model_name in self.models:
            self.models[model_name].enabled = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert configuration to dictionary."""
        return {
            "service": {
                "name": self.service_name,
                "port": self.service_port,
                "host": self.service_host,
                "environment": self.environment
            },
            "models": {name: {
                "name": config.name,
                "model_type": config.model_type,
                "model_path": config.model_path,
                "weight": config.weight,
                "enabled": config.enabled,
                "preprocessing_steps": config.preprocessing_steps,
                "hyperparameters": config.hyperparameters
            } for name, config in self.models.items()},
            "ensemble": {
                "strategy": self.ensemble.strategy,
                "confidence_threshold": self.ensemble.confidence_threshold,
                "fraud_threshold": self.ensemble.fraud_threshold,
                "enable_explanation": self.ensemble.enable_explanation
            },
            "redis": {
                "host": self.redis.host,
                "port": self.redis.port,
                "db": self.redis.db,
                "socket_timeout": self.redis.socket_timeout,
                "connection_pool_size": self.redis.connection_pool_size
            },
            "kafka": {
                "bootstrap_servers": self.kafka.bootstrap_servers,
                "security_protocol": self.kafka.security_protocol
            },
            "monitoring": {
                "enable_prometheus": self.monitoring.enable_prometheus,
                "prometheus_port": self.monitoring.prometheus_port,
                "log_level": self.monitoring.log_level,
                "enable_performance_tracking": self.monitoring.enable_performance_tracking,
                "enable_drift_detection": self.monitoring.enable_drift_detection
            },
            "performance": {
                "max_concurrent_predictions": self.max_concurrent_predictions,
                "prediction_timeout_seconds": self.prediction_timeout_seconds,
                "batch_size_limit": self.batch_size_limit,
                "feature_cache_ttl": self.feature_cache_ttl,
                "max_feature_age_seconds": self.max_feature_age_seconds
            }
        }
    
    @classmethod
    def from_file(cls, config_path: str) -> 'Config':
        """Load configuration from a file."""
        import json
        
        with open(config_path, 'r') as f:
            config_data = json.load(f)
        
        # Create a new config instance and override with file data
        config = cls()
        
        # Override environment variables with file values
        if "service" in config_data:
            for key, value in config_data["service"].items():
                setattr(config, key, value)
        
        # Override model configurations
        if "models" in config_data:
            for model_name, model_data in config_data["models"].items():
                if model_name in config.models:
                    for attr, value in model_data.items():
                        setattr(config.models[model_name], attr, value)
        
        return config