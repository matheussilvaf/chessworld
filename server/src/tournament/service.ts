import { nanoid } from 'nanoid';
import type {
  Tournament, Player, Round, Pairing, RoundBye, TPN, Color,
  TournamentConfig, GameResult, PairingDiagnostics, Standing, PlayerId,
  RoundMode, TournamentStatus, GameResultDetail,
} from './types.js';
import { calculateRounds, calculateMaxRounds, calculateAutoNormalRounds, calculateAutoFastRounds } from './rounds.js';
import { serializeTournamentToTRF, parsePairingOutput } from './trf.js';
import { generatePairing, getEngineStatus } from './engine.js';
import { validatePairing, validateAllResults } from './validation.js';
import { computeStandings, computeAllHistories } from './tiebreaks.js';

// In-memory store for tests (will be replaced by DB in production)
const tournaments = new Map<string, Tournament>();

export function listTournaments(): Tournament[] {
  return Array.from(tournaments.values());
}

export function getTournament(id: string): Tournament | null {
  return tournaments.get(id) || null;
}

export function deleteTournament(id: string): boolean {
  return tournaments.delete(id);
}

export function createTournament(name: string): Tournament {
  const tournament: Tournament = {
    id: nanoid(),
    name,
    status: 'setup',
    config: {
      roundMode: 'auto-normal',
      totalRounds: 0,
      initialColor: 'w',
    },
    players: [],
    rounds: [],
    standings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tournaments.set(tournament.id, tournament);
  return tournament;
}

export function addPlayer(tournamentId: string, name: string, rating: number): Player {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot add players after tournament started');

  const player: Player = {
    id: nanoid(),
    name,
    rating,
    status: 'active',
    tpn: null,
  };
  t.players.push(player);
  t.updatedAt = new Date().toISOString();
  return player;
}

export function removePlayer(tournamentId: string, playerId: PlayerId): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot remove players after tournament started');
  t.players = t.players.filter(p => p.id !== playerId);
  t.updatedAt = new Date().toISOString();
}

export function updatePlayer(tournamentId: string, playerId: PlayerId, name: string, rating: number): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot edit players after tournament started');
  const player = t.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.name = name;
  player.rating = rating;
  t.updatedAt = new Date().toISOString();
}

export function clearPlayers(tournamentId: string): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot clear players after tournament started');
  t.players = [];
  t.updatedAt = new Date().toISOString();
}

export function setRoundMode(tournamentId: string, mode: RoundMode, manualCount?: number): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot change config after tournament started');
  t.config.roundMode = mode;
  if (mode === 'manual' && manualCount) {
    t.config.totalRounds = manualCount;
  }
  t.updatedAt = new Date().toISOString();
}

export function setInitialColor(tournamentId: string, color: Color | 'random'): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.status !== 'setup') throw new Error('Cannot change config after tournament started');
  if (color === 'random') {
    t.config.initialColor = Math.random() < 0.5 ? 'w' : 'b';
  } else {
    t.config.initialColor = color;
  }
  t.updatedAt = new Date().toISOString();
}

export function getRoundInfo(playerCount: number, mode: RoundMode, manualCount?: number) {
  const max = calculateMaxRounds(playerCount);
  const autoNormal = calculateAutoNormalRounds(playerCount);
  const autoFast = calculateAutoFastRounds(playerCount);
  let calculated: number;

  switch (mode) {
    case 'auto-normal':
      calculated = autoNormal;
      break;
    case 'auto-fast':
      calculated = autoFast;
      break;
    case 'manual':
      calculated = manualCount || autoNormal;
      break;
  }

  return { calculated, max, autoNormal, autoFast };
}

function assignTPNs(tournament: Tournament): void {
  // Sort by: 1. rating desc, 2. name alphabetical, 3. id ascending
  const sorted = [...tournament.players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const nameA = a.name.toLowerCase().normalize('NFD');
    const nameB = b.name.toLowerCase().normalize('NFD');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return a.id < b.id ? -1 : 1;
  });

  sorted.forEach((player, index) => {
    const original = tournament.players.find(p => p.id === player.id)!;
    original.tpn = index + 1;
  });
}

export interface StartResult {
  success: boolean;
  error?: string;
  diagnostics?: PairingDiagnostics;
}

export async function startTournament(tournamentId: string): Promise<StartResult> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'setup') return { success: false, error: 'Tournament already started' };
  if (t.players.length < 2) return { success: false, error: 'Need at least 2 players' };

  // Assign TPNs
  assignTPNs(t);

  // Calculate rounds
  const playerCount = t.players.filter(p => p.status === 'active').length;
  t.config.totalRounds = calculateRounds(playerCount, t.config.roundMode,
    t.config.roundMode === 'manual' ? t.config.totalRounds : undefined);

  // If initial color was never explicitly set, randomize now
  if (!t.config.initialColor) {
    t.config.initialColor = Math.random() < 0.5 ? 'w' : 'b';
  }

  t.status = 'active';
  t.updatedAt = new Date().toISOString();

  // Generate first round
  const result = await generateNextRound(tournamentId);
  if (!result.success) {
    // Revert status
    t.status = 'setup';
    t.players.forEach(p => { p.tpn = null; });
    return result;
  }

  return { success: true, diagnostics: result.diagnostics };
}

export async function generateNextRound(tournamentId: string): Promise<StartResult> {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'active') return { success: false, error: 'Tournament not active' };

  const finalizedCount = t.rounds.filter(r => r.finalized).length;

  // Check if tournament is complete
  if (finalizedCount >= t.config.totalRounds) {
    t.status = 'finished';
    t.standings = computeStandings(t);
    t.updatedAt = new Date().toISOString();
    return { success: false, error: 'All rounds completed' };
  }

  // Check if last round is finalized
  if (t.rounds.length > 0 && !t.rounds[t.rounds.length - 1].finalized) {
    return { success: false, error: 'Current round not yet finalized' };
  }

  // Check active players
  const activePlayers = t.players.filter(p => p.status === 'active');
  if (activePlayers.length < 2) {
    t.status = 'finished';
    t.standings = computeStandings(t);
    t.updatedAt = new Date().toISOString();
    return { success: false, error: 'Fewer than 2 active players' };
  }

  const nextRoundNumber = finalizedCount + 1;

  // Idempotency: if unfinalized round already exists with the correct number, return it
  const existingUnfinalized = t.rounds.find(r => !r.finalized && r.number === nextRoundNumber);
  if (existingUnfinalized) {
    return { success: true };
  }

  // Generate TRF
  const trfContent = serializeTournamentToTRF(t);

  // Call engine
  const response = await generatePairing({ trfContent, roundNumber: nextRoundNumber });
  if (!response.success || !response.result) {
    return { success: false, error: response.diagnostics.errors.join('; '), diagnostics: response.diagnostics };
  }

  // Validate
  const validation = validatePairing(t, response.result, nextRoundNumber);
  if (!validation.valid) {
    response.diagnostics.violations = validation.errors;
    return { success: false, error: validation.errors.join('; '), diagnostics: response.diagnostics };
  }
  if (validation.warnings.length > 0) {
    response.diagnostics.colorWarnings.push(...validation.warnings);
  }

  // Determine board ordering
  const pairings = orderBoards(t, response.result.pairings.map(p => ({
    whiteTpn: p.whiteTpn,
    blackTpn: p.blackTpn,
    result: null,
    isPlayed: true,
    board: 0,
  })));

  // Create round
  const round: Round = {
    number: nextRoundNumber,
    pairings,
    bye: response.result.bye ? { tpn: response.result.bye, points: 1.0 } : null,
    finalized: false,
  };

  t.rounds.push(round);
  t.updatedAt = new Date().toISOString();

  // Update diagnostics
  response.diagnostics.activePlayers = activePlayers.length;
  response.diagnostics.expectedPairings = Math.floor(activePlayers.length / 2);
  response.diagnostics.expectedByes = activePlayers.length % 2;

  return { success: true, diagnostics: response.diagnostics };
}

function orderBoards(tournament: Tournament, pairings: Pairing[]): Pairing[] {
  const histories = computeAllHistories(tournament);

  return pairings
    .map(p => {
      const whiteHistory = histories.get(p.whiteTpn);
      const blackHistory = histories.get(p.blackTpn);
      const whitePoints = whiteHistory?.points ?? 0;
      const blackPoints = blackHistory?.points ?? 0;
      const maxPoints = Math.max(whitePoints, blackPoints);
      const sumPoints = whitePoints + blackPoints;
      const minTPN = Math.min(p.whiteTpn, p.blackTpn);
      return { pairing: p, maxPoints, sumPoints, minTPN };
    })
    .sort((a, b) => {
      if (b.maxPoints !== a.maxPoints) return b.maxPoints - a.maxPoints;
      if (b.sumPoints !== a.sumPoints) return b.sumPoints - a.sumPoints;
      return a.minTPN - b.minTPN;
    })
    .map((item, index) => ({ ...item.pairing, board: index + 1 }));
}

export function setResult(
  tournamentId: string,
  roundNumber: number,
  board: number,
  result: GameResult,
  isPlayed: boolean
): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) throw new Error('Round not found');
  if (round.finalized) throw new Error('Round already finalized');
  const pairing = round.pairings.find(p => p.board === board);
  if (!pairing) throw new Error('Board not found');
  pairing.result = result;
  pairing.isPlayed = isPlayed;
  t.updatedAt = new Date().toISOString();
}

export interface FinalizeResult {
  success: boolean;
  error?: string;
  standings?: Standing[];
}

export function finalizeRound(tournamentId: string, roundNumber: number): FinalizeResult {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return { success: false, error: 'Round not found' };
  if (round.finalized) return { success: false, error: 'Round already finalized' };

  const validation = validateAllResults(round);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') };
  }

  round.finalized = true;
  t.standings = computeStandings(t);
  t.updatedAt = new Date().toISOString();

  // Check if tournament is complete
  const finalizedCount = t.rounds.filter(r => r.finalized).length;
  if (finalizedCount >= t.config.totalRounds) {
    t.status = 'finished';
  }

  return { success: true, standings: t.standings };
}

export function withdrawPlayer(tournamentId: string, playerId: PlayerId): void {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error('Tournament not found');
  const player = t.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.status = 'withdrawn';
  t.updatedAt = new Date().toISOString();
}

export function correctRound(tournamentId: string, roundNumber: number): { success: boolean; error?: string } {
  const t = tournaments.get(tournamentId);
  if (!t) return { success: false, error: 'Tournament not found' };
  const roundIdx = t.rounds.findIndex(r => r.number === roundNumber);
  if (roundIdx === -1) return { success: false, error: 'Round not found' };
  if (!t.rounds[roundIdx].finalized) return { success: false, error: 'Round not finalized yet' };

  // Remove all rounds after this one
  t.rounds = t.rounds.slice(0, roundIdx + 1);
  // Reopen this round
  t.rounds[roundIdx].finalized = false;
  t.status = 'active';
  t.standings = computeStandings(t);
  t.updatedAt = new Date().toISOString();

  return { success: true };
}

export function getPlayerHistories(tournamentId: string): Map<TPN, any> | null {
  const t = tournaments.get(tournamentId);
  if (!t) return null;
  return computeAllHistories(t);
}

export { getEngineStatus } from './engine.js';

export function saveTournament(tournament: Tournament): void {
  tournaments.set(tournament.id, tournament);
}

export function importTournament(data: Tournament): Tournament {
  tournaments.set(data.id, data);
  return data;
}
