import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChessStore } from '../../stores/chessStore';

// Preload all piece images at module load so they're cached before rendering
const preloadedImages = new Map<string, HTMLImageElement>();
let imagesReady = false;
const imageLoadPromises: Promise<void>[] = [];

function preloadAllPieces() {
  const paths = Object.values({
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
  });
  for (const src of paths) {
    const img = new Image();
    img.src = src;
    preloadedImages.set(src, img);
    imageLoadPromises.push(
      new Promise<void>((resolve) => {
        if (img.complete) { resolve(); return; }
        img.onload = () => resolve();
        img.onerror = () => resolve();
      })
    );
  }
  Promise.all(imageLoadPromises).then(() => { imagesReady = true; });
}
preloadAllPieces();

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

export function ChessBoardOverlay() {
  const matchId = useChessStore(s => s.matchId);
  const game = useChessStore(s => s.game);
  const playerColor = useChessStore(s => s.playerColor);
  const turn = useChessStore(s => s.turn);
  const gameOver = useChessStore(s => s.gameOver);
  const isSpectating = useChessStore(s => s.isSpectating);
  const makeMove = useChessStore(s => s.makeMove);
  const lastMove = useChessStore(s => s.lastMove);

  const [screenRect, setScreenRect] = useState<ScreenRect | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<string[]>([]);
  const [dragPiece, setDragPiece] = useState<{ square: string; key: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [piecesLoaded, setPiecesLoaded] = useState(imagesReady);

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const filesRef = useRef(FILES);
  const ranksRef = useRef(RANKS);

  const isBlack = playerColor === 'b';
  const files = useMemo(() => isBlack ? [...FILES].reverse() : FILES, [isBlack]);
  const ranks = useMemo(() => isBlack ? [...RANKS].reverse() : RANKS, [isBlack]);

  // Keep refs in sync for use in callbacks
  filesRef.current = files;
  ranksRef.current = ranks;

  // Wait for piece images to be cached
  useEffect(() => {
    if (imagesReady) { setPiecesLoaded(true); return; }
    Promise.all(imageLoadPromises).then(() => setPiecesLoaded(true));
  }, []);

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

  // Drag move handler
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    const clientPos = 'touches' in e
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX, y: e.clientY };
    setDragPos(clientPos);
  }, []);

  // Drag end handler
  const handleDragEnd = useCallback((e: MouseEvent | TouchEvent) => {
    const clientPos = 'changedTouches' in e
      ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
      : { x: e.clientX, y: e.clientY };

    setIsDragging(false);
    setDragPiece((currentDragPiece) => {
      if (!currentDragPiece) return null;

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
          const targetSquare = filesRef.current[fileIdx] + ranksRef.current[rankIdx];
          setValidMoves((currentValid) => {
            if (currentValid.includes(targetSquare)) {
              makeMove(currentDragPiece.square, targetSquare);
            }
            return [];
          });
        }
      }

      setSelectedSquare(null);
      return null;
    });
  }, [makeMove]);

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

  // --- All hooks above, conditional return below ---

  if (!matchId || !game || !screenRect || !piecesLoaded) return null;

  const isMyTurn = !isSpectating && !gameOver && turn === playerColor;

  // Parse board from FEN
  const boardMap = new Map<string, string>();
  try {
    const fen = game.fen().split(' ')[0];
    const fenRanks = fen.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      const rankStr = fenRanks[r];
      if (!rankStr) continue;
      for (const ch of rankStr) {
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
  } catch { /* game may be in transient state */ }

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

    try {
      const piece = game.get(square as any);
      if (piece && piece.color === playerColor) {
        const moves = game.moves({ square: square as any, verbose: true });
        setSelectedSquare(square);
        setValidMoves(moves.map(m => m.to));
      } else {
        setSelectedSquare(null);
        setValidMoves([]);
      }
    } catch {
      setSelectedSquare(null);
      setValidMoves([]);
    }
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent, square: string) => {
    if (!isMyTurn) return;
    try {
      const piece = game.get(square as any);
      if (!piece || piece.color !== playerColor) return;

      const moves = game.moves({ square: square as any, verbose: true });
      setSelectedSquare(square);
      setValidMoves(moves.map(m => m.to));
    } catch { return; }

    const pieceKey = boardMap.get(square);
    if (!pieceKey) return;

    setDragPiece({ square, key: pieceKey });
    setIsDragging(true);

    const clientPos = 'touches' in e
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX, y: e.clientY };
    setDragPos(clientPos);
  };

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
                    if (pieceKey && isMyTurn) handleDragStart(e, square);
                    else handleSquareClick(square);
                  }}
                  onTouchStart={(e) => {
                    if (pieceKey && isMyTurn) handleDragStart(e, square);
                    else handleSquareClick(square);
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
                  {isValidMove && pieceKey && !isBeingDragged && (
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
            className="w-full h-full object-contain"
            style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))' }}
            draggable={false}
          />
        </div>
      )}
    </>
  );
}
