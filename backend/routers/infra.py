"""
Infrastructure node management and monitoring.
Provides Docker, k3s, and system metrics for the Phantom Portal infrastructure panel.
"""

import json
import logging
import os
import subprocess
from typing import Optional

import docker
import psutil
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.db.connection import get_connection

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/infra", tags=["infra"])


class InfraNode(BaseModel):
    """Request schema for adding a new infrastructure node."""
    name: str
    tailscale_ip: str
    docker_port: int = 2375
    role: str = "agent"


@router.get("/containers")
async def get_containers():
    """List Docker containers on local cyberdeck."""
    try:
        client = docker.from_env()
        containers = []
        for c in client.containers.list():
            containers.append({
                "id": c.id[:12],
                "name": c.name,
                "image": c.image.tags[0] if c.image.tags else c.image.id[:12],
                "status": c.status,
                "ports": c.ports,
                "created": c.attrs['Created'],
            })
        return {"containers": containers}
    except Exception as e:
        log.error(f"Error fetching containers: {e}")
        return JSONResponse(status_code=503, content={"error": str(e)})


@router.get("/metrics")
async def get_metrics():
    """System metrics: CPU, RAM, disk for local cyberdeck."""
    try:
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        return {
            "cpu_percent": cpu_percent,
            "memory_percent": memory.percent,
            "memory_available_gb": round(memory.available / (1024**3), 2),
            "disk_percent": disk.percent,
            "disk_free_gb": round(disk.free / (1024**3), 2),
        }
    except Exception as e:
        log.error(f"Error fetching metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metrics")


@router.get("/k3s/nodes")
async def get_k3s_nodes():
    """List k3s nodes; returns 503 if k3s not installed."""
    try:
        env = os.environ.copy()
        env['KUBECONFIG'] = '/etc/rancher/k3s/k3s.yaml'

        result = subprocess.run(
            ["/usr/local/bin/kubectl", "get", "nodes", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=5,
            env=env
        )
        if result.returncode != 0:
            raise RuntimeError(f"kubectl failed: {result.stderr}")

        nodes_data = json.loads(result.stdout)
        nodes = []
        for item in nodes_data.get('items', []):
            status_type = item['status']['conditions'][-1]['type'] if item['status']['conditions'] else 'Unknown'
            nodes.append({
                "name": item['metadata']['name'],
                "role": item['metadata']['labels'].get('node-role.kubernetes.io/master', 'agent'),
                "status": status_type,
            })
        return {"nodes": nodes}
    except FileNotFoundError as e:
        log.error(f"kubectl not found: {e}")
        return JSONResponse(status_code=503, content={"error": "k3s not installed"})
    except Exception as e:
        log.error(f"Error fetching k3s nodes: {e}", exc_info=True)
        return JSONResponse(status_code=503, content={"error": f"k3s error: {str(e)}"})


@router.post("/nodes")
async def add_node(node: InfraNode):
    """Add a new infrastructure node to the cluster."""
    db = await get_connection()
    try:
        await db.execute(
            "INSERT INTO infra_nodes (name, tailscale_ip, docker_port, role) VALUES (?, ?, ?, ?)",
            (node.name, node.tailscale_ip, node.docker_port, node.role)
        )
        await db.commit()
        log.info(f"Added infra node: {node.name}")
        return {"status": "added", "node": node.dict()}
    except Exception as e:
        log.error(f"Error adding node: {e}")
        raise HTTPException(status_code=400, detail="Failed to add node")
    finally:
        await db.close()


@router.get("/nodes")
async def list_nodes():
    """List all infrastructure nodes."""
    db = await get_connection()
    try:
        cursor = await db.execute(
            "SELECT id, name, tailscale_ip, docker_port, role, enabled FROM infra_nodes"
        )
        rows = await cursor.fetchall()
        nodes = []
        for row in rows:
            nodes.append({
                "id": row[0],
                "name": row[1],
                "tailscale_ip": row[2],
                "docker_port": row[3],
                "role": row[4],
                "enabled": bool(row[5]),
            })
        return {"nodes": nodes}
    except Exception as e:
        log.error(f"Error fetching nodes: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch nodes")
    finally:
        await db.close()
