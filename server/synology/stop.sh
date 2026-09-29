#!/bin/sh
# Σταματά τον διακομιστή (π.χ. πριν από ενημέρωση ή μεταφορά δεδομένων).
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/data/server.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  i=0
  while kill -0 "$(cat "$PID_FILE")" 2>/dev/null && [ $i -lt 10 ]; do sleep 1; i=$((i + 1)); done
  echo "Ο διακομιστής σταμάτησε."
else
  echo "Ο διακομιστής δεν έτρεχε."
fi
rm -f "$PID_FILE"
