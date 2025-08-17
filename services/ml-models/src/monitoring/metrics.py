"""
Metrics collection and monitoring for the ML Models service.
Provides Prometheus-compatible metrics and performance tracking.
"""
import time
import asyncio
import logging
from typing import Dict, Any, List, Optional
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from threading import Lock

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from utils.logging_config import get_logger


@dataclass
class PredictionMetric:
    """Individual prediction metric."""
    transaction_id: str
    timestamp: float
    processing_time_ms: float
    fraud_probability: float
    decision: str
    model_predictions: Dict[str, float] = field(default_factory=dict)
    error: Optional[str] = None


class MetricsCollector:
    """
    Collects and manages metrics for the ML Models service.
    Provides Prometheus-compatible metrics and performance tracking.
    """
    
    def __init__(self):
        self.logger = get_logger("metrics_collector")
        self.start_time = time.time()
        self.lock = Lock()
        
        # Prometheus metrics
        self._setup_prometheus_metrics()
        
        # Internal metrics storage
        self.prediction_history = deque(maxlen=10000)  # Last 10k predictions
        self.error_history = deque(maxlen=1000)        # Last 1k errors
        self.model_performance = defaultdict(lambda: {
            "predictions": 0,
            "total_time_ms": 0.0,
            "errors": 0,
            "last_prediction": None
        })
        
        # Real-time counters
        self.prediction_count = 0
        self.error_count = 0
        self.fraud_detections = 0
        self.declined_transactions = 0
        
        self.logger.info("Metrics collector initialized")
    
    def _setup_prometheus_metrics(self):
        """Setup Prometheus metrics."""
        
        # Counters
        self.predictions_total = Counter(
            'ml_predictions_total',
            'Total number of predictions made',
            ['model_name', 'decision']
        )
        
        self.errors_total = Counter(
            'ml_errors_total',
            'Total number of errors',
            ['error_type']
        )
        
        self.fraud_detected_total = Counter(
            'ml_fraud_detected_total',
            'Total number of fraud cases detected',
            ['risk_level']
        )
        
        # Histograms
        self.prediction_duration = Histogram(
            'ml_prediction_duration_seconds',
            'Time spent on predictions',
            ['model_name'],
            buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
        )
        
        self.fraud_score_histogram = Histogram(
            'ml_fraud_score_distribution',
            'Distribution of fraud scores',
            buckets=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        )
        
        # Gauges
        self.active_models = Gauge(
            'ml_active_models',
            'Number of active ML models'
        )
        
        self.model_accuracy = Gauge(
            'ml_model_accuracy',
            'Model accuracy percentage',
            ['model_name']
        )
        
        self.avg_processing_time = Gauge(
            'ml_avg_processing_time_ms',
            'Average processing time in milliseconds',
            ['model_name']
        )
        
        self.system_uptime = Gauge(
            'ml_system_uptime_seconds',
            'System uptime in seconds'
        )
        
        self.prediction_throughput = Gauge(
            'ml_prediction_throughput_per_second',
            'Predictions per second'
        )
    
    async def record_prediction(
        self,
        transaction_id: str,
        processing_time_ms: float,
        fraud_probability: float,
        decision: str,
        model_predictions: Dict[str, float] = None
    ):
        """Record a prediction metric."""
        
        current_time = time.time()
        
        # Create prediction metric
        metric = PredictionMetric(
            transaction_id=transaction_id,
            timestamp=current_time,
            processing_time_ms=processing_time_ms,
            fraud_probability=fraud_probability,
            decision=decision,
            model_predictions=model_predictions or {}
        )
        
        with self.lock:
            # Add to history
            self.prediction_history.append(metric)
            
            # Update counters
            self.prediction_count += 1
            
            if fraud_probability > 0.5:
                self.fraud_detections += 1
            
            if decision == "DECLINE":
                self.declined_transactions += 1
            
            # Update model performance
            for model_name, prediction in model_predictions.items():
                self.model_performance[model_name]["predictions"] += 1
                self.model_performance[model_name]["total_time_ms"] += processing_time_ms
                self.model_performance[model_name]["last_prediction"] = current_time
        
        # Update Prometheus metrics
        self.predictions_total.labels(model_name="ensemble", decision=decision).inc()
        self.prediction_duration.labels(model_name="ensemble").observe(processing_time_ms / 1000.0)
        self.fraud_score_histogram.observe(fraud_probability)
        
        # Update individual model metrics
        if model_predictions:
            for model_name, prediction in model_predictions.items():
                self.predictions_total.labels(model_name=model_name, decision=decision).inc()
                self.prediction_duration.labels(model_name=model_name).observe(processing_time_ms / 1000.0)
        
        # Determine risk level for fraud detection counter
        risk_level = self._get_risk_level(fraud_probability)
        if fraud_probability > 0.5:
            self.fraud_detected_total.labels(risk_level=risk_level).inc()
        
        self.logger.debug(f"Recorded prediction metric for transaction {transaction_id}")
    
    async def record_error(self, error_message: str, error_type: str = "unknown"):
        """Record an error metric."""
        
        current_time = time.time()
        
        with self.lock:
            # Add to error history
            self.error_history.append({
                "timestamp": current_time,
                "error_message": error_message,
                "error_type": error_type
            })
            
            # Update counter
            self.error_count += 1
        
        # Update Prometheus metrics
        self.errors_total.labels(error_type=error_type).inc()
        
        self.logger.debug(f"Recorded error metric: {error_type}")
    
    async def update_model_metrics(self, model_name: str, is_active: bool = True, accuracy: float = None):
        """Update metrics for a specific model."""
        
        if is_active:
            self.active_models.inc()
        
        if accuracy is not None:
            self.model_accuracy.labels(model_name=model_name).set(accuracy * 100)
        
        # Update average processing time
        with self.lock:
            if model_name in self.model_performance:
                perf = self.model_performance[model_name]
                if perf["predictions"] > 0:
                    avg_time = perf["total_time_ms"] / perf["predictions"]
                    self.avg_processing_time.labels(model_name=model_name).set(avg_time)
    
    def update_system_metrics(self):
        """Update system-level metrics."""
        current_time = time.time()
        uptime = current_time - self.start_time
        self.system_uptime.set(uptime)
        
        # Calculate throughput (predictions per second over last minute)
        with self.lock:
            recent_predictions = [
                p for p in self.prediction_history
                if current_time - p.timestamp <= 60  # Last minute
            ]
            throughput = len(recent_predictions) / 60.0
            self.prediction_throughput.set(throughput)
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get comprehensive metrics summary."""
        current_time = time.time()
        uptime = current_time - self.start_time
        
        with self.lock:
            # Calculate time-based metrics
            last_hour_predictions = [
                p for p in self.prediction_history
                if current_time - p.timestamp <= 3600
            ]
            
            last_minute_predictions = [
                p for p in self.prediction_history
                if current_time - p.timestamp <= 60
            ]
            
            # Calculate accuracy (simplified)
            fraud_predictions = [p for p in last_hour_predictions if p.fraud_probability > 0.5]
            
            # Calculate average processing time
            if last_hour_predictions:
                avg_processing_time = sum(p.processing_time_ms for p in last_hour_predictions) / len(last_hour_predictions)
            else:
                avg_processing_time = 0.0
            
            # Model performance
            model_metrics = {}
            for model_name, perf in self.model_performance.items():
                if perf["predictions"] > 0:
                    model_metrics[model_name] = {
                        "total_predictions": perf["predictions"],
                        "avg_processing_time_ms": perf["total_time_ms"] / perf["predictions"],
                        "error_rate": perf["errors"] / perf["predictions"] if perf["predictions"] > 0 else 0.0,
                        "last_prediction": datetime.fromtimestamp(perf["last_prediction"]).isoformat() if perf["last_prediction"] else None
                    }
            
            return {
                "system": {
                    "uptime_seconds": uptime,
                    "total_predictions": self.prediction_count,
                    "total_errors": self.error_count,
                    "fraud_detections": self.fraud_detections,
                    "declined_transactions": self.declined_transactions,
                    "error_rate": self.error_count / max(self.prediction_count, 1)
                },
                "performance": {
                    "avg_processing_time_ms": avg_processing_time,
                    "predictions_per_second": len(last_minute_predictions) / 60.0,
                    "predictions_last_hour": len(last_hour_predictions),
                    "predictions_last_minute": len(last_minute_predictions)
                },
                "fraud_detection": {
                    "fraud_rate": len(fraud_predictions) / max(len(last_hour_predictions), 1),
                    "fraud_detections_last_hour": len(fraud_predictions),
                    "high_risk_transactions": len([p for p in last_hour_predictions if p.fraud_probability > 0.8])
                },
                "models": model_metrics,
                "timestamp": datetime.now().isoformat()
            }
    
    def get_prometheus_metrics(self) -> bytes:
        """Get Prometheus-formatted metrics."""
        # Update system metrics before generating output
        self.update_system_metrics()
        
        return generate_latest()
    
    def get_uptime(self) -> float:
        """Get system uptime in seconds."""
        return time.time() - self.start_time
    
    def _get_risk_level(self, fraud_probability: float) -> str:
        """Get risk level based on fraud probability."""
        if fraud_probability >= 0.95:
            return "CRITICAL"
        elif fraud_probability >= 0.8:
            return "HIGH"
        elif fraud_probability >= 0.6:
            return "MEDIUM"
        elif fraud_probability >= 0.3:
            return "LOW"
        else:
            return "VERY_LOW"
    
    async def get_model_performance_report(self) -> Dict[str, Any]:
        """Get detailed model performance report."""
        current_time = time.time()
        
        with self.lock:
            # Get recent predictions
            recent_predictions = [
                p for p in self.prediction_history
                if current_time - p.timestamp <= 3600  # Last hour
            ]
            
            # Group by model
            model_reports = {}
            
            for model_name in self.model_performance.keys():
                model_predictions = []
                for prediction in recent_predictions:
                    if model_name in prediction.model_predictions:
                        model_predictions.append({
                            "timestamp": prediction.timestamp,
                            "prediction": prediction.model_predictions[model_name],
                            "actual_fraud": prediction.fraud_probability > 0.5,
                            "processing_time_ms": prediction.processing_time_ms
                        })
                
                if model_predictions:
                    # Calculate metrics
                    processing_times = [p["processing_time_ms"] for p in model_predictions]
                    predictions = [p["prediction"] for p in model_predictions]
                    
                    model_reports[model_name] = {
                        "total_predictions": len(model_predictions),
                        "avg_processing_time_ms": sum(processing_times) / len(processing_times),
                        "min_processing_time_ms": min(processing_times),
                        "max_processing_time_ms": max(processing_times),
                        "avg_prediction_score": sum(predictions) / len(predictions),
                        "prediction_distribution": {
                            "low_risk": len([p for p in predictions if p < 0.3]),
                            "medium_risk": len([p for p in predictions if 0.3 <= p < 0.7]),
                            "high_risk": len([p for p in predictions if p >= 0.7])
                        }
                    }
            
            return {
                "report_timestamp": datetime.now().isoformat(),
                "time_window": "1 hour",
                "total_predictions": len(recent_predictions),
                "models": model_reports
            }
    
    async def get_error_summary(self) -> Dict[str, Any]:
        """Get error summary and statistics."""
        current_time = time.time()
        
        with self.lock:
            # Get recent errors
            recent_errors = [
                error for error in self.error_history
                if current_time - error["timestamp"] <= 3600  # Last hour
            ]
            
            # Group by error type
            error_types = defaultdict(int)
            for error in recent_errors:
                error_types[error["error_type"]] += 1
            
            return {
                "total_errors_last_hour": len(recent_errors),
                "error_rate": len(recent_errors) / max(self.prediction_count, 1),
                "error_types": dict(error_types),
                "recent_errors": [
                    {
                        "timestamp": datetime.fromtimestamp(error["timestamp"]).isoformat(),
                        "error_type": error["error_type"],
                        "message": error["error_message"][:100]  # Truncate long messages
                    }
                    for error in list(self.error_history)[-10:]  # Last 10 errors
                ]
            }
    
    def reset_metrics(self):
        """Reset all metrics (for testing purposes)."""
        with self.lock:
            self.prediction_history.clear()
            self.error_history.clear()
            self.model_performance.clear()
            
            self.prediction_count = 0
            self.error_count = 0
            self.fraud_detections = 0
            self.declined_transactions = 0
            
            self.start_time = time.time()
        
        self.logger.info("Metrics reset")
    
    async def start_background_tasks(self):
        """Start background tasks for metrics collection."""
        # Update system metrics every 30 seconds
        asyncio.create_task(self._periodic_system_metrics_update())
    
    async def _periodic_system_metrics_update(self):
        """Periodically update system metrics."""
        while True:
            try:
                self.update_system_metrics()
                await asyncio.sleep(30)  # Update every 30 seconds
            except Exception as e:
                self.logger.error(f"Error updating system metrics: {str(e)}")
                await asyncio.sleep(30)