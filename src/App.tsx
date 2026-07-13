import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useGameStore } from './stores/gameStore';
import { useChessStore } from './stores/chessStore';
import { supabase } from './lib/supabase';
import { AuthPage } from './components/auth/AuthPage';
import { ServerSelect } from './components/game/ServerSelect';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/ui/HUD';
import { PublicChat } from './components/chat/PublicChat';
import { PlayerProfile } from './components/profile/PlayerProfile';
import { BoardModal } from './components/game/BoardModal';
import { HouseModal } from './components/game/HouseModal';
import { FriendRequests } from './components/game/FriendRequests';
import { SettingsModal } from './components/game/SettingsModal';
import { VoiceChatPanel } from './components/game/VoiceChatPanel';
import { ChessBoard } from './components/chess/ChessBoard';
import { useRealtimePlayers } from './hooks/useRealtimePlayers';
import { useRealtimeBoards } from './hooks/useRealtimeBoards';
import { useRealtimeChat } from './hooks/useRealtimeChat';
import { useRealtimeMatch } from './hooks/useRealtimeMatch';
import { useColyseusConnection } from './hooks/useColyseusConnection';
import { Loader2 } from 'lucide-react';

function App() {
  const { user, profile, loading, initialized, initialize } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    initialize();
  }, []);

  if (!initialized || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-slate-400">Loading ChessWorld...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <AuthPage />;
  }

  if (!region) {
    return <ServerSelect />;
  }

  return <GameScene />;
}

function GameScene() {
  const { setCurrentMatch, setBoardLocked } = useGameStore();
  const { match, reset: resetChess } = useChessStore();
  const { user } = useAuthStore();
  const [opponentInfo, setOpponentInfo] = useState<{ username: string; rating: number } | null>(null);

  useRealtimePlayers();
  useRealtimeBoards();
  useRealtimeChat();
  useRealtimeMatch();
  useColyseusConnection();

  // Fetch opponent profile when match changes
  useEffect(() => {
    if (!match || !user) {
      setOpponentInfo(null);
      return;
    }

    const opponentId = match.white_user_id === user.id ? match.black_user_id : match.white_user_id;

    supabase
      .from('profiles')
      .select('username, rating')
      .eq('user_id', opponentId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setOpponentInfo({ username: data.username, rating: data.rating });
        }
      });
  }, [match?.id, user?.id]);

  const handleCloseChess = () => {
    resetChess();
    setCurrentMatch(null);
    setBoardLocked(false);
    setOpponentInfo(null);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900">
      <GameCanvas />
      <HUD />
      <PublicChat />
      <PlayerProfile />
      <BoardModal />
      <HouseModal />
      <FriendRequests />
      <SettingsModal />
      <VoiceChatPanel />

      {match && (
        <ChessBoard
          onClose={handleCloseChess}
          opponentName={opponentInfo?.username}
          opponentRating={opponentInfo?.rating}
        />
      )}
    </div>
  );
}

export default App;
