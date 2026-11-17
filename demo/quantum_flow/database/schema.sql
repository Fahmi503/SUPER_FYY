-- Synthetic Workflow Events Table
CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
