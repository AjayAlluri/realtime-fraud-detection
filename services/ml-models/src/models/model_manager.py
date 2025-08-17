"""
Model Manager for loading, managing, and serving multiple ML models.
Supports XGBoost, TensorFlow, PyTorch, Transformers, and Scikit-learn models.
"""
import asyncio
import os
import pickle
import json
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path
from datetime import datetime, timedelta

import joblib
import numpy as np
import xgboost as xgb
import tensorflow as tf
import torch
import torch.nn as nn
from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification
from sklearn.base import BaseEstimator

from utils.config import Config, ModelConfig
from utils.logging_config import get_logger, log_error_with_context


class ModelManager:
    """
    Manages loading, caching, and serving of multiple ML models.
    Supports hot-swapping and model versioning.
    """
    
    def __init__(self, config: Config):
        self.config = config
        self.logger = get_logger("model_manager")
        self.models: Dict[str, Any] = {}
        self.model_metadata: Dict[str, Dict[str, Any]] = {}
        self.model_load_times: Dict[str, datetime] = {}
        self.model_lock = asyncio.Lock()
        
        # Initialize TensorFlow settings
        self._setup_tensorflow()
        
        # Initialize PyTorch settings
        self._setup_pytorch()
    
    def _setup_tensorflow(self):
        """Setup TensorFlow configuration."""
        try:
            # Configure GPU memory growth
            gpus = tf.config.experimental.list_physical_devices('GPU')
            if gpus:
                for gpu in gpus:
                    tf.config.experimental.set_memory_growth(gpu, True)
                self.logger.info(f"Configured {len(gpus)} GPU(s) for TensorFlow")
            
            # Set thread configuration
            tf.config.threading.set_inter_op_parallelism_threads(2)
            tf.config.threading.set_intra_op_parallelism_threads(4)
            
        except Exception as e:
            self.logger.warning(f"Failed to configure TensorFlow: {str(e)}")
    
    def _setup_pytorch(self):
        """Setup PyTorch configuration."""
        try:
            # Set number of threads
            torch.set_num_threads(4)
            
            # Check for GPU availability
            if torch.cuda.is_available():
                self.device = torch.device("cuda")
                self.logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
            else:
                self.device = torch.device("cpu")
                self.logger.info("Using CPU for PyTorch models")
                
        except Exception as e:
            self.logger.warning(f"Failed to configure PyTorch: {str(e)}")
            self.device = torch.device("cpu")
    
    async def load_all_models(self) -> None:
        """Load all enabled models asynchronously."""
        async with self.model_lock:
            enabled_models = self.config.get_enabled_models()
            
            self.logger.info(f"Loading {len(enabled_models)} models...")
            
            # Load models in parallel
            tasks = []
            for model_name, model_config in enabled_models.items():
                task = asyncio.create_task(self._load_single_model(model_name, model_config))
                tasks.append(task)
            
            # Wait for all models to load
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Check results
            successful_loads = 0
            for i, (model_name, result) in enumerate(zip(enabled_models.keys(), results)):
                if isinstance(result, Exception):
                    self.logger.error(f"Failed to load model {model_name}: {str(result)}")
                else:
                    successful_loads += 1
                    self.logger.info(f"Successfully loaded model: {model_name}")
            
            self.logger.info(f"Loaded {successful_loads}/{len(enabled_models)} models successfully")
    
    async def _load_single_model(self, model_name: str, model_config: ModelConfig) -> None:
        """Load a single model based on its type."""
        try:
            self.logger.info(f"Loading model: {model_name} ({model_config.model_type})")
            
            # Check if model file exists
            if not os.path.exists(model_config.model_path):
                # Create dummy model for development/testing
                self.logger.warning(f"Model file not found: {model_config.model_path}. Creating dummy model.")
                model = await self._create_dummy_model(model_config)
            else:
                # Load actual model
                model = await self._load_model_by_type(model_config)
            
            # Store model and metadata
            self.models[model_name] = model
            self.model_load_times[model_name] = datetime.now()
            self.model_metadata[model_name] = {
                "type": model_config.model_type,
                "path": model_config.model_path,
                "weight": model_config.weight,
                "loaded_at": self.model_load_times[model_name].isoformat(),
                "hyperparameters": model_config.hyperparameters,
                "preprocessing_steps": model_config.preprocessing_steps
            }
            
        except Exception as e:
            log_error_with_context(
                e,
                {"model_name": model_name, "model_type": model_config.model_type, "model_path": model_config.model_path}
            )
            raise
    
    async def _load_model_by_type(self, model_config: ModelConfig) -> Any:
        """Load model based on its type."""
        if model_config.model_type == "xgboost":
            return await self._load_xgboost_model(model_config)
        elif model_config.model_type == "tensorflow":
            return await self._load_tensorflow_model(model_config)
        elif model_config.model_type == "pytorch":
            return await self._load_pytorch_model(model_config)
        elif model_config.model_type == "transformers":
            return await self._load_transformers_model(model_config)
        elif model_config.model_type == "sklearn":
            return await self._load_sklearn_model(model_config)
        else:
            raise ValueError(f"Unsupported model type: {model_config.model_type}")
    
    async def _load_xgboost_model(self, model_config: ModelConfig) -> xgb.XGBClassifier:
        """Load XGBoost model."""
        model = xgb.XGBClassifier()
        model.load_model(model_config.model_path)
        return model
    
    async def _load_tensorflow_model(self, model_config: ModelConfig) -> tf.keras.Model:
        """Load TensorFlow/Keras model."""
        model = tf.keras.models.load_model(model_config.model_path)
        return model
    
    async def _load_pytorch_model(self, model_config: ModelConfig) -> torch.nn.Module:
        """Load PyTorch model."""
        # Load model state dict
        state_dict = torch.load(model_config.model_path, map_location=self.device)
        
        # Create model architecture (this would need to be customized based on your specific model)
        model = self._create_pytorch_model_architecture(model_config)
        model.load_state_dict(state_dict)
        model.to(self.device)
        model.eval()
        
        return model
    
    async def _load_transformers_model(self, model_config: ModelConfig) -> Dict[str, Any]:
        """Load Transformers (BERT) model."""
        model_name = model_config.hyperparameters.get("model_name", "distilbert-base-uncased")
        
        # Load tokenizer and model
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForSequenceClassification.from_pretrained(
            model_config.model_path if os.path.exists(model_config.model_path) else model_name,
            num_labels=2  # binary classification
        )
        
        return {
            "tokenizer": tokenizer,
            "model": model
        }
    
    async def _load_sklearn_model(self, model_config: ModelConfig) -> BaseEstimator:
        """Load Scikit-learn model."""
        model = joblib.load(model_config.model_path)
        return model
    
    def _create_pytorch_model_architecture(self, model_config: ModelConfig) -> torch.nn.Module:
        """Create PyTorch model architecture for GNN."""
        # This is a simplified GNN architecture
        # In practice, you'd load the actual architecture definition
        
        class SimpleGNN(nn.Module):
            def __init__(self, input_dim=64, hidden_dim=64, output_dim=2, num_layers=3):
                super(SimpleGNN, self).__init__()
                self.layers = nn.ModuleList()
                
                # Input layer
                self.layers.append(nn.Linear(input_dim, hidden_dim))
                
                # Hidden layers
                for _ in range(num_layers - 2):
                    self.layers.append(nn.Linear(hidden_dim, hidden_dim))
                
                # Output layer
                self.layers.append(nn.Linear(hidden_dim, output_dim))
                
                self.activation = nn.ReLU()
                self.dropout = nn.Dropout(model_config.hyperparameters.get("dropout", 0.1))
            
            def forward(self, x):
                for i, layer in enumerate(self.layers[:-1]):
                    x = self.activation(layer(x))
                    x = self.dropout(x)
                
                # Final layer without activation (logits)
                x = self.layers[-1](x)
                return torch.softmax(x, dim=1)
        
        hidden_channels = model_config.hyperparameters.get("hidden_channels", 64)
        num_layers = model_config.hyperparameters.get("num_layers", 3)
        
        return SimpleGNN(
            input_dim=hidden_channels,
            hidden_dim=hidden_channels,
            output_dim=2,
            num_layers=num_layers
        )
    
    async def _create_dummy_model(self, model_config: ModelConfig) -> Any:
        """Create a dummy model for testing purposes."""
        self.logger.info(f"Creating dummy model for {model_config.name}")
        
        class DummyModel:
            def __init__(self, model_type: str):
                self.model_type = model_type
                self.name = model_config.name
            
            def predict(self, X):
                # Return random predictions
                if isinstance(X, (list, tuple)):
                    n_samples = len(X)
                elif hasattr(X, 'shape'):
                    n_samples = X.shape[0] if len(X.shape) > 1 else 1
                else:
                    n_samples = 1
                
                return np.random.random(n_samples)
            
            def predict_proba(self, X):
                if isinstance(X, (list, tuple)):
                    n_samples = len(X)
                elif hasattr(X, 'shape'):
                    n_samples = X.shape[0] if len(X.shape) > 1 else 1
                else:
                    n_samples = 1
                
                probs = np.random.random((n_samples, 2))
                # Normalize to sum to 1
                probs = probs / probs.sum(axis=1, keepdims=True)
                return probs
        
        return DummyModel(model_config.model_type)
    
    async def predict(self, model_name: str, features: np.ndarray) -> np.ndarray:
        """Make prediction using a specific model."""
        if model_name not in self.models:
            raise ValueError(f"Model {model_name} not loaded")
        
        model = self.models[model_name]
        model_config = self.config.get_model_config(model_name)
        
        try:
            if model_config.model_type == "xgboost":
                return await self._predict_xgboost(model, features)
            elif model_config.model_type == "tensorflow":
                return await self._predict_tensorflow(model, features)
            elif model_config.model_type == "pytorch":
                return await self._predict_pytorch(model, features)
            elif model_config.model_type == "transformers":
                return await self._predict_transformers(model, features)
            elif model_config.model_type == "sklearn":
                return await self._predict_sklearn(model, features)
            else:
                # Dummy model
                return model.predict_proba(features)[:, 1]  # Return fraud probability
                
        except Exception as e:
            log_error_with_context(
                e,
                {"model_name": model_name, "model_type": model_config.model_type, "features_shape": features.shape}
            )
            raise
    
    async def _predict_xgboost(self, model: xgb.XGBClassifier, features: np.ndarray) -> np.ndarray:
        """Make prediction with XGBoost model."""
        return model.predict_proba(features)[:, 1]  # Return fraud probability
    
    async def _predict_tensorflow(self, model: tf.keras.Model, features: np.ndarray) -> np.ndarray:
        """Make prediction with TensorFlow model."""
        predictions = model.predict(features, verbose=0)
        if predictions.shape[1] > 1:
            return predictions[:, 1]  # Return fraud probability
        else:
            return predictions.flatten()
    
    async def _predict_pytorch(self, model: torch.nn.Module, features: np.ndarray) -> np.ndarray:
        """Make prediction with PyTorch model."""
        with torch.no_grad():
            features_tensor = torch.FloatTensor(features).to(self.device)
            predictions = model(features_tensor)
            
            if predictions.shape[1] > 1:
                return predictions[:, 1].cpu().numpy()  # Return fraud probability
            else:
                return predictions.cpu().numpy().flatten()
    
    async def _predict_transformers(self, model_dict: Dict[str, Any], features: np.ndarray) -> np.ndarray:
        """Make prediction with Transformers model."""
        # For text-based features, this would need text preprocessing
        # For now, return dummy predictions
        return np.random.random(features.shape[0])
    
    async def _predict_sklearn(self, model: BaseEstimator, features: np.ndarray) -> np.ndarray:
        """Make prediction with Scikit-learn model."""
        if hasattr(model, 'predict_proba'):
            return model.predict_proba(features)[:, 1]  # Return fraud probability
        else:
            # For models like Isolation Forest that return anomaly scores
            scores = model.decision_function(features)
            # Convert anomaly scores to probabilities (higher score = less anomalous)
            return 1.0 / (1.0 + np.exp(scores))  # Sigmoid transformation
    
    async def reload_model(self, model_name: str) -> None:
        """Reload a specific model."""
        if model_name not in self.config.models:
            raise ValueError(f"Model {model_name} not found in configuration")
        
        async with self.model_lock:
            model_config = self.config.get_model_config(model_name)
            
            try:
                # Remove old model
                if model_name in self.models:
                    del self.models[model_name]
                    del self.model_metadata[model_name]
                    del self.model_load_times[model_name]
                
                # Load new model
                await self._load_single_model(model_name, model_config)
                self.logger.info(f"Successfully reloaded model: {model_name}")
                
            except Exception as e:
                log_error_with_context(e, {"model_name": model_name})
                raise
    
    async def reload_all_models(self) -> None:
        """Reload all models."""
        async with self.model_lock:
            # Clear all models
            self.models.clear()
            self.model_metadata.clear()
            self.model_load_times.clear()
            
            # Reload all models
            await self.load_all_models()
    
    def get_loaded_models(self) -> Dict[str, Any]:
        """Get information about loaded models."""
        return {
            name: {
                "type": self.model_metadata[name]["type"],
                "loaded_at": self.model_metadata[name]["loaded_at"],
                "weight": self.model_metadata[name]["weight"]
            }
            for name in self.models.keys()
        }
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get detailed model information."""
        return {
            "total_models": len(self.models),
            "models": self.model_metadata,
            "last_reload": max(self.model_load_times.values()).isoformat() if self.model_load_times else None
        }
    
    def is_model_loaded(self, model_name: str) -> bool:
        """Check if a model is loaded."""
        return model_name in self.models
    
    async def cleanup(self) -> None:
        """Cleanup resources."""
        async with self.model_lock:
            # Clear models to free memory
            for model_name in list(self.models.keys()):
                try:
                    model = self.models[model_name]
                    
                    # Cleanup based on model type
                    if hasattr(model, 'close'):
                        model.close()
                    elif isinstance(model, dict) and 'model' in model:
                        # Transformers model
                        del model['model']
                        del model['tokenizer']
                    
                    del self.models[model_name]
                    
                except Exception as e:
                    self.logger.warning(f"Error cleaning up model {model_name}: {str(e)}")
            
            self.models.clear()
            self.model_metadata.clear()
            self.model_load_times.clear()
            
            self.logger.info("Model manager cleanup completed")