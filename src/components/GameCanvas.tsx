import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { getWorldRoom, registerBoards, sendMovement } from '../game/network/colyseusClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { Room } from 'colyseus.js';
import type { WorldState, PlayerState, BoardState } from '../game/network/schemas';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const listenersSetRef = useRef(false);
  const { setSelectedBoard } = useGameStore();
  const { user, profile } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = createPhaserGame(containerRef.current);
    gameRef.current = game;

    const setupScene = () => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);

      if (!scene) {
        setTimeout(setupScene, 200);
        return;
      }

      try {
        if (!scene.scene || !scene.scene.isActive()) {
          setTimeout(setupScene, 200);
          return;
        }
      } catch {
        setTimeout(setupScene, 200);
        return;
      }

      sceneReadyRef.current = true;
      console.log('[GameCanvas] Scene ready');

      if (user && region) {
        scene.setLocalPlayer(user.id, region);
      }

      scene.onBoardClick = (arenaId: string, arenaTitle: string) => {
        if (!user || !profile || !region) return;
        const state = useGameStore.getState();
        if (state.selectedBoard || state.boardLocked) return;

        setSelectedBoard({
          id: arenaId,
          name: arenaTitle,
          region,
          x: 0,
          y: 0,
          status: 'free',
          waiting_user_id: null,
          current_match_id: null,
          time_minutes: null,
          increment_seconds: null,
          created_at: '',
          updated_at: '',
        } as any);
      };

      scene.onPositionUpdate = () => {};

      tryAttachListeners(scene);
    };

    setTimeout(setupScene, 500);

    return () => {
      listenersSetRef.current = false;
      sceneReadyRef.current = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const unsubColyseus = useColyseusStore.subscribe((state, prev) => {
      if (state.connected && !prev.connected) {
        attemptListenerSetup();
      }
    });

    if (useColyseusStore.getState().connected) {
      attemptListenerSetup();
    }

    return () => unsubColyseus();
  }, []);

  function attemptListenerSetup() {
    if (!sceneReadyRef.current || !gameRef.current || listenersSetRef.current) return;
    const scene = getWorldScene(gameRef.current);
    if (scene) {
      tryAttachListeners(scene);
    }
  }

  function tryAttachListeners(scene: WorldScene) {
    if (listenersSetRef.current) return;

    const room = getWorldRoom();
    if (!room) return;

    if (!room.state) {
      console.error('[State Contract] room.state is null/undefined after join');
      useGameStore.getState().setLastEvent('state null - waiting');
      room.onStateChange.once(() => {
        console.log('[State Contract] State received via onStateChange');
        validateAndAttach(scene, room);
      });
      return;
    }

    validateAndAttach(scene, room);
  }

  function validateAndAttach(scene: WorldScene, room: Room<WorldState>) {
    if (listenersSetRef.current) return;

    const state = room.state;
    const playersOk = state && state.players && typeof state.players.onAdd === 'function';
    const boardsOk = state && state.boards && typeof state.boards.onAdd === 'function';

    console.log(`[State Contract] Validating state contract:`);
    console.log(`[State Contract]   players exists: ${Boolean(state?.players)}`);
    console.log(`[State Contract]   players has onAdd: ${playersOk}`);
    console.log(`[State Contract]   boards exists: ${Boolean(state?.boards)}`);
    console.log(`[State Contract]   boards has onAdd: ${boardsOk}`);
    console.log(`[State Contract]   matches exists: ${Boolean(state?.matches)}`);

    if (!playersOk || !boardsOk) {
      console.error('[State Contract] INVALID - players or boards missing onAdd method');
      console.error('[State Contract] Frontend connected, but Colyseus schema contract is invalid.');
      console.error('[State Contract] This usually means client/server schema version mismatch.');
      useGameStore.getState().setLastEvent('Colyseus state invalid');
      return;
    }

    attachListeners(scene, room);
  }

  function attachListeners(scene: WorldScene, room: Room<WorldState>) {
    if (listenersSetRef.current) return;
    listenersSetRef.current = true;

    const state = room.state;
    console.log('[Colyseus] Attaching listeners. roomId:', room.roomId, 'sessionId:', room.sessionId);
    console.log('[Colyseus] Initial players:', state.players.size, '| boards:', state.boards.size);

    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      const payload = arenas.map(a => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height }));
      console.log('[Boards] Sending register_boards:', payload.length, 'boards');
      registerBoards(payload);
    }

    // --- Players ---
    state.players.onAdd((player: PlayerState, sessionId: string) => {
      if (sessionId === room.sessionId) {
        console.log(`[Players] Local player in state: ${sessionId}`);
        updateOnlineCount(room);
        return;
      }
      console.log(`[Players] Remote player added: ${player.username} (${sessionId}) at (${player.x}, ${player.y})`);

      scene.handlePlayerJoined({
        id: player.id,
        socketId: sessionId,
        username: player.username,
        rating: player.rating,
        region: player.region,
        x: player.x,
        y: player.y,
        targetX: player.targetX,
        targetY: player.targetY,
        direction: player.direction,
        isMoving: player.isMoving,
      });

      player.onChange(() => {
        scene.updateRemotePlayerState(sessionId, {
          x: player.x,
          y: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          direction: player.direction,
          isMoving: player.isMoving,
        });
      });

      updateOnlineCount(room);
    });

    state.players.onRemove((_player: PlayerState, sessionId: string) => {
      console.log(`[Players] Remote player removed: ${sessionId}`);
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    // --- Boards ---
    state.boards.onAdd((board: BoardState, boardId: string) => {
      console.log(`[Boards] Board added: ${boardId} status=${board.status}`);
      updateBoardVisual(scene, board);
      syncBoardsToStore(room);

      board.onChange(() => {
        console.log(`[Boards] Board changed: ${boardId} -> ${board.status}`);
        updateBoardVisual(scene, board);
        syncBoardsToStore(room);
      });
    });

    state.boards.onRemove((_board: BoardState, boardId: string) => {
      console.log(`[Boards] Board removed: ${boardId}`);
      syncBoardsToStore(room);
    });

    // --- Messages ---
    room.onMessage('state_contract', (data: any) => {
      console.log(`[Client Contract] received state_contract message:`, data);
    });

    room.onMessage('match_started', (data: any) => {
      console.log(`[Colyseus] match_started: matchId=${data.matchId} boardId=${data.boardId} color=${data.color}`);
      useGameStore.getState().setMatchStartedInfo(data);
      useGameStore.getState().setLastEvent(`match_started ${data.matchId.slice(0, 8)}`);
    });

    room.onMessage('match_finished', (data: any) => {
      console.log(`[Colyseus] match_finished: ${data.matchId} reason=${data.reason}`);
      useGameStore.getState().setLastEvent(`match_finished: ${data.reason}`);
    });

    room.onMessage('error', (data: any) => {
      console.warn(`[Colyseus] Error: ${data.message}`);
    });

    room.onMessage('chat', (data: any) => {
      useGameStore.getState().addChatMessage({
        id: data.id,
        region: '',
        user_id: data.playerId,
        username: data.username,
        message: data.message,
        created_at: data.createdAt,
      });
    });

    syncBoardsToStore(room);
    updateOnlineCount(room);
    useGameStore.getState().setLastEvent('listeners attached');
    console.log('[Colyseus] All listeners attached successfully');
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function updateOnlineCount(room: Room<WorldState>) {
  if (!room.state?.players) return;
  const count = room.state.players.size;
  useGameStore.getState().setOnlinePlayers(Math.max(0, count - 1));
}

function updateBoardVisual(scene: WorldScene, board: BoardState) {
  if (board.status === 'waiting') {
    scene.updateBoardStatus(board.id, 'waiting', {
      playerName: board.waitingPlayerName,
      timeLabel: board.timeLabel,
    });
  } else if (board.status === 'playing') {
    scene.updateBoardStatus(board.id, 'in_match');
  } else {
    scene.updateBoardStatus(board.id, 'idle');
  }
}

function syncBoardsToStore(room: Room<WorldState>) {
  if (!room.state?.boards) return;
  const boards: any[] = [];
  room.state.boards.forEach((board: BoardState, id: string) => {
    boards.push({
      id,
      name: board.name,
      status: board.status,
      waitingPlayerId: board.waitingPlayerId,
      waitingPlayerName: board.waitingPlayerName,
      timeCategory: board.timeCategory,
      baseMinutes: board.baseMinutes,
      incrementSeconds: board.incrementSeconds,
      timeLabel: board.timeLabel,
    });
  });
  useGameStore.getState().setColyseusBoards(boards);
}
