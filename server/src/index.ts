import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WorldRoom } from './rooms/WorldRoom.js';

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, port: PORT, uptime: process.uptime() });
});

app.use('/colyseus', monitor());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  presence: undefined,
  driver: undefined,
});

gameServer.define('world', WorldRoom);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('=================================');
  console.log('  Colyseus Server Started');
  console.log('=================================');
  console.log(`  Port:    ${PORT}`);
  console.log(`  Room:    "world" registered`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Monitor: http://localhost:${PORT}/colyseus`);
  console.log('=================================');
  console.log('');
});
