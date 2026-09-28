#!/bin/sh
# Database backups for Docker Compose (the `backup` service).
#   sh /backup.sh          run forever: a dump now if today has none, then daily at BACKUP_HOUR
#   sh /backup.sh once     one dump now, then exit
# Dumps are pg_dump custom format (restore with pg_restore), written to /backups and
# pruned to the newest BACKUP_KEEP. Connection settings come from PGHOST/PGUSER/
# PGPASSWORD/PGDATABASE.
set -eu

DIR=/backups
KEEP="${BACKUP_KEEP:-30}"
HOUR="${BACKUP_HOUR:-3}"

dump() {
  name="rxplus-$(date +%Y-%m-%d-%H%M%S).dump"
  # Write to a temporary name first, so a half-written file never looks like a backup.
  pg_dump --format=custom --file="$DIR/.$name.partial"
  mv "$DIR/.$name.partial" "$DIR/$name"
  echo "[backup] wrote $name ($(du -h "$DIR/$name" | cut -f1))"
  # Keep the newest $KEEP dumps.
  ls -1t "$DIR"/rxplus-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" && echo "[backup] removed $(basename "$old")"
  done
}

if [ "${1:-}" = once ]; then
  dump
  exit 0
fi

while true; do
  if ! ls "$DIR"/rxplus-"$(date +%Y-%m-%d)"-*.dump >/dev/null 2>&1; then
    dump || echo "[backup] failed; will try again at the next run"
  fi
  # Sleep until the next BACKUP_HOUR:00 (server time zone, TZ).
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $HOUR:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump || echo "[backup] failed; will try again tomorrow"
done
