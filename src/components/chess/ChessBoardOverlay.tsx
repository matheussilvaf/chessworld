import { useState, useEffect, useRef, useCallback } from 'react';
import { useChessStore } from '../../stores/chessStore';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PIECE_IMAGES: Record<string, string> = {
  wp: '/assets/chesspieces/whitepawn.png',
  wn: '/assets/chesspieces/whiteknight.png',
  wb: '/assets/chesspieces/whitebishop.png',
  wr: '/assets/chesspieces/whiterock.png',
  wq: '/assets/chesspieces/whitequeen.png',
  wk: '/assets/chesspieces/whiteking.png',
  bp: '/assets/chesspieces/blackpawn.png',
  bn: '/assets/chesspieces/blackknight.png',
  bb: '/assets/chesspieces/blackbiship.png',
  br: '/assets/chesspieces/blackrock.png',
  bq: '/assets/chesspieces/blackqueen.png',
  bk: '/assets/chesspieces/blackking.png',
};

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';
const SELECTED_SQ = '#829769';
const VALID_MOVE_DOT = 'rgba(100, 111, 64, 0.7)';
const LAST_MOVE_SQ = 'rgba(205, 210, 106, 0.5)';

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChessBoardOverlayHandle {
  setScreenRect: (rect: ScreenRect | null) => void;
}

export function ChessBoardOverlay() {
  const {
    matchId, game, playerColor, turn, gameOver, isSpectating,
  } = useChessStore();
  const { makeMove } = useChessStore();

  const [screenRect, setScreenRect] = useState<ScreenRect | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<string[]>([]);
  const [dragPiece, setDragPiece] = useState<{ square: string; key: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Poll screen rect from global callback set by Phaser scene
  useEffect(() => {
    if (!matchId) {
      setScreenRect(null);
      return;
    }
    const poll = () => {
      const rect = (window as any).__chessOverlayRect as ScreenRect | null;
      if (rect) setScreenRect(rect);
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [matchId]);

  // Reset selection on turn change
  useEffect(() => {
    setSelectedSquare(null);
    setValidMoves([]);
  }, [turn]);

  if (!matchId || !game || !screenRect) return null;

  const isBlack = playerColor === 'b';
  const files = isBlack ? [...FILES].reverse() : FILES;
  const ranks = isBlack ? [...RANKS].reverse() : RANKS;

  const isMyTurn = !isSpectating && !gameOver && turn === playerColor;

  // Get last move
  const history = game.history({ verbose: true });
  const lastMove = history.length > 0 ? history[history.length - 1] : null;

  // Parse board from FEN
  const boardMap = new Map<string, string>();
  const fen = game.fen().split(' ')[0];
  const fenRanks = fen.split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of fenRanks[r]) {
      if (ch >= '1' && ch <= '8') { f += parseInt(ch); }
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const piece = ch.toLowerCase();
        const square = FILES[f] + RANKS[r];
        boardMap.set(square, color + piece);
        f++;
      }
    }
  }

  const sqSize = screenRect.width / 8;

  const handleSquareClick = (square: string) => {
    if (isDragging) return;

    if (selectedSquare && validMoves.includes(square)) {
      makeMove(selectedSquare, square);
      setSelectedSquare(null);
      setValidMoves([]);
      return;
    }

    if (!isMyTurn) {
      setSelectedSquare(null);
      setValidMoves([]);
      return;
    }

    const piece = game.get(square as any);
    if (piece && piece.color === playerColor) {
      const moves = game.moves({ square: square as any, verbose: true });
      setSelectedSquare(square);
      setValidMoves(moves.map(m => m.to));
    } else {
      setSelectedSquare(null);
      setValidMoves([]);
    }
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent, square: string) => {
    if (!isMyTurn) return;
    const piece = game.get(square as any);
    if (!piece || piece.color !== playerColor) return;

    const moves = game.moves({ square: square as any, verbose: true });
    setSelectedSquare(square);
    setValidMoves(moves.map(m => m.to));

    const pieceKey = boardMap.get(square);
    if (!pieceKey) return;

    setDragPiece({ square, key: pieceKey });
    setIsDragging(true);

    const clientPos = 'touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
    setDragPos(clientPos);
  };

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    const clientPos = 'touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
    setDragPos(clientPos);
  }, [isDragging]);

  const handleDragEnd = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging || !dragPiece) {
      setIsDragging(false);
      setDragPiece(null);
      return;
    }

    const clientPos = 'changedTouches' in e
      ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
      : { x: e.clientX, y: e.clientY };

    // Find which square was dropped on
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const localX = clientPos.x - rect.left;
      const localY = clientPos.y - rect.top;
      const sqW = rect.width / 8;
      const sqH = rect.height / 8;
      const fileIdx = Math.floor(localX / sqW);
      const rankIdx = Math.floor(localY / sqH);

      if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
        const targetSquare = files[fileIdx] + ranks[rankIdx];
        if (validMoves.includes(targetSquare)) {
          makeMove(dragPiece.square, targetSquare);
        }
      }
    }

    setIsDragging(false);
    setDragPiece(null);
    setSelectedSquare(null);
    setValidMoves([]);
  }, [isDragging, dragPiece, validMoves, files, ranks, makeMove]);

  // Global event listeners for drag
  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  return (
    <>
      <div
        ref={containerRef}
        className="fixed z-[100] select-none"
        style={{
          left: screenRect.x,
          top: screenRect.y,
          width: screenRect.width,
          height: screenRect.height,
          pointerEvents: 'auto',
        }}
      >
        <div className="w-full h-full grid grid-cols-8 grid-rows-8 rounded-sm overflow-hidden shadow-xl border border-amber-900/40">
          {ranks.map((rank) =>
            files.map((file) => {
              const square = file + rank;
              const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
              const pieceKey = boardMap.get(square);
              const isSelected = selectedSquare === square;
              const isValidMove = validMoves.includes(square);
              const isLastMoveFrom = lastMove?.from === square;
              const isLastMoveTo = lastMove?.to === square;
              const isBeingDragged = dragPiece?.square === square && isDragging;

              let bgColor = isLight ? LIGHT_SQ : DARK_SQ;
              if (isSelected) bgColor = SELECTED_SQ;
              else if (isLastMoveFrom || isLastMoveTo) bgColor = LAST_MOVE_SQ;

              return (
                <div
                  key={square}
                  className="relative flex items-center justify-center cursor-pointer"
                  style={{ backgroundColor: bgColor }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (pieceKey) handleDragStart(e, square);
                    else handleSquareClick(square);
                  }}
                  onTouchStart={(e) => {
                    if (pieceKey) handleDragStart(e, square);
                    else handleSquareClick(square);
                  }}
                  onClick={() => {
                    if (!isDragging) handleSquareClick(square);
                  }}
                >
                  {/* Piece image */}
                  {pieceKey && !isBeingDragged && (
                    <img
                      src={PIECE_IMAGES[pieceKey]}
                      alt={pieceKey}
                      className="w-[85%] h-[85%] object-contain pointer-events-none"
                      draggable={false}
                    />
                  )}

                  {/* Ghost piece while dragging */}
                  {pieceKey && isBeingDragged && (
                    <img
                      src={PIECE_IMAGES[pieceKey]}
                      alt={pieceKey}
                      className="w-[85%] h-[85%] object-contain pointer-events-none opacity-30"
                      draggable={false}
                    />
                  )}

                  {/* Valid move indicator */}
                  {isValidMove && !pieceKey && (
                    <div
                      className="absolute rounded-full"
                      style={{
                        width: '30%', height: '30%',
                        backgroundColor: VALID_MOVE_DOT,
                      }}
                    />
                  )}

                  {/* Valid capture indicator */}
                  {isValidMove && pieceKey && (
                    <div
                      className="absolute inset-0 rounded-full border-[3px]"
                      style={{ borderColor: VALID_MOVE_DOT }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Dragged piece following cursor */}
      {isDragging && dragPiece && (
        <div
          className="fixed z-[300] pointer-events-none"
          style={{
            left: dragPos.x - sqSize * 0.5,
            top: dragPos.y - sqSize * 0.7,
            width: sqSize,
            height: sqSize,
          }}
        >
          <img
            src={PIECE_IMAGES[dragPiece.key]}
            alt="dragging"
            className="w-full h-full object-contain drop-shadow-lg"
            style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))' }}
            draggable={false}
          />
        </div>
      )}
    </>
  );
}
