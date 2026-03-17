#!/bin/bash

# Start frontend
(cd seokart_web_frontend && npm run dev) &

# Start backend Node server
(cd seokart_web_node && npm run dev) &

# Start Python server
(cd backend/pythonServer && python3 server.py) &

# Wait for all processes
wait