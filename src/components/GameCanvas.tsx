import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { useChessStore } from '../stores/chessStore';
import { supabase } from '../lib/supabase';
import {
  socket, connectSocket, joinWorld, registerBoards,
} from '../game/network/socketClient';
import type { PlayerState, BoardState, MatchState } from '../game/network/types';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const { region, setCurrentMatch, setSelectedBoard, setBoardLocked } = useGameStore();
  const { user, profile } = useAuthStore();
  const { initMatch } = useChessStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = createPhaserGame(containerRef.current);
    gameRef.current = game;

    const setupScene = () => {
      const scene = getWorldScene(game);
      if (!scene || !scene.scene.isActive()) {
        setTimeout(setupScene, 200);
        return;
      }

      sceneReadyRef.current = true;

      if (user && region) {
        scene.setLocalPlayer(user.id, region);
      }

      scene.onBoardClick = (arenaId: string, arenaTitle: string) => {
        if (!user || !profile || !region) return;
        const state = useGameStore.getState();
        if (state.selectedBoard || state.boardLocked) return;

        scene.lockMovement(arenaId);
        setBoardLocked(true);

        supabase
          .from('boards')
          .upsert(
            { region, name: arenaTitle, x: 0, y: 0, status: 'free' },
            { onConflict: 'region,name', ignoreDuplicates: true }
          )
          .then(() => {
            return supabase
              .from('boards')
              .select('*')
              .eq('region', region)
              .eq('name', arenaTitle)
              .single();
          })
          .then(({ data }) => {
            if (data) {
              setSelectedBoard(data);

              if (data.status === 'waiting' && data.waiting_user_id !== user.id) {
                scene.movePlayerToBoard(arenaId, 'right');
              }
            } else {
              setBoardLocked(false);
              scene.unlockMovement();
            }
          });
      };

      scene.onPositionUpdate = () => {};

      connectSocket();

      socket.on('connect', () => {
        if (user && profile && region) {
          const pos = scene.getPlayerPosition();
          joinWorld({
            playerId: user.id,
            username: profile.username,
            rating: profile.rating,
            region,
            x: pos.x,
            y: pos.y,
          });

          const arenas = scene.getArenas();
          if (arenas.length > 0) {
            registerBoards({
              region,
              boards: arenas.map(a => ({ id: a.id, name: a.title, x: a.x, y: a.y })),
            });
          }
        }
      });

      if (socket.connected && user && profile && region) {
        const pos = scene.getPlayerPosition();
        joinWorld({
          playerId: user.id,
          username: profile.username,
          rating: profile.rating,
          region,
          x: pos.x,
          y: pos.y,
        });
        const arenas = scene.getArenas();
        if (arenas.length > 0) {
          registerBoards({ region, boards: arenas.map(a => ({ id: a.id, name: a.title, x: a.x, y: a.y })) });
        }
      }

      socket.on('world_state', (payload: { players: PlayerState[]; boards: BoardState[] }) => {
        scene.handlePlayerSnapshot(payload.players);
      });

      socket.on('player_snapshot', (players: PlayerState[]) => {
        scene.handlePlayerSnapshot(players);
      });

      socket.on('player_joined', (player: PlayerState) => {
        scene.handlePlayerJoined(player);
      });

      socket.on('player_left', (payload: { playerId: string }) => {
        scene.handlePlayerLeft(payload.playerId);
      });

      socket.on('board_state_update', (board: BoardState) => {
        useGameStore.getState().setBoards(
          useGameStore.getState().boards.map(b => b.id === board.id ? { ...b, status: board.status === 'idle' ? 'free' : board.status === 'waiting' ? 'waiting' : 'in_match' } : b)
        );
      });

      socket.on('board_waiting', (_payload) => {});

      socket.on('match_started', (match: MatchState) => {
        if (!user) return;
        const matchData = {
          id: match.id,
          region: match.region,
          board_id: match.boardId,
          white_user_id: match.whitePlayerId,
          black_user_id: match.blackPlayerId,
          current_fen: match.fen,
          pgn: match.pgn,
          status: 'playing',
          winner_user_id: null,
          result: null,
          turn: match.turn,
          time_minutes: 10,
          increment_seconds: 0,
          white_time_ms: 600000,
          black_time_ms: 600000,
          last_move_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          finished_at: null,
        };
        setCurrentMatch(matchData);
        initMatch(matchData, user.id);
        setBoardLocked(false);
        scene.unlockMovement();
      });

      socket.on('chess_state_update', (payload) => {
        useChessStore.getState().syncFen(payload.fen, payload.turn);
      });

      socket.on('chess_match_finished', (payload) => {
        console.log(`[Socket] match_finished: ${payload.matchId} (${payload.reason})`);
        useGameStore.getState().setCurrentMatch(null);
      });

      socket.on('error', (payload) => {
        console.warn(`[Socket] Error: ${payload.message}`);
      });

      // Register global callback for broadcast-based board status updates
      window.__updateBoardStatusInScene = (boardName: string, status: string) => {
        scene.updateBoardStatus(boardName, status);
      };

      // Subscribe to board status changes for visual indicators
      const unsubscribe = useGameStore.subscribe((state, prevState) => {
        if (prevState.boardLocked && !state.boardLocked && !state.selectedBoard) {
          scene.unlockMovement();
        }
        if (prevState.selectedBoard && !state.selectedBoard && !state.boardLocked) {
          scene.unlockMovement();
        }

        if (state.boards !== prevState.boards) {
          state.boards.forEach(board => {
            scene.updateBoardStatus(board.name, board.status);
          });
        }
      });

      // Initial board status update + retry after boards load
      const pushBoardStatuses = () => {
        const currentBoards = useGameStore.getState().boards;
        currentBoards.forEach(board => {
          scene.updateBoardStatus(board.name, board.status);
        });
      };
      pushBoardStatuses();
      setTimeout(pushBoardStatuses, 2000);
      setTimeout(pushBoardStatuses, 5000);

      (containerRef.current as any).__unsubscribe = unsubscribe;
    };

    setTimeout(setupScene, 500);

    return () => {
      socket.off('world_state');
      socket.off('player_snapshot');
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('board_state_update');
      socket.off('board_waiting');
      socket.off('match_started');
      socket.off('chess_state_update');
      socket.off('chess_match_finished');
      socket.off('error');

      if ((containerRef.current as any)?.__unsubscribe) {
        (containerRef.current as any).__unsubscribe();
      }

      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneReadyRef.current = false;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
