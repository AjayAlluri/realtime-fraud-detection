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
    
    def _generate_synthetic_data(self, n_samples: int = 10000) -> pd.DataFrame:
        """Generate synthetic fraud detection training data."""
        np.random.seed(self.random_state)
        
        data = []
        for i in range(n_samples):
            # Create synthetic transaction features
            transaction = {
                'transaction_id': f"tx_{i}",
                'user_id': f"user_{np.random.randint(1, 1000)}",
                'merchant_id': f"merchant_{np.random.randint(1, 500)}",
                
                # Amount features
                'amount': np.random.lognormal(3, 1.5),
                'amount_log': 0,  # Will be calculated
                'amount_percentile': np.random.uniform(0, 100),
                'amount_zscore': np.random.normal(0, 1),
                
                # Temporal features
                'hour_of_day': np.random.randint(0, 24),
                'day_of_week': np.random.randint(0, 7),
                'is_weekend': np.random.choice([0, 1], p=[0.7, 0.3]),
                
                # User behavior features
                'user_transaction_count_1h': np.random.poisson(2),
                'user_transaction_count_24h': np.random.poisson(10),
                'user_total_amount_24h': np.random.lognormal(5, 1),
                'user_avg_amount': np.random.lognormal(3, 1),
                'user_unique_merchants_24h': np.random.poisson(3),
                
                # Merchant features
                'merchant_transaction_count_1h': np.random.poisson(50),
                'merchant_fraud_rate': np.random.beta(1, 10),  # Skewed toward low fraud rates
                'merchant_avg_amount': np.random.lognormal(4, 1),
                'merchant_risk_score': np.random.beta(2, 8),
                
                # Device and network features
                'device_risk_score': np.random.beta(1, 9),
                'is_new_device': np.random.choice([0, 1], p=[0.8, 0.2]),
                'ip_risk_score': np.random.beta(1, 9),
                'is_tor_ip': np.random.choice([0, 1], p=[0.99, 0.01]),
                'is_vpn_ip': np.random.choice([0, 1], p=[0.95, 0.05]),
                
                # Velocity features
                'velocity_score': np.random.beta(2, 8),
                'amount_velocity_1h': np.random.lognormal(2, 1),
                'transaction_velocity_5m': np.random.poisson(1),
                
                # Geographic features
                'distance_from_home': np.random.exponential(10),
                'location_risk_score': np.random.beta(2, 8),
                'country_risk_score': np.random.beta(3, 7),
                'timezone_mismatch': np.random.choice([0, 1], p=[0.9, 0.1]),
                
                # Contextual features
                'payment_method_risk': np.random.beta(2, 8),
                'card_type_risk': np.random.beta(2, 8),
                'is_crypto_merchant': np.random.choice([0, 1], p=[0.95, 0.05]),
                'is_gift_card_merchant': np.random.choice([0, 1], p=[0.9, 0.1]),
                'cross_border_transaction': np.random.choice([0, 1], p=[0.8, 0.2])
            }
            
            # Calculate derived features
            transaction['amount_log'] = np.log1p(transaction['amount'])
            
            # Determine fraud label based on risk factors
            fraud_score = (
                transaction['merchant_fraud_rate'] * 0.3 +
                transaction['device_risk_score'] * 0.2 +
                transaction['ip_risk_score'] * 0.2 +
                transaction['velocity_score'] * 0.15 +
                transaction['location_risk_score'] * 0.15
            )
            
            # Add some noise and non-linear effects
            if transaction['is_tor_ip'] or transaction['is_crypto_merchant']:
                fraud_score += 0.3
            if transaction['is_new_device'] and transaction['amount'] > 1000:
                fraud_score += 0.2
            if transaction['hour_of_day'] < 6 or transaction['hour_of_day'] > 22:
                fraud_score += 0.1
            
            # Add random noise
            fraud_score += np.random.normal(0, 0.1)
            fraud_score = np.clip(fraud_score, 0, 1)
            
            # Convert to binary label (5% fraud rate)
            transaction['is_fraud'] = 1 if fraud_score > 0.7 else 0
            
            data.append(transaction)
        
        df = pd.DataFrame(data)
        
        # Ensure realistic fraud rate (around 5%)
        fraud_count = df['is_fraud'].sum()
        target_fraud_count = int(n_samples * 0.05)
        
        if fraud_count > target_fraud_count:
            # Randomly flip some fraud cases to non-fraud
            fraud_indices = df[df['is_fraud'] == 1].index
            flip_indices = np.random.choice(fraud_indices, fraud_count - target_fraud_count, replace=False)
            df.loc[flip_indices, 'is_fraud'] = 0
        elif fraud_count < target_fraud_count:
            # Randomly flip some non-fraud cases to fraud
            non_fraud_indices = df[df['is_fraud'] == 0].index
            flip_indices = np.random.choice(non_fraud_indices, target_fraud_count - fraud_count, replace=False)
            df.loc[flip_indices, 'is_fraud'] = 1
        
        self.logger.info(f"Generated {len(df)} synthetic transactions with {df['is_fraud'].sum()} fraud cases ({df['is_fraud'].mean():.1%} fraud rate)")
        
        return df
    
    def train_isolation_forest(self, X_train: np.ndarray, y_train: np.ndarray, 
                              X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, Any]:
        """Train Isolation Forest for anomaly detection."""
        from sklearn.ensemble import IsolationForest
        
        self.logger.info("Training Isolation Forest model...")
        start_time = time.time()
        
        # Train on normal transactions only
        X_normal = X_train[y_train == 0]
        
        model = IsolationForest(
            contamination=0.05,  # Expected fraud rate
            n_estimators=100,
            random_state=self.random_state
        )
        model.fit(X_normal)
        
        # Evaluate
        y_pred = model.predict(X_test)
        y_pred_binary = (y_pred == -1).astype(int)  # -1 means anomaly/fraud
        
        # Calculate AUC using decision function
        y_scores = model.decision_function(X_test)
        auc_score = roc_auc_score(y_test, -y_scores)  # Negative because lower scores mean more anomalous
        
        # Save model
        model_path = os.path.join(self.output_dir, "sklearn", "isolation_forest.joblib")
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        joblib.dump(model, model_path)
        
        training_time = time.time() - start_time
        
        results = {
            'model_type': 'isolation_forest',
            'model_path': model_path,
            'auc_score': auc_score,
            'training_time_seconds': training_time
        }
        
        self.logger.info(f"Isolation Forest training completed in {training_time:.2f}s, AUC: {auc_score:.4f}")
        return results
    
    def save_training_metadata(self, results: Dict[str, Any]) -> None:
        """Save training metadata and results."""
        metadata = {
            'timestamp': datetime.now().isoformat(),
            'training_results': results,
            'configuration': {
                'test_size': self.test_size,
                'validation_size': self.validation_size,
                'random_state': self.random_state
            }
        }
        
        import json
        metadata_path = os.path.join(self.output_dir, "training_metadata.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        self.logger.info(f"Training metadata saved to: {metadata_path}")