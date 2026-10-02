CREATE TABLE model_connections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  provider text NOT NULL,
  auth_mode text NOT NULL CHECK (auth_mode IN ('api_key', 'oauth')),
  model_id text NOT NULL,
  base_url text,
  credential text,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_connections_active ON model_connections(active) WHERE active;
