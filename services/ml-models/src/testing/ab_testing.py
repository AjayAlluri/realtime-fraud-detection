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