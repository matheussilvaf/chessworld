import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { useChessStore } from '../stores/chessStore';
import { useGameSettingsStore } from '../stores/gameSettingsStore';
import { useInteractionStore } from '../stores/interactionStore';
import { getWorldRoom, registerBoards, sendMovement, sendChangeMap } from '../game/network/colyseusClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import { loadCharacterConfigs } from '../config/loadCharacterConfigs';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { Room } from 'colyseus.js';

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

    loadCharacterConfigs();

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

      // Wire confirm action for ProximityButton clicks
      useInteractionStore.getState().setConfirmAction(() => {
        scene.confirmProximityInteraction();
      });

      if (user && region) {
        scene.setLocalPlayer(user.id, region);
      }

      // When the player switches maps, notify the server
      scene.onMapChanged = (mapKey: string) => {
        sendChangeMap(mapKey);
        // Hide all remote players until we re-evaluate their map
        scene.hideAllRemotePlayers();
      };

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

      // Wire interaction system events to store
      scene.onInteractionClick = (event) => {
        const interactionStore = useInteractionStore.getState();
        const obj = event.object;

        // Chess table interactions trigger BoardModal
        if (obj.category === 'chess_table' || obj.category === 'player_seat') {
          if (!user || !profile || !region) return;
          const tableId = obj.properties.tableId as string;
          if (!tableId) return;
          const state = useGameStore.getState();
          if (state.selectedBoard || state.boardLocked) return;

          // Pre-select side based on which element was clicked
          let preSelectedSide: 'w' | 'b' | 'random' = 'random';
          if (obj.category === 'player_seat') {
            const pos = obj.properties.position as string;
            if (pos === 'top') preSelectedSide = 'b'; // top seat = black
            else preSelectedSide = 'w'; // bottom seat = white
          }

          setSelectedBoard({
            id: tableId,
            name: tableId,
            region,
            x: obj.x,
            y: obj.y,
            status: 'free',
            waiting_user_id: null,
            current_match_id: null,
            time_minutes: null,
            increment_seconds: null,
            created_at: '',
            updated_at: '',
            preSelectedSide,
          } as any);
          return;
        }

        // Spectator seat interactions
        if (obj.category === 'spectator_seat') {
          const tableId = obj.properties.tableId as string;
          if (!tableId) return;
          const state = useGameStore.getState();
          const boardState = state.colyseusBoards.find(b => b.id === tableId);
          if (boardState?.status === 'playing' && boardState.matchId) {
            // Auto-spectate
            useChessStore.getState().openSpectate(boardState.matchId);
            // Seat as spectator
            const position = obj.properties.position as string;
            const seatKey = position?.includes('left') ? 'left_01' : 'right_01';
            scene.seatPlayer(tableId, 'spectator', seatKey);
          }
          return;
        }

        // For all other interaction categories, handle enter_building action
        if (obj.properties.action === 'enter_building' && obj.properties.targetMap) {
          const targetMap = obj.properties.targetMap as string;
          const targetSpawn = obj.properties.targetSpawn as string;
          let mapPath = '';
          if (targetMap === 'tournament_arena_interior') {
            mapPath = '/assets/world-v2/tournament_reception.tmj';
          }
          if (mapPath && targetSpawn) {
            scene.switchMap(mapPath, targetSpawn);
            useInteractionStore.getState().setProximityObject(null);
            return;
          }
        }

        if (obj.properties.action === 'exit_building' && obj.properties.targetMap) {
          const targetMap = obj.properties.targetMap as string;
          const targetSpawn = obj.properties.targetSpawn as string;
          let mapPath = '';
          if (targetMap === 'main_world') {
            mapPath = '/assets/world-v2/main_world.tmj';
          }
          if (mapPath && targetSpawn) {
            scene.switchMap(mapPath, targetSpawn);
            useInteractionStore.getState().setProximityObject(null);
            return;
          }
        }

        // Fallback: show debug modal if enabled
        if (interactionStore.debugEnabled) {
          interactionStore.openModal({ object: obj, playerDistance: event.playerDistance });
        }
      };
      scene.onProximityEnter = (event) => {
        useInteractionStore.getState().setProximityObject(event.object);
      };
      scene.onProximityExit = () => {
        useInteractionStore.getState().setProximityObject(null);
      };
      scene.onZoneChange = (event) => {
        const store = useInteractionStore.getState();
        if (event.entered) {
          store.setCurrentZone({ zoneId: event.zoneId, zoneName: event.zoneName, zoneType: event.zoneType });
        } else {
          store.setCurrentZone(null);
        }
        store.showZoneNotification(event);
      };

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

  // Load and subscribe to game settings (admin-adjustable zoom/speed)
  useEffect(() => {
    const settingsStore = useGameSettingsStore;
    settingsStore.getState().load();
    const unsubRealtime = settingsStore.getState().subscribe();

    const unsubStore = settingsStore.subscribe((state) => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);
      if (scene) {
        scene.setDefaultZoom(state.defaultZoom);
        scene.setPlayerSpeed(state.playerSpeed);
        scene.setShowDebugVisuals(state.showDebugVisuals);
      }
    });

    return () => {
      unsubRealtime();
      unsubStore();
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
      useGameStore.getState().setLastEvent('state null - waiting');
      room.onStateChange.once(() => {
        validateAndAttach(scene, room);
      });
      return;
    }

    validateAndAttach(scene, room);
  }

  function validateAndAttach(scene: WorldScene, room: Room<any>) {
    if (listenersSetRef.current) return;

    const state = room.state;
    const playersOk = state && state.players && typeof state.players.onAdd === 'function';
    const boardsOk = state && state.boards && typeof state.boards.onAdd === 'function';

    if (!playersOk || !boardsOk) {
      console.error('[Colyseus] State contract invalid - players or boards missing onAdd');
      useGameStore.getState().setLastEvent('Colyseus state invalid');
      return;
    }

    attachListeners(scene, room);
  }

  function attachListeners(scene: WorldScene, room: Room<any>) {
    if (listenersSetRef.current) return;
    listenersSetRef.current = true;

    const state = room.state;
    console.log('[Colyseus] Attaching listeners. players:', state.players.size, '| boards:', state.boards.size);

    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      const payload = arenas.map((a: any) => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height }));
      registerBoards(payload);
    }

    state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) {
        updateOnlineCount(room);
        return;
      }

      // Only show the player if they're on the same map as us
      const localMap = scene.getCurrentMapKey();
      const remoteMap = player.currentMap || 'main_world';
      const sameMap = (localMap === 'world' && remoteMap === 'main_world') ||
                      localMap === remoteMap;

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

      // Hide if on different map
      if (!sameMap) {
        scene.setRemotePlayerVisibility(sessionId, false);
      }

      player.onChange(() => {
        const currentLocalMap = scene.getCurrentMapKey();
        const currentRemoteMap = player.currentMap || 'main_world';
        const nowSameMap = (currentLocalMap === 'world' && currentRemoteMap === 'main_world') ||
                          currentLocalMap === currentRemoteMap;

        // Update visibility based on map
        scene.setRemotePlayerVisibility(sessionId, nowSameMap);

        // Only update position if on same map
        if (nowSameMap) {
          scene.updateRemotePlayerState(sessionId, {
            x: player.x,
            y: player.y,
            targetX: player.targetX,
            targetY: player.targetY,
            direction: player.direction,
            isMoving: player.isMoving,
          });
        }
      });

      updateOnlineCount(room);
    });

    state.players.onRemove((_player: any, sessionId: string) => {
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    state.boards.onAdd((board: any, _boardId: string) => {
      updateBoardVisual(scene, board, room);
      syncBoardsToStore(room);

      board.onChange(() => {
        updateBoardVisual(scene, board, room);
        syncBoardsToStore(room);
      });
    });

    state.boards.onRemove((_board: any, _boardId: string) => {
      syncBoardsToStore(room);
    });

    // --- Matches ---
    if (state.matches && typeof state.matches.onAdd === 'function') {
      state.matches.onAdd((match: any, _matchId: string) => {
        // Show overlay immediately when match is added
        if (match.boardId && match.fen && gameRef.current) {
          const ws = getWorldScene(gameRef.current);
          if (ws) ws.updateBoardFEN(match.boardId, match.fen);
        }
        match.onChange(() => {
          useChessStore.getState().syncFromColyseus(match);
          // Update board overlay with current FEN for ALL clients
          if (match.boardId && match.fen && gameRef.current) {
            const ws = getWorldScene(gameRef.current);
            if (ws) ws.updateBoardFEN(match.boardId, match.fen);
          }
        });
      });
    }

    room.onMessage('state_contract', (data: any) => {
      console.log('[Colyseus] state_contract:', data);
    });

    room.onMessage('match_started', (data: any) => {
      useGameStore.getState().setLastEvent(`match_started ${data.matchId.slice(0, 8)}`);
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      // Close the board modal
      useGameStore.getState().setSelectedBoard(null);
      useGameStore.getState().setBoardLocked(false);

      // Open the match in the chess store (enables interaction logic)
      useChessStore.getState().openMatch(data.matchId, data.color, userId, data.boardId);

      if (gameRef.current) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene && data.boardId) {
          // Seat at correct side: white=bottom, black=top
          const seat = data.color === 'w' ? 'bottom' : 'top';
          worldScene.seatPlayer(data.boardId, 'player', seat, data.color);
          // Show initial position and activate interactive overlay
          const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
          worldScene.updateBoardFEN(data.boardId, initialFen);
          worldScene.activateOverlayInteraction(data.boardId, data.color);
        }
      }
    });

    room.onMessage('match_finished', (data: any) => {
      useGameStore.getState().setLastEvent(`match_finished: ${data.result}`);
      // Sync game over state to chessStore
      useChessStore.getState().syncFromColyseus(data);
      // Unseat and clean up after delay
      setTimeout(() => {
        if (gameRef.current) {
          const worldScene = getWorldScene(gameRef.current);
          if (worldScene) {
            worldScene.deactivateOverlayInteraction();
            worldScene.unseatPlayer();
            if (data.boardId) {
              worldScene.updateBoardStatus(data.boardId, 'idle');
            }
          }
        }
        useChessStore.getState().reset();
      }, 3000);
    });

    room.onMessage('challenge_created', (data: any) => {
      // Store the color assignment
      useGameStore.getState().setChallengeColor(data.color || null);
      // Seat challenger at their chosen side
      if (gameRef.current && data.boardId) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) {
          worldScene.seatPlayer(data.boardId, 'player', data.seat || 'bottom');
        }
      }
    });

    room.onMessage('challenge_cancelled', () => {
      if (gameRef.current) {
        const worldScene = getWorldScene(gameRef.current);
        if (worldScene) worldScene.unseatPlayer();
      }
    });

    room.onMessage('error', (data: any) => {
      console.warn('[Colyseus] Error:', data.message);
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
    console.log('[Colyseus] All listeners attached');
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function updateOnlineCount(room: Room<any>) {
  if (!room.state?.players) return;
  const count = room.state.players.size;
  useGameStore.getState().setOnlinePlayers(Math.max(0, count - 1));
}

function updateBoardVisual(scene: WorldScene, board: any, room?: Room<any>) {
  if (board.status === 'waiting') {
    scene.updateBoardStatus(board.id, 'waiting', {
      playerName: board.waitingPlayerName,
      timeLabel: board.timeLabel,
    });
  } else if (board.status === 'playing') {
    // Find the match FEN to show on the overlay
    let fen = '';
    if (room?.state?.matches && board.matchId) {
      room.state.matches.forEach((m: any, mId: string) => {
        if (mId === board.matchId || m.id === board.matchId) {
          fen = m.fen || '';
        }
      });
    }
    // Always show the board with pieces - use starting FEN as fallback
    const fenToShow = fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    scene.updateBoardFEN(board.id, fenToShow);

    // Seat remote players at the board (skip local player - handled by match_started)
    const localUserId = useAuthStore.getState().user?.id;
    if (board.whitePlayerId && board.whitePlayerId !== localUserId) {
      scene.seatRemotePlayerById(board.whitePlayerId, 'bottom', board.id);
    }
    if (board.blackPlayerId && board.blackPlayerId !== localUserId) {
      scene.seatRemotePlayerById(board.blackPlayerId, 'top', board.id);
    }
  } else {
    scene.updateBoardStatus(board.id, 'idle');
    scene.unseatRemotePlayersAtBoard(board.id);
  }
}

function syncBoardsToStore(room: Room<any>) {
  if (!room.state?.boards) return;
  const boards: any[] = [];
  room.state.boards.forEach((board: any, id: string) => {
    boards.push({
      id,
      name: board.name,
      status: board.status,
      waitingPlayerId: board.waitingPlayerId,
      waitingPlayerName: board.waitingPlayerName,
      whitePlayerId: board.whitePlayerId || '',
      blackPlayerId: board.blackPlayerId || '',
      timeCategory: board.timeCategory,
      baseMinutes: board.baseMinutes,
      incrementSeconds: board.incrementSeconds,
      timeLabel: board.timeLabel,
      matchId: board.matchId || '',
    });
  });
  useGameStore.getState().setColyseusBoards(boards);
}
