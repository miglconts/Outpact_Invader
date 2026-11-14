import * as THREE from 'three';

export interface ArkanoidHUDCallbacks {
  onScoreChange: (score: number, combo: number) => void;
  onLivesChange: (lives: number) => void;
  onLevelChange: (level: number) => void;
  onStateChange: (state: 'start' | 'playing' | 'paused' | 'gameOver' | 'victory', finalScore: number) => void;
  onTargetInspect: (info: { label: string; wght: number; health: number; maxHealth: number } | null) => void;
}

interface LetterBrick {
  group: THREE.Group;
  frontMat: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  maxHealth: number;
  health: number;
  currentWght: number;
  targetWght: number;
  lastRenderedWght: number;
  hitFlash: number;
  oscillateTimer: number;
  oscillateDuration: number;
  oscillateMinWght: number;
  oscillateMaxWght: number;
}

interface Particle3D {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  life: number;
  maxLife: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  maxScale: number;
}

class ArkanoidSynth {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playPaddleHit() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  playBrickHit(wght: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const baseFreq = 220 + (1 - wght / 1000) * 620;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, now + 0.07);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  playBrickDestroy() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.18);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playLoseLife() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  }
}

export class OutpactArkanoid3D {
  private canvas: HTMLCanvasElement;
  private callbacks: ArkanoidHUDCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private worldWidth = 60;
  private worldHeight = 80;

  private gameState: 'start' | 'playing' | 'paused' | 'gameOver' | 'victory' = 'start';
  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private level = 1;
  private lives = 3;

  // Paddle
  private paddleGroup: THREE.Group;
  private paddleX = 0;
  private paddleY = -34;
  private paddleTargetX = 0;
  private paddleWidth = 14;
  private paddleHeight = 2.4;
  private paddleVX = 0;

  // Ball
  private ballMesh: THREE.Mesh;
  private ballX = 0;
  private ballY = -30;
  private ballVX = 0;
  private ballVY = 0;
  private ballRadius = 1.1;
  private ballAttachedToPaddle = true;
  private baseBallSpeed = 40;

  // Input
  private keys: Record<string, boolean> = {};

  // Entities
  private letters: LetterBrick[] = [];
  private particles: Particle3D[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private starPoints!: THREE.Points;
  private starPositions!: Float32Array;
  private starSpeeds!: Float32Array;

  // Geometries
  private shardGeo = new THREE.BoxGeometry(0.7, 0.7, 0.3);
  private ringGeo = new THREE.RingGeometry(0.7, 1.1, 32);

  // Measure helper canvas for fitty tight fitting
  private measureCanvas = document.createElement('canvas');
  private measureCtx = this.measureCanvas.getContext('2d')!;

  // Lifecycle
  private rafId: number | null = null;
  private lastTime = 0;
  private isOffscreenPaused = false;
  public synth = new ArkanoidSynth();

  constructor(canvas: HTMLCanvasElement, callbacks: ArkanoidHUDCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070810, 0.0035);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
    this.camera.position.set(0, 0, 105);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x070810, 1);

    this.initEnvironment();

    // Paddle
    this.paddleGroup = this.createPaddleMesh();
    this.scene.add(this.paddleGroup);

    // Ball
    this.ballMesh = this.createBallMesh();
    this.scene.add(this.ballMesh);

    this.handleResize();
    this.bindEvents();

    if (document.fonts) {
      document.fonts.load('900 64px "Outpact"').then(() => {
        this.buildLevel(this.level);
      });
    } else {
      this.buildLevel(this.level);
    }

    this.startLoop();
  }

  private initEnvironment() {
    const starCount = 180;
    const geo = new THREE.BufferGeometry();
    this.starPositions = new Float32Array(starCount * 3);
    this.starSpeeds = new Float32Array(starCount);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      this.starPositions[i * 3] = (Math.random() - 0.5) * 160;
      this.starPositions[i * 3 + 1] = (Math.random() - 0.5) * 120;
      this.starPositions[i * 3 + 2] = -Math.random() * 50 - 5;
      this.starSpeeds[i] = 4 + Math.random() * 14;

      const c = Math.random();
      if (c > 0.8) {
        colors[i * 3] = 0.96; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.0;
      } else if (c > 0.6) {
        colors[i * 3] = 0.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 0.75; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.95;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    this.starPoints = new THREE.Points(geo, mat);
    this.scene.add(this.starPoints);
  }

  private createPaddleMesh(): THREE.Group {
    const group = new THREE.Group();
    const shape = new THREE.BoxGeometry(this.paddleWidth, this.paddleHeight, 1.8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const mesh = new THREE.Mesh(shape, mat);
    group.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(shape),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
    );
    group.add(edges);
    group.position.set(this.paddleX, this.paddleY, 0);
    return group;
  }

  private createBallMesh(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(this.ballRadius, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5ff00 });
    const mesh = new THREE.Mesh(geo, mat);

    const glowGeo = new THREE.SphereGeometry(this.ballRadius * 1.35, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    mesh.add(glow);

    mesh.position.set(this.ballX, this.ballY, 0);
    return mesh;
  }

  private clearLetters() {
    for (const b of this.letters) {
      this.scene.remove(b.group);
      b.texture.dispose();
      b.frontMat.dispose();
    }
    this.letters = [];
  }

  /**
   * Builds uniform square glyph rows filling the available width so letters are never deformed on desktop or mobile.
   * Each glyph's initial health is randomly chosen and directly equals its variable font weight (250..1000).
   */
  private buildLevel(_lvl: number) {
    this.clearLetters();

    const rowCount = 3;
    const startY = this.worldHeight * 0.35;
    const targetRowHeight = 7.5;
    const rowGap = 1.2;
    const availableWidth = this.worldWidth * 0.88; // Span across the playfield

    // Keep 1:1 square aspect ratio (charSize x charSize) to match the 256x256 canvas and prevent stretching
    const charCount = Math.max(1, Math.round(availableWidth / targetRowHeight));
    const charSize = availableWidth / charCount;
    const startX = -availableWidth / 2 + charSize / 2;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const weightPool = [250, 500, 750, 1000];

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      const y = startY - rowIdx * (charSize + rowGap);

      for (let colIdx = 0; colIdx < charCount; colIdx++) {
        const x = startX + colIdx * charSize;
        const char = alphabet[Math.floor(Math.random() * alphabet.length)];
        const health = weightPool[Math.floor(Math.random() * weightPool.length)];
        const letter = this.createLetterBrick(x, y, charSize, charSize, char, health);
        this.letters.push(letter);
      }
    }
  }

  private createLetterBrick(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    maxHealth: number
  ): LetterBrick {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const initialWght = Math.max(1, Math.min(1000, maxHealth));
    const imgData = this.renderGlyphToCanvas(ctx, canvas.width, canvas.height, label, initialWght, false);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const group = new THREE.Group();
    group.position.set(x, y, 0);

    const geo = new THREE.PlaneGeometry(w, h);
    const frontMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, frontMat);
    group.add(mesh);
    this.scene.add(group);

    return {
      group,
      frontMat,
      texture,
      canvas,
      ctx,
      imageData: imgData,
      label,
      x,
      y,
      w,
      h,
      maxHealth,
      health: maxHealth,
      currentWght: initialWght,
      targetWght: initialWght,
      lastRenderedWght: initialWght,
      hitFlash: 0,
      oscillateTimer: 0,
      oscillateDuration: 0,
      oscillateMinWght: 1,
      oscillateMaxWght: initialWght
    };
  }

  /**
   * Renders the pure Outpact glyph tightly filling the canvas and updates the cached pixel mask for SVG-precise collisions.
   */
  private renderGlyphToCanvas(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    label: string,
    wght: number,
    flash: boolean
  ): ImageData {
    const clampedWght = Math.max(1, Math.min(1000, Math.round(wght)));
    ctx.clearRect(0, 0, w, h);

    // Apply variable font axis
    ctx.canvas.style.fontVariationSettings = `'wght' ${clampedWght}`;
    
    // Fit snugly inside the canvas
    const fontSize = 210;
    ctx.font = `${clampedWght} ${fontSize}px "Outpact", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (flash) {
      ctx.fillStyle = '#ffffff';
    } else {
      const ratio = clampedWght / 1000;
      if (ratio > 0.45) {
        ctx.fillStyle = '#f5ff00';
      } else if (ratio > 0.2) {
        ctx.fillStyle = '#00e5ff';
      } else {
        ctx.fillStyle = '#ff3366';
      }
    }

    ctx.fillText(label, w / 2, h / 2);

    // Cache image data for pixel-perfect (SVG shape equivalent) hit tests
    const imgData = ctx.getImageData(0, 0, w, h);
    return imgData;
  }

  /**
   * Precise shape collision test: checks if world position (px, py) intersects the actual glyph body.
   */
  private testGlyphShapeCollision(
    letter: LetterBrick,
    ballX: number,
    ballY: number,
    radius: number
  ): { hit: boolean; normalX: number; normalY: number } {
    const localX = ballX - letter.x;
    const localY = ballY - letter.y;

    // Fast AABB pre-check
    const halfW = letter.w / 2;
    const halfH = letter.h / 2;
    if (
      localX < -halfW - radius ||
      localX > halfW + radius ||
      localY < -halfH - radius ||
      localY > halfH + radius
    ) {
      return { hit: false, normalX: 0, normalY: 0 };
    }

    // Map ball center and perimeter samples to canvas pixel coordinates
    const cw = letter.canvas.width;
    const ch = letter.canvas.height;
    const imgData = letter.imageData;

    // Test multiple points around ball perimeter in direction of movement
    const testOffsets = [
      { dx: 0, dy: 0 },
      { dx: 0, dy: -radius },
      { dx: 0, dy: radius },
      { dx: -radius, dy: 0 },
      { dx: radius, dy: 0 },
      { dx: radius * 0.7, dy: radius * 0.7 },
      { dx: -radius * 0.7, dy: radius * 0.7 },
      { dx: radius * 0.7, dy: -radius * 0.7 },
      { dx: -radius * 0.7, dy: -radius * 0.7 }
    ];

    for (const offset of testOffsets) {
      const sampleX = localX + offset.dx;
      const sampleY = localY + offset.dy;

      // In Three.js y goes up, in canvas y goes down
      const u = (sampleX + halfW) / letter.w;
      const v = 1 - (sampleY + halfH) / letter.h;

      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const px = Math.floor(u * cw);
        const py = Math.floor(v * ch);
        const idx = (py * cw + px) * 4 + 3; // Alpha channel

        // If alpha is solid enough (> 40), the ball collided with the glyph's exact outline!
        if (imgData.data[idx] > 40) {
          // Compute normal: approximate from sample offset and ball center
          let nx = localX === 0 ? 0 : localX > 0 ? 1 : -1;
          let ny = localY === 0 ? 0 : localY > 0 ? 1 : -1;

          // Prefer dominant axis
          if (Math.abs(localX / halfW) > Math.abs(localY / halfH)) {
            ny = 0;
          } else {
            nx = 0;
          }
          return { hit: true, normalX: nx, normalY: ny };
        }
      }
    }

    return { hit: false, normalX: 0, normalY: 0 };
  }

  public startGame() {
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.level = 1;
    this.lives = 3;
    this.resetBallAndPaddle();
    this.buildLevel(this.level);
    this.gameState = 'playing';

    this.callbacks.onScoreChange(this.score, this.combo);
    this.callbacks.onLevelChange(this.level);
    this.callbacks.onLivesChange(this.lives);
    this.callbacks.onStateChange('playing', this.score);
    this.callbacks.onTargetInspect(null);
  }

  private resetBallAndPaddle() {
    this.paddleX = 0;
    this.paddleTargetX = 0;
    this.paddleVX = 0;
    this.ballAttachedToPaddle = true;
    this.ballX = 0;
    this.ballY = this.paddleY + this.paddleHeight / 2 + this.ballRadius + 0.1;
    this.ballVX = 0;
    this.ballVY = 0;
  }

  public launchBall() {
    if (!this.ballAttachedToPaddle || this.gameState !== 'playing') return;
    this.ballAttachedToPaddle = false;

    const angleOffset = Math.max(-0.6, Math.min(0.6, this.paddleVX * 0.02));
    const speed = this.baseBallSpeed + (this.level - 1) * 3;
    this.ballVX = speed * Math.sin(angleOffset);
    this.ballVY = speed * Math.cos(angleOffset);
    this.synth.playPaddleHit();
  }

  public togglePause() {
    if (this.gameState === 'playing') {
      this.gameState = 'paused';
      this.callbacks.onStateChange('paused', this.score);
    } else if (this.gameState === 'paused') {
      this.gameState = 'playing';
      this.lastTime = performance.now();
      this.callbacks.onStateChange('playing', this.score);
    }
  }

  public setOffscreenPaused(paused: boolean) {
    this.isOffscreenPaused = paused;
    if (!paused && this.rafId === null) {
      this.lastTime = performance.now();
      this.startLoop();
    }
  }

  private spawnParticles(x: number, y: number, colorHex: number, count: number) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true });
      const mesh = new THREE.Mesh(this.shardGeo, mat);
      mesh.position.set(x, y, 0);

      const angle = Math.random() * Math.PI * 2;
      const speed = 12 + Math.random() * 26;

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (Math.random() - 0.5) * 16,
        rx: (Math.random() - 0.5) * 10,
        ry: (Math.random() - 0.5) * 10,
        rz: (Math.random() - 0.5) * 10,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.3
      });
    }
  }

  private spawnShockwave(x: number, y: number, colorHex: number) {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, 0.2);
    this.scene.add(mesh);
    this.shockwaves.push({
      mesh,
      mat,
      life: 0,
      maxLife: 0.28,
      maxScale: 5.5
    });
  }

  private update(dt: number) {
    // Starfield
    const posAttr = this.starPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.starSpeeds.length; i++) {
      let y = posAttr.getY(i) - this.starSpeeds[i] * dt;
      if (y < -60) {
        y = 60;
        posAttr.setX(i, (Math.random() - 0.5) * 160);
      }
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    if (this.gameState === 'paused') return;

    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.callbacks.onScoreChange(this.score, this.combo);
      }
    }

    // Controls
    const paddleSpeed = 65;
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) {
      this.paddleTargetX -= paddleSpeed * dt;
    }
    if (this.keys['ArrowRight'] || this.keys['KeyD']) {
      this.paddleTargetX += paddleSpeed * dt;
    }

    const maxPaddleX = (this.worldWidth * 0.9) / 2 - this.paddleWidth / 2;
    this.paddleTargetX = Math.max(-maxPaddleX, Math.min(maxPaddleX, this.paddleTargetX));

    const forceX = (this.paddleTargetX - this.paddleX) * 160 - this.paddleVX * 18;
    this.paddleVX += forceX * dt;
    this.paddleX += this.paddleVX * dt;
    this.paddleX = Math.max(-maxPaddleX, Math.min(maxPaddleX, this.paddleX));

    this.paddleGroup.position.x = this.paddleX;
    this.paddleGroup.rotation.z = -this.paddleVX * 0.008;

    // Ball movement & collisions
    if (this.ballAttachedToPaddle) {
      this.ballX = this.paddleX;
      this.ballY = this.paddleY + this.paddleHeight / 2 + this.ballRadius + 0.1;
    } else if (this.gameState === 'playing') {
      this.ballX += this.ballVX * dt;
      this.ballY += this.ballVY * dt;

      // Wall bounds
      const wallLimitX = (this.worldWidth * 0.95) / 2 - this.ballRadius;
      if (this.ballX < -wallLimitX) {
        this.ballX = -wallLimitX;
        this.ballVX = Math.abs(this.ballVX);
        this.synth.playPaddleHit();
        this.spawnShockwave(this.ballX, this.ballY, 0x00e5ff);
      } else if (this.ballX > wallLimitX) {
        this.ballX = wallLimitX;
        this.ballVX = -Math.abs(this.ballVX);
        this.synth.playPaddleHit();
        this.spawnShockwave(this.ballX, this.ballY, 0x00e5ff);
      }

      // Ceiling
      const ceilingY = this.worldHeight * 0.47 - this.ballRadius;
      if (this.ballY > ceilingY) {
        this.ballY = ceilingY;
        this.ballVY = -Math.abs(this.ballVY);
        this.synth.playPaddleHit();
        this.spawnShockwave(this.ballX, this.ballY, 0x00e5ff);
      }

      // Paddle
      const pLeft = this.paddleX - this.paddleWidth / 2;
      const pRight = this.paddleX + this.paddleWidth / 2;
      const pTop = this.paddleY + this.paddleHeight / 2;
      const pBottom = this.paddleY - this.paddleHeight / 2;

      if (
        this.ballY - this.ballRadius <= pTop &&
        this.ballY + this.ballRadius >= pBottom &&
        this.ballX >= pLeft - this.ballRadius &&
        this.ballX <= pRight + this.ballRadius &&
        this.ballVY < 0
      ) {
        this.ballY = pTop + this.ballRadius;
        const hitOffset = (this.ballX - this.paddleX) / (this.paddleWidth / 2);
        const maxAngle = Math.PI * 0.38;
        const bounceAngle = hitOffset * maxAngle;
        const currentSpeed = Math.hypot(this.ballVX, this.ballVY);

        this.ballVX = currentSpeed * Math.sin(bounceAngle) + this.paddleVX * 0.2;
        this.ballVY = currentSpeed * Math.cos(bounceAngle);
        if (this.ballVY < currentSpeed * 0.35) {
          this.ballVY = currentSpeed * 0.35;
        }

        this.synth.playPaddleHit();
        this.spawnShockwave(this.ballX, this.ballY, 0x00e5ff);
      }

      // Bottom breach
      if (this.ballY < this.paddleY - 8) {
        this.lives -= 1;
        this.combo = 1;
        this.callbacks.onLivesChange(this.lives);
        this.synth.playLoseLife();
        this.spawnParticles(this.ballX, this.ballY, 0xff3366, 18);

        if (this.lives <= 0) {
          this.gameState = 'gameOver';
          this.callbacks.onStateChange('gameOver', this.score);
        } else {
          this.resetBallAndPaddle();
        }
      }

      // PRECISE GLYPH SHAPE / SVG COLLISION
      for (let i = this.letters.length - 1; i >= 0; i--) {
        const letter = this.letters[i];
        const collision = this.testGlyphShapeCollision(letter, this.ballX, this.ballY, this.ballRadius);

        if (collision.hit) {
          // Bounce along collision normal
          if (collision.normalX !== 0) {
            this.ballVX = Math.abs(this.ballVX) * collision.normalX;
          }
          if (collision.normalY !== 0) {
            this.ballVY = Math.abs(this.ballVY) * collision.normalY;
          } else {
            this.ballVY *= -1;
          }

          // Damage glyph (health is 1:1 equivalent to font weight)
          const hitDamage = 250;
          letter.health = Math.max(0, letter.health - hitDamage);
          const newTargetWght = Math.max(1, Math.min(1000, letter.health));
          letter.targetWght = newTargetWght;
          letter.hitFlash = 0.12;

          // Sinusoidal wave between 1 and the new reduced ceiling
          letter.oscillateMinWght = 1;
          letter.oscillateMaxWght = newTargetWght;
          letter.oscillateDuration = 0.65;
          letter.oscillateTimer = letter.oscillateDuration;

          this.callbacks.onTargetInspect({
            label: letter.label,
            wght: Math.round(letter.targetWght),
            health: Math.max(0, letter.health),
            maxHealth: letter.maxHealth
          });

          this.synth.playBrickHit(letter.targetWght);
          this.spawnParticles(this.ballX, this.ballY, 0xf5ff00, 6);
          this.spawnShockwave(this.ballX, this.ballY, 0x00e5ff);

          if (letter.health <= 0) {
            this.comboTimer = 2.4;
            this.score += 25 * this.combo;
            this.combo = Math.min(8, this.combo + 1);
            this.callbacks.onScoreChange(this.score, this.combo);

            this.synth.playBrickDestroy();
            this.spawnParticles(letter.x, letter.y, 0xff3366, 18);
            this.spawnShockwave(letter.x, letter.y, 0xf5ff00);

            this.scene.remove(letter.group);
            letter.texture.dispose();
            letter.frontMat.dispose();
            this.letters.splice(i, 1);

            if (this.letters.length === 0) {
              this.level += 1;
              this.callbacks.onLevelChange(this.level);
              this.buildLevel(this.level);
              this.resetBallAndPaddle();
            }
          }
          break; // Stop after first collided glyph in frame
        }
      }
    }

    this.ballMesh.position.set(this.ballX, this.ballY, 0);

    // Update Letters Animation & Sinusoidal Weight Oscillation
    for (const letter of this.letters) {
      if (letter.oscillateTimer > 0) {
        letter.oscillateTimer -= dt;
        const progress = 1 - Math.max(0, letter.oscillateTimer / letter.oscillateDuration);
        const cycles = 3.5;
        const wave = 0.5 - 0.5 * Math.cos(progress * Math.PI * 2 * cycles);

        const minW = letter.oscillateMinWght;
        const maxW = letter.oscillateMaxWght;
        letter.currentWght = minW + (maxW - minW) * wave;

        if (letter.oscillateTimer <= 0) {
          letter.currentWght = letter.targetWght;
        }
      } else {
        letter.currentWght += (letter.targetWght - letter.currentWght) * Math.min(1, dt * 10);
      }

      const wasFlashing = letter.hitFlash > 0;
      if (letter.hitFlash > 0) letter.hitFlash -= dt;
      const isFlashing = letter.hitFlash > 0;

      if (Math.abs(letter.currentWght - letter.lastRenderedWght) >= 4 || wasFlashing !== isFlashing) {
        letter.lastRenderedWght = letter.currentWght;
        letter.imageData = this.renderGlyphToCanvas(
          letter.ctx,
          letter.canvas.width,
          letter.canvas.height,
          letter.label,
          letter.currentWght,
          isFlashing
        );
        letter.texture.needsUpdate = true;
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.life / p.maxLife;
    }

    // Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      if (sw.life >= sw.maxLife) {
        this.scene.remove(sw.mesh);
        sw.mat.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const progress = sw.life / sw.maxLife;
      const scale = 0.5 + progress * sw.maxScale;
      sw.mesh.scale.set(scale, scale, 1);
      sw.mat.opacity = (1 - progress) * 0.85;
    }
  }

  private startLoop() {
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (this.isOffscreenPaused) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;

      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private clientXToWorldX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const normX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    return normX * (this.worldWidth / 2);
  }

  private handleResize = () => {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;

    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    const vFovRad = (this.camera.fov * Math.PI) / 180;
    this.worldHeight = 2 * Math.tan(vFovRad / 2) * this.camera.position.z;
    this.worldWidth = this.worldHeight * this.camera.aspect;
  };

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') {
        if (this.ballAttachedToPaddle) {
          this.launchBall();
        }
      }
      if (e.code === 'KeyP' && (this.gameState === 'playing' || this.gameState === 'paused')) {
        this.togglePause();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      this.paddleTargetX = this.clientXToWorldX(e.clientX);
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.paddleTargetX = this.clientXToWorldX(e.clientX);
      if (this.ballAttachedToPaddle) {
        this.launchBall();
      }
    });
  }
}
