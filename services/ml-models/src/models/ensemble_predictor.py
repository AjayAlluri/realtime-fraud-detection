"""
Ensemble Predictor for combining multiple ML models to make fraud predictions.
Implements weighted averaging, voting, and stacking strategies.
"""
import asyncio
import time
import logging
from typing import Dict, Any, List, Tuple, Optional
from dataclasses import dataclass
from enum import Enum

import numpy as np
from sklearn.preprocessing import StandardScaler

from models.model_manager import ModelManager
from utils.config import Config
from utils.logging_config import get_logger, log_prediction_result


class EnsembleStrategy(Enum):
    """Available ensemble strategies."""
    WEIGHTED_AVERAGE = "weighted_average"
    VOTING = "voting"
    STACKING = "stacking"


@dataclass
class PredictionResult:
    """Result from individual model prediction."""
    model_name: str
    prediction: float
    confidence: float
    processing_time_ms: float


class EnsemblePredictor:
    """
    Ensemble predictor that combines multiple ML models for fraud detection.
    Supports multiple ensemble strategies and provides explanation capabilities.
    """
    
    def __init__(self, model_manager: ModelManager, config: Config):
        self.model_manager = model_manager
        self.config = config
        self.logger = get_logger("ensemble_predictor")
        
        # Ensemble configuration
        self.strategy = EnsembleStrategy(config.ensemble.strategy)
        self.fraud_threshold = config.ensemble.fraud_threshold
        self.confidence_threshold = config.ensemble.confidence_threshold
        self.enable_explanation = config.ensemble.enable_explanation
        
        # Model weights
        self.model_weights = self._get_model_weights()
        
        # Performance tracking
        self.prediction_cache = {}
        self.cache_ttl_seconds = 300  # 5 minutes
        
        self.logger.info(f"Ensemble predictor initialized with strategy: {self.strategy.value}")
    
    def _get_model_weights(self) -> Dict[str, float]:
        """Get normalized model weights from configuration."""
        enabled_models = self.config.get_enabled_models()
        weights = {name: config.weight for name, config in enabled_models.items()}
        
        # Normalize weights to sum to 1
        total_weight = sum(weights.values())
        if total_weight > 0:
            weights = {name: weight / total_weight for name, weight in weights.items()}
        
        self.logger.debug(f"Model weights: {weights}")
        return weights
    
    async def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Make ensemble prediction for fraud detection.
        
        Args:
            features: Processed feature dictionary
            
        Returns:
            Dictionary containing prediction results
        """
        start_time = time.time()
        
        try:
            # Check cache first
            cache_key = self._generate_cache_key(features)
            cached_result = self._get_cached_prediction(cache_key)
            if cached_result:
                self.logger.debug("Returning cached prediction")
                return cached_result
            
            # Get predictions from all loaded models
            model_predictions = await self._get_model_predictions(features)
            
            if not model_predictions:
                raise ValueError("No model predictions available")
            
            # Combine predictions using ensemble strategy
            ensemble_result = self._combine_predictions(model_predictions)
            
            # Generate explanation if enabled
            explanation = {}
            if self.enable_explanation:
                explanation = self._generate_explanation(model_predictions, features)
            
            # Calculate final decision
            decision = self._make_decision(
                ensemble_result["fraud_probability"],
                ensemble_result["confidence"]
            )
            
            # Calculate processing time
            processing_time_ms = (time.time() - start_time) * 1000
            
            # Create final result
            result = {
                "fraud_probability": ensemble_result["fraud_probability"],
                "fraud_score": ensemble_result["fraud_probability"],  # Normalized score
                "confidence": ensemble_result["confidence"],
                "risk_level": self._calculate_risk_level(ensemble_result["fraud_probability"]),
                "decision": decision,
                "model_predictions": {pred.model_name: pred.prediction for pred in model_predictions},
                "model_confidences": {pred.model_name: pred.confidence for pred in model_predictions},
                "explanation": explanation,
                "ensemble_strategy": self.strategy.value,
                "processing_time_ms": processing_time_ms
            }
            
            # Cache result
            self._cache_prediction(cache_key, result)
            
            # Log prediction result
            log_prediction_result(
                transaction_id=features.get("transaction_id", "unknown"),
                fraud_probability=result["fraud_probability"],
                decision=result["decision"],
                model_predictions=result["model_predictions"],
                processing_time_ms=processing_time_ms
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error in ensemble prediction: {str(e)}")
            raise
    
    async def _get_model_predictions(self, features: Dict[str, Any]) -> List[PredictionResult]:
        """Get predictions from all loaded models."""
        model_predictions = []
        
        # Convert features to numpy array
        feature_array = self._prepare_features(features)
        
        # Get enabled models that are loaded
        enabled_models = {
            name: config for name, config in self.config.get_enabled_models().items()
            if self.model_manager.is_model_loaded(name)
        }
        
        if not enabled_models:
            raise ValueError("No enabled models are loaded")
        
        # Create prediction tasks
        tasks = []
        for model_name in enabled_models.keys():
            task = asyncio.create_task(
                self._predict_single_model(model_name, feature_array)
            )
            tasks.append((model_name, task))
        
        # Wait for all predictions
        for model_name, task in tasks:
            try:
                prediction_result = await task
                model_predictions.append(prediction_result)
            except Exception as e:
                self.logger.warning(f"Model {model_name} prediction failed: {str(e)}")
                # Continue with other models
        
        return model_predictions
    
    async def _predict_single_model(self, model_name: str, features: np.ndarray) -> PredictionResult:
        """Get prediction from a single model."""
        start_time = time.time()
        
        try:
            # Get prediction from model manager
            prediction = await self.model_manager.predict(model_name, features)
            
            # Handle different prediction formats
            if isinstance(prediction, np.ndarray):
                if len(prediction.shape) > 0 and prediction.shape[0] > 0:
                    fraud_prob = float(prediction[0])
                else:
                    fraud_prob = float(prediction)
            else:
                fraud_prob = float(prediction)
            
            # Ensure probability is in valid range
            fraud_prob = max(0.0, min(1.0, fraud_prob))
            
            # Calculate confidence (simplified)
            confidence = self._calculate_model_confidence(fraud_prob, model_name)
            
            processing_time_ms = (time.time() - start_time) * 1000
            
            return PredictionResult(
                model_name=model_name,
                prediction=fraud_prob,
                confidence=confidence,
                processing_time_ms=processing_time_ms
            )
            
        except Exception as e:
            self.logger.error(f"Error in {model_name} prediction: {str(e)}")
            raise
    
    def _prepare_features(self, features: Dict[str, Any]) -> np.ndarray:
        """Convert feature dictionary to numpy array for model prediction."""
        # Extract numerical features (excluding metadata)
        excluded_keys = {
            'transaction_id', 'user_id', 'merchant_id', 'timestamp',
            'currency', 'payment_method', 'card_type'
        }
        
        numerical_features = []
        for key, value in features.items():
            if key not in excluded_keys and isinstance(value, (int, float)):
                numerical_features.append(float(value))
        
        # If we have the 62+ features from Flink pipeline
        if 'features' in features and isinstance(features['features'], dict):
            for key, value in features['features'].items():
                if isinstance(value, (int, float)):
                    numerical_features.append(float(value))
        
        # Ensure we have enough features (pad with zeros if necessary)
        while len(numerical_features) < 64:  # Minimum feature count
            numerical_features.append(0.0)
        
        # Convert to numpy array and reshape for single prediction
        feature_array = np.array(numerical_features).reshape(1, -1)
        
        # Basic normalization (in production, use fitted scaler)
        feature_array = np.clip(feature_array, -10, 10)  # Clip extreme values
        
        return feature_array
    
    def _combine_predictions(self, model_predictions: List[PredictionResult]) -> Dict[str, float]:
        """Combine model predictions using the selected ensemble strategy."""
        if self.strategy == EnsembleStrategy.WEIGHTED_AVERAGE:
            return self._weighted_average_ensemble(model_predictions)
        elif self.strategy == EnsembleStrategy.VOTING:
            return self._voting_ensemble(model_predictions)
        elif self.strategy == EnsembleStrategy.STACKING:
            return self._stacking_ensemble(model_predictions)
        else:
            raise ValueError(f"Unknown ensemble strategy: {self.strategy}")
    
    def _weighted_average_ensemble(self, predictions: List[PredictionResult]) -> Dict[str, float]:
        """Combine predictions using weighted average."""
        total_weight = 0.0
        weighted_sum = 0.0
        confidence_sum = 0.0
        
        for pred in predictions:
            weight = self.model_weights.get(pred.model_name, 0.0)
            weighted_sum += pred.prediction * weight
            confidence_sum += pred.confidence * weight
            total_weight += weight
        
        if total_weight == 0:
            return {"fraud_probability": 0.5, "confidence": 0.0}
        
        fraud_probability = weighted_sum / total_weight
        confidence = confidence_sum / total_weight
        
        return {
            "fraud_probability": fraud_probability,
            "confidence": confidence
        }
    
    def _voting_ensemble(self, predictions: List[PredictionResult]) -> Dict[str, float]:
        """Combine predictions using majority voting."""
        fraud_votes = 0
        total_votes = len(predictions)
        confidence_sum = 0.0
        
        for pred in predictions:
            if pred.prediction > self.fraud_threshold:
                fraud_votes += 1
            confidence_sum += pred.confidence
        
        fraud_probability = fraud_votes / total_votes if total_votes > 0 else 0.0
        confidence = confidence_sum / total_votes if total_votes > 0 else 0.0
        
        return {
            "fraud_probability": fraud_probability,
            "confidence": confidence
        }
    
    def _stacking_ensemble(self, predictions: List[PredictionResult]) -> Dict[str, float]:
        """Combine predictions using stacking (simplified meta-learner)."""
        # Simplified stacking: weighted by model confidence
        total_confidence = sum(pred.confidence for pred in predictions)
        
        if total_confidence == 0:
            return self._weighted_average_ensemble(predictions)
        
        weighted_sum = sum(
            pred.prediction * pred.confidence for pred in predictions
        )
        
        fraud_probability = weighted_sum / total_confidence
        confidence = total_confidence / len(predictions)
        
        return {
            "fraud_probability": fraud_probability,
            "confidence": confidence
        }
    
    def _calculate_model_confidence(self, prediction: float, model_name: str) -> float:
        """Calculate confidence score for a model prediction."""
        # Distance from threshold (more extreme predictions are more confident)
        distance_from_threshold = abs(prediction - 0.5)
        
        # Model-specific confidence adjustments
        model_confidence_multiplier = {
            "xgboost_primary": 1.0,
            "lstm_sequential": 0.8,
            "bert_text": 0.7,
            "graph_neural": 0.6,
            "isolation_forest": 0.5
        }
        
        multiplier = model_confidence_multiplier.get(model_name, 0.5)
        confidence = distance_from_threshold * 2 * multiplier  # Scale to 0-1
        
        return min(1.0, confidence)
    
    def _make_decision(self, fraud_probability: float, confidence: float) -> str:
        """Make final fraud decision based on probability and confidence."""
        if confidence < self.confidence_threshold:
            return "REVIEW"  # Low confidence requires human review
        
        if fraud_probability >= 0.95:
            return "DECLINE"
        elif fraud_probability >= 0.8:
            return "REVIEW"
        elif fraud_probability >= 0.6:
            return "APPROVE_WITH_MONITORING"
        else:
            return "APPROVE"
    
    def _calculate_risk_level(self, fraud_probability: float) -> str:
        """Calculate risk level based on fraud probability."""
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
    
    def _generate_explanation(self, predictions: List[PredictionResult], features: Dict[str, Any]) -> Dict[str, Any]:
        """Generate explanation for the prediction."""
        explanation = {
            "model_contributions": {},
            "key_factors": [],
            "feature_importance": {}
        }
        
        # Model contributions
        total_weight = sum(self.model_weights.get(pred.model_name, 0) for pred in predictions)
        for pred in predictions:
            weight = self.model_weights.get(pred.model_name, 0)
            contribution = (pred.prediction * weight / total_weight) if total_weight > 0 else 0
            explanation["model_contributions"][pred.model_name] = {
                "prediction": pred.prediction,
                "weight": weight,
                "contribution": contribution,
                "confidence": pred.confidence
            }
        
        # Key factors (simplified feature analysis)
        key_factors = []
        
        # Amount-based factors
        amount = features.get("amount", 0)
        if amount > 10000:
            key_factors.append(f"High transaction amount: ${amount:,.2f}")
        elif amount < 1:
            key_factors.append(f"Unusual low amount: ${amount:.2f}")
        
        # Time-based factors
        hour_of_day = features.get("hour_of_day", 12)
        if hour_of_day < 6 or hour_of_day > 22:
            key_factors.append(f"Off-hours transaction: {hour_of_day}:00")
        
        # Payment method factors
        payment_method = features.get("payment_method", "")
        if payment_method in ["crypto", "gift_card"]:
            key_factors.append(f"High-risk payment method: {payment_method}")
        
        explanation["key_factors"] = key_factors
        
        # Feature importance (top contributing features)
        if 'features' in features and isinstance(features['features'], dict):
            feature_values = features['features']
            
            # Simplified importance based on feature values
            important_features = {}
            for name, value in feature_values.items():
                if isinstance(value, (int, float)):
                    # Simple heuristic: higher values = higher importance
                    importance = min(abs(float(value)), 1.0)
                    if importance > 0.1:
                        important_features[name] = importance
            
            # Sort by importance and take top 10
            sorted_features = sorted(
                important_features.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]
            
            explanation["feature_importance"] = dict(sorted_features)
        
        return explanation
    
    def _generate_cache_key(self, features: Dict[str, Any]) -> str:
        """Generate cache key for prediction."""
        # Create a simple hash of key features
        key_features = [
            str(features.get("transaction_id", "")),
            str(features.get("amount", "")),
            str(features.get("user_id", "")),
            str(features.get("merchant_id", "")),
            str(features.get("payment_method", ""))
        ]
        return "_".join(key_features)
    
    def _get_cached_prediction(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Get cached prediction if available and not expired."""
        if cache_key in self.prediction_cache:
            cached_result, timestamp = self.prediction_cache[cache_key]
            if time.time() - timestamp < self.cache_ttl_seconds:
                return cached_result
            else:
                # Remove expired entry
                del self.prediction_cache[cache_key]
        return None
    
    def _cache_prediction(self, cache_key: str, result: Dict[str, Any]) -> None:
        """Cache prediction result."""
        # Limit cache size
        if len(self.prediction_cache) > 1000:
            # Remove oldest entries
            oldest_key = min(
                self.prediction_cache.keys(),
                key=lambda k: self.prediction_cache[k][1]
            )
            del self.prediction_cache[oldest_key]
        
        self.prediction_cache[cache_key] = (result, time.time())
    
    def update_model_weights(self, new_weights: Dict[str, float]) -> None:
        """Update model weights dynamically."""
        # Normalize new weights
        total_weight = sum(new_weights.values())
        if total_weight > 0:
            normalized_weights = {
                name: weight / total_weight for name, weight in new_weights.items()
            }
            self.model_weights.update(normalized_weights)
            self.logger.info(f"Updated model weights: {self.model_weights}")
    
    def get_model_performance_stats(self) -> Dict[str, Any]:
        """Get performance statistics for the ensemble."""
        # This would be enhanced with actual performance tracking
        return {
            "ensemble_strategy": self.strategy.value,
            "model_weights": self.model_weights,
            "fraud_threshold": self.fraud_threshold,
            "confidence_threshold": self.confidence_threshold,
            "cache_size": len(self.prediction_cache),
            "loaded_models": list(self.model_weights.keys())
        }