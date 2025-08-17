"""
Model training utilities for fraud detection models.
Provides training scripts for XGBoost, BERT, and GNN models.
"""
import os
import logging
import time
from typing import Dict, Any, List, Tuple, Optional
from datetime import datetime

import numpy as np
import pandas as pd
import joblib
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score

from utils.logging_config import get_logger


class ModelTrainer:
    """
    Model training class for fraud detection models.
    Handles data preparation, training, and model evaluation.
    """
    
    def __init__(self, output_dir: str = "/app/models"):
        self.logger = get_logger("model_trainer")
        self.output_dir = output_dir
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Training configuration
        self.test_size = 0.2
        self.validation_size = 0.1
        self.random_state = 42
        
        self.logger.info(f"Model trainer initialized with output dir: {output_dir}")
    
    def prepare_training_data(self, data_path: str = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Prepare training data from CSV or generate synthetic data.
        
        Args:
            data_path: Path to training data CSV file
        
        Returns:
            Tuple of (X_train, X_test, y_train, y_test)
        """
        if data_path and os.path.exists(data_path):
            self.logger.info(f"Loading training data from: {data_path}")
            df = pd.read_csv(data_path)
        else:
            self.logger.info("Generating synthetic training data")
            df = self._generate_synthetic_data()
        
        # Prepare features and labels
        feature_columns = [col for col in df.columns if col not in ['is_fraud', 'transaction_id', 'user_id', 'merchant_id']]
        X = df[feature_columns].values
        y = df['is_fraud'].values
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=self.test_size, random_state=self.random_state, stratify=y
        )
        
        self.logger.info(f"Training data prepared: {X_train.shape[0]} train, {X_test.shape[0]} test samples")
        return X_train, X_test, y_train, y_test
    
    def train_xgboost_model(self, X_train: np.ndarray, y_train: np.ndarray, 
                           X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, Any]:
        """
        Train XGBoost fraud detection model.
        
        Returns:
            Dictionary with training results
        """
        self.logger.info("Training XGBoost model...")
        start_time = time.time()
        
        # XGBoost parameters
        params = {
            'objective': 'binary:logistic',
            'eval_metric': 'auc',
            'max_depth': 6,
            'learning_rate': 0.1,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'n_estimators': 100,
            'random_state': self.random_state
        }
        
        # Train model
        model = xgb.XGBClassifier(**params)
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
        
        # Evaluate model
        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        
        # Calculate metrics
        auc_score = roc_auc_score(y_test, y_pred_proba)
        
        # Save model
        model_path = os.path.join(self.output_dir, "xgboost", "fraud_classifier.json")
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        model.save_model(model_path)
        
        training_time = time.time() - start_time
        
        results = {
            'model_type': 'xgboost',
            'model_path': model_path,
            'auc_score': auc_score,
            'training_time_seconds': training_time,
            'feature_importance': dict(zip(range(X_train.shape[1]), model.feature_importances_))
        }
        
        self.logger.info(f"XGBoost training completed in {training_time:.2f}s, AUC: {auc_score:.4f}")
        return results