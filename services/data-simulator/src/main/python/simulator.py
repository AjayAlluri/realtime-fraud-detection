#!/usr/bin/env python3
"""
Real-Time Payment Fraud Detection System - Data Simulator
Generates realistic transaction data with fraud patterns for ML training and testing.
"""

import json
import random
import time
import threading
import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from kafka import KafkaProducer
from faker import Faker
import numpy as np
import pandas as pd
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import redis
import argparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
transactions_generated = Counter('transactions_generated_total', 'Total transactions generated')
fraud_transactions = Counter('fraud_transactions_total', 'Total fraud transactions generated')
transaction_generation_time = Histogram('transaction_generation_seconds', 'Time to generate transaction')
active_users = Gauge('active_users_current', 'Currently active users')
transaction_rate = Gauge('transaction_rate_per_second', 'Current transaction rate per second')

fake = Faker()

@dataclass
class UserProfile:
    """User profile with behavioral patterns"""
    user_id: str
    email: str
    phone: str
    first_name: str
    last_name: str
    date_of_birth: str
    country: str
    state: str
    city: str
    zip_code: str
    created_at: str
    kyc_status: str
    risk_score: float
    avg_transaction_amount: float
    transaction_frequency: int  # transactions per day
    preferred_merchants: List[str]
    device_fingerprints: List[str]
    behavioral_patterns: Dict[str, Any]

@dataclass
class MerchantProfile:
    """Merchant profile with risk characteristics"""
    merchant_id: str
    name: str
    category: str
    mcc: str  # Merchant Category Code
    country: str
    city: str
    risk_level: str  # low, medium, high
    avg_transaction_amount: float
    fraud_rate: float
    is_blacklisted: bool
    operating_hours: Dict[str, str]  # start_hour, end_hour

@dataclass
class Transaction:
    """Payment transaction with all attributes"""
    transaction_id: str
    user_id: str
    merchant_id: str
    amount: float
    currency: str
    transaction_type: str
    payment_method: str
    card_type: str
    card_last_four: str
    timestamp: str
    ip_address: str
    device_id: str
    device_fingerprint: str
    user_agent: str
    geolocation: Dict[str, float]  # lat, lon
    merchant_location: Dict[str, float]
    is_weekend: bool
    hour_of_day: int
    is_fraud: bool
    fraud_type: Optional[str]
    fraud_score: float
    processing_time_ms: int

class FraudPatternGenerator:
    """Generates various fraud patterns"""
    
    def __init__(self):
        self.fraud_patterns = {
            'card_testing': 0.02,  # 2% probability
            'account_takeover': 0.01,  # 1% probability
            'synthetic_fraud': 0.005,  # 0.5% probability
            'money_laundering': 0.003,  # 0.3% probability
            'merchant_fraud': 0.002,  # 0.2% probability
            'velocity_fraud': 0.01,  # 1% probability
            'geographic_fraud': 0.005,  # 0.5% probability
        }
    
    def should_generate_fraud(self) -> tuple[bool, Optional[str]]:
        """Determine if this transaction should be fraudulent"""
        fraud_roll = random.random()
        cumulative_probability = 0
        
        for pattern, probability in self.fraud_patterns.items():
            cumulative_probability += probability
            if fraud_roll < cumulative_probability:
                return True, pattern
        
        return False, None
    
    def generate_card_testing_pattern(self, base_transaction: Transaction) -> Transaction:
        """Generate card testing fraud pattern (multiple small amounts)"""
        base_transaction.amount = round(random.uniform(1.0, 5.0), 2)
        base_transaction.fraud_score = random.uniform(0.8, 0.95)
        return base_transaction
    
    def generate_account_takeover_pattern(self, base_transaction: Transaction) -> Transaction:
        """Generate account takeover pattern (unusual location, device)"""
        # Different IP and geolocation
        base_transaction.ip_address = fake.ipv4()
        base_transaction.geolocation = {
            'lat': fake.latitude(),
            'lon': fake.longitude()
        }
        # New device
        base_transaction.device_fingerprint = str(uuid.uuid4())
        base_transaction.fraud_score = random.uniform(0.7, 0.9)
        return base_transaction
    
    def generate_synthetic_fraud_pattern(self, base_transaction: Transaction) -> Transaction:
        """Generate synthetic fraud (new user, high amount)"""
        base_transaction.amount = round(random.uniform(1000.0, 5000.0), 2)
        base_transaction.fraud_score = random.uniform(0.75, 0.95)
        return base_transaction
    
    def generate_velocity_fraud_pattern(self, base_transaction: Transaction) -> Transaction:
        """Generate velocity fraud (rapid transactions)"""
        base_transaction.fraud_score = random.uniform(0.6, 0.85)
        return base_transaction

class DataSimulator:
    """Main data simulator class"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.producer = self._create_kafka_producer()
        self.redis_client = self._create_redis_client()
        self.fraud_generator = FraudPatternGenerator()
        
        # User and merchant pools
        self.users: List[UserProfile] = []
        self.merchants: List[MerchantProfile] = []
        
        # Simulation state
        self.is_running = False
        self.current_transactions_per_second = 0
        
        # Generate initial data
        self._generate_user_profiles(config['num_users'])
        self._generate_merchant_profiles(config['num_merchants'])
        
        logger.info(f"Initialized simulator with {len(self.users)} users and {len(self.merchants)} merchants")
    
    def _create_kafka_producer(self) -> KafkaProducer:
        """Create Kafka producer with optimal settings"""
        return KafkaProducer(
            bootstrap_servers=self.config['kafka_brokers'],
            value_serializer=lambda v: json.dumps(v, default=str).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks='all',
            retries=3,
            batch_size=32768,
            linger_ms=10,
            compression_type='lz4',
            max_in_flight_requests_per_connection=5,
            enable_idempotence=True
        )
    
    def _create_redis_client(self) -> redis.Redis:
        """Create Redis client for state management"""
        return redis.Redis(
            host=self.config['redis_host'],
            port=self.config['redis_port'],
            password=self.config.get('redis_password'),
            decode_responses=True
        )
    
    def _generate_user_profiles(self, num_users: int):
        """Generate realistic user profiles"""
        logger.info(f"Generating {num_users} user profiles...")
        
        for i in range(num_users):
            # Generate behavioral patterns
            risk_score = np.random.beta(2, 8)  # Most users have low risk
            
            user = UserProfile(
                user_id=f"user_{str(uuid.uuid4())[:8]}",
                email=fake.email(),
                phone=fake.phone_number(),
                first_name=fake.first_name(),
                last_name=fake.last_name(),
                date_of_birth=fake.date_of_birth(minimum_age=18, maximum_age=80).isoformat(),
                country=fake.country_code(),
                state=fake.state(),
                city=fake.city(),
                zip_code=fake.zipcode(),
                created_at=fake.date_time_between(start_date='-2y', end_date='now').isoformat(),
                kyc_status=np.random.choice(['verified', 'pending', 'rejected'], p=[0.85, 0.12, 0.03]),
                risk_score=risk_score,
                avg_transaction_amount=np.random.lognormal(4, 1),  # Log-normal distribution
                transaction_frequency=int(np.random.gamma(2, 2)) + 1,
                preferred_merchants=[],
                device_fingerprints=[str(uuid.uuid4()) for _ in range(random.randint(1, 3))],
                behavioral_patterns={
                    'preferred_time_start': random.randint(6, 10),
                    'preferred_time_end': random.randint(18, 23),
                    'weekend_activity': random.uniform(0.3, 1.0),
                    'international_transactions': random.uniform(0.0, 0.1),
                    'online_preference': random.uniform(0.5, 0.95),
                }
            )
            
            self.users.append(user)
            
            # Cache user profile in Redis
            self.redis_client.hset(
                f"user:{user.user_id}",
                mapping=asdict(user)
            )
        
        logger.info(f"Generated {len(self.users)} user profiles")
    
    def _generate_merchant_profiles(self, num_merchants: int):
        """Generate realistic merchant profiles"""
        logger.info(f"Generating {num_merchants} merchant profiles...")
        
        merchant_categories = [
            ('retail', '5399', 'low', 50.0, 0.01),
            ('grocery', '5411', 'low', 25.0, 0.005),
            ('gas_station', '5542', 'medium', 40.0, 0.02),
            ('restaurant', '5812', 'low', 35.0, 0.008),
            ('online_retail', '5399', 'medium', 75.0, 0.025),
            ('gambling', '7995', 'high', 200.0, 0.15),
            ('adult_entertainment', '5967', 'high', 100.0, 0.12),
            ('pharmacy', '5912', 'medium', 30.0, 0.01),
            ('jewelry', '5944', 'high', 500.0, 0.08),
            ('electronics', '5732', 'medium', 300.0, 0.03),
        ]
        
        for i in range(num_merchants):
            category, mcc, risk_level, avg_amount, fraud_rate = random.choice(merchant_categories)
            
            merchant = MerchantProfile(
                merchant_id=f"merchant_{str(uuid.uuid4())[:8]}",
                name=fake.company(),
                category=category,
                mcc=mcc,
                country=fake.country_code(),
                city=fake.city(),
                risk_level=risk_level,
                avg_transaction_amount=avg_amount * random.uniform(0.5, 2.0),
                fraud_rate=fraud_rate,
                is_blacklisted=random.random() < 0.02,  # 2% blacklisted
                operating_hours={
                    'start_hour': str(random.randint(6, 10)),
                    'end_hour': str(random.randint(20, 24))
                }
            )
            
            self.merchants.append(merchant)
            
            # Cache merchant profile in Redis
            self.redis_client.hset(
                f"merchant:{merchant.merchant_id}",
                mapping=asdict(merchant)
            )
        
        logger.info(f"Generated {len(self.merchants)} merchant profiles")
    
    def _generate_transaction(self) -> Transaction:
        """Generate a single realistic transaction"""
        with transaction_generation_time.time():
            # Select random user and merchant
            user = random.choice(self.users)
            merchant = random.choice(self.merchants)
            
            # Generate base transaction
            now = datetime.now()
            
            # Calculate amount based on user and merchant patterns
            user_amount_factor = np.random.normal(1.0, 0.3)
            merchant_amount_factor = np.random.normal(1.0, 0.2)
            base_amount = user.avg_transaction_amount * user_amount_factor * merchant_amount_factor
            amount = max(1.0, round(base_amount, 2))
            
            # Generate location (sometimes different from user's location)
            if random.random() < user.behavioral_patterns['international_transactions']:
                # International transaction
                geo_lat = fake.latitude()
                geo_lon = fake.longitude()
            else:
                # Domestic transaction (near user's location)
                geo_lat = fake.latitude()
                geo_lon = fake.longitude()
            
            transaction = Transaction(
                transaction_id=str(uuid.uuid4()),
                user_id=user.user_id,
                merchant_id=merchant.merchant_id,
                amount=amount,
                currency='USD',
                transaction_type=random.choice(['purchase', 'refund', 'authorization']),
                payment_method=random.choice(['credit_card', 'debit_card', 'digital_wallet', 'bank_transfer']),
                card_type=random.choice(['visa', 'mastercard', 'amex', 'discover']),
                card_last_four=str(random.randint(1000, 9999)),
                timestamp=now.isoformat(),
                ip_address=fake.ipv4(),
                device_id=random.choice(user.device_fingerprints),
                device_fingerprint=random.choice(user.device_fingerprints),
                user_agent=fake.user_agent(),
                geolocation={'lat': float(geo_lat), 'lon': float(geo_lon)},
                merchant_location={'lat': fake.latitude(), 'lon': fake.longitude()},
                is_weekend=now.weekday() >= 5,
                hour_of_day=now.hour,
                is_fraud=False,
                fraud_type=None,
                fraud_score=0.0,
                processing_time_ms=random.randint(50, 500)
            )
            
            # Check if this should be a fraud transaction
            is_fraud, fraud_type = self.fraud_generator.should_generate_fraud()
            
            if is_fraud:
                transaction.is_fraud = True
                transaction.fraud_type = fraud_type
                
                # Apply fraud pattern
                if fraud_type == 'card_testing':
                    transaction = self.fraud_generator.generate_card_testing_pattern(transaction)
                elif fraud_type == 'account_takeover':
                    transaction = self.fraud_generator.generate_account_takeover_pattern(transaction)
                elif fraud_type == 'synthetic_fraud':
                    transaction = self.fraud_generator.generate_synthetic_fraud_pattern(transaction)
                elif fraud_type == 'velocity_fraud':
                    transaction = self.fraud_generator.generate_velocity_fraud_pattern(transaction)
                else:
                    transaction.fraud_score = random.uniform(0.5, 0.8)
                
                fraud_transactions.inc()
            else:
                # Normal transaction
                transaction.fraud_score = random.uniform(0.0, 0.3)
            
            transactions_generated.inc()
            return transaction
    
    def _send_to_kafka(self, transaction: Transaction):
        """Send transaction to appropriate Kafka topics"""
        transaction_dict = asdict(transaction)
        
        # Send to main transactions topic
        self.producer.send(
            'payment-transactions',
            key=transaction.transaction_id,
            value=transaction_dict
        )
        
        # Send to user behavior topic
        user_behavior = {
            'user_id': transaction.user_id,
            'event_type': 'transaction',
            'transaction_id': transaction.transaction_id,
            'amount': transaction.amount,
            'merchant_category': self._get_merchant_category(transaction.merchant_id),
            'timestamp': transaction.timestamp,
            'geolocation': transaction.geolocation,
            'device_fingerprint': transaction.device_fingerprint
        }
        
        self.producer.send(
            'user-behavior',
            key=transaction.user_id,
            value=user_behavior
        )
        
        # Send fraud alerts for high-risk transactions
        if transaction.fraud_score > 0.7:
            fraud_alert = {
                'alert_id': str(uuid.uuid4()),
                'transaction_id': transaction.transaction_id,
                'user_id': transaction.user_id,
                'fraud_score': transaction.fraud_score,
                'fraud_type': transaction.fraud_type,
                'alert_level': 'high' if transaction.fraud_score > 0.9 else 'medium',
                'timestamp': transaction.timestamp
            }
            
            self.producer.send(
                'fraud-alerts',
                key=transaction.transaction_id,
                value=fraud_alert
            )
    
    def _get_merchant_category(self, merchant_id: str) -> str:
        """Get merchant category from cache or default"""
        try:
            return self.redis_client.hget(f"merchant:{merchant_id}", 'category') or 'unknown'
        except:
            return 'unknown'
    
    def start_simulation(self, transactions_per_second: int = 100):
        """Start the transaction simulation"""
        self.is_running = True
        self.current_transactions_per_second = transactions_per_second
        
        logger.info(f"Starting simulation at {transactions_per_second} transactions per second")
        
        interval = 1.0 / transactions_per_second
        
        def generate_transactions():
            while self.is_running:
                try:
                    transaction = self._generate_transaction()
                    self._send_to_kafka(transaction)
                    
                    # Update metrics
                    active_users.set(len(self.users))
                    transaction_rate.set(self.current_transactions_per_second)
                    
                    time.sleep(interval)
                    
                except Exception as e:
                    logger.error(f"Error generating transaction: {e}")
                    time.sleep(1)
        
        # Start generation in separate thread
        generation_thread = threading.Thread(target=generate_transactions)
        generation_thread.daemon = True
        generation_thread.start()
        
        logger.info("Transaction simulation started")
    
    def stop_simulation(self):
        """Stop the transaction simulation"""
        self.is_running = False
        logger.info("Stopping transaction simulation")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current simulation statistics"""
        return {
            'is_running': self.is_running,
            'users_count': len(self.users),
            'merchants_count': len(self.merchants),
            'transactions_per_second': self.current_transactions_per_second,
            'total_transactions': transactions_generated._value.get(),
            'total_fraud_transactions': fraud_transactions._value.get(),
        }

def main():
    """Main function to run the simulator"""
    parser = argparse.ArgumentParser(description='Fraud Detection Data Simulator')
    parser.add_argument('--tps', type=int, default=100, help='Transactions per second')
    parser.add_argument('--users', type=int, default=10000, help='Number of users to generate')
    parser.add_argument('--merchants', type=int, default=5000, help='Number of merchants to generate')
    parser.add_argument('--kafka-brokers', default='localhost:9092,localhost:9093,localhost:9094')
    parser.add_argument('--redis-host', default='localhost')
    parser.add_argument('--redis-port', type=int, default=6379)
    parser.add_argument('--metrics-port', type=int, default=8000, help='Prometheus metrics port')
    
    args = parser.parse_args()
    
    config = {
        'num_users': args.users,
        'num_merchants': args.merchants,
        'kafka_brokers': args.kafka_brokers.split(','),
        'redis_host': args.redis_host,
        'redis_port': args.redis_port,
        'redis_password': 'redis123'
    }
    
    # Start Prometheus metrics server
    start_http_server(args.metrics_port)
    logger.info(f"Prometheus metrics available at http://localhost:{args.metrics_port}/metrics")
    
    # Initialize and start simulator
    simulator = DataSimulator(config)
    
    try:
        simulator.start_simulation(args.tps)
        
        # Keep running until interrupted
        while True:
            time.sleep(10)
            stats = simulator.get_stats()
            logger.info(f"Stats: {stats}")
            
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    finally:
        simulator.stop_simulation()
        logger.info("Simulator stopped")

if __name__ == '__main__':
    main()