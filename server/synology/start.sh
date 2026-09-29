#!/bin/sh
# GMC Maritime Academy — κεντρικός διακομιστής σε Synology NAS.
# DSM → Πίνακας Ελέγχου → Προγραμματιστής εργασιών → Ενεργοποιημένη εργασία (Εκκίνηση/Boot-up), χρήστης root:
#     sh /volume1/gmc/gmc-registry/start.sh
# Επιπλέον παράμετροι περνούν στον διακομιστή, π.χ.  --reset-admin "jim:ΝέοςΚωδικός2026"

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8080
DATA="$DIR/data"

case "$(uname -m)" in
  x86_64 | amd64) BIN="gmc-registry-server-linux-amd64" ;;
  aarch64 | arm64) BIN="gmc-registry-server-linux-arm64" ;;
  arm*) BIN="gmc-registry-server-linux-arm" ;;
  *) echo "Άγνωστος επεξεργαστής: $(uname -m)"; exit 1 ;;
esac

mkdir -p "$DATA"
chmod +x "$DIR/$BIN"

if [ -f "$DATA/server.pid" ] && kill -0 "$(cat "$DATA/server.pid")" 2>/dev/null; then
  echo "Ο διακομιστής τρέχει ήδη (pid $(cat "$DATA/server.pid"))."
  exit 0
fi

nohup "$DIR/$BIN" --port "$PORT" --data "$DATA" "$@" >> "$DATA/console.log" 2>&1 &
echo $! > "$DATA/server.pid"
sleep 2
if kill -0 "$(cat "$DATA/server.pid")" 2>/dev/null; then
  echo "Ο διακομιστής ξεκίνησε (θύρα $PORT)."
else
  echo "Ο διακομιστής δεν ξεκίνησε — δείτε το $DATA/console.log"
  exit 1
fi
