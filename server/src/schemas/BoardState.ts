import { Schema, defineTypes } from '@colyseus/schema';

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
