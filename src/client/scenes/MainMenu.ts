import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { InitResponse, VoteMutatorResponse } from '../../shared/api';

export class MainMenu extends Scene {
  private loadingText?: Phaser.GameObjects.Text;
  private initData: InitResponse | null = null;

  constructor() {
    super('MainMenu');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0f172a);

    this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.14, 'Hookline Legends', {
        fontFamily: 'Trebuchet MS',
        fontSize: '52px',
        color: '#f8fafc',
        stroke: '#1e293b',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(
        this.scale.width * 0.5,
        this.scale.height * 0.2,
        'Daily route puzzle. Beat the clock. Vote the next mutator.',
        {
          fontFamily: 'Verdana',
          fontSize: '20px',
          color: '#cbd5e1',
        }
      )
      .setOrigin(0.5);

    this.loadingText = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.35, 'Loading daily board...', {
        fontFamily: 'Verdana',
        fontSize: '24px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    void this.loadInitData();
  }

  private async loadInitData(): Promise<void> {
    try {
      const response = await fetch('/api/init');
      if (!response.ok) {
        throw new Error(`Failed to load init data (${response.status})`);
      }

      const data = (await response.json()) as InitResponse;
      this.initData = data;
      this.renderLobby();
    } catch (error) {
      console.error(error);
      if (this.loadingText) {
        this.loadingText.setText('Unable to load game state. Refresh this post and retry.');
      }
    }
  }

  private renderLobby(): void {
    if (!this.initData) {
      return;
    }

    this.loadingText?.destroy();

    const startY = this.scale.height * 0.3;
    const panel = this.add.rectangle(
      this.scale.width * 0.5,
      this.scale.height * 0.57,
      this.scale.width * 0.86,
      this.scale.height * 0.58,
      0x111827,
      0.9
    );
    panel.setStrokeStyle(2, 0x334155, 1);

    this.add
      .text(
        this.scale.width * 0.17,
        startY,
        `Player: ${this.initData.player.username}\nStreak: ${this.initData.player.streak}\nRuns left: ${this.initData.player.runsLeft}`,
        {
          fontFamily: 'Verdana',
          fontSize: '22px',
          color: '#e2e8f0',
          lineSpacing: 8,
        }
      )
      .setOrigin(0, 0);

    this.add
      .text(
        this.scale.width * 0.53,
        startY,
        `Today's mutator: ${this.initData.daily.mutator.title}\n${this.initData.daily.mutator.description}\nTime: ${this.initData.daily.timeLimitSeconds}s`,
        {
          fontFamily: 'Verdana',
          fontSize: '20px',
          color: '#fef3c7',
          wordWrap: { width: this.scale.width * 0.3 },
          lineSpacing: 8,
        }
      )
      .setOrigin(0, 0);

    const leaderboardLines = this.initData.leaderboard.length
      ? this.initData.leaderboard
          .slice(0, 5)
          .map((entry, index) => `${index + 1}. u/${entry.username} - ${entry.score}`)
          .join('\n')
      : 'No runs yet today. Be first on the board.';

    this.add
      .text(this.scale.width * 0.17, this.scale.height * 0.52, `Daily Leaderboard\n${leaderboardLines}`, {
        fontFamily: 'Verdana',
        fontSize: '20px',
        color: '#d1fae5',
        lineSpacing: 8,
      })
      .setOrigin(0, 0);

    const startButton = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.82, 'Start Daily Run', {
        fontFamily: 'Trebuchet MS',
        fontSize: '32px',
        color: '#f8fafc',
        backgroundColor: '#15803d',
        padding: { left: 24, right: 24, top: 12, bottom: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    if (this.initData.player.runsLeft <= 0) {
      startButton.setText('Daily Cap Reached').setStyle({ backgroundColor: '#991b1b' });
      startButton.disableInteractive();
    } else {
      startButton.on('pointerdown', () => {
        if (!this.initData) {
          return;
        }
        this.scene.start('Game', this.initData);
      });
    }

    const voteLabel = this.add
      .text(this.scale.width * 0.53, this.scale.height * 0.58, 'Vote tomorrow mutator:', {
        fontFamily: 'Verdana',
        fontSize: '18px',
        color: '#f1f5f9',
      })
      .setOrigin(0, 0);

    this.initData.mutatorOptions.forEach((option, index) => {
      const y = voteLabel.y + 42 + index * 44;
      const optionButton = this.add
        .text(this.scale.width * 0.53, y, option.title, {
          fontFamily: 'Verdana',
          fontSize: '18px',
          color: this.initData?.player.voteOptionId === option.id ? '#bbf7d0' : '#bfdbfe',
          backgroundColor:
            this.initData?.player.voteOptionId === option.id ? '#14532d' : '#1e3a8a',
          padding: { left: 12, right: 12, top: 6, bottom: 6 },
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });

      optionButton.on('pointerdown', async () => {
        try {
          const response = await fetch('/api/vote-mutator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionId: option.id }),
          });
          if (!response.ok) {
            throw new Error('Vote failed');
          }

          const voteResponse = (await response.json()) as VoteMutatorResponse;
          this.add
            .text(this.scale.width * 0.5, this.scale.height * 0.91, `Vote locked: ${option.title}`, {
              fontFamily: 'Verdana',
              fontSize: '17px',
              color: '#bbf7d0',
            })
            .setOrigin(0.5)
            .setDepth(10);

          this.initData!.player.voteOptionId = voteResponse.optionId;
          this.scene.restart();
        } catch {
          this.add
            .text(this.scale.width * 0.5, this.scale.height * 0.91, 'Vote failed. Retry in a moment.', {
              fontFamily: 'Verdana',
              fontSize: '17px',
              color: '#fecaca',
            })
            .setOrigin(0.5)
            .setDepth(10);
        }
      });
    });
  }
}
