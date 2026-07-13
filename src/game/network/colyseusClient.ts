import { Client, Room } from 'colyseus.js';
import { WorldState } from './schemas';

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || '';

export function isColyseusConfigured(): boolean {
  return COLYSEUS_URL.length > 0;
}

export function getColyseusEndpoint(): string {
  return COLYSEUS_URL;
}

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client(COLYSEUS_URL);
  }
  return client;
}

let worldRoom: Room<WorldState> | null = null;

export function getWorldRoom(): Room<WorldState> | null {
  return worldRoom;
}

export async function joinWorldRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room<WorldState>> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  console.log(`[Colyseus] joining world region: ${options.region}`);
  console.log(`[Client Contract] colyseus.js version: 0.15.28`);
  console.log(`[Client Contract] @colyseus/schema version: 2.x (explicit schemas)`);

  worldRoom = await getClient().joinOrCreate<WorldState>('world', options, WorldState);

  console.log(`[Client Contract] roomId: ${worldRoom.roomId}`);
  console.log(`[Client Contract] sessionId: ${worldRoom.sessionId}`);
  console.log(`[Client Contract] raw room.state:`, worldRoom.state);
  console.log(`[Client Contract] players exists: ${Boolean(worldRoom.state?.players)}`);
  console.log(`[Client Contract] boards exists: ${Boolean(worldRoom.state?.boards)}`);
  console.log(`[Client Contract] matches exists: ${Boolean(worldRoom.state?.matches)}`);

  if (worldRoom.state?.players) {
    console.log(`[Client Contract] players.size: ${worldRoom.state.players.size}`);
  }
  if (worldRoom.state?.boards) {
    console.log(`[Client Contract] boards.size: ${worldRoom.state.boards.size}`);
  }

  return worldRoom;
}

export async function leaveWorldRoom(): Promise<void> {
  if (worldRoom) {
    await worldRoom.leave();
    worldRoom = null;
  }
}

export function sendMovement(data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) {
  worldRoom?.send('move_to', data);
}

export function sendCreateChallenge(data: {
  boardId: string;
  timeCategory: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
}) {
  worldRoom?.send('create_challenge', data);
  console.log(`[Boards] challenge created: ${data.boardId} ${data.timeLabel}`);
}

export function sendAcceptChallenge(boardId: string) {
  worldRoom?.send('accept_challenge', { boardId });
  console.log(`[Boards] challenge accepted: ${boardId}`);
}

export function sendBoardCancel(boardId: string) {
  worldRoom?.send('cancel_waiting', { boardId });
}

export function sendChessMove(matchId: string, from: string, to: string, promotion?: string) {
  worldRoom?.send('chess_move', { matchId, from, to, promotion });
}

export function sendResign(matchId: string) {
  worldRoom?.send('chess_resign', { matchId });
}

export function sendDrawOffer(matchId: string) {
  worldRoom?.send('chess_draw_offer', { matchId });
}

export function sendDrawAccept(matchId: string) {
  worldRoom?.send('chess_draw_accept', { matchId });
}

export function sendChat(message: string) {
  worldRoom?.send('chat', { message });
}

export function registerBoards(boards: { id: string; name: string; x: number; y: number; width?: number; height?: number }[]) {
  worldRoom?.send('register_boards', { boards });
  console.log(`[Boards] register_boards sent: ${boards.length} boards`);
}
