#!/usr/bin/env python3
"""
Fraud Pattern Generation Module
Implements various sophisticated fraud patterns for testing ML models
"""

import random
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
import numpy as np
from faker import Faker

fake = Faker()

@dataclass
class FraudScenario:
    """Defines a specific fraud scenario with parameters"""
    name: str
    description: str
    probability: float
    severity: str  # low, medium, high, critical
    detection_difficulty: str  # easy, medium, hard, very_hard
    typical_amount_range: Tuple[float, float]
    typical_frequency: str  # single, burst, sustained
    geographic_pattern: str  # local, remote, international, random

class AdvancedFraudPatterns:
    """Advanced fraud pattern generator with realistic attack vectors"""
    
    def __init__(self):
        self.scenarios = self._initialize_fraud_scenarios()
        self.velocity_windows = {}  # Track transaction velocity per user
        self.device_sessions = {}  # Track device usage patterns
        self.geographic_history = {}  # Track user location history
        
    def _initialize_fraud_scenarios(self) -> Dict[str, FraudScenario]:
        """Initialize all fraud scenarios"""
        return {
            'card_testing': FraudScenario(
                name='Card Testing',
                description='Testing stolen card numbers with small transactions',
                probability=0.025,
                severity='medium',
                detection_difficulty='easy',
                typical_amount_range=(0.99, 9.99),
                typical_frequency='burst',
                geographic_pattern='random'
            ),
            'account_takeover': FraudScenario(
                name='Account Takeover',
                description='Legitimate account compromised by fraudster',
                probability=0.015,
                severity='high',
                detection_difficulty='medium',
                typical_amount_range=(100.0, 2000.0),
                typical_frequency='sustained',
                geographic_pattern='remote'
            ),
            'synthetic_identity': FraudScenario(
                name='Synthetic Identity Fraud',
                description='Fake identity created with real and fake information',
                probability=0.008,
                severity='high',
                detection_difficulty='hard',
                typical_amount_range=(500.0, 5000.0),
                typical_frequency='sustained',
                geographic_pattern='local'
            ),
            'first_party_fraud': FraudScenario(
                name='First Party Fraud',
                description='Legitimate customer committing fraud',
                probability=0.012,
                severity='medium',
                detection_difficulty='very_hard',
                typical_amount_range=(200.0, 1500.0),
                typical_frequency='single',
                geographic_pattern='local'
            ),
            'money_laundering': FraudScenario(
                name='Money Laundering',
                description='Structured transactions to hide money source',
                probability=0.005,
                severity='critical',
                detection_difficulty='hard',
                typical_amount_range=(9000.0, 9900.0),
                typical_frequency='sustained',
                geographic_pattern='random'
            ),
            'merchant_fraud': FraudScenario(
                name='Merchant Fraud',
                description='Fraudulent merchant processing fake transactions',
                probability=0.003,
                severity='high',
                detection_difficulty='medium',
                typical_amount_range=(50.0, 500.0),
                typical_frequency='sustained',
                geographic_pattern='local'
            ),
            'velocity_fraud': FraudScenario(
                name='Velocity Fraud',
                description='Rapid succession of transactions exceeding normal patterns',
                probability=0.018,
                severity='medium',
                detection_difficulty='easy',
                typical_amount_range=(25.0, 300.0),
                typical_frequency='burst',
                geographic_pattern='local'
            ),
            'geographic_fraud': FraudScenario(
                name='Geographic Impossibility',
                description='Transactions in impossible geographic sequence',
                probability=0.010,
                severity='medium',
                detection_difficulty='medium',
                typical_amount_range=(100.0, 800.0),
                typical_frequency='single',
                geographic_pattern='international'
            ),
            'bust_out_fraud': FraudScenario(
                name='Bust-Out Fraud',
                description='Building credit profile then maxing out quickly',
                probability=0.004,
                severity='high',
                detection_difficulty='hard',
                typical_amount_range=(1000.0, 8000.0),
                typical_frequency='burst',
                geographic_pattern='local'
            ),
            'friendly_fraud': FraudScenario(
                name='Friendly Fraud',
                description='Legitimate customer disputing valid charges',
                probability=0.020,
                severity='low',
                detection_difficulty='very_hard',
                typical_amount_range=(50.0, 1000.0),
                typical_frequency='single',
                geographic_pattern='local'
            )
        }
    
    def generate_fraud_scenario(self) -> Tuple[bool, Optional[str], Optional[FraudScenario]]:
        """Determine if this transaction should be fraudulent and which pattern"""
        total_probability = sum(scenario.probability for scenario in self.scenarios.values())
        
        if random.random() > total_probability:
            return False, None, None
            
        # Select fraud type based on weighted probability
        cumulative_prob = 0
        random_value = random.random() * total_probability
        
        for fraud_type, scenario in self.scenarios.items():
            cumulative_prob += scenario.probability
            if random_value <= cumulative_prob:
                return True, fraud_type, scenario
        
        return False, None, None
    
    def apply_card_testing_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply card testing fraud pattern"""
        scenario = self.scenarios['card_testing']
        
        # Small, round amounts
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # Multiple attempts with same card
        transaction_data['card_last_four'] = random.choice(['1234', '5678', '9999', '0000'])
        
        # Random merchant to test card validity
        transaction_data['merchant_category'] = random.choice(['online_retail', 'digital_services', 'subscription'])
        
        # High fraud score for obvious patterns
        transaction_data['fraud_score'] = random.uniform(0.75, 0.95)
        transaction_data['fraud_reason'] = 'Small amount testing pattern detected'
        
        # Often from different IP addresses
        transaction_data['ip_address'] = fake.ipv4()
        
        return transaction_data
    
    def apply_account_takeover_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply account takeover fraud pattern"""
        scenario = self.scenarios['account_takeover']
        user_id = transaction_data['user_id']
        
        # Check if this user has geographic history
        if user_id in self.geographic_history:
            # Sudden geographic change
            last_location = self.geographic_history[user_id][-1]
            
            # Generate location far from last known location
            new_lat = last_location['lat'] + random.uniform(-50, 50)
            new_lon = last_location['lon'] + random.uniform(-50, 50)
            
            transaction_data['geolocation'] = {
                'lat': max(-90, min(90, new_lat)),
                'lon': max(-180, min(180, new_lon))
            }
        else:
            # First transaction - record location
            self.geographic_history[user_id] = []
        
        # Record this location
        if user_id not in self.geographic_history:
            self.geographic_history[user_id] = []
        self.geographic_history[user_id].append(transaction_data['geolocation'])
        
        # New device fingerprint
        transaction_data['device_fingerprint'] = str(uuid.uuid4())
        transaction_data['device_id'] = str(uuid.uuid4())
        
        # Different user agent
        transaction_data['user_agent'] = fake.user_agent()
        
        # Larger amounts than usual
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # High fraud score
        transaction_data['fraud_score'] = random.uniform(0.70, 0.90)
        transaction_data['fraud_reason'] = 'Geographic and device anomaly detected'
        
        return transaction_data
    
    def apply_velocity_fraud_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply velocity fraud pattern"""
        scenario = self.scenarios['velocity_fraud']
        user_id = transaction_data['user_id']
        current_time = datetime.fromisoformat(transaction_data['timestamp'])
        
        # Track velocity for this user
        if user_id not in self.velocity_windows:
            self.velocity_windows[user_id] = []
        
        # Add current transaction time
        self.velocity_windows[user_id].append(current_time)
        
        # Keep only transactions from last 10 minutes
        cutoff_time = current_time - timedelta(minutes=10)
        self.velocity_windows[user_id] = [
            t for t in self.velocity_windows[user_id] if t > cutoff_time
        ]
        
        # If more than 5 transactions in 10 minutes, it's suspicious
        transaction_count = len(self.velocity_windows[user_id])
        
        if transaction_count > 5:
            transaction_data['fraud_score'] = min(0.95, 0.5 + (transaction_count * 0.1))
            transaction_data['fraud_reason'] = f'High velocity: {transaction_count} transactions in 10 minutes'
        else:
            transaction_data['fraud_score'] = random.uniform(0.60, 0.80)
            transaction_data['fraud_reason'] = 'Velocity pattern detected'
        
        # Moderate amounts
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        return transaction_data
    
    def apply_synthetic_identity_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply synthetic identity fraud pattern"""
        scenario = self.scenarios['synthetic_identity']
        
        # High amounts for new accounts
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # Often online merchants
        transaction_data['merchant_category'] = random.choice(['online_retail', 'electronics', 'jewelry'])
        
        # Consistent device and location (built identity)
        transaction_data['fraud_score'] = random.uniform(0.65, 0.85)
        transaction_data['fraud_reason'] = 'Synthetic identity pattern indicators'
        
        # Fast spending pattern
        transaction_data['transaction_type'] = 'purchase'
        
        return transaction_data
    
    def apply_money_laundering_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply money laundering fraud pattern"""
        scenario = self.scenarios['money_laundering']
        
        # Amounts just under reporting thresholds
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # Often to cash-equivalent merchants
        transaction_data['merchant_category'] = random.choice(['atm', 'money_transfer', 'prepaid_cards', 'casino'])
        
        # Structured to avoid detection
        transaction_data['fraud_score'] = random.uniform(0.70, 0.90)
        transaction_data['fraud_reason'] = 'Structured transaction pattern'
        
        return transaction_data
    
    def apply_geographic_fraud_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply geographic impossibility fraud pattern"""
        scenario = self.scenarios['geographic_fraud']
        user_id = transaction_data['user_id']
        
        # Generate impossible geographic sequence
        if user_id in self.geographic_history and self.geographic_history[user_id]:
            last_location = self.geographic_history[user_id][-1]
            last_time = datetime.fromisoformat(transaction_data['timestamp']) - timedelta(minutes=random.randint(5, 30))
            
            # Calculate impossible distance/time ratio
            # Place transaction very far from last location
            transaction_data['geolocation'] = {
                'lat': fake.latitude(),
                'lon': fake.longitude()
            }
        
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        transaction_data['fraud_score'] = random.uniform(0.75, 0.90)
        transaction_data['fraud_reason'] = 'Geographic impossibility detected'
        
        return transaction_data
    
    def apply_merchant_fraud_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply merchant fraud pattern"""
        scenario = self.scenarios['merchant_fraud']
        
        # Repetitive amounts
        common_amounts = [49.99, 99.99, 199.99, 299.99]
        transaction_data['amount'] = random.choice(common_amounts)
        
        # Often high-risk merchant categories
        transaction_data['merchant_category'] = random.choice(['electronics', 'jewelry', 'adult_entertainment'])
        
        # Same merchant, multiple cards
        transaction_data['fraud_score'] = random.uniform(0.60, 0.85)
        transaction_data['fraud_reason'] = 'Merchant fraud pattern detected'
        
        return transaction_data
    
    def apply_bust_out_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply bust-out fraud pattern"""
        scenario = self.scenarios['bust_out_fraud']
        
        # Large amounts in short time
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # High-value merchants
        transaction_data['merchant_category'] = random.choice(['jewelry', 'electronics', 'luxury_goods'])
        
        transaction_data['fraud_score'] = random.uniform(0.70, 0.90)
        transaction_data['fraud_reason'] = 'Bust-out spending pattern'
        
        return transaction_data
    
    def apply_friendly_fraud_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply friendly fraud pattern (hardest to detect)"""
        scenario = self.scenarios['friendly_fraud']
        
        # Normal amounts and patterns
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # Normal merchant categories
        transaction_data['merchant_category'] = random.choice(['retail', 'restaurant', 'online_retail'])
        
        # Very low fraud score (legitimate-looking transaction)
        transaction_data['fraud_score'] = random.uniform(0.05, 0.25)
        transaction_data['fraud_reason'] = 'Potential friendly fraud'
        
        return transaction_data
    
    def apply_first_party_fraud_pattern(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply first party fraud pattern"""
        scenario = self.scenarios['first_party_fraud']
        
        # Normal user patterns but higher amounts
        transaction_data['amount'] = round(random.uniform(*scenario.typical_amount_range), 2)
        
        # Normal location and device
        transaction_data['fraud_score'] = random.uniform(0.10, 0.40)
        transaction_data['fraud_reason'] = 'First party fraud indicators'
        
        return transaction_data
    
    def apply_fraud_pattern(self, fraud_type: str, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply the specified fraud pattern to transaction data"""
        pattern_methods = {
            'card_testing': self.apply_card_testing_pattern,
            'account_takeover': self.apply_account_takeover_pattern,
            'velocity_fraud': self.apply_velocity_fraud_pattern,
            'synthetic_identity': self.apply_synthetic_identity_pattern,
            'money_laundering': self.apply_money_laundering_pattern,
            'geographic_fraud': self.apply_geographic_fraud_pattern,
            'merchant_fraud': self.apply_merchant_fraud_pattern,
            'bust_out_fraud': self.apply_bust_out_pattern,
            'friendly_fraud': self.apply_friendly_fraud_pattern,
            'first_party_fraud': self.apply_first_party_fraud_pattern,
        }
        
        if fraud_type in pattern_methods:
            return pattern_methods[fraud_type](transaction_data)
        else:
            # Default fraud pattern
            transaction_data['fraud_score'] = random.uniform(0.50, 0.80)
            transaction_data['fraud_reason'] = f'Unknown fraud pattern: {fraud_type}'
            return transaction_data
    
    def get_fraud_statistics(self) -> Dict[str, Any]:
        """Get statistics about fraud patterns"""
        return {
            'total_scenarios': len(self.scenarios),
            'scenarios': {
                name: {
                    'probability': scenario.probability,
                    'severity': scenario.severity,
                    'detection_difficulty': scenario.detection_difficulty
                }
                for name, scenario in self.scenarios.items()
            },
            'total_fraud_probability': sum(s.probability for s in self.scenarios.values()),
            'velocity_tracking_users': len(self.velocity_windows),
            'geographic_tracking_users': len(self.geographic_history)
        }