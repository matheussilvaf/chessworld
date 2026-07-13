import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  id!: string;
  sessionId!: string;
  username!: string;
  rating!: number;
  region!: string;
  x!: number;
  y!: number;
  targetX!: number;
  targetY!: number;
  direction!: string;
  isMoving!: boolean;
  currentBoardId!: string;

  constructor() {
    super();
    this.id = '';
    this.sessionId = '';
    this.username = '';
    this.rating = 0;
    this.region = '';
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.direction = 'down';
    this.isMoving = false;
    this.currentBoardId = '';
  }
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
  id!: string;
  name!: string;
  region!: string;
  x!: number;
  y!: number;
  width!: number;
  height!: number;
  status!: string;
  waitingPlayerId!: string;
  waitingPlayerName!: string;
  timeCategory!: string;
  baseMinutes!: number;
  incrementSeconds!: number;
  timeLabel!: string;
  whitePlayerId!: string;
  blackPlayerId!: string;
  matchId!: string;

  constructor() {
    super();
    this.id = '';
    this.name = '';
    this.region = '';
    this.x = 0;
    this.y = 0;
    this.width = 80;
    this.height = 80;
    this.status = 'idle';
    this.waitingPlayerId = '';
    this.waitingPlayerName = '';
    this.timeCategory = '';
    this.baseMinutes = 0;
    this.incrementSeconds = 0;
    this.timeLabel = '';
    this.whitePlayerId = '';
    this.blackPlayerId = '';
    this.matchId = '';
  }
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
  id!: string;
  boardId!: string;
  region!: string;
  whitePlayerId!: string;
  blackPlayerId!: string;
  fen!: string;
  pgn!: string;
  status!: string;
  turn!: string;

  constructor() {
    super();
    this.id = '';
    this.boardId = '';
    this.region = '';
    this.whitePlayerId = '';
    this.blackPlayerId = '';
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.pgn = '';
    this.status = 'playing';
    this.turn = 'w';
  }
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
  players!: MapSchema<PlayerState>;
  boards!: MapSchema<BoardState>;
  matches!: MapSchema<MatchState>;

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.boards = new MapSchema<BoardState>();
    this.matches = new MapSchema<MatchState>();
  }
}

defineTypes(WorldState, {
  players: { map: PlayerState },
  boards: { map: BoardState },
  matches: { map: MatchState },
});
