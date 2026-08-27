#!/usr/bin/env bash
set -euo pipefail

# Start local Plexus GraphQL as a host uvicorn process with Virtuus file storage.
# No Docker, Compose, Postgres, MinIO, or Qdrant.
#
# Required:
#   PLEXUS_ROOT — Plexus checkout containing services/private-graphql-proxy
#     Example: /path/to/Plexus
#
# Optional:
#   PLEXUS_DATA_DIR or PLEXUS_VIRTUUS_DATA_DIR — data directory (default: .plexus/data)
#   PLEXUS_GRAPHQL_HOST — bind address (default: 127.0.0.1)
#   PLEXUS_GRAPHQL_PORT — listen port (default: 8000)
#   PYTHON — Python interpreter (default: python3 from PATH)

: "${PLEXUS_ROOT:?PLEXUS_ROOT must be set to a Plexus checkout containing services/private-graphql-proxy}"

PORT="${PLEXUS_GRAPHQL_PORT:-8000}"
HOST="${PLEXUS_GRAPHQL_HOST:-127.0.0.1}"
DATA_DIR="${PLEXUS_DATA_DIR:-${PLEXUS_VIRTUUS_DATA_DIR:-.plexus/data}}"
PYTHON="${PYTHON:-python3}"

PROXY_DIR="${PLEXUS_ROOT}/services/private-graphql-proxy"
if [[ ! -d "${PROXY_DIR}" ]]; then
  echo "error: ${PROXY_DIR} not found; set PLEXUS_ROOT to a valid Plexus checkout" >&2
  exit 1
fi

export PLEXUS_STORE=virtuus
export PLEXUS_DATA_DIR="${DATA_DIR}"
export PLEXUS_BACKEND_MODE=local
export PLEXUS_PROXY_UPSTREAM_DISABLED=true
export PLEXUS_PROXY_AUTH_MODE=trusted_open
unset PLEXUS_PROXY_DATABASE_URL

export PYTHONPATH="${PROXY_DIR}${PYTHONPATH:+:${PYTHONPATH}}"

exec "${PYTHON}" -m uvicorn proxy.app:app \
  --host "${HOST}" \
  --port "${PORT}" \
  --workers 1
