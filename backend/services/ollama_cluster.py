"""
Ollama Cluster Manager — Distributes inference across multiple Ollama instances.
Supports load balancing, model pulling, and failover.
"""

import asyncio
import aiohttp
import logging
from typing import Optional
from backend.config import get_settings

log = logging.getLogger(__name__)


class OllamaNode:
    """Represents a single Ollama instance in the cluster."""

    def __init__(self, name: str, url: str, address: str, role: str = "worker", priority: int = 0, specialization: str = None):
        self.name = name
        self.url = url.rstrip('/')
        self.address = address  # IP or hostname
        self.role = role  # "master" or "worker"
        self.priority = priority  # Lower = higher priority
        self.healthy = False  # Will be set by health check
        self.ollama_online = False
        self.loaded_models = set()
        self.specialization = specialization  # e.g., "embeddings", "llm", "control"
        self.cpu_percent = None
        self.cpu_cores = 4  # Default, can be updated
        self.ram_used_mb = None
        self.ram_total_mb = None

    async def health_check(self) -> bool:
        """Check if this node is responsive."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.url}/api/tags", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    self.ollama_online = resp.status == 200
                    if self.ollama_online:
                        data = await resp.json()
                        self.loaded_models = {m['name'] for m in data.get('models', [])}
                    self.healthy = self.ollama_online
                    return self.healthy
        except Exception as e:
            log.warning(f"Health check failed for {self.name}: {e}")
            self.ollama_online = False
            self.healthy = False
            return False

    async def pull_model(self, model: str) -> bool:
        """Pull a model to this node."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.url}/api/pull", json={"name": model}) as resp:
                    if resp.status == 200:
                        self.loaded_models.add(model)
                        return True
                    return False
        except Exception as e:
            log.error(f"Failed to pull {model} to {self.name}: {e}")
            return False

    async def generate(self, model: str, prompt: str, **kwargs) -> dict:
        """Generate a response using this node."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.url}/api/generate",
                    json={"model": model, "prompt": prompt, **kwargs},
                    timeout=aiohttp.ClientTimeout(total=None)  # Streaming, no timeout
                ) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    return {"error": f"HTTP {resp.status}"}
        except Exception as e:
            log.error(f"Generation failed on {self.name}: {e}")
            return {"error": str(e)}


class OllamaCluster:
    """Manages a cluster of Ollama instances with load balancing."""

    def __init__(self):
        self.nodes = []
        self.routing_config = {
            "llm_node": "cyberdeck",
            "embeddings_node": "ai-pi",
            "fallback_node": "cyberdeck"
        }
        self._initialize_nodes()

    def _initialize_nodes(self):
        """Set up Ollama nodes from config."""
        settings = get_settings()

        # blacknode (k3s master, control node with optional Ollama)
        self.nodes.append(OllamaNode(
            name="blacknode",
            url="http://100.90.234.21:11434",
            address="100.90.234.21",
            role="master",
            priority=2,
            specialization="control"
        ))

        # cyberdeck (worker node, primary LLM models)
        # Use localhost since Ollama and FastAPI server run on the same machine
        self.nodes.append(OllamaNode(
            name="cyberdeck",
            url="http://localhost:11434",
            address="localhost",
            role="worker",
            priority=0,
            specialization="llm"  # Chat, narration, titles, key-points
        ))

        # ai-pi (worker node, specialized for embeddings and reasoning)
        self.nodes.append(OllamaNode(
            name="ai-pi",
            url="http://192.168.1.15:11434",
            address="192.168.1.15",
            role="worker",
            priority=1,
            specialization="embeddings"  # Embeddings + reasoning backup
        ))

    async def initialize(self):
        """Run health checks and sync models across cluster."""
        for node in self.nodes:
            await node.health_check()
            log.info(f"Node {node.name}: healthy={node.healthy}, models={len(node.loaded_models)}")

    async def ensure_model(self, model: str) -> bool:
        """Ensure a model is available on at least one healthy node."""
        healthy_nodes = [n for n in self.nodes if n.healthy]

        # Check if already loaded on any node
        for node in healthy_nodes:
            if model in node.loaded_models:
                return True

        # Pull to primary node
        if healthy_nodes:
            log.info(f"Pulling {model} to {healthy_nodes[0].name}")
            return await healthy_nodes[0].pull_model(model)

        return False

    async def generate_streaming(self, model: str, prompt: str, **kwargs):
        """Stream generation response across cluster with smart routing."""
        # Determine if this is an embedding request by checking model name
        is_embedding = self._is_embedding_model(model)

        # Get candidate nodes based on request type
        if is_embedding:
            candidate_nodes = self._route_embedding_request(model)
        else:
            candidate_nodes = self._route_llm_request(model)

        if not candidate_nodes:
            raise RuntimeError("No healthy Ollama nodes available for this request")

        # Try each candidate node
        for node in candidate_nodes:
            try:
                response = await node.generate(model, prompt, **kwargs)
                if "error" not in response:
                    return response
            except Exception as e:
                log.warning(f"Generation failed on {node.name}, trying next: {e}")
                continue

        raise RuntimeError(f"Failed to generate on any cluster node for model {model}")

    def _is_embedding_model(self, model: str) -> bool:
        """Check if model is an embedding model."""
        embedding_models = [
            "nomic-embed-text",
            "deepseek-embed",
            "mxbai-embed",
            "bge",
        ]
        return any(em in model.lower() for em in embedding_models)

    def _route_embedding_request(self, model: str) -> list:
        """Route embedding requests to specialized embeddings node."""
        healthy_nodes = [n for n in self.nodes if n.healthy]
        target_node_name = self.routing_config.get("embeddings_node", "ai-pi")
        fallback_node_name = self.routing_config.get("fallback_node", "cyberdeck")

        # Try to use configured embeddings node first
        target_node = next((n for n in healthy_nodes if n.name == target_node_name), None)
        if target_node and model in target_node.loaded_models:
            return [target_node]

        # Fallback: use configured fallback node
        fallback = next((n for n in healthy_nodes if n.name == fallback_node_name), None)
        if fallback and model in fallback.loaded_models:
            return [fallback]

        # Last resort: use any healthy node with the model
        available = [n for n in healthy_nodes if model in n.loaded_models]
        if available:
            return sorted(available, key=lambda n: n.priority)

        # Absolute fallback: any healthy node (may pull model)
        return sorted(healthy_nodes, key=lambda n: n.priority)

    def _route_llm_request(self, model: str) -> list:
        """Route LLM requests to configured LLM node."""
        healthy_nodes = [n for n in self.nodes if n.healthy]
        target_node_name = self.routing_config.get("llm_node", "cyberdeck")
        fallback_node_name = self.routing_config.get("fallback_node", "cyberdeck")

        # Prefer configured LLM node for general LLM tasks
        target_node = next((n for n in healthy_nodes if n.name == target_node_name), None)
        if target_node:
            return [target_node] + [n for n in healthy_nodes if n.name != target_node_name]

        # Fallback: try fallback node
        fallback = next((n for n in healthy_nodes if n.name == fallback_node_name), None)
        if fallback:
            return [fallback] + [n for n in healthy_nodes if n.name != fallback_node_name]

        # Last resort: sorted by priority
        return sorted(healthy_nodes, key=lambda n: n.priority)

    async def get_loaded_models(self) -> dict:
        """Get all models loaded across the cluster."""
        all_models = {}
        for node in self.nodes:
            all_models[node.name] = list(node.loaded_models)
        return all_models

    async def get_routing_config(self) -> dict:
        """Get current routing configuration."""
        return {
            "llm_node": self.routing_config.get("llm_node", "cyberdeck"),
            "embeddings_node": self.routing_config.get("embeddings_node", "ai-pi"),
            "fallback_node": self.routing_config.get("fallback_node", "cyberdeck")
        }

    async def set_route(self, task_type: str, target_node: str) -> dict:
        """Update routing for a specific task type."""
        valid_nodes = {n.name for n in self.nodes}
        if target_node not in valid_nodes:
            return {"error": f"Invalid target node: {target_node}"}

        if task_type == "llm":
            self.routing_config["llm_node"] = target_node
        elif task_type == "embeddings":
            self.routing_config["embeddings_node"] = target_node
        else:
            return {"error": f"Invalid task type: {task_type}"}

        return {
            "success": True,
            "routing_config": self.routing_config
        }


# Singleton instance
_cluster = None


def get_ollama_cluster() -> OllamaCluster:
    """Get or initialize the Ollama cluster."""
    global _cluster
    if _cluster is None:
        _cluster = OllamaCluster()
    return _cluster
