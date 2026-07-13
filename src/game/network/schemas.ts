import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  id: string = '';
  sessionId: string = '';
  username: string = '';
  rating: number = 0;
  region: string = '';
  x: number = 0;
  y: number = 0;
  targetX: number = 0;
  targetY: number = 0;
  direction: string = 'down';
  isMoving: boolean = false;
  currentBoardId: string = '';
}

defineTypes(PlayerState, {
  id: 'string',
  sessionId: 'string',
  username: 'string',
  rating: 'number',
  region: 'string',
  x: 'number',
  y: 'number',
  targetX: 'number',
  targetY: 'number',
  direction: 'string',
  isMoving: 'boolean',
  currentBoardId: 'string',
});

export class BoardState extends Schema {
  id: string = '';
  name: string = '';
  region: string = '';
  x: number = 0;
  y: number = 0;
  width: number = 80;
  height: number = 80;
  status: string = 'idle';
  waitingPlayerId: string = '';
  waitingPlayerName: string = '';
  timeCategory: string = '';
  baseMinutes: number = 0;
  incrementSeconds: number = 0;
  timeLabel: string = '';
  whitePlayerId: string = '';
  blackPlayerId: string = '';
  matchId: string = '';
}

defineTypes(BoardState, {
  id: 'string',
  name: 'string',
  region: 'string',
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  status: 'string',
  waitingPlayerId: 'string',
  waitingPlayerName: 'string',
  timeCategory: 'string',
  baseMinutes: 'number',
  incrementSeconds: 'number',
  timeLabel: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  matchId: 'string',
});

export class MatchState extends Schema {
  id: string = '';
  boardId: string = '';
  region: string = '';
  whitePlayerId: string = '';
  blackPlayerId: string = '';
  fen: string = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  pgn: string = '';
  status: string = 'playing';
  turn: string = 'w';
}

defineTypes(MatchState, {
  id: 'string',
  boardId: 'string',
  region: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  fen: 'string',
  pgn: 'string',
  status: 'string',
  turn: 'string',
});

export class WorldState extends Schema {
  players = new MapSchema<PlayerState>();
  boards = new MapSchema<BoardState>();
  matches = new MapSchema<MatchState>();
}

defineTypes(WorldState, {
  players: { map: PlayerState },
  boards: { map: BoardState },
  matches: { map: MatchState },
});
