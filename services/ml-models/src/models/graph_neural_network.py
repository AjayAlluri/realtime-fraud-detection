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
    
    def _add_transaction_to_history(self, transaction_data: Dict[str, Any]) -> None:
        """Add transaction to history for graph building."""
        # Limit history size
        if len(self.transaction_history) >= self.max_history_size:
            self.transaction_history = self.transaction_history[-self.max_history_size//2:]
        
        self.transaction_history.append({
            'user_id': transaction_data.get('user_id'),
            'merchant_id': transaction_data.get('merchant_id'),
            'device_id': transaction_data.get('device_id'),
            'ip_address': transaction_data.get('ip_address'),
            'amount': transaction_data.get('amount', 0),
            'timestamp': transaction_data.get('timestamp'),
            'is_fraud': transaction_data.get('is_fraud', False)
        })
    
    def _build_transaction_graph(self, current_transaction: Dict[str, Any]) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Build transaction graph from recent transaction history.
        
        Returns:
            Tuple of (node_features, edge_index)
        """
        try:
            # Get recent transactions within time window
            current_time = current_transaction.get('timestamp')
            if not current_time:
                return None, None
            
            # For simplification, create a small graph with key entities
            entities = set()
            relationships = []
            
            # Add current transaction entities
            user_id = current_transaction.get('user_id')
            merchant_id = current_transaction.get('merchant_id')
            device_id = current_transaction.get('device_id')
            
            if user_id:
                entities.add(f"user_{user_id}")
            if merchant_id:
                entities.add(f"merchant_{merchant_id}")
            if device_id:
                entities.add(f"device_{device_id}")
            
            # Add relationships from recent history
            for tx in self.transaction_history[-100:]:  # Last 100 transactions
                tx_user = f"user_{tx['user_id']}" if tx['user_id'] else None
                tx_merchant = f"merchant_{tx['merchant_id']}" if tx['merchant_id'] else None
                tx_device = f"device_{tx['device_id']}" if tx['device_id'] else None
                
                if tx_user and tx_merchant:
                    entities.add(tx_user)
                    entities.add(tx_merchant)
                    relationships.append((tx_user, tx_merchant))
                
                if tx_user and tx_device:
                    entities.add(tx_user)
                    entities.add(tx_device)
                    relationships.append((tx_user, tx_device))
            
            # Convert to tensors
            entity_list = list(entities)
            entity_to_idx = {entity: idx for idx, entity in enumerate(entity_list)}
            
            # Create node features (simplified)
            num_nodes = len(entity_list)
            node_features = torch.randn(num_nodes, 64)  # Random features for now
            
            # Create edge index
            edge_list = []
            for rel in relationships:
                if rel[0] in entity_to_idx and rel[1] in entity_to_idx:
                    src_idx = entity_to_idx[rel[0]]
                    dst_idx = entity_to_idx[rel[1]]
                    edge_list.append([src_idx, dst_idx])
                    edge_list.append([dst_idx, src_idx])  # Bidirectional
            
            if edge_list:
                edge_index = torch.tensor(edge_list).t().contiguous()
            else:
                edge_index = torch.empty((2, 0), dtype=torch.long)
            
            return node_features.to(self.device), edge_index.to(self.device)
            
        except Exception as e:
            self.logger.warning(f"Error building transaction graph: {str(e)}")
            return None, None
    
    def _predict_with_gnn(self, node_features: torch.Tensor, edge_index: torch.Tensor) -> float:
        """Make prediction using the GNN model."""
        try:
            with torch.no_grad():
                # Get model prediction
                output = self.model(node_features, edge_index)
                
                # For fraud detection, we'll use the mean prediction across all nodes
                # In practice, you'd focus on the specific transaction node
                probabilities = torch.exp(output)  # Convert from log probabilities
                fraud_probs = probabilities[:, 1]  # Fraud class probabilities
                
                # Return mean fraud probability
                mean_fraud_prob = torch.mean(fraud_probs).item()
                
                return min(max(mean_fraud_prob, 0.0), 1.0)  # Clamp to [0, 1]
                
        except Exception as e:
            self.logger.warning(f"Error in GNN prediction: {str(e)}")
            return 0.0
    
    def _calculate_network_features(self, transaction_data: Dict[str, Any]) -> Dict[str, float]:
        """Calculate network-based features from transaction history."""
        features = {
            'user_centrality': 0.0,
            'merchant_centrality': 0.0,
            'clustering_coefficient': 0.0,
            'path_length_anomaly': 0.0,
            'community_anomaly': 0.0
        }
        
        try:
            user_id = transaction_data.get('user_id')
            merchant_id = transaction_data.get('merchant_id')
            
            if not user_id or not merchant_id:
                return features
            
            # Calculate user centrality (simplified)
            user_transactions = [tx for tx in self.transaction_history if tx['user_id'] == user_id]
            unique_merchants = len(set(tx['merchant_id'] for tx in user_transactions if tx['merchant_id']))
            features['user_centrality'] = min(unique_merchants / 10.0, 1.0)  # Normalize
            
            # Calculate merchant centrality
            merchant_transactions = [tx for tx in self.transaction_history if tx['merchant_id'] == merchant_id]
            unique_users = len(set(tx['user_id'] for tx in merchant_transactions if tx['user_id']))
            features['merchant_centrality'] = min(unique_users / 100.0, 1.0)  # Normalize
            
            # Clustering coefficient (simplified)
            # Measure how interconnected the user's transaction partners are
            user_merchants = set(tx['merchant_id'] for tx in user_transactions if tx['merchant_id'])
            if len(user_merchants) > 1:
                # Check how many other users also transact with the same merchants
                shared_connections = 0
                for merchant in user_merchants:
                    other_users = set(tx['user_id'] for tx in self.transaction_history 
                                    if tx['merchant_id'] == merchant and tx['user_id'] != user_id)
                    shared_connections += len(other_users)
                
                features['clustering_coefficient'] = min(shared_connections / (len(user_merchants) * 10), 1.0)
            
            # Path length anomaly (distance from normal transaction patterns)
            avg_amount = sum(tx['amount'] for tx in user_transactions) / max(len(user_transactions), 1)
            current_amount = transaction_data.get('amount', 0)
            if avg_amount > 0:
                amount_ratio = abs(current_amount - avg_amount) / avg_amount
                features['path_length_anomaly'] = min(amount_ratio, 1.0)
            
            # Community anomaly (new vs. established patterns)
            new_merchant = merchant_id not in [tx['merchant_id'] for tx in user_transactions[:-1]]
            features['community_anomaly'] = 1.0 if new_merchant else 0.0
            
        except Exception as e:
            self.logger.warning(f"Error calculating network features: {str(e)}")
        
        return features
    
    def get_performance_stats(self) -> Dict[str, float]:
        """Get performance statistics for the graph analyzer."""
        if self.total_predictions > 0:
            avg_time = self.total_time_ms / self.total_predictions
        else:
            avg_time = 0.0
        
        return {
            'total_predictions': self.total_predictions,
            'avg_processing_time_ms': avg_time,
            'total_processing_time_ms': self.total_time_ms,
            'transaction_history_size': len(self.transaction_history)
        }