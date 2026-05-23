"""
Ollama cluster management endpoints.
Provides cluster status, model distribution, and cluster operations.
"""

from fastapi import APIRouter, Query
from backend.services.ollama_cluster import get_ollama_cluster
import logging

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cluster", tags=["cluster"])


@router.get("/status")
async def cluster_status():
    """Get comprehensive cluster status with node metrics and routing info."""
    cluster = get_ollama_cluster()

    # Build nodes response
    nodes_data = []
    total_ram = 0
    total_cpu_cores = 0
    used_ram = 0
    online_count = 0

    for node in cluster.nodes:
        node_info = {
            "name": node.name,
            "address": node.address,
            "role": node.role,
            "online": node.healthy,
            "cpu_percent": node.cpu_percent,
            "ram_used_mb": node.ram_used_mb,
            "ram_total_mb": node.ram_total_mb,
            "ollama_online": node.ollama_online,
            "ollama_models": list(node.loaded_models),
            "routing_role": node.specialization or "general"
        }
        nodes_data.append(node_info)

        if node.healthy:
            online_count += 1
            if node.cpu_cores:
                total_cpu_cores += node.cpu_cores
            if node.ram_total_mb:
                total_ram += node.ram_total_mb
            if node.ram_used_mb:
                used_ram += node.ram_used_mb

    # Ensure minimum values
    if total_cpu_cores == 0:
        total_cpu_cores = 12  # Default for 3 nodes
    if total_ram == 0:
        total_ram = 24576  # Default 24GB for 3 nodes

    return {
        "nodes": nodes_data,
        "pool": {
            "total_cpu_cores": total_cpu_cores,
            "total_ram_mb": total_ram,
            "used_ram_mb": used_ram,
            "online_nodes": online_count
        },
        "routing": await cluster.get_routing_config()
    }


@router.get("/models")
async def cluster_models():
    """Get all models loaded across the cluster."""
    cluster = get_ollama_cluster()
    return await cluster.get_loaded_models()


@router.get("/route-info")
async def route_info():
    """Get current routing rules and configuration."""
    cluster = get_ollama_cluster()
    return {
        "rules": [
            {
                "type": "llm",
                "target_node": cluster.routing_config.get("llm_node", "cyberdeck"),
                "models": ["qwen2.5:1.5b", "gemma3", "deepseek-coder"],
                "fallback": "if node offline, use cyberdeck"
            },
            {
                "type": "embeddings",
                "target_node": cluster.routing_config.get("embeddings_node", "ai-pi"),
                "models": ["nomic-embed-text"],
                "fallback": "if node offline, use cyberdeck"
            }
        ]
    }


@router.post("/route")
async def set_route(body: dict):
    """Update routing configuration for a task type."""
    task_type = body.get("type")  # "llm" or "embeddings"
    target_node = body.get("target_node")  # "cyberdeck", "ai-pi", or "blacknode"

    if not task_type or not target_node:
        return {"error": "Missing type or target_node in request"}

    cluster = get_ollama_cluster()
    return await cluster.set_route(task_type, target_node)


@router.post("/pull/{model_name}")
async def pull_model(model_name: str, node: str = Query(None)):
    """Pull a model to a specific node or the cluster primary."""
    cluster = get_ollama_cluster()

    if node:
        # Pull to specific node
        target_node = next((n for n in cluster.nodes if n.name == node), None)
        if not target_node:
            return {"error": f"Node {node} not found"}
        success = await target_node.pull_model(model_name)
    else:
        # Pull to primary node
        success = await cluster.ensure_model(model_name)

    # Derive loaded_on by iterating through nodes
    loaded_on = []
    for node in cluster.nodes:
        if model_name in node.loaded_models:
            loaded_on.append(node.name)

    return {
        "model": model_name,
        "success": success,
        "loaded_on": loaded_on
    }


@router.post("/health-check")
async def health_check():
    """Run health checks on all cluster nodes."""
    cluster = get_ollama_cluster()
    results = {}
    for node in cluster.nodes:
        results[node.name] = await node.health_check()
    return results
