import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { BoardState } from './BoardState.js';
import { MatchState } from './MatchState.js';

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
