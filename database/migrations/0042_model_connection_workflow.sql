ALTER TABLE model_connections ADD COLUMN login_status text NOT NULL DEFAULT 'idle';
ALTER TABLE model_connections ADD COLUMN login_error text;
ALTER TABLE model_connections ADD COLUMN verified_at timestamptz;
CREATE TABLE model_connection_tasks (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES model_connections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify','bootstrap')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','failed')),
  error text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_connection_tasks_pending ON model_connection_tasks(connection_id,kind) WHERE status IN ('queued','running');
