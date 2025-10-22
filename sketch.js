// --- VARIABLES DEL JUEGO ---
let player;
let bullets = [];
let enemies = [];
let score = 0;
let wave = 1;
let gameState = 'start';
let lives = 3;

const enemiesArray = ["a","b","A","B","C","&","HI","ADIOS"];
let particles = [];
const numParticles = 40;

let buttonX, buttonY, buttonW, buttonH;
let gameJustStarted = false;

const FONT_FAMILY_NAME = 'Outpact';
let outpactFont;

// --- FUENTE ---
function registerFont() {
  const style = document.createElement('style');
  style.innerHTML = `@font-face{font-family:'${FONT_FAMILY_NAME}';src:url('Outpact-VF.ttf');}`;
  document.head.appendChild(style);
}

function preload() { outpactFont = loadFont('Outpact-VF.ttf'); }

// --- SETUP ---
function setup() {
  createCanvas(windowWidth, windowHeight);
  registerFont();
  player = new Player();
  textFont(FONT_FAMILY_NAME);
  for (let i = 0; i < numParticles; i++) particles.push(new Particle());
  updateButtonSize();
  document.addEventListener('touchmove', e => e.preventDefault(), { passive:false });
}

// --- DRAW ---
function draw() {
  background(10,10,20);
  for (let p of particles){ p.update(); p.show(); }

  if(gameState==='start') drawStartScreen();
  else if(gameState==='playing') drawGamePlay();
  else if(gameState==='gameOver') drawGameOver();

  if(gameJustStarted) gameJustStarted=false;
}

// --- PANTALLAS ---
function drawStartScreen(){
  textAlign(CENTER,CENTER);
  fill(255,255,0);
  let titleSize = constrain(width*0.1, 72, 90);
  textSize(titleSize); textVariations({'wght':900});
  text("OUTPACT", width/2, height/2 - height*0.3+ titleSize);
  text("INVADERS", width/2, height/2 - height*0.3 + (titleSize*2));

  fill(255);
  let infoSize = constrain(width*0.04,14,28);
  textSize(infoSize); textVariations({'wght':400});
  text("Arrastra el dedo o mueve el mouse para moverte.", width/2, height*0.5+(infoSize));
  text("Toca o haz clic para disparar.", width/2, height*0.5+(infoSize*2+3));

  drawButton("COMENZAR");
}

function drawGamePlay(){
  player.show();
  player.updatePosition();

  for(let i=bullets.length-1;i>=0;i--){
    bullets[i].update(); bullets[i].show();
    if(bullets[i].offscreen()) bullets.splice(i,1);
    else checkBulletCollision(i);
  }

  for(let enemy of enemies){ enemy.update(); enemy.show(); }
  enemies = enemies.filter(e=>e.health>0);

  // Solo aumentar wave si no acabamos de iniciar el juego
  if(enemies.length===0 && !gameJustStarted){ 
    wave++; 
    spawnEnemies(wave); 
  }

  fill(255); textAlign(LEFT,TOP); textVariations({'wght':400});
  textSize(constrain(width*0.035,16,24));
  text("Score: "+score, 20, 20);
  text("Wave: "+wave, 20, 50);
  text("Vidas: "+lives, 20, 80);
}

function drawGameOver(){
  fill(255,0,0); textAlign(CENTER,CENTER);
  let goSize = constrain(width*0.06,30,60);
  textSize(goSize); textVariations({'wght':800}); text("GAME OVER", width/2, height/2-40);
  fill(255);
  let scoreSize = constrain(width*0.04,18,28);
  textSize(scoreSize); textVariations({'wght':400}); text("Puntuación: "+score, width/2, height/2+20);
  drawButton("REINICIAR");
}

// --- BOTÓN ---
function updateButtonSize(){
  buttonW = constrain(width*0.35,160,280);
  buttonH = constrain(height*0.06,45,70);
  buttonX = width/2 - buttonW/2; buttonY = height/2 + height*0.15;
}

function drawButton(label){
  fill(0,255,0); rect(buttonX, buttonY, buttonW, buttonH, 10);
  fill(0); let txtSize = constrain(width*0.04,18,28); textSize(txtSize);
  textVariations({'wght':700}); textAlign(CENTER,CENTER); text(label, width/2, buttonY+buttonH/2);
}

// --- CONTROLES ---
function isOverButton(x,y){ return x>buttonX && x<buttonX+buttonW && y>buttonY && y<buttonY+buttonH; }
function mousePressed(){ handleInput(mouseX,mouseY); return false; }
function touchStarted(){ gameJustStarted=true; handleInput(touches[0]?.x||mouseX,touches[0]?.y||mouseY); return false; }
function touchMoved(){ 
  if(gameState==='playing'){ 
    player.x=constrain(touches[0].x,player.width/2,width-player.width/2); 
  } 
  return false; 
}
function touchEnded(){ 
  if(gameState==='playing' && !gameJustStarted) bullets.push(new Bullet(player.x,player.y)); 
  gameJustStarted=false; 
  return false; 
}

function handleInput(x,y){
  if(gameState==='start' && isOverButton(x,y)) startGame();
  else if(gameState==='gameOver' && isOverButton(x,y)) resetGame();
  else if(gameState==='playing') bullets.push(new Bullet(player.x,player.y));
}

// --- ESTADOS ---
function startGame(){ gameState='playing'; lives=3; spawnEnemies(wave); gameJustStarted=true; }
function resetGame(){ score=0; wave=1; bullets=[]; enemies=[]; lives=3; player=new Player(); startGame(); }

// --- CLASES ---
class Player{
  constructor(){ 
    this.width=constrain(width*0.04,25,50); 
    this.height=this.width*0.7; 
    this.x=width/2; 
    this.y=height-this.height*2; 
  }
  show(){ fill(0,200,255); noStroke(); triangle(this.x,this.y,this.x-this.width/2,this.y+this.height,this.x+this.width/2,this.y+this.height); }
  updatePosition(){ 
    if (touches.length === 0) {
      let targetX = mouseX;
      this.x = constrain(targetX, this.width/2, width - this.width/2); 
    }
  }
}

class Bullet{
  constructor(x,y){ this.x=x; this.y=y; this.r=constrain(width*0.007,5,10); this.speed=height*0.015; }
  update(){ this.y-=this.speed; }
  show(){ fill(255,100,100); noStroke(); ellipse(this.x,this.y,this.r*2); }
  offscreen(){ return this.y<-this.r; }
  hits(enemy){
    if(enemy.health<=0) return false;
    const enemyFontSize = enemy.fontSize;
    textSize(enemyFontSize); 
    textVariations({'wght': enemy.currentWght}); 
    const w = textWidth(enemy.label);
    const h = enemyFontSize;
    let leftEdge = enemy.x - w/2;
    let rightEdge = enemy.x + w/2;
    let topEdge = enemy.y - h/2;
    let bottomEdge = enemy.y + h/2;
    return (this.x > leftEdge && this.x < rightEdge && this.y > topEdge && this.y < bottomEdge);
  }
}

class Enemy{
  constructor(x,y,label){
    this.x = x;
    this.y = y;
    this.label = label;

    // Tamaño adaptativo con variación aleatoria
    let baseMin = width < 500 ? width*0.12 : width*0.05;
    let baseMax = width < 500 ? width*0.18 : width*0.08;

    this.fontSize = constrain(random(baseMin, baseMax), 25, 70); // más grande
    this.speed = height*0.001 + wave*0.05;

    // Salud basada en tamaño (más grande = más vida)
    this.maxHealth = floor(map(this.fontSize, baseMin, baseMax, 3, 7));
    this.health = this.maxHealth;
    this.currentWght = 900;
  }

  update(){
    if(this.health <= 0) return;
    this.y += this.speed;
    if(this.y > height + this.fontSize){
      lives--;
      this.health = 0;
      if(lives <= 0) gameState = 'gameOver';
    }
  }

  show(){
    textSize(this.fontSize);
    let targetW = map(this.health, 0, this.maxHealth, 1, 1000);
    this.currentWght = lerp(this.currentWght, targetW, 0.15);
    textVariations({'wght': this.currentWght});
    fill(255,255,0);
    textAlign(CENTER, CENTER);
    text(this.label, this.x, this.y);
  }

  takeDamage(){
    const alive = this.health > 0;
    this.health--;
    return alive && this.health <= 0;
  }
}


class Particle{
  constructor(){ this.x=random(width); this.y=random(height); this.z=random(0,20); this.size=map(this.z,0,20,1,3); this.speed=map(this.z,0,20,1,5); }
  update(){ this.y+=this.speed; if(this.y>height){ this.y=random(-20,0); this.x=random(width); } }
  show(){ noStroke(); fill(map(this.z,0,20,50,150)); ellipse(this.x,this.y,this.size); }
}

// --- AUXILIARES ---
function spawnEnemies(count){
  for(let i=0;i<count;i++){
    let valid=false,x,y,attempts=0;
    while(!valid && attempts<100){
      x=random(width*0.1,width*0.9);
      y=random(-150,-50);
      valid=!enemies.some(e=>dist(x,y,e.x,e.y)<width*0.15);
      attempts++;
    }
    if(valid) enemies.push(new Enemy(x,y,random(enemiesArray)));
  }
}

function checkBulletCollision(i){
  for(let j=enemies.length-1;j>=0;j--){
    if(bullets[i] && bullets[i].hits(enemies[j])){
      if(enemies[j].takeDamage()) score++;
      bullets.splice(i,1); break;
    }
  }
}

function windowResized(){
  resizeCanvas(windowWidth,windowHeight);
  updateButtonSize();
  if(player){ 
    player.width=constrain(width*0.04,25,50); 
    player.height=player.width*0.7; 
    player.y=height-player.height*2; 
  }
}
