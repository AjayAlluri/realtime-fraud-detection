"""
Main entry point for the ML Models service.
Provides real-time fraud detection inference using multiple ML models.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Dict, Any, List

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.model_manager import ModelManager
from models.ensemble_predictor import EnsemblePredictor
from models.feature_processor import FeatureProcessor
from monitoring.metrics import MetricsCollector
from utils.config import Config
from utils.logging_config import setup_logging

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

# Global model manager
model_manager: ModelManager = None
ensemble_predictor: EnsemblePredictor = None
feature_processor: FeatureProcessor = None
metrics_collector: MetricsCollector = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for loading models on startup."""
    global model_manager, ensemble_predictor, feature_processor, metrics_collector
    
    logger.info("Starting ML Models service...")
    
    # Initialize configuration
    config = Config()
    
    # Initialize metrics collector
    metrics_collector = MetricsCollector()
    
    # Initialize feature processor
    feature_processor = FeatureProcessor(config)
    
    # Initialize model manager and load models
    model_manager = ModelManager(config)
    await model_manager.load_all_models()
    
    # Initialize ensemble predictor
    ensemble_predictor = EnsemblePredictor(model_manager, config)
    
    logger.info("ML Models service started successfully")
    
    yield
    
    logger.info("Shutting down ML Models service...")
    if model_manager:
        await model_manager.cleanup()


# Pydantic models for API
class TransactionFeatures(BaseModel):
    """Input features for fraud prediction."""
    transaction_id: str = Field(..., description="Unique transaction identifier")
    user_id: str = Field(..., description="User identifier")
    merchant_id: str = Field(..., description="Merchant identifier")
    amount: float = Field(..., description="Transaction amount")
    currency: str = Field(..., description="Transaction currency")
    payment_method: str = Field(..., description="Payment method used")
    features: Dict[str, Any] = Field(..., description="Extracted features from Flink pipeline")
    timestamp: str = Field(..., description="Transaction timestamp")


class FraudPrediction(BaseModel):
    """Output prediction from fraud models."""
    transaction_id: str
    fraud_probability: float = Field(..., ge=0.0, le=1.0, description="Probability of fraud (0-1)")
    fraud_score: float = Field(..., ge=0.0, le=1.0, description="Normalized fraud score")
    risk_level: str = Field(..., description="Risk level: VERY_LOW, LOW, MEDIUM, HIGH, CRITICAL")
    decision: str = Field(..., description="Decision: APPROVE, REVIEW, DECLINE")
    model_predictions: Dict[str, float] = Field(..., description="Individual model predictions")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Prediction confidence")
    processing_time_ms: float = Field(..., description="Inference processing time in milliseconds")
    explanation: Dict[str, Any] = Field(..., description="Feature importance and explanation")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    models_loaded: List[str]
    uptime_seconds: float


class ModelMetrics(BaseModel):
    """Model performance metrics."""
    model_name: str
    predictions_count: int
    avg_processing_time_ms: float
    error_rate: float
    last_prediction_time: str


# Initialize FastAPI app
app = FastAPI(
    title="Fraud Detection ML Models Service",
    description="Real-time fraud detection using ensemble of ML models",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    global model_manager, metrics_collector
    
    if not model_manager:
        raise HTTPException(status_code=503, detail="Models not loaded")
    
    loaded_models = list(model_manager.get_loaded_models().keys())
    uptime = metrics_collector.get_uptime() if metrics_collector else 0.0
    
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        models_loaded=loaded_models,
        uptime_seconds=uptime
    )


@app.post("/predict", response_model=FraudPrediction)
async def predict_fraud(
    features: TransactionFeatures,
    background_tasks: BackgroundTasks
) -> FraudPrediction:
    """
    Predict fraud probability for a transaction using ensemble of ML models.
    """
    global ensemble_predictor, feature_processor, metrics_collector
    
    if not ensemble_predictor or not feature_processor:
        raise HTTPException(status_code=503, detail="Models not ready")
    
    try:
        start_time = asyncio.get_event_loop().time()
        
        # Process and validate features
        processed_features = await feature_processor.process_features(features.dict())
        
        # Get ensemble prediction
        prediction = await ensemble_predictor.predict(processed_features)
        
        # Calculate processing time
        processing_time_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        
        # Create response
        response = FraudPrediction(
            transaction_id=features.transaction_id,
            fraud_probability=prediction["fraud_probability"],
            fraud_score=prediction["fraud_score"],
            risk_level=prediction["risk_level"],
            decision=prediction["decision"],
            model_predictions=prediction["model_predictions"],
            confidence=prediction["confidence"],
            processing_time_ms=processing_time_ms,
            explanation=prediction["explanation"]
        )
        
        # Record metrics in background
        if metrics_collector:
            background_tasks.add_task(
                metrics_collector.record_prediction,
                features.transaction_id,
                processing_time_ms,
                prediction["fraud_probability"],
                prediction["decision"]
            )
        
        logger.info(
            f"Fraud prediction completed",
            extra={
                "transaction_id": features.transaction_id,
                "fraud_probability": prediction["fraud_probability"],
                "decision": prediction["decision"],
                "processing_time_ms": processing_time_ms
            }
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error during fraud prediction: {str(e)}", extra={
            "transaction_id": features.transaction_id,
            "error": str(e)
        })
        
        if metrics_collector:
            background_tasks.add_task(metrics_collector.record_error, str(e))
        
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/batch-predict")
async def batch_predict_fraud(
    transactions: List[TransactionFeatures],
    background_tasks: BackgroundTasks
) -> List[FraudPrediction]:
    """
    Batch prediction for multiple transactions.
    """
    global ensemble_predictor, feature_processor
    
    if not ensemble_predictor or not feature_processor:
        raise HTTPException(status_code=503, detail="Models not ready")
    
    try:
        predictions = []
        start_time = asyncio.get_event_loop().time()
        
        for transaction in transactions:
            processed_features = await feature_processor.process_features(transaction.dict())
            prediction = await ensemble_predictor.predict(processed_features)
            
            predictions.append(FraudPrediction(
                transaction_id=transaction.transaction_id,
                fraud_probability=prediction["fraud_probability"],
                fraud_score=prediction["fraud_score"],
                risk_level=prediction["risk_level"],
                decision=prediction["decision"],
                model_predictions=prediction["model_predictions"],
                confidence=prediction["confidence"],
                processing_time_ms=0.0,  # Will be calculated at the end
                explanation=prediction["explanation"]
            ))
        
        # Calculate total processing time
        total_time_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        avg_time_per_transaction = total_time_ms / len(transactions)
        
        # Update processing times
        for prediction in predictions:
            prediction.processing_time_ms = avg_time_per_transaction
        
        logger.info(f"Batch prediction completed for {len(transactions)} transactions in {total_time_ms:.2f}ms")
        
        return predictions
        
    except Exception as e:
        logger.error(f"Error during batch prediction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Batch prediction failed: {str(e)}")


@app.get("/metrics")
async def get_metrics() -> Dict[str, Any]:
    """Get model performance metrics."""
    global metrics_collector, model_manager
    
    if not metrics_collector or not model_manager:
        raise HTTPException(status_code=503, detail="Service not ready")
    
    try:
        metrics = await metrics_collector.get_metrics()
        model_info = model_manager.get_model_info()
        
        return {
            "service_metrics": metrics,
            "model_info": model_info,
            "timestamp": asyncio.get_event_loop().time()
        }
        
    except Exception as e:
        logger.error(f"Error retrieving metrics: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve metrics: {str(e)}")


@app.post("/reload-models")
async def reload_models(background_tasks: BackgroundTasks):
    """Reload all ML models (for model updates)."""
    global model_manager
    
    if not model_manager:
        raise HTTPException(status_code=503, detail="Model manager not initialized")
    
    try:
        background_tasks.add_task(model_manager.reload_all_models)
        return {"message": "Model reload initiated"}
        
    except Exception as e:
        logger.error(f"Error initiating model reload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reload models: {str(e)}")


@app.get("/model-info")
async def get_model_info() -> Dict[str, Any]:
    """Get information about loaded models."""
    global model_manager
    
    if not model_manager:
        raise HTTPException(status_code=503, detail="Model manager not initialized")
    
    return model_manager.get_model_info()


# Prometheus metrics endpoint
@app.get("/metrics/prometheus")
async def prometheus_metrics():
    """Prometheus-compatible metrics endpoint."""
    global metrics_collector
    
    if not metrics_collector:
        raise HTTPException(status_code=503, detail="Metrics collector not initialized")
    
    return metrics_collector.get_prometheus_metrics()


if __name__ == "__main__":
    # Get configuration from environment
    host = os.getenv("ML_SERVICE_HOST", "0.0.0.0")
    port = int(os.getenv("ML_SERVICE_PORT", "8080"))
    log_level = os.getenv("LOG_LEVEL", "info").lower()
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        log_level=log_level,
        reload=False,
        workers=1  # Single worker to avoid model loading conflicts
    )