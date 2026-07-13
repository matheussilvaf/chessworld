import { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { useGameStore } from './stores/gameStore';
import { useChessStore } from './stores/chessStore';
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
  useColyseusConnection();
  const showChessBoard = useChessStore((s) => s.showBoard);

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
      {showChessBoard && <ChessBoard />}
    </div>
  );
}

export default App;
