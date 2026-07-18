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
    statusText?: Phaser.GameObjects.Text;
    waitingBanner?: Phaser.GameObjects.Container;
  }>();
  private configs = new Map<string, TableOverlayConfig>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
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

    overlay.container.setVisible(true);
    this.removeWaitingBanner(tableId);
    this.renderFEN(overlay, config, fen);
  }

  updatePosition(tableId: string, fen: string) {
    const overlay = this.overlays.get(tableId);
    const config = this.configs.get(tableId);
    if (!overlay || !config) return;
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

    this.removeWaitingBanner(tableId);

    const container = this.scene.add.container(
      config.x + config.width / 2,
      config.y - 8
    ).setDepth(155);

    const bannerW = Math.max(config.width + 16, 100);
    const bannerH = 24;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0xd97706, 0.92);
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

    const subText = this.scene.add.text(0, 6, `${playerName} - ${timeLabel}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '6px',
      color: '#fde68a',
      resolution: 2,
    }).setOrigin(0.5);

    container.add([bg, text, subText]);

    this.scene.tweens.add({
      targets: container,
      alpha: { from: 1, to: 0.6 },
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
    overlay.waitingBanner = container;
  }

  showInProgressBanner(tableId: string) {
    const config = this.configs.get(tableId);
    if (!config) return;
    this.removeWaitingBanner(tableId);

    const container = this.scene.add.container(
      config.x + config.width / 2,
      config.y - 8
    ).setDepth(155);

    const bannerW = 80;
    const bannerH = 16;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x059669, 0.88);
    bg.fillRoundedRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH, 3);

    const text = this.scene.add.text(0, 0, 'Match in progress', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '6px',
      fontStyle: 'bold',
      color: '#ffffff',
      resolution: 2,
    }).setOrigin(0.5);

    container.add([bg, text]);

    let overlay = this.overlays.get(tableId);
    if (!overlay) {
      overlay = this.createOverlay(config);
      this.overlays.set(tableId, overlay);
    }
    overlay.waitingBanner = container;
  }

  removeWaitingBanner(tableId: string) {
    const overlay = this.overlays.get(tableId);
    if (overlay?.waitingBanner) {
      overlay.waitingBanner.destroy();
      overlay.waitingBanner = undefined;
    }
  }

  removeAll(tableId: string) {
    this.removeWaitingBanner(tableId);
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

    // Clear previous
    boardGfx.clear();
    for (const p of overlay.pieces) p.destroy();
    overlay.pieces = [];

    // Draw board squares
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;
        boardGfx.fillStyle(isLight ? LIGHT_COLOR : DARK_COLOR, 1);
        boardGfx.fillRect(file * sqW, rank * sqH, sqW, sqH);
      }
    }

    // Parse FEN and place pieces
    const fenParts = fen.split(' ')[0];
    const ranks = fenParts.split('/');
    for (let rank = 0; rank < 8; rank++) {
      let file = 0;
      for (const ch of ranks[rank]) {
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
                fontSize: `${Math.floor(sqW * 0.85)}px`,
                color: color === 'w' ? '#ffffff' : '#1a1a1a',
                resolution: 2,
                stroke: color === 'w' ? '#333333' : '#888888',
                strokeThickness: 0.5,
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
