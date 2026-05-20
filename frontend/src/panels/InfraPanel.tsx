import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Cpu, HardDrive, Zap, Container, AlertCircle } from 'lucide-react';

export const InfraPanel: React.FC = () => {
  const [containers, setContainers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [k3sNodes, setK3sNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [containerRes, metricsRes, k3sRes] = await Promise.all([
          axios.get('/api/infra/containers'),
          axios.get('/api/infra/metrics'),
          axios.get('/api/infra/k3s/nodes'),
        ]);
        setContainers(containerRes.data.containers || []);
        setMetrics(metricsRes.data);
        setK3sNodes(k3sRes.data.nodes || []);
      } catch (err: any) {
        setError(err.response?.data?.error || String(err));
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !metrics) return <div className="p-4 text-obsidian-text">Loading...</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-obsidian-bg">
      {/* Header */}
      <div className="p-4 border-b border-obsidian-border">
        <h2 className="text-xl font-bold text-obsidian-text">Infrastructure</h2>
      </div>

      {error && (
        <div className="p-4 bg-obsidian-error/10 border border-obsidian-error text-obsidian-error">
          {error}
        </div>
      )}

      {/* System Metrics */}
      {metrics && (
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

      {/* Containers Section */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        <h3 className="font-semibold text-obsidian-text mb-3">Containers ({containers.length})</h3>
        <div className="flex-1 overflow-y-auto space-y-2">
          {containers.map((c) => (
            <div key={c.id} className="glass-card p-3 rounded border border-obsidian-border text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <Container className="w-4 h-4 text-obsidian-accent" />
                  <span className="font-mono text-obsidian-text">{c.name}</span>
                  {c.status.includes('running') ? (
                    <Badge className="bg-obsidian-success text-xs">Running</Badge>
                  ) : (
                    <Badge className="bg-obsidian-error text-xs">Stopped</Badge>
                  )}
                </div>
              </div>
              <div className="text-xs text-obsidian-text-muted mt-1">{c.image}</div>
            </div>
          ))}
        </div>
      </div>

      {/* k3s Nodes Section */}
      {k3sNodes.length > 0 && (
        <div className="p-4 border-t border-obsidian-border">
          <h3 className="font-semibold text-obsidian-text mb-3">K3s Nodes</h3>
          <div className="space-y-2">
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
    </div>
  );
};
