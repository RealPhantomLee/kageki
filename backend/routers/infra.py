"""
Infrastructure node management and monitoring.
Provides Docker, k3s, and system metrics for the Phantom Portal infrastructure panel.
"""

import asyncio
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
        loop = asyncio.get_event_loop()

        for c in client.containers.list(all=True):
            # Determine status: docker-py returns "running", "exited", "paused", etc.
            container_status = c.status

            # Fetch logs, volumes, and env in executor to avoid blocking
            def get_container_details(container):
                logs = container.logs(tail=50).decode("utf-8", errors="replace")
                volumes = [
                    {"source": m["Source"], "dest": m["Destination"]}
                    for m in (container.attrs.get("Mounts") or [])
                ]
                env = container.attrs.get("Config", {}).get("Env") or []
                return logs, volumes, env

            logs, volumes, env = await loop.run_in_executor(None, get_container_details, c)

            containers.append({
                "id": c.id[:12],
                "name": c.name,
                "image": c.image.tags[0] if c.image.tags else c.image.id[:12],
                "status": container_status,
                "state": c.status,
                "ports": c.ports,
                "created": c.attrs['Created'],
                "logs": logs,
                "volumes": volumes,
                "env": env,
            })
        return {"containers": containers}
    except Exception as e:
        log.error(f"Error fetching containers: {e}")
        return JSONResponse(status_code=503, content={"error": str(e)})


@router.get("/metrics")
async def get_metrics():
    """System metrics: CPU, RAM, disk for local cyberdeck."""
    try:
        loop = asyncio.get_event_loop()
        cpu_percent = await loop.run_in_executor(None, psutil.cpu_percent, None)
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
            # Check for k3s role labels (values are "true", but we want the role name)
            labels = item['metadata']['labels']
            if 'node-role.kubernetes.io/control-plane' in labels:
                role = 'control-plane'
            elif 'node-role.kubernetes.io/master' in labels:
                role = 'master'
            else:
                role = 'agent'

            nodes.append({
                "name": item['metadata']['name'],
                "role": role,
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


@router.post("/containers/{name}/start")
async def start_container(name: str):
    """Start a Docker container."""
    try:
        client = docker.from_env()
        container = client.containers.get(name)
        container.start()
        log.info(f"Started container: {name}")
        return {"status": "success", "state": "running"}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail=f"Container '{name}' not found")
    except Exception as e:
        log.error(f"Error starting container {name}: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to start container: {str(e)}")


@router.post("/containers/{name}/stop")
async def stop_container(name: str):
    """Stop a Docker container."""
    try:
        client = docker.from_env()
        container = client.containers.get(name)
        container.stop()
        log.info(f"Stopped container: {name}")
        return {"status": "success", "state": "exited"}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail=f"Container '{name}' not found")
    except Exception as e:
        log.error(f"Error stopping container {name}: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to stop container: {str(e)}")


@router.post("/containers/{name}/restart")
async def restart_container(name: str):
    """Restart a Docker container."""
    try:
        client = docker.from_env()
        container = client.containers.get(name)
        container.restart()
        log.info(f"Restarted container: {name}")
        return {"status": "success", "state": "running"}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail=f"Container '{name}' not found")
    except Exception as e:
        log.error(f"Error restarting container {name}: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to restart container: {str(e)}")
