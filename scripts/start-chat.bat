@echo off
rem Double-click launcher for the LibreChat backend alone (serves the built client on http://localhost:3080).
rem MongoDB runs as a Windows service; the model server is started separately by ..\local-llm\scripts\start-server.bat.
rem Use scripts\start-all.bat to start both servers at once.
rem "pause" keeps the window open after the server exits so errors stay readable.
title LibreChat
cd /d "C:\Users\aquerman\Documents\GitHub\local-agent-chat"
npm run backend
pause
