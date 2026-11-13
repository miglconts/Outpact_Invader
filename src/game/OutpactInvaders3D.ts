import * as THREE from 'three';

export interface GameHUDCallbacks {
  onScoreChange: (score: number, combo: number) => void;
  onWaveChange: (wave: number) => void;
  onLivesChange: (lives: number) => void;
  onStateChange: (state: 'start' | 'playing' | 'paused' | 'gameOver', finalScore: number) => void;
  onTargetInspect: (info: { label: string; wght: number; health: number; maxHealth: number; mass: number } | null) => void;
}

interface BulletEntity {
  mesh: THREE.Group;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface EnemyEntity {
  group: THREE.Group;
  frontMat: THREE.MeshBasicMaterial;
  backMat: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseFallSpeed: number;
  angle: number;
  angularVel: number;
  tiltX: number;
  tiltY: number;
  tiltVelX: number;
  tiltVelY: number;
  halfW: number;
  halfH: number;
  radius: number;
  maxHealth: number;
  health: number;
  currentWght: number;
  targetWght: number;
  lastRenderedWght: number;
  mass: number;
  scaleBoost: number;
  hitFlash: number;
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

const ENEMY_GLYPHS = [
  'a', 'b', 'A', 'B', 'C', '&', 'HI', 'ADIOS',
  'Ω', 'Æ', 'Δ', '∑', '∞', 'ﬁ', 'ﬂ', 'TYPE', 'WGHT'
];

class ArcadeSynth {
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

  playShoot() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playHit(wght: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Heavy weight = lower bass pitch; thin weight = higher crystalline pitch
    const baseFreq = 160 + (1 - wght / 1000) * 520;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.08);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  playDestroy() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.23);
  }
}

export class OutpactInvaders3D {
  private canvas: HTMLCanvasElement;
  private callbacks: GameHUDCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private worldWidth = 100;
  private worldHeight = 70;

  private gameState: 'start' | 'playing' | 'paused' | 'gameOver' = 'start';
  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private wave = 1;
  private lives = 3;

  // Player ship state & physics
  private playerGroup: THREE.Group;
  private playerFlame: THREE.Mesh;
  private playerX = 0;
  private playerY = -26;
  private playerVX = 0;
  private targetPlayerX = 0;
  private playerRecoilY = 0;
  private playerWidth = 6.5;

  // Input state
  private keys: Record<string, boolean> = {};
  private pointerActive = false;
  private shootCooldown = 0;
  private autoFireHeld = false;

  // Entities
  private bullets: BulletEntity[] = [];
  private enemies: EnemyEntity[] = [];
  private particles: Particle3D[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private starPoints!: THREE.Points;
  private starPositions!: Float32Array;
  private starSpeeds!: Float32Array;
  private gridHelper!: THREE.GridHelper;

  // Shared geometries
  private shardGeo = new THREE.BoxGeometry(0.9, 0.9, 0.45);
  private bulletGeo = new THREE.CapsuleGeometry(0.42, 1.8, 4, 8);
  private ringGeo = new THREE.RingGeometry(0.8, 1.15, 32);

  // Loop & lifecycle
  private rafId: number | null = null;
  private lastTime = 0;
  private isOffscreenPaused = false;
  public synth = new ArcadeSynth();

  constructor(canvas: HTMLCanvasElement, callbacks: GameHUDCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070810, 0.0042);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
    this.camera.position.set(0, 0, 110);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x070810, 1);

    // Create 2.5D background grid & starfield
    this.initEnvironment();

    // Create 2.5D Player Ship
    const { group, flame } = this.createPlayerMesh();
    this.playerGroup = group;
    this.playerFlame = flame;
    this.scene.add(this.playerGroup);

    this.handleResize();
    this.bindEvents();

    // Ensure Outpact font is loaded before rendering glyph textures
    if (document.fonts) {
      document.fonts.load('900 64px "Outpact"').then(() => {
        this.spawnDemoBackgroundEnemies();
      });
    } else {
      this.spawnDemoBackgroundEnemies();
    }

    this.startLoop();
  }

  private initEnvironment() {
    // Subtle perspective grid in background
    this.gridHelper = new THREE.GridHelper(260, 36, 0x00e5ff, 0x161b33);
    this.gridHelper.rotation.x = Math.PI * 0.36;
    this.gridHelper.position.set(0, -18, -35);
    const gridMat = this.gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.22;
    this.scene.add(this.gridHelper);

    // 3D Starfield particles
    const starCount = 220;
    const geo = new THREE.BufferGeometry();
    this.starPositions = new Float32Array(starCount * 3);
    this.starSpeeds = new Float32Array(starCount);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      this.starPositions[i * 3] = (Math.random() - 0.5) * 190;
      this.starPositions[i * 3 + 1] = (Math.random() - 0.5) * 130;
      this.starPositions[i * 3 + 2] = -Math.random() * 60 - 5;
      this.starSpeeds[i] = 8 + Math.random() * 28;

      const c = Math.random();
      if (c > 0.85) {
        colors[i * 3] = 0.96;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 0.0;
      } else if (c > 0.7) {
        colors[i * 3] = 0.0;
        colors[i * 3 + 1] = 0.9;
        colors[i * 3 + 2] = 1.0;
      } else {
        colors[i * 3] = 0.75;
        colors[i * 3 + 1] = 0.8;
        colors[i * 3 + 2] = 0.95;
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    this.starPoints = new THREE.Points(geo, mat);
    this.scene.add(this.starPoints);
  }

  private createPlayerMesh(): { group: THREE.Group; flame: THREE.Mesh } {
    const group = new THREE.Group();

    // Main delta wing hull
    const shape = new THREE.Shape();
    shape.moveTo(0, 3.4);
    shape.lineTo(-3.2, -2.6);
    shape.lineTo(-1.1, -1.7);
    shape.lineTo(0, -2.4);
    shape.lineTo(1.1, -1.7);
    shape.lineTo(3.2, -2.6);
    shape.closePath();

    const extrudeSettings = {
      depth: 1.1,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.25,
      bevelThickness: 0.25
    };

    const hullGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    hullGeo.center();
    const hullMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const hullMesh = new THREE.Mesh(hullGeo, hullMat);
    group.add(hullMesh);

    // Wireframe accent overlay for 2.5D arcade look
    const edgesGeo = new THREE.EdgesGeometry(hullGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    group.add(wireframe);

    // Thruster flame cone
    const flameGeo = new THREE.ConeGeometry(0.95, 2.8, 8);
    flameGeo.rotateX(Math.PI);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xf5ff00 });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0, -3.2, 0);
    group.add(flame);

    return { group, flame };
  }

  private spawnDemoBackgroundEnemies() {
    if (this.gameState !== 'start') return;
    this.clearEnemies();
    const demoWords = ['O', 'U', 'T', 'P', 'A', 'C', 'T'];
    demoWords.forEach((ch, idx) => {
      const spread = (idx - (demoWords.length - 1) / 2) * (this.worldWidth * 0.11);
      const y = (Math.random() - 0.5) * 18 + 6;
      const e = this.createEnemy(spread, y, ch);
      e.vx = (Math.random() - 0.5) * 12;
      e.vy = (Math.random() - 0.5) * 6;
      e.angularVel = (Math.random() - 0.5) * 1.2;
      this.enemies.push(e);
    });
  }

  public startGame() {
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.wave = 1;
    this.lives = 3;
    this.clearBullets();
    this.clearEnemies();
    this.playerX = 0;
    this.targetPlayerX = 0;
    this.playerVX = 0;
    this.gameState = 'playing';

    this.callbacks.onScoreChange(this.score, this.combo);
    this.callbacks.onWaveChange(this.wave);
    this.callbacks.onLivesChange(this.lives);
    this.callbacks.onStateChange('playing', this.score);
    this.callbacks.onTargetInspect(null);

    this.spawnWave(this.wave + 2);
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

  private clearBullets() {
    for (const b of this.bullets) {
      this.scene.remove(b.mesh);
    }
    this.bullets = [];
  }

  private clearEnemies() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.texture.dispose();
      e.frontMat.dispose();
      e.backMat.dispose();
    }
    this.enemies = [];
  }

  private spawnWave(count: number) {
    const minX = -this.worldWidth * 0.38;
    const maxX = this.worldWidth * 0.38;

    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      let attempts = 0;
      let valid = false;

      while (!valid && attempts < 50) {
        x = minX + Math.random() * (maxX - minX);
        y = this.worldHeight * 0.52 + 6 + Math.random() * 26;
        valid = !this.enemies.some((other) => Math.hypot(x - other.x, y - other.y) < 11);
        attempts++;
      }

      const label = ENEMY_GLYPHS[Math.floor(Math.random() * ENEMY_GLYPHS.length)];
      const enemy = this.createEnemy(x, y, label);
      this.enemies.push(enemy);
    }
  }

  private createEnemy(x: number, y: number, label: string): EnemyEntity {
    const canvas = document.createElement('canvas');
    const isWord = label.length > 1;
    canvas.width = isWord ? 512 : 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Size & health scaling
    const scaleFactor = 0.85 + Math.random() * 0.55;
    const maxHealth = Math.round(3 + scaleFactor * 4 + Math.min(this.wave * 0.4, 4));
    const initialWght = 1000;

    this.renderGlyphToCanvas(ctx, canvas.width, canvas.height, label, initialWght, false);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const planeH = 8.2 * scaleFactor;
    const planeW = isWord ? planeH * 2 : planeH;

    // Measure approximate visual width of the label for tight physics hitboxes
    const charCount = Math.max(1, label.length);
    const halfW = Math.min(planeW * 0.44, (planeH * 0.34) * charCount);
    const halfH = planeH * 0.36;
    const radius = Math.max(halfW, halfH) * 0.85;

    const group = new THREE.Group();
    group.position.set(x, y, 0);

    const planeGeo = new THREE.PlaneGeometry(planeW, planeH);

    // Front Glyph Plane
    const frontMat = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xf5ff00,
      transparent: true,
      depthWrite: false
    });
    const frontMesh = new THREE.Mesh(planeGeo, frontMat);
    group.add(frontMesh);

    // Back dummy material for disposal compatibility
    const backMat = frontMat;

    this.scene.add(group);

    const baseFallSpeed = 4.2 + this.wave * 0.85 + Math.random() * 2.2;
    const mass = 0.75 + (initialWght / 1000) * 3.75;

    return {
      group,
      frontMat,
      backMat,
      texture,
      canvas,
      ctx,
      label,
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -baseFallSpeed,
      baseFallSpeed,
      angle: (Math.random() - 0.5) * 0.12,
      angularVel: (Math.random() - 0.5) * 0.4,
      tiltX: 0,
      tiltY: 0,
      tiltVelX: 0,
      tiltVelY: 0,
      halfW,
      halfH,
      radius,
      maxHealth,
      health: maxHealth,
      currentWght: initialWght,
      targetWght: initialWght,
      lastRenderedWght: initialWght,
      mass,
      scaleBoost: 0,
      hitFlash: 0
    };
  }

  private renderGlyphToCanvas(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    label: string,
    wght: number,
    flash: boolean
  ) {
    const clampedWght = Math.max(1, Math.min(1000, Math.round(wght)));
    ctx.clearRect(0, 0, w, h);

    // Apply variable font axis on canvas element for browsers supporting fontVariationSettings
    ctx.canvas.style.fontVariationSettings = `'wght' ${clampedWght}`;
    const fontSize = label.length > 3 ? 102 : label.length > 1 ? 132 : 168;
    ctx.font = `${clampedWght} ${fontSize}px "Outpact", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Subtle outer glow
    ctx.shadowColor = flash ? '#ffffff' : 'rgba(245, 255, 0, 0.55)';
    ctx.shadowBlur = flash ? 24 : 12;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, w / 2, h / 2);
  }

  private fireBullet() {
    if (this.gameState !== 'playing' || this.shootCooldown > 0) return;
    this.shootCooldown = 0.13;

    const bulletGroup = new THREE.Group();
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const bolt = new THREE.Mesh(this.bulletGeo, boltMat);
    bulletGroup.add(bolt);

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.6, 0.35), coreMat);
    core.position.z = 0.2;
    bulletGroup.add(core);

    const spawnX = this.playerX;
    const spawnY = this.playerY + 3.2;
    bulletGroup.position.set(spawnX, spawnY, 0);

    // Inherit a fraction of ship horizontal velocity for authentic arcade physics
    const inheritedVX = this.playerVX * 0.18;
    const bulletSpeedY = 82;
    bulletGroup.rotation.z = -inheritedVX / bulletSpeedY;

    this.scene.add(bulletGroup);
    this.bullets.push({
      mesh: bulletGroup,
      x: spawnX,
      y: spawnY,
      vx: inheritedVX,
      vy: bulletSpeedY,
      radius: 0.9
    });

    // Apply physical recoil to player ship
    this.playerRecoilY = -1.35;
    this.synth.playShoot();
  }

  private spawnImpactParticles(x: number, y: number, colorHex: number, count: number, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffffff : colorHex,
        transparent: true,
        opacity: 1
      });
      const mesh = new THREE.Mesh(this.shardGeo, mat);
      mesh.position.set(x, y, (Math.random() - 0.5) * 2);
      const scale = (0.4 + Math.random() * 0.9) * speedScale;
      mesh.scale.set(scale, scale, scale);

      const angle = Math.random() * Math.PI * 2;
      const speed = (10 + Math.random() * 32) * speedScale;
      this.scene.add(mesh);

      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (Math.random() - 0.5) * 22,
        rx: (Math.random() - 0.5) * 12,
        ry: (Math.random() - 0.5) * 12,
        rz: (Math.random() - 0.5) * 12,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.35
      });
    }
  }

  private spawnShockwave(x: number, y: number, colorHex: number, maxScale = 6.5) {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, 0.2);
    this.scene.add(mesh);
    this.shockwaves.push({
      mesh,
      mat,
      life: 0,
      maxLife: 0.32,
      maxScale
    });
  }

  private resolveEnemyCollisions(dt: number) {
    const n = this.enemies.length;
    for (let i = 0; i < n; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius;

        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          const totalMass = a.mass + b.mass;
          a.x -= nx * overlap * (b.mass / totalMass);
          a.y -= ny * overlap * (b.mass / totalMass);
          b.x += nx * overlap * (a.mass / totalMass);
          b.y += ny * overlap * (a.mass / totalMass);

          // Relative velocity along normal
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
            const restitution = 0.78;
            const jImpulse = (-(1 + restitution) * velAlongNormal) / (1 / a.mass + 1 / b.mass);
            const impulseX = jImpulse * nx;
            const impulseY = jImpulse * ny;

            a.vx -= impulseX / a.mass;
            a.vy -= impulseY / a.mass;
            b.vx += impulseX / b.mass;
            b.vy += impulseY / b.mass;

            // Add angular spin on collision
            a.angularVel += (ny * impulseX - nx * impulseY) * 0.015;
            b.angularVel -= (ny * impulseX - nx * impulseY) * 0.015;
          }
        }
      }
    }
    void dt;
  }

  private update(dt: number) {
    // Update 3D Starfield
    const posAttr = this.starPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.starSpeeds.length; i++) {
      let y = posAttr.getY(i) - this.starSpeeds[i] * dt;
      if (y < -65) {
        y = 65;
        posAttr.setX(i, (Math.random() - 0.5) * 190);
      }
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    // Thruster flicker
    this.playerFlame.scale.y = 0.8 + Math.sin(performance.now() * 0.04) * 0.35;

    if (this.gameState === 'paused') return;

    // Combo decay
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.callbacks.onScoreChange(this.score, this.combo);
      }
    }

    // Keyboard movement input
    const moveSpeed = 58;
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) {
      this.targetPlayerX -= moveSpeed * dt;
      this.pointerActive = false;
    }
    if (this.keys['ArrowRight'] || this.keys['KeyD']) {
      this.targetPlayerX += moveSpeed * dt;
      this.pointerActive = false;
    }

    const maxPlayerX = this.worldWidth * 0.45;
    this.targetPlayerX = Math.max(-maxPlayerX, Math.min(maxPlayerX, this.targetPlayerX));

    // Spring-damper physics for Player Ship
    const springStiffness = 180;
    const springDamping = 18;
    const forceX = (this.targetPlayerX - this.playerX) * springStiffness - this.playerVX * springDamping;
    this.playerVX += forceX * dt;
    this.playerX += this.playerVX * dt;
    this.playerX = Math.max(-maxPlayerX, Math.min(maxPlayerX, this.playerX));

    // Recover barrel recoil
    this.playerRecoilY += (0 - this.playerRecoilY) * Math.min(1, dt * 16);

    this.playerY = -this.worldHeight * 0.41;
    this.playerGroup.position.set(this.playerX, this.playerY + this.playerRecoilY, 0);

    // 2.5D Banking & pitch based on velocity
    const bankAngle = Math.max(-0.55, Math.min(0.55, -this.playerVX * 0.014));
    this.playerGroup.rotation.y = bankAngle;
    this.playerGroup.rotation.z = bankAngle * 0.35;

    // Subtle parallax camera shift following ship
    this.camera.position.x += (this.playerX * 0.08 - this.camera.position.x) * Math.min(1, dt * 5);
    this.camera.lookAt(0, 0, 0);

    // Shooting cooldown & triggers
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.gameState === 'playing' && (this.keys['Space'] || this.autoFireHeld)) {
      this.fireBullet();
    }

    // Update Bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.mesh.position.set(b.x, b.y, 0);

      if (b.y > this.worldHeight * 0.56) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
        continue;
      }

      // Check collision against enemies
      if (this.gameState === 'playing') {
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (e.health <= 0) continue;

          // Transform bullet into enemy's rotated local coordinates for accurate OBB hit test
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          const cosA = Math.cos(-e.angle);
          const sinA = Math.sin(-e.angle);
          const localX = dx * cosA - dy * sinA;
          const localY = dx * sinA + dy * cosA;

          if (
            Math.abs(localX) <= e.halfW + b.radius &&
            Math.abs(localY) <= e.halfH + b.radius
          ) {
            // HIT! Apply 2.5D Impulse & Variable Font Weight Reduction
            e.health -= 1;
            e.targetWght = Math.max(1, (e.health / e.maxHealth) * 1000);
            e.mass = 0.75 + (e.targetWght / 1000) * 3.75;
            e.hitFlash = 0.12;
            e.scaleBoost = 0.26;

            // Linear knockback inversely proportional to typographic weight mass
            const knockbackY = 24 / e.mass;
            const knockbackX = ((dx / Math.max(1, e.halfW)) * 18 + b.vx * 0.25) / e.mass;
            e.vy = Math.min(22, e.vy + knockbackY);
            e.vx += knockbackX;

            // Rotational torque from off-center hit (r x F)
            const torque = -localX * 3.4;
            e.angularVel += torque / (e.mass * e.radius);

            // 3D out-of-plane tilt impulse
            e.tiltVelX += -0.45 / e.mass;
            e.tiltVelY += (localX * 0.18) / e.mass;

            this.synth.playHit(e.currentWght);
            this.spawnImpactParticles(b.x, b.y, 0xf5ff00, 7, 0.8);
            this.spawnShockwave(b.x, b.y, 0x00e5ff, 3.8);

            // Update HUD Target Inspector with live variable font physics stats
            this.callbacks.onTargetInspect({
              label: e.label,
              wght: Math.round(e.targetWght),
              health: Math.max(0, e.health),
              maxHealth: e.maxHealth,
              mass: Number(e.mass.toFixed(2))
            });

            // Remove bullet
            this.scene.remove(b.mesh);
            this.bullets.splice(i, 1);

            if (e.health <= 0) {
              // Destroyed!
              this.comboTimer = 2.6;
              this.score += 10 * this.combo;
              this.combo = Math.min(8, this.combo + 1);
              this.callbacks.onScoreChange(this.score, this.combo);
              this.synth.playDestroy();
              this.spawnImpactParticles(e.x, e.y, 0xff3366, 22, 1.35);
              this.spawnShockwave(e.x, e.y, 0xf5ff00, 9.5);

              this.scene.remove(e.group);
              e.texture.dispose();
              e.frontMat.dispose();
              e.backMat.dispose();
              this.enemies.splice(j, 1);
            }
            break;
          }
        }
      }
    }

    // Resolve Enemy-to-Enemy elastic collisions
    this.resolveEnemyCollisions(dt);

    // Update Enemies
    const wallLimitX = this.worldWidth * 0.45;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      if (this.gameState === 'playing') {
        // Gravity / downward wave pull restores downward velocity after upward knockback
        const targetVy = -e.baseFallSpeed;
        e.vy += (targetVy - e.vy) * Math.min(1, dt * 2.2);
        // Horizontal air drag
        e.vx *= Math.pow(0.65, dt);
      } else {
        // Gentle floating in demo screen
        if (e.y < -this.worldHeight * 0.35 || e.y > this.worldHeight * 0.38) {
          e.vy *= -1;
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Wall bounce physics
      if (e.x - e.halfW < -wallLimitX) {
        e.x = -wallLimitX + e.halfW;
        e.vx = Math.abs(e.vx) * 0.85;
        e.angularVel -= 0.8;
        this.spawnImpactParticles(e.x - e.halfW, e.y, 0x00e5ff, 4, 0.55);
      } else if (e.x + e.halfW > wallLimitX) {
        e.x = wallLimitX - e.halfW;
        e.vx = -Math.abs(e.vx) * 0.85;
        e.angularVel += 0.8;
        this.spawnImpactParticles(e.x + e.halfW, e.y, 0x00e5ff, 4, 0.55);
      }

      // Angular rotation & restoring spring torque
      e.angle += e.angularVel * dt;
      e.angularVel *= Math.pow(0.28, dt);
      e.angularVel += -e.angle * 1.8 * dt;

      // 2.5D Out-of-plane tilt spring
      e.tiltX += e.tiltVelX;
      e.tiltY += e.tiltVelY;
      e.tiltVelX += (-e.tiltX * 18 - e.tiltVelX * 6) * dt;
      e.tiltVelY += (-e.tiltY * 18 - e.tiltVelY * 6) * dt;

      // Squash & stretch recovery
      e.scaleBoost += (0 - e.scaleBoost) * Math.min(1, dt * 12);
      const s = 1 + e.scaleBoost;
      e.group.scale.set(s, Math.max(0.75, 1 - e.scaleBoost * 0.45), 1);

      e.group.position.set(e.x, e.y, 0);
      e.group.rotation.set(e.tiltX, e.tiltY, e.angle);

      // Smoothly interpolate Variable Font Weight (`wght` 1000 -> 1)
      e.currentWght += (e.targetWght - e.currentWght) * Math.min(1, dt * 10);

      const wasFlashing = e.hitFlash > 0;
      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
      }
      const isFlashing = e.hitFlash > 0;

      // Re-render variable font canvas texture when weight shifts or flash toggles
      if (
        Math.abs(e.currentWght - e.lastRenderedWght) >= 6 ||
        wasFlashing !== isFlashing
      ) {
        e.lastRenderedWght = e.currentWght;
        this.renderGlyphToCanvas(
          e.ctx,
          e.canvas.width,
          e.canvas.height,
          e.label,
          e.currentWght,
          isFlashing
        );
        e.texture.needsUpdate = true;

        // Shift tint from Acid Yellow (heavy wght) -> Cyan -> Coral Pink (thin critical wght)
        if (isFlashing) {
          e.frontMat.color.setHex(0xffffff);
        } else {
          const ratio = e.currentWght / 1000;
          if (ratio > 0.45) {
            e.frontMat.color.setHex(0xf5ff00);
          } else if (ratio > 0.2) {
            e.frontMat.color.setHex(0x00e5ff);
          } else {
            e.frontMat.color.setHex(0xff3366);
          }
        }
      }

      // Check bottom breach in playing state
      if (this.gameState === 'playing' && e.y < -this.worldHeight * 0.52) {
        this.lives -= 1;
        this.combo = 1;
        this.callbacks.onLivesChange(this.lives);
        this.callbacks.onScoreChange(this.score, this.combo);
        this.spawnImpactParticles(e.x, -this.worldHeight * 0.46, 0xff3366, 15, 1.1);

        this.scene.remove(e.group);
        e.texture.dispose();
        e.frontMat.dispose();
        e.backMat.dispose();
        this.enemies.splice(i, 1);

        if (this.lives <= 0) {
          this.gameState = 'gameOver';
          this.callbacks.onStateChange('gameOver', this.score);
          break;
        }
      }
    }

    // Spawn next wave when all enemies cleared
    if (this.gameState === 'playing' && this.enemies.length === 0) {
      this.wave += 1;
      this.callbacks.onWaveChange(this.wave);
      this.spawnWave(this.wave + 2);
    }

    // Update 3D Shards / Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 28 * dt; // subtle gravity on shards
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      p.mesh.rotation.z += p.rz * dt;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - p.life / p.maxLife;
    }

    // Update 3D Shockwave Rings
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
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const scale = 0.5 + easeOut * sw.maxScale;
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
      if (e.code === 'Space' && this.gameState === 'playing') {
        // Avoid scrolling page when playing and pressing Space inside game hero
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && !document.activeElement?.hasAttribute('contenteditable')) {
          e.preventDefault();
        }
      }
      if (e.code === 'KeyP' && (this.gameState === 'playing' || this.gameState === 'paused')) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && !document.activeElement?.hasAttribute('contenteditable')) {
          this.togglePause();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      this.pointerActive = true;
      this.targetPlayerX = this.clientXToWorldX(e.clientX);
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointerActive = true;
      this.targetPlayerX = this.clientXToWorldX(e.clientX);
      if (this.gameState === 'playing') {
        this.autoFireHeld = true;
        this.fireBullet();
      }
    });

    window.addEventListener('pointerup', () => {
      this.autoFireHeld = false;
    });
  }
}
