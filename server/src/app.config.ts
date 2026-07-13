import type { ConfigOptions } from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { WorldRoom } from "./rooms/WorldRoom.js";
import type { Request, Response } from "express";

const config: ConfigOptions = {
  initializeGameServer: (gameServer) => {
    gameServer.define("world", WorldRoom);
  },

  initializeExpress: (app) => {
    app.get("/health", (_req: Request, res: Response) => {
      res.json({ ok: true, uptime: process.uptime() });
    });

    app.use("/colyseus", monitor());
  },
};

export default config;
