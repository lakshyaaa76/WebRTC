# P2P File Sharing App

A simple WebRTC-based peer-to-peer file sharing application. The app uses a lightweight signaling server to help peers connect and exchange files directly between browsers.

## What this project does

- Upload and share files between users in the same room
- Use WebRTC for direct peer-to-peer transfer
- Provide a simple frontend interface for creating and joining rooms
- Use a Node.js signaling server for connection handshakes

## Project structure

- frontend: Next.js client app
- signaling: WebSocket signaling server

## Prerequisites

- Node.js 18+ recommended
- npm

## Run locally

1. Install frontend dependencies
   ```bash
   cd frontend
   npm install
   ```

2. Install signaling server dependencies
   ```bash
   cd ../signaling
   npm install
   ```

3. Start the signaling server
   ```bash
   npm start
   ```

4. In a new terminal, start the frontend app
   ```bash
   cd ../frontend
   npm run dev
   ```

5. Open http://localhost:3000 in your browser

## Build for production

```bash
cd frontend
npm run build
```

## Notes

- The signaling server must be running before using the app.
- This project is intended for local development and testing.
