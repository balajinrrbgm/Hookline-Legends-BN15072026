import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type {
  FinishRunResponse,
  InitResponse,
  StartRunResponse,
} from '../../shared/api';

type NodeTarget = {
  id: number;
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  completed: boolean;
};

type Hazard = {
  orb: Phaser.GameObjects.Arc;
  radius: number;
};

export class Game extends Scene {
  private initData: InitResponse | null = null;
  private runData: StartRunResponse | null = null;
  private nodes: NodeTarget[] = [];
  private hazards: Hazard[] = [];
  private routeLines: Phaser.GameObjects.Line[] = [];
  private pointerGlow?: Phaser.GameObjects.Arc;
  private progressText?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private runStartTime = 0;
  private score = 0;
  private currentNode = 1;
  private mistakes = 0;
  private runFinished = false;

  constructor() {
    super('Game');
  }

  init(data: InitResponse): void {
    this.initData = data;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x020617);

    this.add.rectangle(
      this.scale.width * 0.5,
      this.scale.height * 0.5,
      this.scale.width,
      this.scale.height,
      0x0b1120,
      1
    );

    this.progressText = this.add
      .text(this.scale.width * 0.03, this.scale.height * 0.04, 'Route 0/0', {
        fontFamily: 'Verdana',
        fontSize: '24px',
        color: '#bae6fd',
      })
      .setOrigin(0, 0);

    this.timerText = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.04, 'Time: --', {
        fontFamily: 'Trebuchet MS',
        fontSize: '28px',
        color: '#fef3c7',
      })
      .setOrigin(0.5, 0);

    this.scoreText = this.add
      .text(this.scale.width * 0.97, this.scale.height * 0.04, 'Score: 0', {
        fontFamily: 'Verdana',
        fontSize: '24px',
        color: '#bbf7d0',
      })
      .setOrigin(1, 0);

    this.statusText = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.12, 'Preparing daily route...', {
        fontFamily: 'Verdana',
        fontSize: '20px',
        color: '#94a3b8',
      })
      .setOrigin(0.5, 0);

    this.pointerGlow = this.add.arc(0, 0, 14, 0, 360, false, 0x38bdf8, 0.25);
    this.pointerGlow.setDepth(8);

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.pointerGlow?.setPosition(pointer.x, pointer.y);
    });

    void this.bootstrapRun();
  }

  override update(): void {
    if (!this.initData || !this.runData || this.runFinished) {
      return;
    }

    const limitMs = this.runData.daily.timeLimitSeconds * 1000;
    const elapsed = this.time.now - this.runStartTime;
    const left = Math.max(limitMs - elapsed, 0);
    this.timerText?.setText(`Time: ${(left / 1000).toFixed(1)}s`);

    if (left <= 0) {
      void this.finishRun();
      return;
    }

    this.hazards.forEach((hazard, index) => {
      hazard.orb.x += Math.sin((this.time.now / 700) * (index + 1)) * 0.8;
      hazard.orb.y += Math.cos((this.time.now / 900) * (index + 2)) * 0.8;
    });
  }

  private async bootstrapRun(): Promise<void> {
    if (!this.initData) {
      this.statusText?.setText('Game session expired. Return to the lobby and retry.');
      return;
    }

    try {
      const response = await fetch('/api/start-run', { method: 'POST' });
      if (!response.ok) {
        const errorPayload = await response.json();
        const message =
          typeof errorPayload?.message === 'string'
            ? errorPayload.message
            : 'Unable to start run.';
        this.statusText?.setText(message);
        return;
      }

      this.runData = (await response.json()) as StartRunResponse;
      this.statusText?.setText(`Mutator: ${this.runData.daily.mutator.title}`);
      this.runStartTime = this.time.now;
      this.buildRoute(this.runData.daily.seed);
      this.buildHazards(this.runData.daily.seed, this.runData.daily.mutator.id);
      this.updateProgressText();
    } catch (error) {
      console.error(error);
      this.statusText?.setText('Could not connect to game server. Retry shortly.');
    }
  }

  private buildRoute(seed: number): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const totalNodes = 8;

    this.nodes = [];
    this.routeLines = [];

    let rngSeed = seed;
    const nextRandom = (): number => {
      rngSeed = (rngSeed * 1664525 + 1013904223) % 4294967296;
      return rngSeed / 4294967296;
    };

    for (let index = 0; index < totalNodes; index += 1) {
      const x = width * 0.18 + nextRandom() * width * 0.64;
      const y = height * 0.24 + nextRandom() * height * 0.62;

      const circle = this.add.arc(x, y, 30, 0, 360, false, 0x0f766e, 1);
      circle.setStrokeStyle(3, 0x99f6e4, 1);
      circle.setInteractive({ useHandCursor: true });

      const label = this.add
        .text(x, y, `${index + 1}`, {
          fontFamily: 'Trebuchet MS',
          fontSize: '24px',
          color: '#f0fdfa',
        })
        .setOrigin(0.5);

      const nodeTarget: NodeTarget = {
        id: index + 1,
        circle,
        label,
        completed: false,
      };
      this.nodes.push(nodeTarget);

      circle.on('pointerdown', () => {
        void this.onNodeSelected(nodeTarget);
      });
    }

    for (let index = 1; index < this.nodes.length; index += 1) {
      const previous = this.nodes[index - 1];
      const next = this.nodes[index];
      if (!previous || !next) {
        continue;
      }
      const line = this.add.line(
        0,
        0,
        previous.circle.x,
        previous.circle.y,
        next.circle.x,
        next.circle.y,
        0x334155,
        1
      );
      line.setLineWidth(4, 4);
      line.setOrigin(0, 0);
      line.setDepth(-1);
      this.routeLines.push(line);
    }
  }

  private buildHazards(seed: number, mutatorId: string): void {
    const hazardCount = mutatorId === 'pulse-rush' ? 4 : 3;
    const hazardRadius = mutatorId === 'fog-shift' ? 40 : 30;

    let localSeed = seed ^ 0x9e3779b9;
    const random = (): number => {
      localSeed = (localSeed * 1103515245 + 12345) % 2147483648;
      return localSeed / 2147483648;
    };

    this.hazards = [];
    for (let index = 0; index < hazardCount; index += 1) {
      const x = this.scale.width * 0.2 + random() * this.scale.width * 0.6;
      const y = this.scale.height * 0.25 + random() * this.scale.height * 0.6;
      const orb = this.add.arc(x, y, hazardRadius, 0, 360, false, 0xb91c1c, 0.4);
      orb.setStrokeStyle(2, 0xfca5a5, 0.9);
      orb.setBlendMode(Phaser.BlendModes.SCREEN);
      this.hazards.push({ orb, radius: hazardRadius });
    }
  }

  private async onNodeSelected(node: NodeTarget): Promise<void> {
    if (this.runFinished || !this.runData) {
      return;
    }

    const blocked = this.hazards.some((hazard) => {
      const distance = Phaser.Math.Distance.Between(
        hazard.orb.x,
        hazard.orb.y,
        node.circle.x,
        node.circle.y
      );
      return distance <= hazard.radius + 18;
    });

    if (blocked) {
      this.mistakes += 1;
      this.statusText?.setText('Node blocked by hazard wave. Try another moment.');
      this.cameras.main.shake(80, 0.002);
      return;
    }

    if (node.id !== this.currentNode || node.completed) {
      this.mistakes += 1;
      this.statusText?.setText(`Sequence break. Hit node ${this.currentNode}.`);
      return;
    }

    node.completed = true;
    node.circle.setFillStyle(0x65a30d, 1);
    node.circle.disableInteractive();
    this.score += 220;
    this.currentNode += 1;
    this.scoreText?.setText(`Score: ${this.score}`);
    this.updateProgressText();

    if (this.currentNode > this.nodes.length) {
      await this.finishRun();
    }
  }

  private updateProgressText(): void {
    const completed = this.currentNode - 1;
    this.progressText?.setText(`Route ${completed}/${this.nodes.length} | Mistakes ${this.mistakes}`);
  }

  private async finishRun(): Promise<void> {
    if (this.runFinished || !this.runData) {
      return;
    }

    this.runFinished = true;
    const elapsed = this.time.now - this.runStartTime;
    const timeLimitMs = this.runData.daily.timeLimitSeconds * 1000;
    const timeLeftMs = Math.max(timeLimitMs - elapsed, 0);

    this.statusText?.setText('Submitting run...');

    try {
      const response = await fetch('/api/finish-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: this.runData.runId,
          rawScore: this.score,
          mistakes: this.mistakes,
          completedNodes: this.currentNode - 1,
          totalNodes: this.nodes.length,
          timeLeftMs,
        }),
      });

      if (!response.ok) {
        throw new Error(`Submit failed (${response.status})`);
      }

      const result = (await response.json()) as FinishRunResponse;
      this.renderSummary(result);
    } catch (error) {
      console.error(error);
      this.statusText?.setText('Submission failed. Return to lobby and retry.');
      this.addReturnButton();
    }
  }

  private renderSummary(result: FinishRunResponse): void {
    this.add
      .rectangle(
        this.scale.width * 0.5,
        this.scale.height * 0.5,
        this.scale.width * 0.7,
        this.scale.height * 0.48,
        0x0f172a,
        0.95
      )
      .setStrokeStyle(2, 0x38bdf8, 1)
      .setDepth(20);

    const message = result.accepted
      ? `Final score: ${result.finalScore}\nBest score: ${result.bestScore}\nRank: #${result.rank}\nStreak: ${result.streak}\nRuns left: ${result.runsLeft}`
      : result.message;

    this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.38, message, {
        fontFamily: 'Verdana',
        fontSize: '28px',
        color: '#e2e8f0',
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.statusText?.setText(result.message);
    this.addReturnButton();

    if (result.runsLeft > 0 && result.accepted) {
      const replay = this.add
        .text(this.scale.width * 0.5, this.scale.height * 0.66, 'Play Another Run', {
          fontFamily: 'Trebuchet MS',
          fontSize: '28px',
          color: '#f8fafc',
          backgroundColor: '#2563eb',
          padding: { left: 18, right: 18, top: 9, bottom: 9 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(25);

      replay.on('pointerdown', () => {
        if (!this.initData) {
          return;
        }
        this.scene.restart(this.initData);
      });
    }
  }

  private addReturnButton(): void {
    const lobbyButton = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.75, 'Return to Lobby', {
        fontFamily: 'Trebuchet MS',
        fontSize: '28px',
        color: '#f8fafc',
        backgroundColor: '#16a34a',
        padding: { left: 18, right: 18, top: 9, bottom: 9 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(25);

    lobbyButton.on('pointerdown', () => {
      this.scene.start('MainMenu');
    });
  }
}
