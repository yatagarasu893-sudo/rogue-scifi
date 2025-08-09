// v6 core = v5 main.js (copied). For brevity, the full v5 logic is embedded.
/* Rogue-like Sci-Fi Variant v5
   New from v4:
   - Jam/Misfire: blaster can misfire (ammo消費・ダメ0) & jammed 状態。待機で解消しやすく。
   - Saber color & forms: colors cosmetic; forms affect ATK/DEF (Aggressive +1/-1, Defensive -1/+1, Balanced 0/0)
   - Enemy ranged AI: Sentry shoots line-of-sight with cooldown; Boss on deepest floor with mixed attacks.
   - Floor transitions: multi-floor with elevators '<' 上り, '>' 下り, 最下層に 'X' 脱出地点。
   - Save/Load: localStorage に保存/復元（P: save, O: load）
*/
const W = 80, H = 24;
const TILE = { WALL:'#', FLOOR:'.', DOOR:'+', UP:'<', DOWN:'>', EXIT:'X' };
const ENT = { PLAYER:'@', DRONE:'d', ALIEN:'a', SENTRY:'s', BOSS:'B' };

const screen = document.getElementById('screen');
const logEl = document.getElementById('log');
const statsEl = document.getElementById('stats');

function rand(n){ return Math.floor(Math.random()*n); }
function make2D(w,h,val=0){ return Array.from({length:h}, _=> Array(w).fill(val)); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function shuffle(a){ for(let i=a.length-1;i>0;--i){ const j=rand(i+1); [a[i],a[j]]=[a[j],a[i]];} return a; }

class RNG {
  constructor(seed=Date.now()%2147483647) { this.s=seed; }
  next(){ return this.s = this.s*48271%2147483647; }
  nextFloat(){ return (this.next()-1)/2147483646; }
  range(a,b){ return a + Math.floor(this.nextFloat()*(b-a+1)); }
}
const rng = new RNG();

// State per floor
let floors = [];
let currentFloor = 0;
const MAX_FLOOR = 3;

// Player
let player = {
  x:1,y:1,ch:ENT.PLAYER,
  hp:16,maxhp:16,atk:2,def:0,bag:[],
  ammo:10,
  weapon:"fists",
  shieldTurns:0,
  heat:0, // blaster heat
  critChance:0.10,
  jam:false,
  saberColor:'blue',
  saberForm:'Balanced' // Aggressive, Defensive, Balanced
};

// Items
const TMedkit     = {ch:'!', name:'Medkit', heal:6};
const TEnergy     = {ch:'*', name:'Energy Cell', ammo:5};
const TLightsaber = {ch:')', name:'Lightsaber', meleeAtk:3, dur:20, maxdur:20, color:'blue'};
const TBlaster    = {ch:'/', name:'Blaster',  rangeAtk:3, dur:12, maxdur:12};
const TShield     = {ch:'[', name:'Shield Emitter', shield:20};
const TRepair     = {ch:'}', name:'Repair Kit', repair:6};
const ITEM_POOL = [TMedkit, TEnergy, TEnergy, TLightsaber, TBlaster, TShield, TRepair];

function cloneItem(t){ return {...t}; }

function baseFloorState(){
  return {
    map: make2D(W,H, TILE.WALL),
    doors: make2D(W,H,false),
    explored: make2D(W,H,false),
    fov: make2D(W,H,false),
    entities: [],
    items: [],
    upPos: null,
    downPos: null,
    exitPos: null
  };
}

function carve(f,x,y,t){ if(x>0&&x<W&&y>0&&y<H) f.map[y][x]=t; }
function isWalkable(f,x,y){
  const t=f.map[y]?.[x];
  return t===TILE.FLOOR || t===TILE.DOOR || t===TILE.UP || t===TILE.DOWN || t===TILE.EXIT;
}
function rectRoom(f,x,y,w,h){
  for(let j=y;j<y+h;j++){
    for(let i=x;i<x+w;i++){
      if(i===x||i===x+w-1||j===y||j===y+h-1) carve(f,i,j,TILE.WALL);
      else carve(f,i,j,TILE.FLOOR);
    }
  }
  const side=rng.range(0,3);
  let dx,dy;
  if(side===0){ dx=rng.range(x+1,x+w-2); dy=y; }
  if(side===1){ dx=x+w-1; dy=rng.range(y+1,y+h-2); }
  if(side===2){ dx=rng.range(x+1,x+w-2); dy=y+h-1; }
  if(side===3){ dx=x; dy=rng.range(y+1,y+h-2); }
  f.doors[dy][dx]=true; carve(f,dx,dy,TILE.DOOR);
  return {x,y,w,h,cx:Math.floor(x+w/2),cy:Math.floor(y+h/2)};
}
function tunnel(f,x1,y1,x2,y2){
  if(rng.range(0,1)===0){
    for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++) carve(f,x,y1,TILE.FLOOR);
    for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) carve(f,x2,y,TILE.FLOOR);
  }else{
    for(let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++) carve(f,x1,y,TILE.FLOOR);
    for(let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++) carve(f,x,y2,TILE.FLOOR);
  }
}

function genFloor(fi){
  const f = baseFloorState();
  // rooms
  const rooms=[];
  const MAX=15;
  let attempts=0;
  while(rooms.length<MAX && attempts<200){
    attempts++;
    const w=rng.range(5,12), h=rng.range(4,8);
    const x=rng.range(1,W-w-2), y=rng.range(1,H-h-2);
    const overlap = rooms.some(r=> !(x+w<r.x || r.x+r.w<x || y+h<r.y || r.y+r.h<y));
    if(overlap) continue;
    rooms.push(rectRoom(f,x,y,w,h));
    if(rooms.length>1){
      const a=rooms[rooms.length-2], b=rooms[rooms.length-1];
      tunnel(f,a.cx,a.cy,b.cx,b.cy);
    }
  }
  // elevators
  f.upPos = {x:rooms[0].cx, y:rooms[0].cy};
  carve(f,f.upPos.x,f.upPos.y,TILE.UP);
  f.downPos = {x:rooms[rooms.length-1].cx, y:rooms[rooms.length-1].cy};
  carve(f,f.downPos.x,f.downPos.y,TILE.DOWN);
  if(fi===MAX_FLOOR-1){
    f.exitPos = {x:rooms[Math.max(1, rooms.length-2)].cx, y:rooms[Math.max(1, rooms.length-2)].cy};
    carve(f,f.exitPos.x,f.exitPos.y,TILE.EXIT);
  }
  // mobs
  const freeTiles = [];
  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      if(isWalkable(f,x,y) && !f.doors[y][x] && !(f.upPos&&x===f.upPos.x&&y===f.upPos.y) && !(f.downPos&&x===f.downPos.x&&y===f.downPos.y)) freeTiles.push({x,y});
    }
  }
  shuffle(freeTiles);
  const mobs = Math.min(12, Math.floor(freeTiles.length*0.02)+5);
  for(let i=0;i<mobs;i++){
    const t=freeTiles.pop(); if(!t) break;
    let typeRoll = rng.range(0,9);
    let ch = ENT.DRONE;
    if(typeRoll>=6) ch = ENT.ALIEN;
    if(typeRoll>=8) ch = ENT.SENTRY;
    const hp = ch===ENT.ALIEN? 6 : ch===ENT.SENTRY? 5 : 4;
    const atk = ch===ENT.ALIEN? 2 : 1;
    const sentry = ch===ENT.SENTRY? {range:8,cool:0} : null;
    f.entities.push({x:t.x,y:t.y,ch,hp,maxhp:hp,atk,ai:'hunt',sentry});
  }
  if(fi===MAX_FLOOR-1){
    const t = freeTiles.pop();
    f.entities.push({x:t.x,y:t.y,ch:ENT.BOSS,hp:24,maxhp:24,atk:3,ai:'boss',phase:0,cool:0});
  }
  // items
  const drops = Math.min(10, Math.floor(freeTiles.length*0.01)+5);
  for(let i=0;i<drops;i++){
    const t=freeTiles.pop(); if(!t) break;
    const it = cloneItem(ITEM_POOL[rng.range(0,ITEM_POOL.length-1)]);
    f.items.push({x:t.x,y:t.y,...it});
  }
  return f;
}

function log(msg){ logEl.textContent = msg; }

function current(){ return floors[currentFloor]; }

const LOS_RADIUS = 8;
function opaque(f,x,y){ return current().map[y]?.[x]===TILE.WALL; }
function recomputeFOV(px,py){
  const f=current();
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) f.fov[y][x]=false;
  for(let y=py-LOS_RADIUS;y<=py+LOS_RADIUS;y++){
    for(let x=px-LOS_RADIUS;x<=px+LOS_RADIUS;x++){
      const dx=x-px, dy=y-py;
      if(dx*dx+dy*dy>LOS_RADIUS*LOS_RADIUS) continue;
      if(!inBounds(x,y)) continue;
      if(visible(px,py,x,y)){
        f.fov[y][x]=true;
        f.explored[y][x]=true;
      }
    }
  }
}
function inBounds(x,y){ return x>=0&&y>=0&&x<W&&y<H; }
function visible(x0,y0,x1,y1){
  let dx=Math.abs(x1-x0), sx=x0<x1?1:-1;
  let dy=-Math.abs(y1-y0), sy=y0<y1?1:-1;
  let err=dx+dy, x=x0, y=y0;
  while(true){
    if(x===x1 && y===y1) return true;
    if(!(x===x0&&y===y0) && opaque(current(),x,y)) return false;
    const e2=2*err;
    if(e2>=dy){ err+=dy; x+=sx; }
    if(e2<=dx){ err+=dx; y+=sy; }
    if(!inBounds(x,y)) return false;
  }
}

function render(){
  const f=current();
  recomputeFOV(player.x, player.y);
  let out="";
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      let ch = f.map[y][x];
      let cls = (ch===TILE.WALL?"c-wall":ch===TILE.FLOOR?"c-floor":ch===TILE.DOOR?"c-door":ch===TILE.UP||ch===TILE.DOWN?"c-elev":"c-exit");
      const item = f.items.find(it=>it.x===x&&it.y===y);
      const ent = f.entities.find(e=>e.x===x&&e.y===y);
      if(f.fov[y][x]){
        if(item){ ch=item.ch; cls="c-item"; }
        if(ent){ ch=ent.ch; cls="c-enemy"; }
        if(player.x===x && player.y===y){ ch=player.ch; cls=player.weapon==='lightsaber'? saberClass(): "c-player"; }
      }else if(f.explored[y][x]){
        if(player.x===x && player.y===y){ ch=player.ch; cls="c-dark"; }
      }else{
        ch = ' ';
        cls="c-explored";
      }
      out += `<span class="${cls}">${ch}</span>`;
    }
    out += "\n";
  }
  const wlabel = weaponLabel();
  const durlabel = weaponDurabilityLabel();
  const heatStr = player.weapon==="blaster" ? ` Heat ${player.heat}%${player.jam?' (JAMMED)':''}` : "";
  const formStr = player.weapon==="lightsaber" ? ` ${player.saberColor}/${player.saberForm}` : "";
  statsEl.textContent = `F${currentFloor+1}/${MAX_FLOOR}  HP ${player.hp}/${player.maxhp}  DEF ${effectiveDef()}  ATK ${attackValue()}  Ammo ${player.ammo}  Weapon[${wlabel}${durlabel}]${heatStr}${formStr}  Bag[${current().items.length} on floor, ${player.bag.map(x=>bagLabel(x)).join(', ')}]`;
  screen.innerHTML = out;
}
function saberClass(){
  return player.saberColor==='blue' ? 'c-saber-blue' :
         player.saberColor==='green' ? 'c-saber-green' :
         player.saberColor==='red' ? 'c-saber-red' : 'c-saber-purple';
}
function bagLabel(it){
  if(it.dur!=null && it.maxdur!=null) return `${it.name}{${it.dur}/${it.maxdur}}`;
  if(it.repair) return `${it.name}{+${it.repair}}`;
  if(it.ammo) return `${it.name}{+${it.ammo}}`;
  if(it.heal) return `${it.name}{+${it.heal}}`;
  if(it.shield) return `${it.name}{${it.shield}T}`;
  return it.name;
}
function weaponLabel(){
  if(player.weapon==="fists") return "Fists";
  if(player.weapon==="lightsaber") return "Lightsaber";
  if(player.weapon==="blaster") return "Blaster";
  return "?";
}
function weaponDurabilityLabel(){
  let it = null;
  if(player.weapon==="lightsaber") it = player.bag.find(b=> b.name==='Lightsaber');
  if(player.weapon==="blaster") it = player.bag.find(b=> b.name==='Blaster');
  return it && it.dur!=null ? `:${it.dur}/${it.maxdur}` : "";
}
function at(x,y){ return current().map[y]?.[x]; }

function weaponScale(it){
  if(!it || it.maxdur==null || it.dur==null) return 1.0;
  const ratio = Math.max(0, Math.min(1, it.dur / it.maxdur));
  return 0.5 + 0.5 * ratio; // 50%-100%
}
function formMods(){
  if(player.saberForm==='Aggressive') return {atk:+1, def:-1};
  if(player.saberForm==='Defensive') return {atk:-1, def:+1};
  return {atk:0, def:0};
}
function effectiveDef(){ return player.def + (player.shieldTurns>0?2:0) + formMods().def; }

function rollCrit(){ return Math.random() < player.critChance; }

function attackValue(){
  let base = player.atk + formMods().atk;
  if(player.weapon==="lightsaber"){
    const it = player.bag.find(b=> b.name==='Lightsaber' && (b.dur??0)>0);
    if(!it) return base; // broken or absent
    const bonus = (it.meleeAtk||3) * weaponScale(it);
    return Math.floor(base + Math.max(1, Math.round(bonus)));
  }
  if(player.weapon==="blaster"){
    // melee with blaster uses base atk
    return base;
  }
  return base;
}

function maybeDegrade(name, chance=0.5, amount=1){
  const it = player.bag.find(b=> b.name===name && (b.dur??0)>0);
  if(!it) return false;
  if(Math.random() < chance){
    it.dur -= amount;
    if(it.dur<=0){
      it.dur=0;
      if(player.weapon.toLowerCase()===name.toLowerCase()){
        player.weapon = "fists";
        log(`${name} が壊れた！（耐久0）`);
      }else{
        log(`${name} が壊れた！（耐久0）`);
      }
    }
    return true;
  }
  return false;
}

function moveEntity(e,dx,dy){
  const f=current();
  const nx = clamp(e.x+dx,0,W-1), ny=clamp(e.y+dy,0,H-1);
  if(!isWalkable(f,nx,ny)) return false;
  if(e!==player && (player.x===nx && player.y===ny)){
    const dmg = Math.max(0, e.atk - effectiveDef()) || 1;
    player.hp -= dmg;
    log(`${glyph(e)}の攻撃 ${dmg} ダメージ`);
    return true;
  }
  if(f.entities.some(o=>o!==e && o.x===nx&&o.y===ny)) return false;
  e.x=nx; e.y=ny;
  return true;
}
function glyph(e){
  return e.ch===ENT.DRONE?'ドローン':
         e.ch===ENT.ALIEN?'エイリアン':
         e.ch===ENT.SENTRY?'セントリー':
         e.ch===ENT.BOSS?'ボス':'？';
}

function tryPlayerMove(dx,dy){
  const f=current();
  const nx=player.x+dx, ny=player.y+dy;
  const foe = f.entities.find(e=>e.x===nx&&e.y===ny);
  if(foe){
    let dmg = Math.max(1, attackValue());
    if(rollCrit()){ dmg *= 2; log('クリティカル！'); }
    foe.hp -= dmg;
    log(`あなたの${player.weapon==="lightsaber"?"ライトセーバー":"攻撃"} → ${glyph(foe)}に${dmg}ダメージ`);
    if(player.weapon==="lightsaber"){
      maybeDegrade('Lightsaber', 0.5, 1);
    }
    if(foe.hp<=0){
      log(`${glyph(foe)}を倒した！`);
      const idx=f.entities.indexOf(foe);
      f.entities.splice(idx,1);
    }
    endTurn();
    return;
  }
  if(isWalkable(f,nx,ny) && !f.entities.some(e=>e.x===nx&&e.y===ny)){
    player.x=nx; player.y=ny;
    endTurn();
  }
}

function pickUp(){
  const f=current();
  const idx = f.items.findIndex(it=> it.x===player.x && it.y===player.y);
  if(idx>=0){
    const it = f.items.splice(idx,1)[0];
    if(it.ammo){ player.ammo += it.ammo; log(`Energy Cellを${it.ammo}入手（合計${player.ammo}）`); }
    else{
      if(it.name==='Lightsaber' && it.maxdur==null){ it.maxdur=20; it.dur=20; }
      if(it.name==='Blaster' && it.maxdur==null){ it.maxdur=12; it.dur=12; }
      if(it.name==='Lightsaber' && it.color) player.saberColor = it.color;
      player.bag.push(it);
      if(player.weapon==="fists"){
        if(it.name==='Lightsaber') player.weapon="lightsaber";
        if(it.name==='Blaster') player.weapon="blaster";
      }
      log(`${it.name} を拾った${it.dur!=null?`（耐久${it.dur}/${it.maxdur}）`:""}`);
    }
  }else{
    log('ここには何もない');
  }
}

function waitTurn(){
  if(player.shieldTurns>0) player.shieldTurns--;
  // cool and clear jam chance
  if(player.heat>0) player.heat = Math.max(0, player.heat - 10);
  if(player.jam && Math.random()<0.6){ player.jam=false; log('ジャム解消'); }
  endTurn();
}

function useRepairKit(){
  const idx = player.bag.findIndex(b=> b.repair);
  if(idx<0){ return false; }
  const repairAmount = player.bag[idx].repair;
  let target = null;
  if(player.weapon==='lightsaber'){
    target = player.bag.find(b=> b.name==='Lightsaber');
  }else if(player.weapon==='blaster'){
    target = player.bag.find(b=> b.name==='Blaster');
  }
  if(!target){
    target = player.bag.find(b=> (b.name==='Lightsaber' || b.name==='Blaster'));
  }
  if(!target){ log('修理対象の武器がない'); return false; }
  const before = target.dur||0;
  target.dur = Math.min(target.maxdur||before, (target.dur||0) + repairAmount);
  player.bag.splice(idx,1);
  if(player.weapon==='blaster') player.jam=false; // repair clears jam
  log(`修理キットで ${target.name} を修理（${before} → ${target.dur}/${target.maxdur}）`);
  render();
  return true;
}

function handleUse(){
  // Medkit > Repair Kit > Shield
  const mi = player.bag.findIndex(b=> b.heal);
  if(mi>=0){
    const it = player.bag.splice(mi,1)[0];
    player.hp = Math.min(player.maxhp, player.hp + it.heal);
    log(`Medkitで ${it.heal} 回復`);
    endTurn();
    return;
  }
  if(useRepairKit()){ endTurn(); return; }
  const si = player.bag.findIndex(b=> b.shield);
  if(si>=0){
    const it = player.bag.splice(si,1)[0];
    player.shieldTurns = it.shield;
    log(`シールド展開（+DEF 2, ${it.shield}ターン）`);
    endTurn();
    return;
  }
  log('使えるアイテムがない');
}

function toggleWeapon(){
  const hasSaber = player.bag.some(b=> b.name==='Lightsaber' && (b.dur??0)>0) || player.weapon==='lightsaber';
  const hasBlaster = player.bag.some(b=> b.name==='Blaster' && (b.dur??0)>0) || player.weapon==='blaster';
  const cycle = ['fists', hasSaber?'lightsaber':null, hasBlaster?'blaster':null].filter(Boolean);
  const idx = cycle.indexOf(player.weapon);
  player.weapon = cycle[(idx+1)%cycle.length];
  log(`武器を ${weaponLabel()} に切り替え`);
  render();
}

function cycleSaberColor(){
  const colors = ['blue','green','red','purple'];
  const i = colors.indexOf(player.saberColor);
  player.saberColor = colors[(i+1)%colors.length];
  log(`セーバー色: ${player.saberColor}`);
  render();
}
function cycleSaberForm(){
  const forms = ['Balanced','Aggressive','Defensive'];
  const i = forms.indexOf(player.saberForm);
  player.saberForm = forms[(i+1)%forms.length];
  log(`セーバーフォーム: ${player.saberForm}`);
  render();
}

let awaitingFireDir = false;
function tryFire(dx,dy){
  if(player.weapon!=="blaster"){
    log('Blasterを装備していない');
    return;
  }
  const bl = player.bag.find(b=> b.name==='Blaster' && (b.dur??0)>0);
  if(!bl){
    log('Blasterは壊れている');
    player.weapon = "fists";
    render();
    return;
  }
  if(player.ammo<=0){ log('Energy Cellがない'); return; }
  if(player.jam){ log('ブラスターがジャム中！（待機で解除しやすい）'); return; }
  if(player.heat>=100){ log('過熱中！冷却が必要'); return; }

  // Misfire check: 0.1 + heat/200 + low durability penalty
  const lowDur = 1 - (bl.dur/bl.maxdur);
  const misfireChance = Math.min(0.5, 0.1 + (player.heat/200) + lowDur*0.2);
  if(Math.random() < misfireChance){
    player.ammo -= 1;
    player.heat = Math.min(100, player.heat + 20);
    if(Math.random()<0.5){ player.jam=true; }
    log('ミスファイア！ （弾だけ消費）');
    endTurn();
    return;
  }

  // Fire beam
  let x=player.x+dx, y=player.y+dy;
  let hit=false;
  while(inBounds(x,y) && current().map[y][x]!==TILE.WALL){
    const foe = current().entities.find(e=>e.x===x&&e.y===y);
    if(foe){
      const scale = weaponScale(bl);
      const base = bl.rangeAtk || 3;
      let dmg = Math.max(1, Math.floor(base * scale));
      if(rollCrit()){ dmg *= 2; log('クリティカル！'); }
      foe.hp -= dmg; hit=true;
      if(foe.hp<=0){
        const idx=current().entities.indexOf(foe);
        current().entities.splice(idx,1);
        log(`Blasterで撃破！（${glyph(foe)}に${dmg}ダメージ）`);
      }else{
        log(`Blasterで射撃 → ${glyph(foe)}に${dmg}ダメージ`);
      }
      break;
    }
    x += dx; y += dy;
  }
  player.ammo -= 1;
  player.heat = Math.min(100, player.heat + 20);
  const chance = Math.min(0.99, 0.5 + (player.heat/200));
  maybeDegrade('Blaster', chance, 1);
  if(!hit) log('発砲（ヒットなし）');
  endTurn();
}

function enemyFire(e, dx, dy, dmg=2){
  let x=e.x+dx, y=e.y+dy;
  while(inBounds(x,y) && current().map[y][x]!==TILE.WALL){
    if(player.x===x && player.y===y){
      const dealt = Math.max(1, dmg - Math.floor(effectiveDef()/2));
      player.hp -= dealt;
      log(`${glyph(e)}の射撃 → あなたに${dealt}ダメージ`);
      return true;
    }
    x+=dx; y+=dy;
  }
  return false;
}

function endTurn(){
  const f=current();
  // enemies
  for(const m of f.entities){
    if(m.ch===ENT.SENTRY){
      // Sentry: shoot if LoS and cooldown 0
      if(m.sentry.cool>0) m.sentry.cool--;
      const dx = Math.sign(player.x - m.x);
      const dy = Math.sign(player.y - m.y);
      const dist = Math.max(Math.abs(player.x-m.x), Math.abs(player.y-m.y));
      if(dist<= (m.sentry.range||8) && visible(m.x,m.y,player.x,player.y) && m.sentry.cool===0){
        const sdx = Math.sign(player.x-m.x);
        const sdy = Math.sign(player.y-m.y);
        if(enemyFire(m, sdx, sdy, 2)) m.sentry.cool = 2;
      }else{
        // slight reposition
        moveEntity(m, rng.range(-1,1), rng.range(-1,1));
      }
      continue;
    }
    if(m.ch===ENT.BOSS){
      // Boss: alternates ranged and melee chase. Cooldown for ranged.
      if(m.cool>0) m.cool--;
      const distM = Math.abs(player.x-m.x)+Math.abs(player.y-m.y);
      if(m.cool===0 && visible(m.x,m.y,player.x,player.y)){
        const sdx = Math.sign(player.x-m.x), sdy=Math.sign(player.y-m.y);
        enemyFire(m, sdx, sdy, 3); m.cool = 2;
      }else{
        // chase
        const dx = Math.sign(player.x - m.x);
        const dy = Math.sign(player.y - m.y);
        moveEntity(m, Math.abs(player.x-m.x)>Math.abs(player.y-m.y)?dx:0, Math.abs(player.x-m.x)>Math.abs(player.y-m.y)?0:dy);
      }
      continue;
    }
    // default: wander/hunt
    if(Math.hypot(m.x-player.x, m.y-player.y) <= 8){
      const dx = Math.sign(player.x - m.x);
      const dy = Math.sign(player.y - m.y);
      const options = Math.abs(player.x-m.x) > Math.abs(player.y-m.y)
        ? [[dx,0],[0,dy],[dx,dy],[-dx,0],[0,-dy]]
        : [[0,dy],[dx,0],[dx,dy],[0,-dy],[-dx,0]];
      let moved=false;
      for(const [mx,my] of options){
        if(moveEntity(m,mx,my)){ moved=true; break; }
      }
      if(!moved){
        moveEntity(m, rng.range(-1,1), rng.range(-1,1));
      }
    }else{
      moveEntity(m, rng.range(-1,1), rng.range(-1,1));
    }
  }
  if(player.hp<=0){
    log('あなたは倒れた… (Rで再挑戦)');
  }
  if(player.shieldTurns>0){
    player.shieldTurns--;
    if(player.shieldTurns===0){
      log('シールドが消失した');
    }
  }
  // passive cool
  if(player.heat>0) player.heat = Math.max(0, player.heat - 10);
  render();
}

// Elevators & Exit
function useElevator(){
  const f=current();
  const t = f.map[player.y][player.x];
  if(t===TILE.DOWN && currentFloor<MAX_FLOOR-1){
    currentFloor++;
    // place player at upPos of next floor
    const nf = current();
    player.x = nf.upPos.x; player.y = nf.upPos.y;
    log(`F${currentFloor} に降りた`);
    render();
    return true;
  }else if(t===TILE.UP && currentFloor>0){
    currentFloor--;
    const pf = current();
    player.x = pf.downPos.x; player.y = pf.downPos.y;
    log(`F${currentFloor+2} から昇った`);
    render();
    return true;
  }else if(t===TILE.EXIT && currentFloor===MAX_FLOOR-1){
    log('脱出成功！クリア！ (Rで新規開始)');
    return true;
  }else{
    log('ここにエレベーターはない');
    return false;
  }
}

// Save/Load
function saveGame(){
  const data = {
    player,
    currentFloor,
    floors: floors.map((f)=> ({
      map:f.map, explored:f.explored, entities:f.entities, items:f.items,
      upPos:f.upPos, downPos:f.downPos, exitPos:f.exitPos
    }))
  };
  try{
    localStorage.setItem('rogue_scifi_save', JSON.stringify(data));
    log('セーブ完了');
  }catch(e){ log('セーブ失敗: ' + e.message); }
}
function loadGame(){
  try{
    const s = localStorage.getItem('rogue_scifi_save');
    if(!s){ log('セーブデータなし'); return; }
    const data = JSON.parse(s);
    player = data.player;
    currentFloor = data.currentFloor;
    floors = data.floors.map((d)=>{
      const f = baseFloorState();
      f.map = d.map; f.explored = d.explored; f.entities = d.entities; f.items = d.items;
      f.upPos = d.upPos; f.downPos = d.downPos; f.exitPos = d.exitPos;
      return f;
    });
    log('ロード完了');
    render();
  }catch(e){ log('ロード失敗: ' + e.message); }
}

// Boot
function resetGame(){
  floors = [];
  for(let i=0;i<MAX_FLOOR;i++) floors.push(genFloor(i));
  currentFloor = 0;
  const f0 = current();
  player = {x:f0.upPos.x,y:f0.upPos.y,ch:ENT.PLAYER,hp:16,maxhp:16,atk:2,def:0,bag:[],ammo:10,weapon:"fists",shieldTurns:0,heat:0,critChance:0.10,jam:false,saberColor:'blue',saberForm:'Balanced'};
  log('あなたは廃棄宇宙施設に潜入した…（v5）');
  render();
}

// Input
const keymap = {
  'ArrowUp':[0,-1], 'KeyW':[0,-1],
  'ArrowDown':[0,1], 'KeyS':[0,1],
  'ArrowLeft':[-1,0], 'KeyA':[-1,0],
  'ArrowRight':[1,0], 'KeyD':[1,0],
  'Numpad8':[0,-1], 'Numpad2':[0,1], 'Numpad4':[-1,0], 'Numpad6':[1,0],
  'Numpad7':[-1,-1],'Numpad9':[1,-1],'Numpad1':[-1,1],'Numpad3':[1,1]
};

window.addEventListener('keydown', (e)=>{
  if(player.hp<=0){
    if(e.key==='r' || e.key==='R') resetGame();
    return;
  }
  if(awaitingFireDir){
    if(e.code in keymap){
      e.preventDefault();
      const [dx,dy]=keymap[e.code];
      awaitingFireDir=false;
      tryFire(dx,dy);
      return;
    }else{
      awaitingFireDir=false;
      log('射撃をキャンセル');
      return;
    }
  }
  if(e.code in keymap){
    e.preventDefault();
    const [dx,dy]=keymap[e.code];
    tryPlayerMove(dx,dy);
  }else if(e.key==='.' ){ // wait
    e.preventDefault();
    waitTurn();
  }else if(e.key==='g' || e.key==='G'){
    e.preventDefault();
    pickUp();
    render();
  }else if(e.key==='u' || e.key==='U'){
    e.preventDefault();
    handleUse();
  }else if(e.key==='t' || e.key==='T'){
    e.preventDefault();
    toggleWeapon();
  }else if(e.key==='f' || e.key==='F'){
    e.preventDefault();
    awaitingFireDir = true;
    log('射撃方向を入力（矢印/WASD/テンキー）');
  }else if(e.key==='e' || e.key==='E'){
    e.preventDefault();
    useElevator();
  }else if(e.key==='c' || e.key==='C'){
    e.preventDefault();
    if(player.weapon==='lightsaber') cycleSaberColor();
  }else if(e.key==='v' || e.key==='V'){
    e.preventDefault();
    if(player.weapon==='lightsaber') cycleSaberForm();
  }else if(e.key==='p' || e.key==='P'){
    e.preventDefault();
    saveGame();
  }else if(e.key==='o' || e.key==='O'){
    e.preventDefault();
    loadGame();
  }
});

resetGame();
screen.focus();
