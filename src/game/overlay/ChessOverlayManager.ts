import Phaser from 'phaser';

const LIGHT_COLOR = 0xf0d9b5;
const DARK_COLOR = 0xb58863;
const PIECE_CHARS: Record<string, string> = {
  wp: '\u2659', wn: '\u2658', wb: '\u2657', wr: '\u2656', wq: '\u2655', wk: '\u2654',
  bp: '\u265F', bn: '\u265E', bb: '\u265D', br: '\u265C', bq: '\u265B', bk: '\u265A',
};

export interface TableOverlayConfig {
  tableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ChessOverlayManager {
  private scene: Phaser.Scene;
  private overlays = new Map<string, {
    container: Phaser.GameObjects.Container;
    boardGfx: Phaser.GameObjects.Graphics;
    pieces: Phaser.GameObjects.Text[];
    banner?: Phaser.GameObjects.Container;
  }>();
  private configs = new Map<string, TableOverlayConfig>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  registerTable(config: TableOverlayConfig) {
    this.configs.set(config.tableId, config);
    console.log('[ChessOverlay] Registered table:', config.tableId, 'at', config.x, config.y, config.width + 'x' + config.height);
  }

  showMatchOverlay(tableId: string, fen: string) {
    const config = this.configs.get(tableId);
    if (!config) {
      console.warn('[ChessOverlay] showMatchOverlay: no config for', tableId);
      return;
    }

    let overlay = this.overlays.get(tableId);
    if (!overlay) {
      overlay = this.createOverlay(config);
      this.overlays.set(tableId, overlay);
    }

    this.removeBanner(tableId);
    overlay.container.setVisible(true);
    this.renderFEN(overlay, config, fen);
  }

  hideMatchOverlay(tableId: string) {
    const overlay = this.overlays.get(tableId);
    if (overlay) {
      overlay.container.setVisible(false);
    }
  }

  showWaitingBanner(tableId: string, playerName: string, timeLabel: string) {
    const config = this.configs.get(tableId);
    if (!config) return;

    this.removeBanner(tableId);

    const cx = config.x + config.width / 2;
    const cy = config.y + config.height / 2;

    const banner = this.scene.add.container(cx, cy - config.height / 2 - 14).setDepth(160);

    const bannerW = Math.max(config.width, 100);
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
    const cy = config.y + config.height / 2;

    const banner = this.scene.add.container(cx, cy - config.height / 2 - 10).setDepth(160);

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

  private createOverlay(config: TableOverlayConfig) {
    const container = this.scene.add.container(config.x, config.y).setDepth(150);
    const boardGfx = this.scene.add.graphics();
    container.add(boardGfx);
    container.setVisible(false);

    return { container, boardGfx, pieces: [] as Phaser.GameObjects.Text[] };
  }

  private renderFEN(
    overlay: { container: Phaser.GameObjects.Container; boardGfx: Phaser.GameObjects.Graphics; pieces: Phaser.GameObjects.Text[] },
    config: TableOverlayConfig,
    fen: string
  ) {
    const { boardGfx, container } = overlay;
    const sqW = config.width / 8;
    const sqH = config.height / 8;

    boardGfx.clear();
    for (const p of overlay.pieces) p.destroy();
    overlay.pieces = [];

    // Draw board squares (opaque background)
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;
        boardGfx.fillStyle(isLight ? LIGHT_COLOR : DARK_COLOR, 1);
        boardGfx.fillRect(file * sqW, rank * sqH, sqW, sqH);
      }
    }

    // Border around the board
    boardGfx.lineStyle(1, 0x4a3520, 1);
    boardGfx.strokeRect(0, 0, config.width, config.height);

    // Parse FEN and place pieces
    const fenParts = fen.split(' ')[0];
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
          const char = PIECE_CHARS[key];
          if (char) {
            const text = this.scene.add.text(
              file * sqW + sqW / 2,
              rank * sqH + sqH / 2,
              char,
              {
                fontFamily: 'serif',
                fontSize: `${Math.floor(sqW * 0.8)}px`,
                color: color === 'w' ? '#ffffff' : '#111111',
                resolution: 3,
                stroke: color === 'w' ? '#222222' : '#999999',
                strokeThickness: 0.8,
              }
            ).setOrigin(0.5);
            container.add(text);
            overlay.pieces.push(text);
          }
          file++;
        }
      }
    }
  }
}
