"""
Graph Neural Network for fraud detection using transaction relationships.
Analyzes networks of users, merchants, and devices to detect fraud patterns.
"""
import logging
import time
from typing import Dict, List, Optional, Tuple, Any

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

from utils.logging_config import get_logger


class GraphNeuralNetwork(nn.Module):
    """
    Graph Neural Network for fraud detection using transaction graphs.
    Implements a simplified GNN architecture for real-time inference.
    """
    
    def __init__(
        self, 
        input_dim: int = 64, 
        hidden_dim: int = 128, 
        output_dim: int = 2, 
        num_layers: int = 3,
        dropout: float = 0.1
    ):
        super(GraphNeuralNetwork, self).__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim
        self.num_layers = num_layers
        self.dropout = dropout
        
        # Graph convolution layers
        self.conv_layers = nn.ModuleList()
        
        # Input layer
        self.conv_layers.append(nn.Linear(input_dim, hidden_dim))
        
        # Hidden layers
        for _ in range(num_layers - 2):
            self.conv_layers.append(nn.Linear(hidden_dim, hidden_dim))
        
        # Output layer
        self.conv_layers.append(nn.Linear(hidden_dim, output_dim))
        
        # Activation and regularization
        self.activation = nn.ReLU()
        self.dropout_layer = nn.Dropout(dropout)
        self.batch_norm = nn.ModuleList([
            nn.BatchNorm1d(hidden_dim) for _ in range(num_layers - 1)
        ])
        
        # Initialize weights
        self._initialize_weights()
    
    def _initialize_weights(self):
        """Initialize model weights."""
        for layer in self.conv_layers:
            nn.init.xavier_uniform_(layer.weight)
            nn.init.zeros_(layer.bias)
    
    def forward(self, x: torch.Tensor, edge_index: torch.Tensor = None) -> torch.Tensor:
        """
        Forward pass through the GNN.
        
        Args:
            x: Node features [num_nodes, input_dim]
            edge_index: Edge connections [2, num_edges] (optional for simplified version)
        
        Returns:
            Node predictions [num_nodes, output_dim]
        """
        # For simplified version without actual graph convolution
        # In production, this would use proper graph convolution operations
        
        for i, layer in enumerate(self.conv_layers[:-1]):
            x = layer(x)
            x = self.batch_norm[i](x)
            x = self.activation(x)
            x = self.dropout_layer(x)
        
        # Final layer
        x = self.conv_layers[-1](x)
        
        return F.log_softmax(x, dim=-1)


class GraphFraudDetector:
    """
    Graph-based fraud detector using transaction networks.
    Builds graphs from transaction data and applies GNN for fraud detection.
    """
    
    def __init__(self, model_path: str = None, device: str = "auto"):
        self.logger = get_logger("graph_fraud_detector")
        
        # Set device
        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)
        
        self.model = None
        self.model_path = model_path
        
        # Graph construction parameters
        self.max_nodes = 1000  # Maximum nodes in transaction graph
        self.time_window_hours = 24  # Time window for building graphs
        
        # Performance tracking
        self.total_predictions = 0
        self.total_time_ms = 0.0
        
        # Transaction history for graph building
        self.transaction_history = []
        self.max_history_size = 10000
        
        self.logger.info(f"Graph fraud detector initialized on device: {self.device}")
    
    def load_model(self) -> None:
        """Load the GNN model."""
        try:
            if self.model_path and torch.cuda.is_available():
                self.logger.info(f"Loading GNN model from: {self.model_path}")
                checkpoint = torch.load(self.model_path, map_location=self.device)
                
                # Create model with saved configuration
                model_config = checkpoint.get('config', {})
                self.model = GraphNeuralNetwork(
                    input_dim=model_config.get('input_dim', 64),
                    hidden_dim=model_config.get('hidden_dim', 128),
                    output_dim=model_config.get('output_dim', 2),
                    num_layers=model_config.get('num_layers', 3),
                    dropout=model_config.get('dropout', 0.1)
                )
                
                self.model.load_state_dict(checkpoint['model_state_dict'])
                self.model.to(self.device)
                self.model.eval()
                
                self.logger.info("GNN model loaded successfully")
            else:
                # Create dummy model for development
                self._create_dummy_model()
                
        except Exception as e:
            self.logger.error(f"Failed to load GNN model: {str(e)}")
            self._create_dummy_model()
    
    def _create_dummy_model(self) -> None:
        """Create a dummy GNN model for development."""
        self.logger.warning("Creating dummy GNN model for development")
        
        self.model = GraphNeuralNetwork(
            input_dim=64,
            hidden_dim=128,
            output_dim=2,
            num_layers=3,
            dropout=0.1
        )
        self.model.to(self.device)
        self.model.eval()
    
    def analyze_transaction_network(self, transaction_data: Dict[str, Any]) -> Dict[str, float]:
        """
        Analyze transaction using graph neural network.
        
        Args:
            transaction_data: Dictionary containing transaction information
        
        Returns:
            Dictionary with network-based fraud risk scores
        """
        start_time = time.time()
        
        try:
            # Add transaction to history
            self._add_transaction_to_history(transaction_data)
            
            # Build transaction graph
            graph_features, adjacency = self._build_transaction_graph(transaction_data)
            
            # Get GNN prediction
            if graph_features is not None:
                network_risk_score = self._predict_with_gnn(graph_features, adjacency)
            else:
                network_risk_score = 0.0
            
            # Calculate network features
            network_features = self._calculate_network_features(transaction_data)
            
            # Combine results
            results = {
                'network_risk_score': network_risk_score,
                'user_centrality': network_features['user_centrality'],
                'merchant_centrality': network_features['merchant_centrality'],
                'clustering_coefficient': network_features['clustering_coefficient'],
                'path_length_anomaly': network_features['path_length_anomaly'],
                'community_anomaly': network_features['community_anomaly']
            }
            
            # Update performance metrics
            processing_time = (time.time() - start_time) * 1000
            self.total_predictions += 1
            self.total_time_ms += processing_time
            
            self.logger.debug(f"Graph analysis completed in {processing_time:.2f}ms")
            
            return results
            
        except Exception as e:
            self.logger.error(f"Error in graph analysis: {str(e)}")
            return {
                'network_risk_score': 0.0,
                'user_centrality': 0.0,
                'merchant_centrality': 0.0,
                'clustering_coefficient': 0.0,
                'path_length_anomaly': 0.0,
                'community_anomaly': 0.0
            }