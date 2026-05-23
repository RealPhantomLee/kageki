import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Cpu, HardDrive, Zap, Container, AlertCircle, ExternalLink, X, ChevronDown, Download } from 'lucide-react';
import { api } from '../api/client';

interface ServiceLink {
  port: number;
  label: string;
}

interface ModalContainer {
  id: string;
  name: string;
  status: string;
  image: string;
  created?: string;
  ports?: string[];
  env?: string[];
  volumes?: string[];
  logs?: string[];
}

const SERVICE_LINKS: Record<string, ServiceLink> = {
  'grafana': { port: 3030, label: 'Grafana' },
  'gitea': { port: 3003, label: 'Gitea' },
  'prometheus': { port: 9091, label: 'Prometheus' },
  'node-red': { port: 1880, label: 'Node Red' },
  'portainer': { port: 9000, label: 'Portainer' },
  'pihole': { port: 80, label: 'Pi-hole' },
  'home-assistant': { port: 8123, label: 'Home Assistant' },
};

export const InfraPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'docker' | 'system' | 'k3s' | 'cluster'>('docker');
  const [containers, setContainers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [k3sNodes, setK3sNodes] = useState<any[]>([]);
  const [clusterStatus, setClusterStatus] = useState<any>(null);
  const [clusterRouteInfo, setClusterRouteInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlError, setControlError] = useState('');
  const [selectedContainer, setSelectedContainer] = useState<ModalContainer | null>(null);
  const [controllingContainer, setControllingContainer] = useState<string | null>(null);
  const [pullModelDialog, setPullModelDialog] = useState<{ node: string } | null>(null);
  const [pullModelName, setPullModelName] = useState('');
  const [selectedPullNode, setSelectedPullNode] = useState('');
  const [routeDropdownOpen, setRouteDropdownOpen] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [containerRes, metricsRes, k3sRes, clusterRes, routeRes] = await Promise.all([
        axios.get('/api/infra/containers'),
        axios.get('/api/infra/metrics'),
        axios.get('/api/infra/k3s/nodes'),
        api.cluster.status(),
        api.cluster.routeInfo(),
      ]);
      setContainers(containerRes.data.containers || []);
      setMetrics(metricsRes.data);
      setK3sNodes(k3sRes.data.nodes || []);
      setClusterStatus(clusterRes.data);
      setClusterRouteInfo(routeRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchData();

    // Poll every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleContainerControl = async (containerName: string, action: 'start' | 'stop' | 'restart') => {
    try {
      setControllingContainer(containerName);
      setControlError('');
      await axios.post(`/api/infra/containers/${containerName}/${action}`);
      // Refresh container list
      await fetchData();
    } catch (err: any) {
      setControlError(`Failed to ${action} ${containerName}: ${err.response?.data?.error || err.message}`);
    } finally {
      setControllingContainer(null);
    }
  };

  const isButtonDisabled = (status: string, action: string): boolean => {
    const isRunning = status.includes('running');
    if (action === 'start') return isRunning;
    if (action === 'stop') return !isRunning;
    return false; // restart always enabled
  };

  const handlePullModel = async () => {
    if (!pullModelName || !selectedPullNode) return;
    try {
      await api.cluster.pullModel(pullModelName, selectedPullNode);
      setPullModelDialog(null);
      setPullModelName('');
      setSelectedPullNode('');
      await fetchData();
    } catch (err: any) {
      setControlError(`Failed to pull model: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSetRoute = async (type: 'llm' | 'embeddings', targetNode: string) => {
    try {
      await api.cluster.setRoute(type, targetNode);
      setRouteDropdownOpen(null);
      await fetchData();
    } catch (err: any) {
      setControlError(`Failed to set route: ${err.response?.data?.error || err.message}`);
    }
  };

  const openContainerDetails = (c: any) => {
    setSelectedContainer({
      id: c.id,
      name: c.name,
      status: c.status,
      image: c.image,
      created: c.created,
      ports: c.ports || [],
      env: (c.env || []).slice(0, 5),
      volumes: c.volumes || [],
      logs: c.logs || [],
    });
  };

  if (loading && !metrics) return <div className="p-4 text-obsidian-text">Loading...</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-obsidian-bg">
      {/* Header with Tabs */}
      <div className="glass-card p-4 border-b border-obsidian-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-obsidian-text">Infrastructure</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('docker')}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === 'docker'
                ? 'bg-obsidian-accent text-obsidian-bg'
                : 'bg-obsidian-bg-secondary text-obsidian-text hover:bg-obsidian-bg-secondary/80'
            }`}
          >
            Docker
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === 'system'
                ? 'bg-obsidian-accent text-obsidian-bg'
                : 'bg-obsidian-bg-secondary text-obsidian-text hover:bg-obsidian-bg-secondary/80'
            }`}
          >
            System
          </button>
          <button
            onClick={() => setActiveTab('k3s')}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === 'k3s'
                ? 'bg-obsidian-accent text-obsidian-bg'
                : 'bg-obsidian-bg-secondary text-obsidian-text hover:bg-obsidian-bg-secondary/80'
            }`}
          >
            K3s
          </button>
          <button
            onClick={() => setActiveTab('cluster')}
            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === 'cluster'
                ? 'bg-obsidian-accent text-obsidian-bg'
                : 'bg-obsidian-bg-secondary text-obsidian-text hover:bg-obsidian-bg-secondary/80'
            }`}
          >
            Cluster
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-obsidian-error/10 border border-obsidian-error text-obsidian-error">
          {error}
        </div>
      )}

      {controlError && (
        <div className="p-4 bg-obsidian-error/10 border border-obsidian-error text-obsidian-error flex justify-between items-center">
          <span>{controlError}</span>
          <button onClick={() => setControlError('')} className="text-obsidian-error hover:text-obsidian-error/80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* System Metrics - System Tab */}
      {activeTab === 'system' && metrics && (
        <div className="p-4 grid grid-cols-3 gap-3">
          <div className="glass-card p-3 rounded border border-obsidian-border">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-4 h-4 text-obsidian-accent" />
              <span className="text-sm text-obsidian-text-muted">CPU</span>
            </div>
            <div className="text-2xl font-bold text-obsidian-text">{metrics.cpu_percent}%</div>
            <div className="h-1 bg-obsidian-border rounded mt-2 overflow-hidden">
              <div
                className="h-full bg-obsidian-accent"
                style={{ width: `${metrics.cpu_percent}%` }}
              />
            </div>
          </div>

          <div className="glass-card p-3 rounded border border-obsidian-border">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="w-4 h-4 text-obsidian-warning" />
              <span className="text-sm text-obsidian-text-muted">RAM</span>
            </div>
            <div className="text-2xl font-bold text-obsidian-text">{metrics.memory_percent}%</div>
            <div className="h-1 bg-obsidian-border rounded mt-2 overflow-hidden">
              <div
                className="h-full bg-obsidian-warning"
                style={{ width: `${metrics.memory_percent}%` }}
              />
            </div>
          </div>

          <div className="glass-card p-3 rounded border border-obsidian-border">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-obsidian-error" />
              <span className="text-sm text-obsidian-text-muted">DISK</span>
            </div>
            <div className="text-2xl font-bold text-obsidian-text">{metrics.disk_percent}%</div>
            <div className="h-1 bg-obsidian-border rounded mt-2 overflow-hidden">
              <div
                className="h-full bg-obsidian-error"
                style={{ width: `${metrics.disk_percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Containers Section - Docker Tab */}
      {activeTab === 'docker' && (
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        <h3 className="font-semibold text-obsidian-text mb-3">Containers ({containers.length})</h3>
        <div className="flex-1 overflow-y-auto h-full space-y-2">
          {containers.map((c) => {
            const isRunning = c.status.includes('running');
            const serviceKey = Object.keys(SERVICE_LINKS).find(key => c.name.includes(key));
            const serviceLink = serviceKey ? SERVICE_LINKS[serviceKey] : null;

            return (
              <div
                key={c.id}
                className={`glass-card p-3 rounded border border-obsidian-border text-sm transition-all hover:shadow-lg hover:shadow-obsidian-accent/20 cursor-pointer ${
                  !isRunning ? 'opacity-60' : ''
                }`}
                onClick={() => openContainerDetails(c)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className={`w-2 h-2 rounded-full transition-colors ${isRunning ? 'bg-obsidian-success' : 'bg-obsidian-error'}`} />
                    <span className="font-mono text-obsidian-text">{c.name}</span>
                    {isRunning ? (
                      <Badge className="bg-obsidian-success text-xs">Running</Badge>
                    ) : (
                      <Badge className="bg-obsidian-error text-xs">Stopped</Badge>
                    )}
                  </div>
                </div>

                <div className="text-xs text-obsidian-text-muted mb-2">{c.image}</div>

                {/* Control Buttons and Service Links */}
                <div className="flex gap-2 flex-wrap items-center">
                  <Button
                    size="sm"
                    variant={isRunning ? 'outline' : 'default'}
                    onClick={(e) => { e.stopPropagation(); handleContainerControl(c.name, 'start'); }}
                    disabled={isButtonDisabled(c.status, 'start') || controllingContainer === c.name}
                    className="text-xs"
                  >
                    {controllingContainer === c.name ? '...' : 'Start'}
                  </Button>

                  <Button
                    size="sm"
                    variant={isRunning ? 'default' : 'outline'}
                    onClick={(e) => { e.stopPropagation(); handleContainerControl(c.name, 'stop'); }}
                    disabled={isButtonDisabled(c.status, 'stop') || controllingContainer === c.name}
                    className="text-xs"
                  >
                    {controllingContainer === c.name ? '...' : 'Stop'}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); handleContainerControl(c.name, 'restart'); }}
                    disabled={controllingContainer === c.name}
                    className="text-xs"
                  >
                    {controllingContainer === c.name ? '...' : 'Restart'}
                  </Button>

                  {serviceLink && isRunning && (
                    <a
                      href={`http://100.121.96.1:${serviceLink.port}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="outline" className="text-xs gap-1">
                        <ExternalLink className="w-3 h-3" />
                        {serviceLink.label}
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* k3s Nodes Section - K3s Tab */}
      {activeTab === 'k3s' && k3sNodes.length > 0 && (
        <div className="p-4 flex-1 flex flex-col overflow-hidden">
          <h3 className="font-semibold text-obsidian-text mb-3">K3s Nodes</h3>
          <div className="overflow-y-auto h-full space-y-2">
            {k3sNodes.map((node, idx) => (
              <div key={idx} className="glass-card p-2 rounded border border-obsidian-border text-xs">
                <div className="flex justify-between">
                  <span className="text-obsidian-text">{node.name}</span>
                  <Badge className="bg-obsidian-success text-xs">{node.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cluster Tab */}
      {activeTab === 'cluster' && clusterStatus && (
        <div className="flex-1 flex flex-col overflow-hidden p-4">
          {/* Pool Summary */}
          <div className="glass-card p-3 rounded border border-obsidian-border mb-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-obsidian-accent font-semibold">●</span>
                <span className="text-obsidian-text ml-2">{clusterStatus.pool.online_nodes} online nodes</span>
              </div>
              <div className="text-sm text-obsidian-text-muted">
                {clusterStatus.pool.total_cpu_cores} CPU / {Math.round(clusterStatus.pool.total_ram_mb / 1024)}GB RAM
              </div>
            </div>
          </div>

          {/* Node Cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {clusterStatus.nodes.map((node: any) => (
              <div key={node.name} className={`glass-card p-3 rounded border ${node.online ? 'border-obsidian-accent' : 'border-obsidian-error/30'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-obsidian-text text-sm">{node.name}</h4>
                    <p className="text-xs text-obsidian-text-muted">{node.address}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <Badge className={`text-xs ${node.online ? 'bg-obsidian-success' : 'bg-obsidian-error'}`}>
                      {node.role}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2 text-xs mb-3">
                  {node.online ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-obsidian-text-muted">CPU:</span>
                        <span className="text-obsidian-text">{node.cpu_percent ?? 'N/A'}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-obsidian-text-muted">RAM:</span>
                        <span className="text-obsidian-text">{node.ram_used_mb ?? 0}MB / {node.ram_total_mb ?? 0}MB</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-obsidian-error text-xs">Offline</div>
                  )}
                </div>

                <div className="mb-3 pb-3 border-b border-obsidian-border">
                  <div className="flex items-center gap-1 mb-2">
                    <div className={`w-2 h-2 rounded-full ${node.ollama_online ? 'bg-obsidian-success' : 'bg-obsidian-error'}`} />
                    <span className="text-xs text-obsidian-text-muted">Ollama</span>
                  </div>
                  {node.ollama_models.length > 0 ? (
                    <div className="space-y-1">
                      {node.ollama_models.map((model: string, idx: number) => (
                        <div key={idx} className="text-xs text-obsidian-text bg-obsidian-bg-secondary px-2 py-1 rounded">
                          {model}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-obsidian-text-muted">No models</div>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1"
                  onClick={() => {
                    setPullModelDialog({ node: node.name });
                    setSelectedPullNode(node.name);
                  }}
                  disabled={!node.online}
                >
                  <Download className="w-3 h-3" />
                  Pull Model
                </Button>
              </div>
            ))}
          </div>

          {/* Routing Rules */}
          <div className="glass-card p-3 rounded border border-obsidian-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-obsidian-text text-sm">Routing Rules</h4>
              <span className="text-xs text-obsidian-text-muted">[Auto-updates every 15s]</span>
            </div>

            <div className="space-y-2">
              {/* LLM Route */}
              <div className="flex items-center justify-between p-2 bg-obsidian-bg-secondary rounded text-sm">
                <span className="text-obsidian-text">LLM requests</span>
                <div className="relative">
                  <button
                    onClick={() => setRouteDropdownOpen(routeDropdownOpen === 'llm' ? null : 'llm')}
                    className="flex items-center gap-1 px-2 py-1 bg-obsidian-accent text-obsidian-bg rounded text-xs font-medium"
                  >
                    {clusterStatus.routing.llm_node}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {routeDropdownOpen === 'llm' && (
                    <div className="absolute right-0 mt-1 bg-obsidian-bg-secondary border border-obsidian-border rounded shadow-lg z-10 min-w-32">
                      {clusterStatus.nodes
                        .filter((n: any) => n.online)
                        .map((n: any) => (
                          <button
                            key={n.name}
                            onClick={() => handleSetRoute('llm', n.name)}
                            className="block w-full text-left px-3 py-2 text-xs text-obsidian-text hover:bg-obsidian-accent/20"
                          >
                            {n.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Embeddings Route */}
              <div className="flex items-center justify-between p-2 bg-obsidian-bg-secondary rounded text-sm">
                <span className="text-obsidian-text">Embeddings</span>
                <div className="relative">
                  <button
                    onClick={() => setRouteDropdownOpen(routeDropdownOpen === 'embeddings' ? null : 'embeddings')}
                    className="flex items-center gap-1 px-2 py-1 bg-obsidian-accent text-obsidian-bg rounded text-xs font-medium"
                  >
                    {clusterStatus.routing.embeddings_node}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {routeDropdownOpen === 'embeddings' && (
                    <div className="absolute right-0 mt-1 bg-obsidian-bg-secondary border border-obsidian-border rounded shadow-lg z-10 min-w-32">
                      {clusterStatus.nodes
                        .filter((n: any) => n.online)
                        .map((n: any) => (
                          <button
                            key={n.name}
                            onClick={() => handleSetRoute('embeddings', n.name)}
                            className="block w-full text-left px-3 py-2 text-xs text-obsidian-text hover:bg-obsidian-accent/20"
                          >
                            {n.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-xs text-obsidian-text-muted pt-1">
                Fallback: {clusterStatus.routing.fallback_node}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pull Model Dialog */}
      {pullModelDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setPullModelDialog(null)}
        >
          <div
            className="bg-obsidian-bg border border-obsidian-border rounded-lg max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-obsidian-border">
              <h2 className="text-lg font-bold text-obsidian-text">Pull Model</h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-obsidian-text-muted mb-1">
                  Model Name
                </label>
                <input
                  type="text"
                  value={pullModelName}
                  onChange={(e) => setPullModelName(e.target.value)}
                  placeholder="e.g., qwen2.5:1.5b"
                  className="w-full px-3 py-2 bg-obsidian-bg-secondary border border-obsidian-border rounded text-obsidian-text text-sm focus:outline-none focus:border-obsidian-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-obsidian-text-muted mb-1">
                  Target Node
                </label>
                <select
                  value={selectedPullNode}
                  onChange={(e) => setSelectedPullNode(e.target.value)}
                  className="w-full px-3 py-2 bg-obsidian-bg-secondary border border-obsidian-border rounded text-obsidian-text text-sm focus:outline-none focus:border-obsidian-accent"
                >
                  <option value="">Select node...</option>
                  {clusterStatus?.nodes
                    .filter((n: any) => n.online)
                    .map((n: any) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-obsidian-border">
              <Button onClick={() => setPullModelDialog(null)} variant="outline" className="flex-1 text-xs">
                Cancel
              </Button>
              <Button
                onClick={handlePullModel}
                disabled={!pullModelName || !selectedPullNode}
                className="flex-1 text-xs"
              >
                Pull
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Container Details Modal */}
      {selectedContainer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedContainer(null)}
        >
          <div
            className="bg-obsidian-bg border border-obsidian-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between p-4 border-b border-obsidian-border bg-obsidian-bg/95 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${selectedContainer.status.includes('running') ? 'bg-obsidian-success' : 'bg-obsidian-error'}`} />
                <h2 className="text-lg font-bold text-obsidian-text">{selectedContainer.name}</h2>
              </div>
              <button
                onClick={() => setSelectedContainer(null)}
                className="text-obsidian-text-muted hover:text-obsidian-text transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 space-y-4">
              {/* Status & Image */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Status</h3>
                  <Badge className={selectedContainer.status.includes('running') ? 'bg-obsidian-success' : 'bg-obsidian-error'}>
                    {selectedContainer.status.includes('running') ? 'Running' : 'Stopped'}
                  </Badge>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Created</h3>
                  <p className="text-sm text-obsidian-text font-mono">{selectedContainer.created || 'N/A'}</p>
                </div>
              </div>

              {/* Image */}
              <div>
                <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Image</h3>
                <p className="text-sm text-obsidian-text font-mono break-all">{selectedContainer.image}</p>
              </div>

              {/* Container ID */}
              <div>
                <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Container ID</h3>
                <p className="text-sm text-obsidian-text font-mono">{selectedContainer.id.substring(0, 12)}</p>
              </div>

              {/* Ports */}
              {selectedContainer.ports && selectedContainer.ports.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Port Mappings</h3>
                  <div className="space-y-1">
                    {selectedContainer.ports.map((port, idx) => (
                      <p key={idx} className="text-sm text-obsidian-text font-mono">
                        {port}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Environment Variables */}
              {selectedContainer.env && selectedContainer.env.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">
                    Environment Variables ({selectedContainer.env.length})
                  </h3>
                  <div className="bg-obsidian-bg-secondary rounded p-2 max-h-32 overflow-y-auto space-y-1">
                    {selectedContainer.env.map((e, idx) => (
                      <p key={idx} className="text-xs text-obsidian-text font-mono break-all">
                        {e}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Volumes */}
              {selectedContainer.volumes && selectedContainer.volumes.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Volumes</h3>
                  <div className="space-y-1">
                    {selectedContainer.volumes.map((vol, idx) => (
                      <p key={idx} className="text-sm text-obsidian-text font-mono break-all">
                        {vol}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Logs */}
              {selectedContainer.logs && selectedContainer.logs.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-obsidian-text-muted mb-1">Recent Logs</h3>
                  <div className="bg-obsidian-bg-secondary rounded p-2 max-h-40 overflow-y-auto">
                    <pre className="text-xs text-obsidian-text-muted font-mono whitespace-pre-wrap break-words">
                      {selectedContainer.logs.join('\n')}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 flex gap-2 p-4 border-t border-obsidian-border bg-obsidian-bg/95 backdrop-blur">
              <Button onClick={() => setSelectedContainer(null)} variant="outline" className="flex-1">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
