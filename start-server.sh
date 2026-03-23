#!/bin/bash
set -e

# Start frontend
(cd seokart_web_frontend && npm run dev) &

# Start backend Node server
(cd seokart_web_node && npm run dev) &

# Start Node workers (run what you need)
(cd seokart_web_node && npm run worker:crawl-v2-phase1) &
(cd seokart_web_node && npm run worker:crawl-v2-phase2) &
# (cd seokart_web_node && npm run worker:crawl-v2-phase2) &

# Start Python server (ONLY if folder exists)
if [ -d "backend/pythonServer" ]; then
  (cd backend/pythonServer && python3 server.py) &
else
  echo "⚠️  backend/pythonServer not found, skipping python server"
fi

wait