#!/usr/bin/env bash
# macOS: create a shared drop folder for file ingestion and point the backend at it.
# Usage (from the repo root):  ./scripts/setup_shared_folder.sh [folder]     default: ~/BankDrop
#
# Creates <folder>/incoming, <folder>/processed, <folder>/quarantine, sets FILE_DROP_ROOT in
# backend/.env, and shows how to share the folder so others can drop files from their laptops.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FOLDER="${1:-$HOME/BankDrop}"
FOLDER="${FOLDER/#\~/$HOME}"
ENV_FILE="$ROOT/backend/.env"

mkdir -p "$FOLDER/incoming" "$FOLDER/processed" "$FOLDER/quarantine"
[ -f "$ENV_FILE" ] || { echo "backend/.env not found. Run: cp backend/.env.example backend/.env"; exit 1; }
if grep -q '^FILE_DROP_ROOT=' "$ENV_FILE"; then
  sed -i '' "s|^FILE_DROP_ROOT=.*|FILE_DROP_ROOT=$FOLDER|" "$ENV_FILE"
else
  printf '\nFILE_DROP_ROOT=%s\n' "$FOLDER" >> "$ENV_FILE"
fi

HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<your-ip>')"
NAME="$(basename "$FOLDER")"

cat << MSG
Shared drop folder ready: $FOLDER
  incoming/    drop CSV files here (picked up within ~2 s)
  processed/   files move here when processed
  quarantine/  rejected files land here (duplicate, bad header, failed file-level checks)
backend/.env now has FILE_DROP_ROOT=$FOLDER  (restart the backend: ./scripts/stop_all.sh; ./scripts/run_all.sh)

To let teammates drop files from their laptops (same Wi-Fi):
  1. System Settings > General > Sharing > turn on File Sharing
  2. Click (i) next to File Sharing > Shared Folders > + > choose $FOLDER
     Give your account (or Everyone) Read & Write
  3. From another Mac:     Finder > Go > Connect to Server > smb://$HOST   (or smb://$IP)
     From Windows:         File Explorer address bar > \\\\$IP\\$NAME
     Then open $NAME/incoming and drag CSV files in.
If the venue Wi-Fi blocks file sharing, use a phone hotspot, or drop files on this Mac in Finder.
MSG
open "$FOLDER" 2>/dev/null || true
open "x-apple.systempreferences:com.apple.Sharing-Settings.extension" 2>/dev/null || true
