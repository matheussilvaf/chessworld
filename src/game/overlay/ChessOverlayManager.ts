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

interface PieceSprite {
  image: Phaser.GameObjects.Image;
  square: string;
  color: string;
}

interface ActiveOverlay {
  container: Phaser.GameObjects.Container;
  boardGfx: Phaser.GameObjects.Graphics;
  highlightGfx: Phaser.GameObjects.Graphics;
  pieces: PieceSprite[];
  hitZone: Phaser.GameObjects.Zone | null;
  banner?: Phaser.GameObjects.Container;
  currentFen: string;
}

export class ChessOverlayManager {
  private scene: Phaser.Scene;
  private overlays = new Map<string, ActiveOverlay>();
  private configs = new Map<string, TableOverlayConfig>();
  private assetsLoaded = false;
  private activeTableId: string | null = null;

  // Interaction state
  private selectedSquare: string | null = null;
  private validMoves: string[] = [];
  private dragging: PieceSprite | null = null;
  private dragStartSquare: string | null = null;
  private dragOrigX = 0;
  private dragOrigY = 0;

  // Last move tracking
  private lastMoveFrom: string | null = null;
  private lastMoveTo: string | null = null;

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
      this.scene.load.once('complete', () => { this.assetsLoaded = true; });
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

    const oldFen = overlay.currentFen;
    overlay.currentFen = fen;

    // Track last move from chess store
    const store = useChessStore.getState();
    if (store.game && store.boardId === tableId) {
      const history = store.game.history({ verbose: true });
      if (history.length > 0) {
        const last = history[history.length - 1];
        this.lastMoveFrom = last.from;
        this.lastMoveTo = last.to;
      }
    }

    if (oldFen !== fen || !overlay.hitZone) {
      this.renderBoard(tableId);
    }
  }

  hideMatchOverlay(tableId: string) {
    const overlay = this.overlays.get(tableId);
    if (overlay) {
      overlay.container.setVisible(false);
      this.destroyHitZone(overlay);
    }
    if (this.activeTableId === tableId) {
      this.clearInteractionState();
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
      fontFamily: 'Arial, sans-serif', fontSize: '7px', fontStyle: 'bold',
      color: '#ffffff', resolution: 2,
    }).setOrigin(0.5);

    const sub = this.scene.add.text(0, 6, `${playerName} | ${timeLabel}`, {
      fontFamily: 'Arial, sans-serif', fontSize: '6px',
      color: '#fde68a', resolution: 2,
    }).setOrigin(0.5);

    banner.add([bg, text, sub]);
    this.scene.tweens.add({
      targets: banner, alpha: { from: 1, to: 0.55 },
      duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
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
      fontFamily: 'Arial, sans-serif', fontSize: '6px', fontStyle: 'bold',
      color: '#ffffff', resolution: 2,
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
    this.clearInteractionState();
    const overlay = this.overlays.get(tableId);
    if (overlay) this.renderBoard(tableId);
  }

  clearActiveTable() {
    const prev = this.activeTableId;
    this.activeTableId = null;
    this.clearInteractionState();
    if (prev) {
      const overlay = this.overlays.get(prev);
      if (overlay) {
        this.destroyHitZone(overlay);
        this.renderBoard(prev);
      }
    }
  }

  private clearInteractionState() {
    this.selectedSquare = null;
    this.validMoves = [];
    this.dragging = null;
    this.dragStartSquare = null;
  }

  private createOverlay(config: TableOverlayConfig): ActiveOverlay {
    const container = this.scene.add.container(config.x, config.y).setDepth(150);
    const boardGfx = this.scene.add.graphics();
    const highlightGfx = this.scene.add.graphics();
    container.add([boardGfx, highlightGfx]);
    container.setVisible(false);

    return {
      container, boardGfx, highlightGfx,
      pieces: [], hitZone: null, currentFen: '',
    };
  }

  private renderBoard(tableId: string) {
    const overlay = this.overlays.get(tableId);
    const config = this.configs.get(tableId);
    if (!overlay || !config) return;

    const { boardGfx, highlightGfx, container } = overlay;
    const sqW = config.width / 8;
    const sqH = config.height / 8;

    boardGfx.clear();
    highlightGfx.clear();
    for (const ps of overlay.pieces) ps.image.destroy();
    overlay.pieces = [];

    // Draw board squares
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;
        boardGfx.fillStyle(isLight ? LIGHT_COLOR : DARK_COLOR, 1);
        boardGfx.fillRect(file * sqW, rank * sqH, sqW, sqH);
      }
    }

    // Last move highlight
    if (this.lastMoveFrom) {
      const f = FILES.indexOf(this.lastMoveFrom[0]);
      const r = RANKS.indexOf(this.lastMoveFrom[1]);
      if (f >= 0 && r >= 0) {
        highlightGfx.fillStyle(LAST_MOVE_COLOR, 0.5);
        highlightGfx.fillRect(f * sqW, r * sqH, sqW, sqH);
      }
    }
    if (this.lastMoveTo) {
      const f = FILES.indexOf(this.lastMoveTo[0]);
      const r = RANKS.indexOf(this.lastMoveTo[1]);
      if (f >= 0 && r >= 0) {
        highlightGfx.fillStyle(LAST_MOVE_COLOR, 0.5);
        highlightGfx.fillRect(f * sqW, r * sqH, sqW, sqH);
      }
    }

    // Selected square highlight
    if (this.activeTableId === tableId && this.selectedSquare) {
      const sf = FILES.indexOf(this.selectedSquare[0]);
      const sr = RANKS.indexOf(this.selectedSquare[1]);
      if (sf >= 0 && sr >= 0) {
        highlightGfx.fillStyle(SELECTED_COLOR, 0.8);
        highlightGfx.fillRect(sf * sqW, sr * sqH, sqW, sqH);
      }

      // Valid move dots
      for (const move of this.validMoves) {
        const mf = FILES.indexOf(move[0]);
        const mr = RANKS.indexOf(move[1]);
        if (mf >= 0 && mr >= 0) {
          highlightGfx.fillStyle(VALID_MOVE_COLOR, 0.7);
          highlightGfx.fillCircle(mf * sqW + sqW / 2, mr * sqH + sqH / 2, sqW * 0.2);
        }
      }
    }

    // Parse FEN and render pieces
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
          const square = FILES[file] + RANKS[rank];

          if (textureKey && this.assetsLoaded && this.scene.textures.exists(textureKey)) {
            const img = this.scene.add.image(
              file * sqW + sqW / 2,
              rank * sqH + sqH / 2,
              textureKey,
            );
            const pieceSize = sqW * 0.88;
            img.setDisplaySize(pieceSize, pieceSize);
            container.add(img);
            overlay.pieces.push({ image: img, square, color });
          }
          file++;
        }
      }
    }

    // Setup interactive hit zone for the active table
    if (this.activeTableId === tableId) {
      this.setupDragInteraction(tableId, overlay, config);
    }
  }

  private setupDragInteraction(tableId: string, overlay: ActiveOverlay, config: TableOverlayConfig) {
    this.destroyHitZone(overlay);

    // Single large zone covering the entire board for drag handling
    const zone = this.scene.add.zone(
      config.x + config.width / 2,
      config.y + config.height / 2,
      config.width,
      config.height,
    ).setInteractive({ useHandCursor: true, draggable: false }).setDepth(151);

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(tableId, pointer, config, overlay);
    });

    zone.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) {
        this.handleDragMove(pointer, config);
      }
    });

    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) {
        this.handleDrop(tableId, pointer, config);
      }
    });

    zone.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) {
        this.handleDrop(tableId, pointer, config);
      }
    });

    overlay.hitZone = zone;
  }

  private handlePointerDown(tableId: string, pointer: Phaser.Input.Pointer, config: TableOverlayConfig, overlay: ActiveOverlay) {
    const store = useChessStore.getState();
    if (!store.game || !store.playerColor || store.gameOver || store.isSpectating) return;

    const isMyTurn = store.turn === store.playerColor;
    const { file, rank, square } = this.pointerToSquare(pointer, config);
    if (file < 0 || rank < 0) return;

    // If a square is selected and user clicks a valid move target (tap-to-move)
    if (this.selectedSquare && this.validMoves.includes(square)) {
      store.makeMove(this.selectedSquare, square);
      this.clearInteractionState();
      return;
    }

    if (!isMyTurn) {
      this.clearInteractionState();
      this.renderBoard(tableId);
      return;
    }

    // Check if there's a piece of our color on this square
    const piece = store.game.get(square as any);
    if (piece && piece.color === store.playerColor) {
      const moves = store.game.moves({ square: square as any, verbose: true });
      this.selectedSquare = square;
      this.validMoves = moves.map(m => m.to);
      this.dragStartSquare = square;

      // Find the piece sprite and start dragging
      const ps = overlay.pieces.find(p => p.square === square);
      if (ps) {
        this.dragging = ps;
        this.dragOrigX = ps.image.x;
        this.dragOrigY = ps.image.y;
        ps.image.setDepth(200);
      }

      this.renderBoard(tableId);
      // Re-bring dragged piece to top after render
      if (this.dragging) {
        this.dragging.image.setDepth(200);
      }
    } else {
      // Clicked empty square or opponent piece - deselect
      this.clearInteractionState();
      this.renderBoard(tableId);
    }
  }

  private handleDragMove(pointer: Phaser.Input.Pointer, config: TableOverlayConfig) {
    if (!this.dragging) return;
    // Convert world pointer to container-local coordinates
    const localX = pointer.worldX - config.x;
    const localY = pointer.worldY - config.y;
    this.dragging.image.setPosition(localX, localY);
  }

  private handleDrop(tableId: string, pointer: Phaser.Input.Pointer, config: TableOverlayConfig) {
    if (!this.dragging || !this.dragStartSquare) {
      this.dragging = null;
      return;
    }

    const { square: targetSquare } = this.pointerToSquare(pointer, config);

    if (targetSquare && this.validMoves.includes(targetSquare) && targetSquare !== this.dragStartSquare) {
      // Valid move - execute it
      const store = useChessStore.getState();
      store.makeMove(this.dragStartSquare, targetSquare);
      this.clearInteractionState();
    } else {
      // Invalid drop - snap back
      if (this.dragging) {
        this.scene.tweens.add({
          targets: this.dragging.image,
          x: this.dragOrigX,
          y: this.dragOrigY,
          duration: 150,
          ease: 'Power2',
        });
        this.dragging.image.setDepth(0);
      }
      // Keep selection active if dropped on same square (was just a click)
      if (targetSquare === this.dragStartSquare) {
        this.dragging = null;
        this.dragStartSquare = null;
      } else {
        this.clearInteractionState();
        this.renderBoard(tableId);
      }
    }

    this.dragging = null;
    this.dragStartSquare = null;
  }

  private pointerToSquare(pointer: Phaser.Input.Pointer, config: TableOverlayConfig): { file: number; rank: number; square: string } {
    const localX = pointer.worldX - config.x;
    const localY = pointer.worldY - config.y;
    const sqW = config.width / 8;
    const sqH = config.height / 8;

    const file = Math.floor(localX / sqW);
    const rank = Math.floor(localY / sqH);

    if (file < 0 || file > 7 || rank < 0 || rank > 7) {
      return { file: -1, rank: -1, square: '' };
    }

    return { file, rank, square: FILES[file] + RANKS[rank] };
  }

  private destroyHitZone(overlay: ActiveOverlay) {
    if (overlay.hitZone) {
      overlay.hitZone.destroy();
      overlay.hitZone = null;
    }
  }
}
