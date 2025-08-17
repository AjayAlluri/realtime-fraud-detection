"""
A/B Testing framework for fraud detection models.
Enables safe deployment and testing of new models in production.
"""
import logging
import time
import random
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from enum import Enum

import numpy as np
from utils.logging_config import get_logger


class TestVariant(Enum):
    """A/B test variant types."""
    CONTROL = "control"
    TREATMENT = "treatment"


@dataclass
class ABTestConfig:
    """Configuration for A/B test."""
    test_name: str
    control_model: str
    treatment_model: str
    traffic_split: float  # Percentage of traffic for treatment (0.0-1.0)
    start_time: str
    end_time: str
    success_metric: str = "fraud_detection_rate"
    minimum_sample_size: int = 1000
    significance_level: float = 0.05


@dataclass
class TestResult:
    """Individual test result record."""
    transaction_id: str
    variant: TestVariant
    model_used: str
    prediction: float
    decision: str
    actual_fraud: Optional[bool]
    processing_time_ms: float
    timestamp: float


class ABTestManager:
    """
    A/B testing manager for fraud detection models.
    Handles traffic splitting, result collection, and statistical analysis.
    """
    
    def __init__(self):
        self.logger = get_logger("ab_test_manager")
        
        # Active tests
        self.active_tests: Dict[str, ABTestConfig] = {}
        
        # Test results storage
        self.test_results: Dict[str, List[TestResult]] = {}
        
        # Traffic allocation cache
        self.user_assignments: Dict[str, Dict[str, TestVariant]] = {}
        
        self.logger.info("A/B test manager initialized")
    
    def create_test(self, config: ABTestConfig) -> bool:
        """
        Create and start a new A/B test.
        
        Args:
            config: A/B test configuration
        
        Returns:
            True if test was created successfully
        """
        try:
            # Validate configuration
            if not self._validate_config(config):
                return False
            
            # Check for conflicts with existing tests
            if config.test_name in self.active_tests:
                self.logger.warning(f"Test {config.test_name} already exists")
                return False
            
            # Initialize test
            self.active_tests[config.test_name] = config
            self.test_results[config.test_name] = []
            
            self.logger.info(f"Created A/B test: {config.test_name}")
            self.logger.info(f"Control: {config.control_model}, Treatment: {config.treatment_model}")
            self.logger.info(f"Traffic split: {config.traffic_split:.1%} to treatment")
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error creating A/B test: {str(e)}")
            return False
    
    def get_variant(self, test_name: str, user_id: str) -> Optional[TestVariant]:
        """
        Get the assigned variant for a user in a specific test.
        
        Args:
            test_name: Name of the A/B test
            user_id: User identifier
        
        Returns:
            Assigned test variant or None if test not found
        """
        if test_name not in self.active_tests:
            return None
        
        # Check if user already has assignment
        if user_id in self.user_assignments.get(test_name, {}):
            return self.user_assignments[test_name][user_id]
        
        # Assign variant based on traffic split
        config = self.active_tests[test_name]
        
        # Use hash of user_id for consistent assignment
        user_hash = hash(f"{test_name}_{user_id}") % 100
        variant = TestVariant.TREATMENT if user_hash < (config.traffic_split * 100) else TestVariant.CONTROL
        
        # Store assignment
        if test_name not in self.user_assignments:
            self.user_assignments[test_name] = {}
        self.user_assignments[test_name][user_id] = variant
        
        return variant
    
    def record_result(
        self,
        test_name: str,
        transaction_id: str,
        variant: TestVariant,
        model_used: str,
        prediction: float,
        decision: str,
        processing_time_ms: float,
        actual_fraud: Optional[bool] = None
    ) -> None:
        """
        Record a test result.
        
        Args:
            test_name: Name of the A/B test
            transaction_id: Transaction identifier
            variant: Test variant used
            model_used: Model that was used
            prediction: Model prediction score
            decision: Final decision made
            processing_time_ms: Processing time in milliseconds
            actual_fraud: Actual fraud label (if known)
        """
        if test_name not in self.active_tests:
            return
        
        result = TestResult(
            transaction_id=transaction_id,
            variant=variant,
            model_used=model_used,
            prediction=prediction,
            decision=decision,
            actual_fraud=actual_fraud,
            processing_time_ms=processing_time_ms,
            timestamp=time.time()
        )
        
        self.test_results[test_name].append(result)
        
        # Log every 100th result
        if len(self.test_results[test_name]) % 100 == 0:
            self.logger.debug(f"Recorded {len(self.test_results[test_name])} results for test {test_name}")
    
    def get_test_summary(self, test_name: str) -> Dict[str, Any]:
        """
        Get summary statistics for an A/B test.
        
        Args:
            test_name: Name of the A/B test
        
        Returns:
            Dictionary with test summary statistics
        """
        if test_name not in self.active_tests:
            return {}
        
        config = self.active_tests[test_name]
        results = self.test_results[test_name]
        
        if not results:
            return {
                'test_name': test_name,
                'status': 'no_data',
                'total_samples': 0
            }
        
        # Separate results by variant
        control_results = [r for r in results if r.variant == TestVariant.CONTROL]
        treatment_results = [r for r in results if r.variant == TestVariant.TREATMENT]
        
        summary = {
            'test_name': test_name,
            'config': {
                'control_model': config.control_model,
                'treatment_model': config.treatment_model,
                'traffic_split': config.traffic_split,
                'success_metric': config.success_metric
            },
            'total_samples': len(results),
            'control_samples': len(control_results),
            'treatment_samples': len(treatment_results),
            'control_metrics': self._calculate_metrics(control_results),
            'treatment_metrics': self._calculate_metrics(treatment_results)
        }
        
        # Calculate statistical significance if we have enough samples
        if len(control_results) >= 100 and len(treatment_results) >= 100:
            summary['statistical_analysis'] = self._perform_statistical_test(
                control_results, treatment_results, config.success_metric
            )
        
        return summary
    
    def _validate_config(self, config: ABTestConfig) -> bool:
        """Validate A/B test configuration."""
        if not (0.0 <= config.traffic_split <= 1.0):
            self.logger.error("Traffic split must be between 0.0 and 1.0")
            return False
        
        if config.minimum_sample_size < 100:
            self.logger.error("Minimum sample size should be at least 100")
            return False
        
        if not (0.01 <= config.significance_level <= 0.1):
            self.logger.error("Significance level should be between 0.01 and 0.1")
            return False
        
        return True
    
    def _calculate_metrics(self, results: List[TestResult]) -> Dict[str, float]:
        """Calculate metrics for a set of test results."""
        if not results:
            return {}
        
        # Basic metrics
        total_samples = len(results)
        
        # Fraud detection metrics
        fraud_detected = sum(1 for r in results if r.decision in ["DECLINE", "REVIEW"])
        fraud_detection_rate = fraud_detected / total_samples
        
        # Performance metrics
        avg_processing_time = sum(r.processing_time_ms for r in results) / total_samples
        avg_prediction_score = sum(r.prediction for r in results) / total_samples
        
        # Decision distribution
        decisions = [r.decision for r in results]
        decision_counts = {}
        for decision in ["APPROVE", "APPROVE_WITH_MONITORING", "REVIEW", "DECLINE"]:
            decision_counts[f"{decision.lower()}_rate"] = decisions.count(decision) / total_samples
        
        metrics = {
            'total_samples': total_samples,
            'fraud_detection_rate': fraud_detection_rate,
            'avg_processing_time_ms': avg_processing_time,
            'avg_prediction_score': avg_prediction_score,
            **decision_counts
        }
        
        # Accuracy metrics (if actual fraud labels are available)
        results_with_labels = [r for r in results if r.actual_fraud is not None]
        if results_with_labels:
            true_positives = sum(1 for r in results_with_labels 
                               if r.actual_fraud and r.decision in ["DECLINE", "REVIEW"])
            false_positives = sum(1 for r in results_with_labels 
                                if not r.actual_fraud and r.decision in ["DECLINE", "REVIEW"])
            true_negatives = sum(1 for r in results_with_labels 
                               if not r.actual_fraud and r.decision in ["APPROVE", "APPROVE_WITH_MONITORING"])
            false_negatives = sum(1 for r in results_with_labels 
                                if r.actual_fraud and r.decision in ["APPROVE", "APPROVE_WITH_MONITORING"])
            
            if true_positives + false_positives > 0:
                precision = true_positives / (true_positives + false_positives)
            else:
                precision = 0.0
            
            if true_positives + false_negatives > 0:
                recall = true_positives / (true_positives + false_negatives)
            else:
                recall = 0.0
            
            if precision + recall > 0:
                f1_score = 2 * (precision * recall) / (precision + recall)
            else:
                f1_score = 0.0
            
            accuracy = (true_positives + true_negatives) / len(results_with_labels)
            
            metrics.update({
                'precision': precision,
                'recall': recall,
                'f1_score': f1_score,
                'accuracy': accuracy,
                'labeled_samples': len(results_with_labels)
            })
        
        return metrics
    
    def _perform_statistical_test(
        self, 
        control_results: List[TestResult], 
        treatment_results: List[TestResult], 
        metric: str
    ) -> Dict[str, Any]:
        """Perform statistical significance test between control and treatment."""
        try:
            # Extract metric values
            control_values = self._extract_metric_values(control_results, metric)
            treatment_values = self._extract_metric_values(treatment_results, metric)
            
            if not control_values or not treatment_values:
                return {'error': 'Insufficient data for statistical test'}
            
            # Perform t-test (simplified)
            control_mean = np.mean(control_values)
            treatment_mean = np.mean(treatment_values)
            
            control_std = np.std(control_values, ddof=1)
            treatment_std = np.std(treatment_values, ddof=1)
            
            # Calculate effect size
            pooled_std = np.sqrt(((len(control_values) - 1) * control_std**2 + 
                                 (len(treatment_values) - 1) * treatment_std**2) / 
                                (len(control_values) + len(treatment_values) - 2))
            
            if pooled_std > 0:
                effect_size = (treatment_mean - control_mean) / pooled_std
            else:
                effect_size = 0.0
            
            # Simple confidence interval (95%)
            se_diff = pooled_std * np.sqrt(1/len(control_values) + 1/len(treatment_values))
            margin_error = 1.96 * se_diff  # Approximate 95% CI
            
            relative_improvement = ((treatment_mean - control_mean) / control_mean * 100) if control_mean != 0 else 0
            
            return {
                'metric': metric,
                'control_mean': control_mean,
                'treatment_mean': treatment_mean,
                'control_std': control_std,
                'treatment_std': treatment_std,
                'effect_size': effect_size,
                'relative_improvement_percent': relative_improvement,
                'confidence_interval_95': [
                    (treatment_mean - control_mean) - margin_error,
                    (treatment_mean - control_mean) + margin_error
                ],
                'is_significant': abs(effect_size) > 0.2,  # Simplified significance test
                'sample_sizes': {
                    'control': len(control_values),
                    'treatment': len(treatment_values)
                }
            }
            
        except Exception as e:
            return {'error': f'Statistical test failed: {str(e)}'}
    
    def _extract_metric_values(self, results: List[TestResult], metric: str) -> List[float]:
        """Extract metric values from test results."""
        if metric == "fraud_detection_rate":
            return [1.0 if r.decision in ["DECLINE", "REVIEW"] else 0.0 for r in results]
        elif metric == "processing_time":
            return [r.processing_time_ms for r in results]
        elif metric == "prediction_score":
            return [r.prediction for r in results]
        elif metric == "precision" and all(r.actual_fraud is not None for r in results):
            # Calculate precision for each result (simplified)
            values = []
            for r in results:
                if r.decision in ["DECLINE", "REVIEW"]:
                    values.append(1.0 if r.actual_fraud else 0.0)
            return values
        else:
            return []
    
    def stop_test(self, test_name: str) -> bool:
        """Stop an active A/B test."""
        if test_name in self.active_tests:
            del self.active_tests[test_name]
            self.logger.info(f"Stopped A/B test: {test_name}")
            return True
        return False
    
    def get_active_tests(self) -> List[str]:
        """Get list of active test names."""
        return list(self.active_tests.keys())
    
    def export_results(self, test_name: str) -> Dict[str, Any]:
        """Export detailed results for analysis."""
        if test_name not in self.test_results:
            return {}
        
        results = self.test_results[test_name]
        
        return {
            'test_name': test_name,
            'export_timestamp': time.time(),
            'total_results': len(results),
            'results': [
                {
                    'transaction_id': r.transaction_id,
                    'variant': r.variant.value,
                    'model_used': r.model_used,
                    'prediction': r.prediction,
                    'decision': r.decision,
                    'actual_fraud': r.actual_fraud,
                    'processing_time_ms': r.processing_time_ms,
                    'timestamp': r.timestamp
                }
                for r in results
            ]
        }