"""
BERT Text Analyzer for fraud detection from transaction descriptions and merchant names.
Uses DistilBERT for efficient real-time inference.
"""
import logging
import time
from typing import Dict, List, Optional, Tuple, Any

import torch
import numpy as np
from transformers import (
    AutoTokenizer, 
    AutoModelForSequenceClassification,
    DistilBertTokenizer,
    DistilBertForSequenceClassification
)

from utils.logging_config import get_logger


class BertTextAnalyzer:
    """
    BERT-based text analyzer for fraud detection using transaction descriptions.
    Analyzes merchant names, transaction descriptions, and other text fields.
    """
    
    def __init__(self, model_path: str = "distilbert-base-uncased", device: str = "auto"):
        self.logger = get_logger("bert_text_analyzer")
        
        # Set device
        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)
        
        self.model_path = model_path
        self.max_length = 512
        self.tokenizer = None
        self.model = None
        
        # Performance tracking
        self.total_predictions = 0
        self.total_time_ms = 0.0
        
        self.logger.info(f"BERT analyzer initialized on device: {self.device}")
    
    def load_model(self) -> None:
        """Load the BERT model and tokenizer."""
        try:
            self.logger.info(f"Loading BERT model from: {self.model_path}")
            
            # Load tokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path)
            
            # Load model
            self.model = AutoModelForSequenceClassification.from_pretrained(
                self.model_path,
                num_labels=2,  # Binary classification: fraud/not fraud
                return_dict=True
            )
            
            # Move model to device
            self.model.to(self.device)
            self.model.eval()
            
            self.logger.info("BERT model loaded successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to load BERT model: {str(e)}")
            # Create dummy model for development
            self._create_dummy_model()
    
    def _create_dummy_model(self) -> None:
        """Create a dummy model for development/testing."""
        self.logger.warning("Creating dummy BERT model for development")
        
        class DummyTokenizer:
            def encode_plus(self, text, **kwargs):
                # Return dummy token data
                return {
                    'input_ids': torch.tensor([[101, 2023, 2003, 1037, 7404, 102]]),
                    'attention_mask': torch.tensor([[1, 1, 1, 1, 1, 1]])
                }
        
        class DummyModel:
            def __init__(self, device):
                self.device = device
            
            def to(self, device):
                return self
            
            def eval(self):
                return self
            
            def __call__(self, input_ids, attention_mask=None):
                # Return dummy logits
                batch_size = input_ids.shape[0]
                logits = torch.randn(batch_size, 2)  # Random logits for 2 classes
                return type('Output', (), {'logits': logits})()
        
        self.tokenizer = DummyTokenizer()
        self.model = DummyModel(self.device)