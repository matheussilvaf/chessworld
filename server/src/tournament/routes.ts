import { Router } from 'express';
import * as service from './service.js';
import { PRESETS } from './presets.js';
import type { GameResult, RoundMode, Color } from './types.js';

export const tournamentRouter = Router();

// Engine status
tournamentRouter.get('/engine-status', async (_req, res) => {
  const status = await service.getEngineStatus();
  res.json(status);
});

// Presets
tournamentRouter.get('/presets', (_req, res) => {
  res.json(PRESETS);
});

// List tournaments
tournamentRouter.get('/tournaments', (_req, res) => {
  res.json(service.listTournaments());
});

// Get tournament
tournamentRouter.get('/tournaments/:id', (req, res) => {
  const t = service.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// Create tournament
tournamentRouter.post('/tournaments', (req, res) => {
  const { name } = req.body;
  const t = service.createTournament(name || 'Swiss Test');
  res.json(t);
});

// Delete tournament
tournamentRouter.delete('/tournaments/:id', (req, res) => {
  service.deleteTournament(req.params.id);
  res.json({ ok: true });
});

// Add player
tournamentRouter.post('/tournaments/:id/players', (req, res) => {
  try {
    const { name, rating } = req.body;
    const player = service.addPlayer(req.params.id, name, rating);
    res.json(player);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Remove player
tournamentRouter.delete('/tournaments/:id/players/:playerId', (req, res) => {
  try {
    service.removePlayer(req.params.id, req.params.playerId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Update player
tournamentRouter.put('/tournaments/:id/players/:playerId', (req, res) => {
  try {
    const { name, rating } = req.body;
    service.updatePlayer(req.params.id, req.params.playerId, name, rating);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Clear players
tournamentRouter.delete('/tournaments/:id/players', (req, res) => {
  try {
    service.clearPlayers(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Load preset
tournamentRouter.post('/tournaments/:id/load-preset', (req, res) => {
  try {
    const { presetIndex } = req.body;
    const preset = PRESETS[presetIndex];
    if (!preset) return res.status(400).json({ error: 'Invalid preset index' });

    service.clearPlayers(req.params.id);
    for (const p of preset.players) {
      service.addPlayer(req.params.id, p.name, p.rating);
    }
    const t = service.getTournament(req.params.id);
    res.json(t);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Set round mode
tournamentRouter.post('/tournaments/:id/round-mode', (req, res) => {
  try {
    const { mode, manualCount } = req.body;
    service.setRoundMode(req.params.id, mode as RoundMode, manualCount);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Set initial color
tournamentRouter.post('/tournaments/:id/initial-color', (req, res) => {
  try {
    const { color } = req.body;
    service.setInitialColor(req.params.id, color as Color | 'random');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Get round info
tournamentRouter.get('/tournaments/:id/round-info', (req, res) => {
  const t = service.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const playerCount = t.players.filter(p => p.status === 'active').length;
  const info = service.getRoundInfo(playerCount, t.config.roundMode, t.config.totalRounds || undefined);
  res.json(info);
});

// Start tournament
tournamentRouter.post('/tournaments/:id/start', async (req, res) => {
  const result = await service.startTournament(req.params.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error, diagnostics: result.diagnostics });
  }
  const t = service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, diagnostics: result.diagnostics });
});

// Generate next round
tournamentRouter.post('/tournaments/:id/next-round', async (req, res) => {
  const result = await service.generateNextRound(req.params.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error, diagnostics: result.diagnostics });
  }
  const t = service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, diagnostics: result.diagnostics });
});

// Set result
tournamentRouter.post('/tournaments/:id/rounds/:round/boards/:board/result', (req, res) => {
  try {
    const { result, isPlayed } = req.body;
    service.setResult(
      req.params.id,
      parseInt(req.params.round),
      parseInt(req.params.board),
      result as GameResult,
      isPlayed !== false
    );
    const t = service.getTournament(req.params.id);
    res.json({ ok: true, tournament: t });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Finalize round
tournamentRouter.post('/tournaments/:id/rounds/:round/finalize', (req, res) => {
  const result = service.finalizeRound(req.params.id, parseInt(req.params.round));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  const t = service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t, standings: result.standings });
});

// Withdraw player
tournamentRouter.post('/tournaments/:id/players/:playerId/withdraw', (req, res) => {
  try {
    service.withdrawPlayer(req.params.id, req.params.playerId);
    const t = service.getTournament(req.params.id);
    res.json({ ok: true, tournament: t });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Correct round
tournamentRouter.post('/tournaments/:id/rounds/:round/correct', (req, res) => {
  const result = service.correctRound(req.params.id, parseInt(req.params.round));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  const t = service.getTournament(req.params.id);
  res.json({ ok: true, tournament: t });
});

// Get player histories
tournamentRouter.get('/tournaments/:id/histories', (req, res) => {
  const histories = service.getPlayerHistories(req.params.id);
  if (!histories) return res.status(404).json({ error: 'Not found' });
  // Convert Map to object
  const obj: Record<number, any> = {};
  histories.forEach((v, k) => { obj[k] = v; });
  res.json(obj);
});

// Import tournament (for persistence across reloads)
tournamentRouter.post('/tournaments/import', (req, res) => {
  try {
    const t = service.importTournament(req.body);
    res.json(t);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
