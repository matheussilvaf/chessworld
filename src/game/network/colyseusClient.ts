import { Client, Room } from 'colyseus.js';

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

let worldRoom: Room | null = null;

export function getWorldRoom(): Room | null {
  return worldRoom;
}

export async function joinWorldRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  console.log(`[Colyseus] joining world region: ${options.region}`);
  worldRoom = await getClient().joinOrCreate('world', options);
  console.log(`[Colyseus] joined roomId: ${worldRoom.roomId}`);
  console.log(`[Colyseus] sessionId: ${worldRoom.sessionId}`);
  console.log(`[State Contract] room.state:`, worldRoom.state);
  console.log(`[State Contract] state keys:`, worldRoom.state ? Object.getOwnPropertyNames(worldRoom.state) : 'NO STATE');
  console.log(`[State Contract] players exists:`, Boolean(worldRoom.state?.players));
  console.log(`[State Contract] boards exists:`, Boolean(worldRoom.state?.boards));
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
  console.log(`[Boards] boards registered: ${boards.length}`);
}
