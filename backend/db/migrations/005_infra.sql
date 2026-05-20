CREATE TABLE IF NOT EXISTS infra_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    tailscale_ip TEXT NOT NULL,
    docker_port INTEGER DEFAULT 2375,
    role TEXT DEFAULT 'agent',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed the local cyberdeck node (port 0 means use local Unix socket)
INSERT OR IGNORE INTO infra_nodes (name, tailscale_ip, docker_port, role, enabled)
VALUES ('cyberdeck', '100.121.96.1', 0, 'server', 1);
