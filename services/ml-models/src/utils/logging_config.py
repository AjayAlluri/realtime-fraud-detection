"""
Logging configuration for the ML Models service.
"""
import logging
import logging.config
import os
import sys
from typing import Dict, Any


def setup_logging(log_level: str = None, log_format: str = None) -> None:
    """
    Setup structured logging for the ML Models service.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_format: Log format string
    """
    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    if log_format is None:
        log_format = os.getenv(
            "LOG_FORMAT",
            "%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s"
        )
    
    # Logging configuration
    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": log_format,
                "datefmt": "%Y-%m-%d %H:%M:%S"
            },
            "json": {
                "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
                "format": "%(asctime)s %(name)s %(levelname)s %(filename)s %(lineno)d %(message)s"
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "level": log_level,
                "formatter": "standard",
                "stream": sys.stdout
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "level": log_level,
                "formatter": "json",
                "filename": "/tmp/ml-models.log",
                "maxBytes": 10485760,  # 10MB
                "backupCount": 5
            }
        },
        "loggers": {
            "": {  # Root logger
                "handlers": ["console"],
                "level": log_level,
                "propagate": False
            },
            "ml_models": {
                "handlers": ["console", "file"],
                "level": log_level,
                "propagate": False
            },
            "uvicorn": {
                "handlers": ["console"],
                "level": "INFO",
                "propagate": False
            },
            "uvicorn.access": {
                "handlers": ["console"],
                "level": "INFO",
                "propagate": False
            }
        }
    }
    
    # Apply configuration
    logging.config.dictConfig(config)
    
    # Set specific loggers to appropriate levels
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("tensorflow").setLevel(logging.ERROR)
    logging.getLogger("transformers").setLevel(logging.WARNING)
    
    logger = logging.getLogger(__name__)
    logger.info(f"Logging configured with level: {log_level}")


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the specified name.
    
    Args:
        name: Logger name
        
    Returns:
        Logger instance
    """
    return logging.getLogger(f"ml_models.{name}")


class StructuredLogger:
    """Structured logger for consistent logging across the service."""
    
    def __init__(self, name: str):
        self.logger = get_logger(name)
    
    def info(self, message: str, **kwargs):
        """Log info message with structured data."""
        self._log(logging.INFO, message, **kwargs)
    
    def warning(self, message: str, **kwargs):
        """Log warning message with structured data."""
        self._log(logging.WARNING, message, **kwargs)
    
    def error(self, message: str, **kwargs):
        """Log error message with structured data."""
        self._log(logging.ERROR, message, **kwargs)
    
    def debug(self, message: str, **kwargs):
        """Log debug message with structured data."""
        self._log(logging.DEBUG, message, **kwargs)
    
    def critical(self, message: str, **kwargs):
        """Log critical message with structured data."""
        self._log(logging.CRITICAL, message, **kwargs)
    
    def _log(self, level: int, message: str, **kwargs):
        """Internal logging method with structured data."""
        if kwargs:
            extra_data = " | ".join([f"{k}={v}" for k, v in kwargs.items()])
            full_message = f"{message} | {extra_data}"
        else:
            full_message = message
        
        self.logger.log(level, full_message)


def log_model_performance(
    model_name: str,
    processing_time_ms: float,
    prediction_score: float,
    transaction_id: str = None
):
    """
    Log model performance metrics.
    
    Args:
        model_name: Name of the model
        processing_time_ms: Processing time in milliseconds
        prediction_score: Prediction score
        transaction_id: Transaction ID (optional)
    """
    logger = get_logger("performance")
    
    log_data = {
        "model_name": model_name,
        "processing_time_ms": processing_time_ms,
        "prediction_score": prediction_score
    }
    
    if transaction_id:
        log_data["transaction_id"] = transaction_id
    
    extra_data = " | ".join([f"{k}={v}" for k, v in log_data.items()])
    logger.info(f"Model performance | {extra_data}")


def log_prediction_result(
    transaction_id: str,
    fraud_probability: float,
    decision: str,
    model_predictions: Dict[str, float],
    processing_time_ms: float
):
    """
    Log prediction results.
    
    Args:
        transaction_id: Transaction ID
        fraud_probability: Final fraud probability
        decision: Final decision
        model_predictions: Individual model predictions
        processing_time_ms: Total processing time
    """
    logger = get_logger("predictions")
    
    model_scores = " | ".join([f"{k}={v:.3f}" for k, v in model_predictions.items()])
    
    logger.info(
        f"Prediction result | transaction_id={transaction_id} | "
        f"fraud_probability={fraud_probability:.3f} | decision={decision} | "
        f"processing_time_ms={processing_time_ms:.2f} | models=[{model_scores}]"
    )


def log_error_with_context(
    error: Exception,
    context: Dict[str, Any],
    logger_name: str = "errors"
):
    """
    Log error with additional context.
    
    Args:
        error: Exception that occurred
        context: Additional context information
        logger_name: Logger name to use
    """
    logger = get_logger(logger_name)
    
    context_str = " | ".join([f"{k}={v}" for k, v in context.items()])
    logger.error(f"Error occurred: {str(error)} | {context_str}", exc_info=True)