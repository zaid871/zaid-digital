#!/usr/bin/env bash
#
# Asset retention cleanup for the AI Product-to-Video Automation Platform.
#
# Policy (see OPS.md "Media retention"):
#   - Intermediate/temp files (scene clips, end-cards, work dirs, *.tmp):
#     deleted after RETENTION_TEMP_DAYS  (default 7)
#   - Finished job directories (final.mp4 + captions.srt/vtt): the whole
#     directory is deleted once NOTHING in it was modified for
#     RETENTION_FINAL_DAYS (default 90)
#
# DRY-RUN BY DEFAULT. Pass --apply to actually delete.
# Run weekly, e.g. via cron on the host or a compose profile service:
#   0 3 * * 0  ASSETS_DIR=/var/lib/pv-assets /opt/product-video-platform/scripts/cleanup-assets.sh --apply >> /var/log/pv-cleanup.log 2>&1
#
set -euo pipefail

ASSETS_DIR="${ASSETS_DIR:-/app/storage/jobs}"
RETENTION_TEMP_DAYS="${RETENTION_TEMP_DAYS:-7}"
RETENTION_FINAL_DAYS="${RETENTION_FINAL_DAYS:-90}"
APPLY=false
if [[ "${1:-}" == "--apply" ]]; then APPLY=true; fi

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ASSETS_DIR not found: $ASSETS_DIR (nothing to clean)"
  exit 0
fi

echo "Assets root : $ASSETS_DIR"
echo "Temp files  : older than ${RETENTION_TEMP_DAYS}d will be removed"
echo "Job dirs    : fully removed when untouched for ${RETENTION_FINAL_DAYS}d"
echo "Mode        : $( $APPLY && echo APPLY || echo DRY-RUN )"
echo

# --- 1. Intermediate / temp files -------------------------------------------
# Matches scene intermediates, end-cards, concat lists, tmp files — never
# final.mp4 or captions (those define a finished job's lifetime).
TEMP_RE='.*\(scene-.*\|endcard.*\|video_full.*\|concat.*\.txt\|.*\.tmp\|.*\.part\)$'

temp_count=0
while IFS= read -r -d '' f; do
  temp_count=$((temp_count + 1))
  if $APPLY; then rm -f -- "$f"; echo "DEL temp: $f"; else echo "would delete temp: $f"; fi
done < <(find "$ASSETS_DIR" -type f -regextype posix-extended -regex "$TEMP_RE" -mtime +"$RETENTION_TEMP_DAYS" -print0 2>/dev/null || true)

# --- 2. Stale finished job directories ---------------------------------------
# A job dir dies only when its NEWEST file is older than RETENTION_FINAL_DAYS.
job_count=0
while IFS= read -r -d '' d; do
  # Skip the root itself
  [[ "$d" == "$ASSETS_DIR" ]] && continue
  newest=$(find "$d" -maxdepth 1 -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1 || true)
  if [[ -z "$newest" ]]; then
    # Empty dir — remove it (cheap, safe)
    job_count=$((job_count + 1))
    if $APPLY; then rmdir -- "$d" 2>/dev/null && echo "DEL empty dir: $d" || true
    else echo "would delete empty dir: $d"; fi
    continue
  fi
  cutoff=$(date -d "-${RETENTION_FINAL_DAYS} days" +%s)
  newest_int=${newest%.*}
  if (( newest_int < cutoff )); then
    job_count=$((job_count + 1))
    if $APPLY; then rm -rf -- "$d"; echo "DEL job dir: $d"; else echo "would delete job dir: $d"; fi
  fi
done < <(find "$ASSETS_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null || true)

echo
echo "Summary: $temp_count temp file(s), $job_count job dir(s) $( $APPLY && echo removed || echo 'would be removed' )."
if ! $APPLY; then
  echo "Re-run with --apply to delete. No changes were made."
fi
