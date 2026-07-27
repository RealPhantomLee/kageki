-- Canvas nodes: spatial arrangement of notes on a 2D canvas
CREATE TABLE IF NOT EXISTS canvas_nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    canvas_id TEXT NOT NULL,
    note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    width REAL NOT NULL DEFAULT 320,
    height REAL NOT NULL DEFAULT 180,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas_id ON canvas_nodes(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_note_id ON canvas_nodes(note_id);
