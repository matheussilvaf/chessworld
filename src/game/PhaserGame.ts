import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: '#2d5a27',
    input: {
      activePointers: 3,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [WorldScene],
  };

  return new Phaser.Game(config);
}

export function getWorldScene(game: Phaser.Game): WorldScene | null {
  return game.scene.getScene('WorldScene') as WorldScene | null;
}
