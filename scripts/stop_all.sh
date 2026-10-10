#!/usr/bin/env bash
# Stop everything started by run_all.sh (by port, so child processes stop too).
for port in 8000 5000 5173; do
  pids=$(lsof -ti tcp:$port 2> /dev/null)
  if [ -n "$pids" ]; then echo "Stopping port $port"; kill $pids 2> /dev/null; fi
done
sleep 1
for port in 8000 5000 5173; do
  pids=$(lsof -ti tcp:$port 2> /dev/null)
  [ -n "$pids" ] && kill -9 $pids 2> /dev/null
done
echo "Stopped"
