import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { BoardState } from './BoardState.js';
import { MatchState } from './MatchState.js';

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
