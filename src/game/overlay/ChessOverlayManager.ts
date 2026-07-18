import Phaser from 'phaser';
import { useChessStore } from '../../stores/chessStore';

const LIGHT_COLOR = 0xf0d9b5;
const DARK_COLOR = 0xb58863;
const SELECTED_COLOR = 0x829769;
const VALID_MOVE_COLOR = 0x646f40;
const LAST_MOVE_COLOR = 0xcdd26a;

const PIECE_IMAGE_MAP: Record<string, string> = {
  wk: 'overlay_wk', wq: 'overlay_wq', wr: 'overlay_wr',
  wb: 'overlay_wb', wn: 'overlay_wn', wp: 'overlay_wp',
  bk: 'overlay_bk', bq: 'overlay_bq', br: 'overlay_br',
  bb: 'overlay_bb', bn: 'overlay_bn', bp: 'overlay_bp',
};

const PIECE_PATHS: Record<string, string> = {
  overlay_wk: 'assets/chesspieces/whiteking.png',
  overlay_wq: 'assets/chesspieces/whitequeen.png',
  overlay_wr: 'assets/chesspieces/whiterock.png',
  overlay_wb: 'assets/chesspieces/whitebishop.png',
  overlay_wn: 'assets/chesspieces/whiteknight.png',
  overlay_wp: 'assets/chesspieces/whitepawn.png',
  overlay_bk: 'assets/chesspieces/blackking.png',
  overlay_bq: 'assets/chesspieces/blackqueen.png',
  overlay_br: 'assets/chesspieces/blackrock.png',
  overlay_bb: 'assets/chesspieces/blackbiship.png',
  overlay_bn: 'assets/chesspieces/blackknight.png',
  overlay_bp: 'assets/chesspieces/blackpawn.png',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export interface TableOverlayConfig {
  tableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ActiveOverlay {
  container: Phaser.GameObjects.Container;
  boardGfx: Phaser.GameObjects.Graphics;
  highlightGfx: Phaser.GameObjects.Graphics;
  pieces: Phaser.GameObjects.Image[];
  hitZones: Phaser.GameObjects.Zone[];
  banner?: Phaser.GameObjects.Container;
  currentFen: string;
}

export class ChessOverlayManager {
  private scene: Phaser.Scene;
  private overlays = new Map<string, ActiveOverlay>();
  private configs = new Map<string, TableOverlayConfig>();
  private assetsLoaded = false;
  private selectedSquare: string | null = null;
  private validMoves: string[] = [];
  private activeTableId: string | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.loadPieceAssets();
  }

  private loadPieceAssets() {
    let needsLoad = false;
    for (const [key, path] of Object.entries(PIECE_PATHS)) {
      if (!this.scene.textures.exists(key)) {
        this.scene.load.image(key, path);
        needsLoad = true;
      }
    }
    if (needsLoad) {
      this.scene.load.once('complete', () => {
        this.assetsLoaded = true;
      });
      this.scene.load.start();
    } else {
      this.assetsLoaded = true;
    }
  }

  registerTable(config: TableOverlayConfig) {
    this.configs.set(config.tableId, config);
  }

  showMatchOverlay(tableId: string, fen: string) {
    const config = this.configs.get(tableId);
    if (!config) return;

    let overlay = this.overlays.get(tableId);
    if (!overlay) {
      overlay = this.createOverlay(config);
      this.overlays.set(tableId, overlay);
    }

    this.removeBanner(tableId);
    overlay.container.setVisible(true);
    overlay.currentFen = fen;
    this.renderBoard(tableId);
  }

  hideMatchOverlay(tableId: string) {
    const overlay = this.overlays.get(tableId);
    if (overlay) {
      overlay.container.setVisible(false);
      this.clearHitZones(overlay);
    }
    if (this.activeTableId === tableId) {
      this.selectedSquare = null;
      this.validMoves = [];
      this.activeTableId = null;
    }
  }

  showWaitingBanner(tableId: string, playerName: string, timeLabel: string) {
    const config = this.configs.get(tableId);
    if (!config) return;

    this.removeBanner(tableId);

    const cx = config.x + config.width / 2;
    const bannerY = config.y - 16;

    const banner = this.scene.add.container(cx, bannerY).setDepth(160);

    const bannerW = Math.max(config.width + 8, 110);
    const bannerH = 22;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0xd97706, 0.95);
    bg.fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 4);
    bg.lineStyle(1, 0xfbbf24, 1);
    bg.strokeRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 4);

    const text = this.scene.add.text(0, -4, 'Waiting for duel', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '7px',
      fontStyle: 'bold',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5);

    const sub = this.scene.add.text(0, 6, `${playerName} | ${timeLabel}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '6px',
      color: '#fde68a',
      resolution: 2,
    }).setOrigin(0.5);

    banner.add([bg, text, sub]);

    this.scene.tweens.add({
      targets: banner,
      alpha: { from: 1, to: 0.55 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    let overlay = this.overlays.get(tableId);
    if (!overlay) {
      overlay = this.createOverlay(config);
      this.overlays.set(tableId, overlay);
    }
    overlay.banner = banner;
  }

  showInProgressBanner(tableId: string) {
    const config = this.configs.get(tableId);
    if (!config) return;
    this.removeBanner(tableId);

    const cx = config.x + config.width / 2;
    const bannerY = config.y - 10;

    const banner = this.scene.add.container(cx, bannerY).setDepth(160);

    const bannerW = 80;
    const bannerH = 14;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x059669, 0.9);
    bg.fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);

    const text = this.scene.add.text(0, 0, 'Match in progress', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '6px',
      fontStyle: 'bold',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5);

    banner.add([bg, text]);

    let overlay = this.overlays.get(tableId);
    if (!overlay) {
      overlay = this.createOverlay(config);
      this.overlays.set(tableId, overlay);
    }
    overlay.banner = banner;
  }

  removeBanner(tableId: string) {
    const overlay = this.overlays.get(tableId);
    if (overlay?.banner) {
      overlay.banner.destroy();
      overlay.banner = undefined;
    }
  }

  removeAll(tableId: string) {
    this.removeBanner(tableId);
    this.hideMatchOverlay(tableId);
  }

  setActiveTable(tableId: string) {
    this.activeTableId = tableId;
    this.selectedSquare = null;
    this.validMoves = [];
    this.renderBoard(tableId);
  }

  clearActiveTable() {
    const prev = this.activeTableId;
    this.activeTableId = null;
    this.selectedSquare = null;
    this.validMoves = [];
    if (prev) this.renderBoard(prev);
  }

  refreshBoard(tableId: string, fen: string) {
    const overlay = this.overlays.get(tableId);
    if (!overlay) return;
    overlay.currentFen = fen;
    this.selectedSquare = null;
    this.validMoves = [];
    this.renderBoard(tableId);
  }

  private createOverlay(config: TableOverlayConfig): ActiveOverlay {
    const container = this.scene.add.container(config.x, config.y).setDepth(150);
    const boardGfx = this.scene.add.graphics();
    const highlightGfx = this.scene.add.graphics();
    container.add([boardGfx, highlightGfx]);
    container.setVisible(false);

    return {
      container,
      boardGfx,
      highlightGfx,
      pieces: [],
      hitZones: [],
      currentFen: '',
    };
  }

  private renderBoard(tableId: string) {
    const overlay = this.overlays.get(tableId);
    const config = this.configs.get(tableId);
    if (!overlay || !config) return;

    const { boardGfx, highlightGfx, container } = overlay;
    const sqW = config.width / 8;
    const sqH = config.height / 8;

    // Clear previous
    boardGfx.clear();
    highlightGfx.clear();
    for (const p of overlay.pieces) p.destroy();
    overlay.pieces = [];
    this.clearHitZones(overlay);

    // Draw board squares
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;
        boardGfx.fillStyle(isLight ? LIGHT_COLOR : DARK_COLOR, 1);
        boardGfx.fillRect(file * sqW, rank * sqH, sqW, sqH);
      }
    }

    // Draw highlights (selected square, valid moves)
    if (this.activeTableId === tableId && this.selectedSquare) {
      const selFile = FILES.indexOf(this.selectedSquare[0]);
      const selRank = RANKS.indexOf(this.selectedSquare[1]);
      if (selFile >= 0 && selRank >= 0) {
        highlightGfx.fillStyle(SELECTED_COLOR, 0.8);
        highlightGfx.fillRect(selFile * sqW, selRank * sqH, sqW, sqH);
      }

      for (const move of this.validMoves) {
        const mFile = FILES.indexOf(move[0]);
        const mRank = RANKS.indexOf(move[1]);
        if (mFile >= 0 && mRank >= 0) {
          highlightGfx.fillStyle(VALID_MOVE_COLOR, 0.6);
          highlightGfx.fillCircle(mFile * sqW + sqW / 2, mRank * sqH + sqH / 2, sqW * 0.2);
        }
      }
    }

    // Draw last move highlight from chess store
    const chessState = useChessStore.getState();
    if (chessState.game && chessState.boardId === tableId) {
      const history = chessState.game.history({ verbose: true });
      if (history.length > 0) {
        const lastMove = history[history.length - 1];
        const fromFile = FILES.indexOf(lastMove.from[0]);
        const fromRank = RANKS.indexOf(lastMove.from[1]);
        const toFile = FILES.indexOf(lastMove.to[0]);
        const toRank = RANKS.indexOf(lastMove.to[1]);
        if (fromFile >= 0 && fromRank >= 0) {
          highlightGfx.fillStyle(LAST_MOVE_COLOR, 0.4);
          highlightGfx.fillRect(fromFile * sqW, fromRank * sqH, sqW, sqH);
        }
        if (toFile >= 0 && toRank >= 0) {
          highlightGfx.fillStyle(LAST_MOVE_COLOR, 0.4);
          highlightGfx.fillRect(toFile * sqW, toRank * sqH, sqW, sqH);
        }
      }
    }

    // Parse FEN and place piece images
    const fenParts = overlay.currentFen.split(' ')[0];
    const ranks = fenParts.split('/');
    for (let rank = 0; rank < 8; rank++) {
      let file = 0;
      const rankStr = ranks[rank];
      if (!rankStr) continue;
      for (const ch of rankStr) {
        if (ch >= '1' && ch <= '8') {
          file += parseInt(ch);
        } else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const piece = ch.toLowerCase();
          const key = color + piece;
          const textureKey = PIECE_IMAGE_MAP[key];
          if (textureKey && this.assetsLoaded && this.scene.textures.exists(textureKey)) {
            const img = this.scene.add.image(
              file * sqW + sqW / 2,
              rank * sqH + sqH / 2,
              textureKey,
            );
            const pieceSize = sqW * 0.85;
            img.setDisplaySize(pieceSize, pieceSize);
            container.add(img);
            overlay.pieces.push(img);
          }
          file++;
        }
      }
    }

    // Add interactive hit zones only if this is the active table for the local player
    if (this.activeTableId === tableId) {
      for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
          const zone = this.scene.add.zone(
            config.x + file * sqW + sqW / 2,
            config.y + rank * sqH + sqH / 2,
            sqW,
            sqH,
          ).setInteractive({ useHandCursor: true }).setDepth(151);

          const square = FILES[file] + RANKS[rank];
          zone.on('pointerdown', () => this.handleSquareClick(tableId, square));
          overlay.hitZones.push(zone);
        }
      }
    }
  }

  private handleSquareClick(tableId: string, square: string) {
    if (this.activeTableId !== tableId) return;

    const store = useChessStore.getState();
    if (!store.game || !store.playerColor || store.gameOver || store.isSpectating) return;

    const isMyTurn = store.turn === store.playerColor;

    if (this.selectedSquare) {
      // Second click - try to make move
      if (this.validMoves.includes(square)) {
        store.makeMove(this.selectedSquare, square);
        this.selectedSquare = null;
        this.validMoves = [];
        return;
      }
      // Clicked same square or invalid - deselect
      this.selectedSquare = null;
      this.validMoves = [];
      this.renderBoard(tableId);
      return;
    }

    // First click - select piece
    if (!isMyTurn) return;

    const piece = store.game.get(square as any);
    if (piece && piece.color === store.playerColor) {
      const moves = store.game.moves({ square: square as any, verbose: true });
      this.selectedSquare = square;
      this.validMoves = moves.map(m => m.to);
      this.renderBoard(tableId);
    }
  }

  private clearHitZones(overlay: ActiveOverlay) {
    for (const z of overlay.hitZones) z.destroy();
    overlay.hitZones = [];
  }
}
