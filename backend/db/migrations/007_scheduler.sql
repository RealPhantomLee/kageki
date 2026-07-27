-- Scheduled task registry: one row per named task, tracks run history
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    name TEXT PRIMARY KEY,
    last_run_at TEXT,
    last_status TEXT,           -- 'success' | 'error' | 'running'
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT
);

-- Initialize known tasks so the frontend can display them immediately
INSERT OR IGNORE INTO scheduled_tasks (name) VALUES
    ('daily_note_and_health'),
    ('hourly_embedding_sync'),
    ('weekly_maintenance');

-- Scheduler execution log: one row per task run
CREATE TABLE IF NOT EXISTS scheduler_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NOT NULL,
    ran_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL,       -- 'success' | 'error'
    message TEXT,
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scheduler_logs_task ON scheduler_logs(task_name, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_logs_ran_at ON scheduler_logs(ran_at DESC);
