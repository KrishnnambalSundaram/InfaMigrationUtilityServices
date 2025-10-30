#!/usr/bin/env bash
set -euo pipefail

HOST=example.redshift.amazonaws.com
DB=analytics
USER=admin

psql -h "$HOST" -U "$USER" -d "$DB" <<'SQL'
\timing on
BEGIN;
CREATE TEMP TABLE tmp_recent AS
SELECT * FROM orders WHERE created_date >= current_date - interval '30 day';
SELECT user_id, COUNT(*) AS cnt FROM tmp_recent GROUP BY user_id ORDER BY cnt DESC LIMIT 10;
ROLLBACK;
SQL

exit 0

