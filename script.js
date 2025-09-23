// script.js - päivittynyt: piirrä pelipöytä (ruudukko), vahvemmat viivat joka N, reunaviiva ja PNG-export
const canvas = document.getElementById('paper');
const ctx = canvas.getContext('2d');

// viewport transform for pan & zoom
let baseCell = 40; // base cell size in CSS pixels
let scale = 1; // zoom factor
function cellSize(){ return baseCell * scale; }
let offsetX = 0; // CSS pixels offset for panning
let offsetY = 0;
let isPanning = false;
let panStart = null;

function resizeToFullViewport() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// state: set of marked intersections stored as string keys "x,y"
const marked = new Set();
let hover = null; // {x,y} in CSS pixels for preview (not used for line preview)
let previewSegments = null; // {seg, dir} when a hover would create 5-in-a-row
let previewDot = null; // {col,row,type} type = 'win'|'bonus'
let previewHover = null; // {col,row} last hovered grid cell (for preview dot)
let lastCursor = {x:0,y:0}; // last client coords for cursor-positioned UI
// anti-tamper & input protections
let tampered = false;
let originalHashes = {};
let verifyIntervalId = null;
let lastClickTime = 0;
const MIN_CLICK_INTERVAL = 200; // ms between accepted clicks to limit automation

// helpers: convert stored gx/gy (col*cell) to CSS pixel center
function gridToCssX(col){ return offsetX + col * cellSize() + 0.5; }
function gridToCssY(row){ return offsetY + row * cellSize() + 0.5; }

function screenToGrid(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const col = Math.round((x - offsetX) / cellSize());
  const row = Math.round((y - offsetY) / cellSize());
  return {col,row};
}

function keyFromColRow(col,row){ return col + ',' + row; }


function drawFullGrid({cell=40, dot=6} = {}){
  resizeToFullViewport();
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.scale(dpr, dpr);
  // CSS pixel viewport size
  const vw = Math.floor(canvas.width / dpr);
  const vh = Math.floor(canvas.height / dpr);
  // clear in CSS pixels (since we scaled the context)
  ctx.clearRect(0,0,vw,vh);
  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,vw,vh);

  ctx.strokeStyle = '#e6e6e6';
  ctx.lineWidth = 1;
  // draw vertical and horizontal grid lines according to current transform
  const cs = cellSize();
  // compute start/end in CSS pixels
  const startCol = Math.floor((-offsetX) / cs) - 1;
  const endCol = Math.ceil((vw - offsetX) / cs) + 1;
  for (let c = startCol; c <= endCol; c++){
    const x = Math.round(offsetX + c * cs) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vh); ctx.stroke();
  }
  const startRow = Math.floor((-offsetY) / cs) - 1;
  const endRow = Math.ceil((vh - offsetY) / cs) + 1;
  for (let r = startRow; r <= endRow; r++){
    const y = Math.round(offsetY + r * cs) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vw, y); ctx.stroke();
  }

  // coordinate labels removed per user request

  // draw marked dots only from state
  ctx.fillStyle = '#000';
  const half = dot / 2;
  const arm = Math.max(1, Math.round(dot));
  for (const key of marked) {
    const [col, row] = key.split(',').map(Number);
    const cx = gridToCssX(col);
    const cy = gridToCssY(row);
    // if we're in a provisional bonus state and this is the firstPlacement,
    // draw it orange until it becomes part of a scored line
    let isProvisional = false;
    if (awaitingBonusSecond && firstPlacement){
      const fpKey = (firstPlacement.col*cell) + ',' + (firstPlacement.row*cell);
      if (fpKey === key) isProvisional = true;
    }
    if (isProvisional){
      ctx.fillStyle = 'rgba(255,140,0,0.95)';
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, Math.round(cs * 0.12)), 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#000'; continue;
    }
  // draw small anti-aliased filled circle for marker (crisp at small scales)
  const r = Math.max(2, Math.min(6, Math.round(cs * 0.08)));
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  // draw any persistent scored lines (thin, centered on intersections)
  if (scoredLines.length) drawScoredLines();
  // draw preview (if available) inside the same scaled context so coordinates match
  if (previewSegments) drawPreviewLine(cell);
  // draw preview dot (green for winning placement, orange for bonus)
  if (previewDot) drawPreviewDot();

  // draw preview dot (green for winning placement, orange if bonus would be used)
  if (previewHover){
    const {col,row} = previewHover;
    if (!isOccupied(col,row)){
      const cx = gridToCssX(col);
      const cy = gridToCssY(row);
      if (previewSegments && previewSegments.length){ drawPreviewDot(cx, cy, 'rgba(0,160,60,0.9)', Math.max(4, cs*0.12)); }
      else if (bonus > 0 && !awaitingBonusSecond){ drawPreviewDot(cx, cy, 'rgba(255,140,0,0.9)', Math.max(4, cs*0.12)); }
    }
  }

  // draw bonus indicator near cursor when appropriate
  if (bonus > 0 && !awaitingBonusSecond){
    // only show when hovering over empty intersection and no winning preview
    if (previewHover && !isOccupied(previewHover.col, previewHover.row) && !(previewSegments && previewSegments.length)){
      // convert lastCursor client coords to CSS canvas coords
      const rect = canvas.getBoundingClientRect();
      const cx = lastCursor.x - rect.left + 12; // slight offset to right
      const cy = lastCursor.y - rect.top + 12; // slight offset down
  // draw only the label (the grid preview dot already indicates a bonus)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.font = '12px sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText('käytä bonuspiste', cx, cy - 6);
  ctx.restore();
    }
  }

  ctx.restore();
}

function nearestIntersection(clientX, clientY){
  const {col,row} = screenToGrid(clientX, clientY);
  return {col,row};
}

// --- Game state & helpers ---
let score = 0;
let bonus = 0;
let awaitingBonusSecond = false;
let firstPlacement = null; // {col,row}
const scoredLines = [];

// generate a bright rainbow color (HSL) string
function randomRainbowColor(){
  const h = Math.floor(Math.random() * 360);
  const s = 90 + Math.floor(Math.random()*10); // 90-99%
  const l = 50 + Math.floor(Math.random()*6); // 50-55%
    const palette = ['#66C5CC','#F6CF71','#F89C74','#DCB0F2','#87C55F','#9EB9F3','#FE88B1','#C9DB74','#8BE0A4','#B497E7','#B3B3B3'];
    return palette[Math.floor(Math.random() * palette.length)];
}

function segmentKey(seg){ return seg.map(p=>p.join(',')).join('|'); }

function isOccupied(col,row){
  const key = keyFromColRow(col,row);
  return marked.has(key);
}

function isInsideGrid(col,row){
  // allow unbounded grid but restrict to reasonable integer coords
  if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
  return Math.abs(col) < 10000 && Math.abs(row) < 10000;
}

function addStoneAt(col,row){ marked.add(keyFromColRow(col,row)); }
function removeStoneAt(col,row){ marked.delete(keyFromColRow(col,row)); }

function findFiveAt(col,row){
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dx,dy] of dirs){
    const seq = [[col,row]];
  for (let k=1;k<10;k++){ const c = col + dx*k, r = row + dy*k; if (isOccupied(c,r)) seq.push([c,r]); else break; }
  for (let k=1;k<10;k++){ const c = col - dx*k, r = row - dy*k; if (isOccupied(c,r)) seq.unshift([c,r]); else break; }
    if (seq.length >= 5){
      for (let i=0;i+5<=seq.length;i++){
        const seg = seq.slice(i,i+5);
        if (seg.some(p=>p[0]===col && p[1]===row)) return {seg,dir:[dx,dy]};
      }
    }
  }
  return null;
}

// find all distinct 5-length segments that include the placed point
function findAllFivesAt(col,row){
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  const results = [];
  for (const [dx,dy] of dirs){
    const seq = [[col,row]];
  for (let k=1;k<10;k++){ const c = col + dx*k, r = row + dy*k; if (isOccupied(c,r)) seq.push([c,r]); else break; }
  for (let k=1;k<10;k++){ const c = col - dx*k, r = row - dy*k; if (isOccupied(c,r)) seq.unshift([c,r]); else break; }
    if (seq.length >= 5){
      for (let i=0;i+5<=seq.length;i++){
        const seg = seq.slice(i,i+5);
        if (seg.some(p=>p[0]===col && p[1]===row)){
          // normalize seg to string key to avoid duplicates
          const key = seg.map(p=>p.join(',')).join('|');
          if (!results.some(r=>r.key===key)) results.push({seg,dir:[dx,dy],key});
        }
      }
    }
  }
  return results;
}

// return true if two segments share any intersection other than allowedPoint
function segmentsOverlapExcept(segA, segB, allowedPoint){
  // legacy signature preserved for callers that don't provide dirs
  // new signature: segmentsOverlapExcept(segA, segB, allowedPoint, dirA, dirB)
  const args = Array.from(arguments);
  const dirA = args[3] || null;
  const dirB = args[4] || null;
  const allowedKey = allowedPoint ? (allowedPoint[0]+','+allowedPoint[1]) : null;
  const setA = new Set(segA.map(p=>p.join(',')));
  for (const p of segB){
    const key = p.join(',');
    if (setA.has(key)){
      if (allowedKey && key === allowedKey) continue;
      // if both directions are present and differ, overlapping is allowed
      if (dirA && dirB){
        if (dirA[0] !== dirB[0] || dirA[1] !== dirB[1]){
          // different directions → allowed to touch/overlap
          continue;
        }
      }
      return true;
    }
  }
  return false;
}

function drawScoredLines(cell=40){
  if (!scoredLines.length) return;
  // Assumes drawing happens inside the same scaled context (CSS pixels)
  ctx.save();
  ctx.strokeStyle = 'purple';
  ctx.lineWidth = 2; // thin line
  ctx.lineCap = 'butt';
  const nudge = 0.5;
  for (const s of scoredLines){
  const first = s.seg[0], last = s.seg[s.seg.length-1];
  const x1 = gridToCssX(first[0]), y1 = gridToCssY(first[1]);
  const x2 = gridToCssX(last[0]), y2 = gridToCssY(last[1]);
  // ensure existing scored lines get a color if they were created before color support
  if (!s.color) s.color = randomRainbowColor();
  ctx.strokeStyle = s.color;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  ctx.restore();
}

function drawPreviewDot(cx, cy, color='rgba(0,160,60,0.9)', size=6){
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, size/2, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function handleGridClick(clientX, clientY){
  // tamper and rate-limit guards
  if (tampered) return;
  const now = performance.now(); if (now - lastClickTime < MIN_CLICK_INTERVAL) return; lastClickTime = now;
  if (!verifyIntegrity()) { onTamper(); return; }
  const {col,row} = screenToGrid(clientX, clientY);
  if (!isInsideGrid(col,row)) return;
  if (isOccupied(col,row)) return;
  // simulate placement first (do not mutate state permanently yet)
  addStoneAt(col,row);
  const founds = findAllFivesAt(col,row);
  removeStoneAt(col,row);
  // if this placement doesn't form any 5-in-a-row and the player doesn't
  // have (or isn't using) a bonus second-try, reject the placement
  if (!founds || !founds.length){
    // only allow a provisional first placement if the player has bonus points
    // and is not already in a bonus second-try; placement should be rejected
    // if it wouldn't create any new (previously unscored) 5-in-a-row.
    if (!(bonus > 0 && !awaitingBonusSecond)){
      // not allowed
      drawFullGrid({cell:40,dot:6});
      return;
    }
    // otherwise proceed and consume bonus to allow first (provisional) placement
  }

  // permanent placement
  addStoneAt(col,row);
  drawFullGrid();
  // check immediate fives (multiple lines possible)
  if (founds && founds.length){
    // filter out any candidate that would overlap existing scored lines
    const placedPoint = [col, row];
    const accepted = [];
    for (const f of founds){
      let bad = false;
      for (const s of scoredLines){
        if (segmentsOverlapExcept(f.seg, s.seg, placedPoint, f.dir, s.dir)) { bad = true; break; }
      }
      if (bad) continue;
      // also ensure no overlap with already accepted new lines (except placed point)
  for (const a of accepted){ if (segmentsOverlapExcept(f.seg, a.seg, placedPoint, f.dir, a.dir)) { bad = true; break; } }
      if (bad) continue;
      accepted.push(f);
    }
    if (accepted.length){
      // Only count segments that are actually new (not already recorded).
      const newAccepted = accepted.filter(f => f && f.seg && f.seg.length === 5 && !scoredLines.some(s => s.key === f.key));
      if (newAccepted.length > 0){
        // award one point per distinct new non-overlapping line
        score += newAccepted.length;
        // award a bonus point if a single placement creates 2 or more new lines
        if (newAccepted.length >= 2) bonus += 1;
        // push each distinct scored line
        for (const f of newAccepted) {
          const key = segmentKey(f.seg);
          if (!scoredLines.some(s=>s.key === key)) scoredLines.push({seg: f.seg, dir: f.dir, key, color: randomRainbowColor()});
        }
        // if we were in a provisional bonus state, clear it so the provisional
        // orange stone is rendered as a normal stone immediately
        if (awaitingBonusSecond){ awaitingBonusSecond = false; firstPlacement = null; }
        // update HUD and redraw
        updateHud();
        drawFullGrid({cell:40,dot:6});
        return;
      }
      // All candidate lines were duplicates of already-scored lines → treat as no-five
    }
    // if all candidate lines were overlapping, treat as no-five (fallthrough)
  }
  // no five
  if (bonus > 0 && !awaitingBonusSecond){
    awaitingBonusSecond = true;
    firstPlacement={col,row};
    bonus -=1;
    updateHud();
    drawFullGrid({cell:40,dot:6});
    return;
  }
  if (awaitingBonusSecond){
    // second placement
  const f1 = findAllFivesAt(firstPlacement.col, firstPlacement.row);
  const f2 = findAllFivesAt(col,row);
    const any = (f1 && f1.length) || (f2 && f2.length);
    if (any){
      const toScore = (f2 && f2.length) ? f2 : f1;
      // filter to exact-5 segments and non-duplicates (i.e., actually new)
      const final = toScore.filter(f => f && f.seg && f.seg.length === 5 && !scoredLines.some(s=>s.key === segmentKey(f.seg)));
      if (final.length > 0){
        const lines = final.length;
        score += lines;
        if (lines >= 2) bonus += 1;
  for (const f of final){ const key = segmentKey(f.seg); scoredLines.push({seg: f.seg, dir: f.dir, key, color: randomRainbowColor()}); }
        // clear provisional bonus state so the provisional orange dot is replaced
        awaitingBonusSecond=false; firstPlacement=null;
        updateHud(); drawFullGrid({cell:40,dot:6}); return;
      }
      // otherwise, none of the candidate lines are new -> fail the bonus attempt
    }
  // failed: remove provisional stones and return bonus
  removeStoneAt(firstPlacement.col, firstPlacement.row);
  removeStoneAt(col,row);
  bonus +=1;
  awaitingBonusSecond=false;
  firstPlacement=null;
  updateHud();
  drawFullGrid({cell:40,dot:6});
  return;
  }
  // not allowed
  removeStoneAt(col,row); drawFullGrid();
}

// simple DJB2 hash for strings
function strHash(s){
  let h = 5381;
  for (let i=0;i<s.length;i++) h = ((h<<5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function verifyIntegrity(){
  try{
    const targets = ['findAllFivesAt','segmentsOverlapExcept','handleGridClick'];
    for (const name of targets){
      const fn = window[name];
      if (typeof fn !== 'function') return false;
      const h = strHash(fn.toString());
      if (originalHashes[name] && originalHashes[name] !== h) return false;
    }
    return true;
  }catch(e){ return false; }
}

function onTamper(){
  if (tampered) return; tampered = true;
  // disable interactions
  try{ canvas.style.pointerEvents = 'none'; canvas.style.filter = 'grayscale(70%)'; } catch(e){}
  // show overlay
  let ov = document.getElementById('tamper-overlay');
  if (!ov){
    ov = document.createElement('div'); ov.id = 'tamper-overlay';
    ov.style.position='fixed'; ov.style.left=0; ov.style.top=0; ov.style.right=0; ov.style.bottom=0;
    ov.style.zIndex=9999; ov.style.display='flex'; ov.style.alignItems='center'; ov.style.justifyContent='center';
    ov.style.background='rgba(0,0,0,0.7)'; ov.style.color='#fff'; ov.style.fontSize='18px';
    ov.textContent = 'Havaittu epäluotettavaa muokkausta – peli estetty.';
    document.body.appendChild(ov);
  }
  if (verifyIntervalId) { clearInterval(verifyIntervalId); verifyIntervalId = null; }
}

function updateHud(){
  const s = document.getElementById('score-val');
  const b = document.getElementById('bonus-val');
  if (s) s.textContent = String(score);
  // sanity check: score should match number of recorded scoredLines
  const canonical = scoredLines.length;
  if (score !== canonical){
    // possible tampering: normalize score to canonical and mark tamper
    score = canonical;
    if (s) s.textContent = String(score);
    onTamper();
  }
  if (b) b.textContent = String(bonus);
  const p = document.getElementById('possible-val');
  if (p) p.textContent = String(countPossibleLines());
  const bonusWrap = document.getElementById('bonus');
  if (bonusWrap){
  if (bonus > 0 || awaitingBonusSecond) bonusWrap.classList.add('bonus-available'); else bonusWrap.classList.remove('bonus-available');
  }
  // check for game over condition after HUD changes
  checkGameOver();
}

function countPossibleLines(){
  const rect = canvas.getBoundingClientRect();
  const cs = cellSize();
  const cols = Math.ceil(rect.width / cs) + 4;
  const rows = Math.ceil(rect.height / cs) + 4;
  const foundKeys = new Set();
  for (let c=-2;c<=cols+2;c++){
    for (let r=-2;r<=rows+2;r++){
      if (isOccupied(c,r)) continue;
      addStoneAt(c,r);
      const founds = findAllFivesAt(c,r);
      removeStoneAt(c,r);
      if (founds && founds.length){
        // apply same acceptance rules as scoring: remove overlaps with existing scored lines
        const placedPoint = [c, r];
        const accepted = [];
        for (const f of founds){
          let bad = false;
          for (const s of scoredLines){ if (segmentsOverlapExcept(f.seg, s.seg, placedPoint, f.dir, s.dir)) { bad = true; break; } }
          if (bad) continue;
          for (const a of accepted){ if (segmentsOverlapExcept(f.seg, a.seg, placedPoint, f.dir, a.dir)) { bad = true; break; } }
          if (bad) continue;
          // only count if not already scored
          if (!scoredLines.some(s=>s.key===f.key)) accepted.push(f);
        }
        for (const a of accepted) foundKeys.add(a.key);
      }
    }
  }
  return foundKeys.size;
}

function anyPossibleFive(){
  // brute-force: for every empty intersection, simulate placing and check if any new 5-length segment could form
  const rect = canvas.getBoundingClientRect();
  const cs = cellSize();
  const cols = Math.ceil(rect.width / cs) + 4;
  const rows = Math.ceil(rect.height / cs) + 4;
  for (let c=-2;c<=cols+2;c++){
    for (let r=-2;r<=rows+2;r++){
      if (isOccupied(c,r)) continue;
      addStoneAt(c,r);
      const founds = findAllFivesAt(c,r);
      removeStoneAt(c,r);
      if (founds && founds.length){
        const placedPoint = [c, r];
        const accepted = [];
        for (const f of founds){
          let bad = false;
          for (const s of scoredLines){ if (segmentsOverlapExcept(f.seg, s.seg, placedPoint, f.dir, s.dir)) { bad = true; break; } }
          if (bad) continue;
          for (const a of accepted){ if (segmentsOverlapExcept(f.seg, a.seg, placedPoint, f.dir, a.dir)) { bad = true; break; } }
          if (bad) continue;
          if (!scoredLines.some(s=>s.key===f.key)) accepted.push(f);
        }
        if (accepted.length) return true;
      }
    }
  }
  return false;
}

function checkGameOver(){
  if (bonus === 0 && !anyPossibleFive()){
    // game over
    endGame();
  }
}

function endGame(){
  // play scramble animation then show highscore modal
  playEndAnimation(showHighscore);
}

function showHighscore(){
  // show modal, save score
  const go = document.getElementById('game-over');
  const final = document.getElementById('final-score');
  const list = document.getElementById('highlist');
  if (!go || !final || !list) return;
  final.textContent = 'Pisteesi: ' + score;
  // verify canonical score before saving to highs
  const canonical = scoredLines.length;
  if (score !== canonical){ onTamper(); return; }
  // try to POST to server; if unavailable fall back to localStorage
  const payload = { score: score, lines: scoredLines.map(s=>({key: s.key})) };
  fetch((window.HIGHSERVER_URL || '') + '/api/highscores', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
  }).then(r=>r.json()).then(json => {
    if (json && json.top){
      const top = json.top.slice(0,10);
      list.innerHTML = top.map(h => `<li>${h.score} — ${new Date(h.date).toLocaleString()}</li>`).join('');
      // also mirror to localStorage for offline fallback
      try{ localStorage.setItem('rp_highscores', JSON.stringify(top)); }catch(e){}
    } else {
      throw new Error('invalid response');
    }
  }).catch(()=>{
    // fallback: store locally
    const raw = localStorage.getItem('rp_highscores') || '[]';
    const highs = JSON.parse(raw);
    highs.push({score: score, date: (new Date()).toISOString()});
    highs.sort((a,b)=>b.score - a.score);
    const top = highs.slice(0,10);
    try{ localStorage.setItem('rp_highscores', JSON.stringify(top)); }catch(e){}
    list.innerHTML = top.map(h => `<li>${h.score} — ${new Date(h.date).toLocaleString()}</li>`).join('');
  });
  go.classList.remove('hidden');
}

function playEndAnimation(cb){
  // gather particles from marked points and scored lines
  const rect = canvas.getBoundingClientRect();
  const cell = 40;
  const particles = [];
  // points
  for (const key of marked){
    const [gx,gy] = key.split(',').map(Number);
    const cx = gridToCssX(gx);
    const cy = gridToCssY(gy);
  particles.push({x:cx, y:cy, vx:(Math.random()-0.5)*2.5, vy:(Math.random()-0.8)*2.5, r:4, color:'#000', life:1});
  }
  // scored lines -> spawn points along the line
  for (const s of scoredLines){
    const first = s.seg[0]; const last = s.seg[s.seg.length-1];
    const x1 = gridToCssX(first[0]*cell), y1 = gridToCssY(first[1]*cell);
    const x2 = gridToCssX(last[0]*cell), y2 = gridToCssY(last[1]*cell);
    const steps = 10;
    for (let i=0;i<=steps;i++){
      const t = i/steps;
      const x = x1 + (x2-x1)*t;
      const y = y1 + (y2-y1)*t;
  particles.push({x,y,vx:(Math.random()-0.5)*3.5, vy:(Math.random()-0.8)*3.5, r:3, color: s.color || '#66C5CC', life:1});
    }
  }

  const duration = 2400; // ms (slower)
  const start = performance.now();
  function step(now){
    const t = (now - start) / duration;
    // clear and draw background
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,Math.floor(canvas.width/dpr), Math.floor(canvas.height/dpr));
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,Math.floor(canvas.width/dpr), Math.floor(canvas.height/dpr));
    // update particles
    for (const p of particles){
      p.x += p.vx * (1 - t);
      p.y += p.vy * (1 - t) + 0.5 * t;
      p.life = Math.max(0, 1 - t);
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.r * p.life), 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (now - start < duration) requestAnimationFrame(step); else {
      // restore normal canvas and draw final grid before showing modal
      drawFullGrid({cell:40,dot:6});
      if (typeof cb === 'function') cb();
    }
  }
  requestAnimationFrame(step);
}

document.addEventListener('click', (ev)=>{
  if (ev.target && ev.target.id === 'go-restart'){
    // reset state -> use resetGame helper so start pattern is reapplied
    resetGame();
  }
});

function resetGame(){
  // clear runtime state
  marked.clear(); scoredLines.length = 0; score = 0; bonus = 0; awaitingBonusSecond = false; firstPlacement = null;
  // reapply the original start pattern used on load
  const userCoords = [
    '14,10','15,10','16,10','17,10','17,11','17,12','17,13','18,13','19,13','20,13','20,14','20,15','20,16','19,16','18,16','17,16','17,17','17,18','17,19','16,19','15,19','14,19','14,18','14,17','14,16','13,16','12,16','11,16','11,15','11,14','11,13','12,13','13,13','14,13','14,12','14,11'
  ];
  applyCoordsList(userCoords, {cell:40});
  updateHud(); drawFullGrid({cell:40,dot:6});
  const go = document.getElementById('game-over'); if (go) go.classList.add('hidden');
}

// draw a hover preview square at given intersection
// draw a preview line (80% opacity) when a hover-placement would create a 5-in-a-row
function drawPreviewLine(cell=40){
  if (!previewSegments || !previewSegments.length) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  for (const p of previewSegments){
    const first = p.seg[0], last = p.seg[p.seg.length-1];
  const x1 = gridToCssX(first[0]), y1 = gridToCssY(first[1]);
  const x2 = gridToCssX(last[0]), y2 = gridToCssY(last[1]);
    ctx.strokeStyle = p.color || 'rgba(138,43,226,0.8)';
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  ctx.restore();
}

function drawPreviewDot(cx, cy, color='rgba(0,160,60,0.9)', size=6){
  // overloaded: if first arg is number col instead of px, adjust by checking type
  if (typeof cx === 'number' && typeof cy === 'number' && arguments.length === 1) return;
  ctx.save();
  ctx.fillStyle = color;
  const r = Math.max(4, Math.round(size));
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

// clearPreview is defined later with full behavior
function clearAllPreview(){ previewSegments = null; previewDot = null; }

// simulate placing at client coordinates to see if it would produce a five-in-a-row
function setPreviewAt(clientX, clientY){
  const {col,row} = screenToGrid(clientX, clientY);
  previewHover = {col,row};
  if (!isInsideGrid(col,row)){ clearAllPreview(); return; }
  if (isOccupied(col,row)) { clearPreview(); return; }
  addStoneAt(col,row);
  const founds = findAllFivesAt(col,row);
  removeStoneAt(col,row);
  if (!founds || !founds.length){ previewSegments = null; previewDot = (bonus>0)?{col,row,type:'bonus'}:null; return; }
  const placedPoint = [col,row]; const accepted = [];
  for (const f of founds){
    let bad = false;
    for (const s of scoredLines){ if (segmentsOverlapExcept(f.seg, s.seg, placedPoint, f.dir, s.dir)) { bad = true; break; } }
    if (bad) continue;
    for (const a of accepted){ if (segmentsOverlapExcept(f.seg, a.seg, placedPoint, f.dir, a.dir)) { bad = true; break; } }
    if (bad) continue;
    accepted.push({seg: f.seg, dir: f.dir, key: f.key, color: randomRainbowColor()});
  }
  previewSegments = accepted.length ? accepted : null;
  previewDot = previewSegments ? {col,row,type:'win'} : null;
}

// clear hover preview state
function clearPreview(){ previewSegments = null; previewHover = null; }

function updateCoordsPanel(){
  // coords panel removed; function left as no-op
  return;
}

// copy and clear buttons
// coords UI removed; no-op for load handlers

function exportPNG(filename = 'ruutupaperi.png'){
  const data = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = data;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// piirrä oletuspeliöytä ilman UI-kontrolleja
window.addEventListener('load', () => {
  // start with a centered example pattern
  // start empty: clear any assistant-placed marks
  marked.clear();
  drawFullGrid({cell:40, dot:6});
  // apply the user-supplied coordinate list as the start pattern
  const userCoords = [
    '14,10','15,10','16,10','17,10','17,11','17,12','17,13','18,13','19,13','20,13','20,14','20,15','20,16','19,16','18,16','17,16','17,17','17,18','17,19','16,19','15,19','14,19','14,18','14,17','14,16','13,16','12,16','11,16','11,15','11,14','11,13','12,13','13,13','14,13','14,12','14,11'
  ];
  applyCoordsList(userCoords, {cell:40});
  updateHud();
  // click handler -> game logic
  canvas.addEventListener('click', (ev) => { handleGridClick(ev.clientX, ev.clientY); });
  // mousemove preview
  canvas.addEventListener('mousemove', (ev) => {
  lastCursor.x = ev.clientX; lastCursor.y = ev.clientY;
  setPreviewAt(ev.clientX, ev.clientY);
    drawFullGrid();
  });
  canvas.addEventListener('mouseleave', () => { clearAllPreview(); drawFullGrid(); });
  // wheel zoom (zoom to cursor)
  canvas.addEventListener('wheel', (ev)=>{
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
    const oldScale = scale;
    const delta = -ev.deltaY;
    const zoomFactor = delta > 0 ? 1.12 : 0.9;
    const newScale = Math.max(0.3, Math.min(3, scale * zoomFactor));
    // keep cursor position stable: adjust offset so (mx-offset)/scale remains same
    offsetX = mx - ((mx - offsetX) * (newScale / oldScale));
    offsetY = my - ((my - offsetY) * (newScale / oldScale));
    scale = newScale;
    drawFullGrid();
  }, {passive:false});
  // mouse pan
  canvas.addEventListener('mousedown', (ev)=>{ isPanning = true; panStart = {x: ev.clientX, y: ev.clientY, ox: offsetX, oy: offsetY}; });
  window.addEventListener('mousemove', (ev)=>{ if (!isPanning) return; offsetX = panStart.ox + (ev.clientX - panStart.x); offsetY = panStart.oy + (ev.clientY - panStart.y); drawFullGrid(); });
  window.addEventListener('mouseup', ()=>{ isPanning = false; panStart = null; });
  // touch: single-finger pan, two-finger pinch-to-zoom
  let touchState = null;
  canvas.addEventListener('touchstart', (ev)=>{
    if (!ev.touches) return;
    if (ev.touches.length === 1){ const t = ev.touches[0]; touchState = {mode:'pan', x:t.clientX, y:t.clientY, ox:offsetX, oy:offsetY}; }
    else if (ev.touches.length === 2){ const a = ev.touches[0], b = ev.touches[1]; const midx = (a.clientX + b.clientX)/2; const midy = (a.clientY + b.clientY)/2; const dist = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); touchState = {mode:'pinch', midx, midy, dist, scale0: scale, ox: offsetX, oy: offsetY}; }
  }, {passive:false});
  canvas.addEventListener('touchmove', (ev)=>{
    if (!touchState) return;
    if (touchState.mode === 'pan' && ev.touches && ev.touches[0]){
      const t = ev.touches[0]; offsetX = touchState.ox + (t.clientX - touchState.x); offsetY = touchState.oy + (t.clientY - touchState.y); drawFullGrid();
    } else if (touchState.mode === 'pinch' && ev.touches && ev.touches.length === 2){
      const a = ev.touches[0], b = ev.touches[1]; const midx = (a.clientX + b.clientX)/2; const midy = (a.clientY + b.clientY)/2; const dist = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
      const factor = dist / touchState.dist; const newScale = Math.max(0.3, Math.min(3, touchState.scale0 * factor));
      offsetX = midx - ((midx - touchState.ox) * (newScale / touchState.scale0));
      offsetY = midy - ((midy - touchState.oy) * (newScale / touchState.scale0));
      scale = newScale; drawFullGrid();
    }
  // update lastCursor to the first touch for UI hints
  if (ev.touches && ev.touches[0]){ lastCursor.x = ev.touches[0].clientX; lastCursor.y = ev.touches[0].clientY; }
  ev.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchend', (ev)=>{ touchState = null; }, {passive:false});
  // record original hashes for basic anti-tamper
  originalHashes['findAllFivesAt'] = strHash(String(findAllFivesAt));
  originalHashes['segmentsOverlapExcept'] = strHash(String(segmentsOverlapExcept));
  originalHashes['handleGridClick'] = strHash(String(handleGridClick));
  verifyIntervalId = setInterval(()=>{ if (!verifyIntegrity()) onTamper(); }, 2000);
});

function applyStartPattern({cell=40} = {}){
  // pattern defined as offsets (grid steps) relative to center
  const offsets = [
    // main horizontal center line
    [-2,0],[-1,0],[0,0],[1,0],[2,0],
    // main vertical center line
    [0,-2],[0,-1],[0,1],[0,2],
    // corner accents
    [-2,-1],[-2,1],[2,-1],[2,1],[-1,-2],[1,-2],[-1,2],[1,2],
    // lower extension (alarivin pidennys)
    [-1,3],[0,3],[1,3]
  ];

  // center pattern around viewport center in grid coords
  const rect = canvas.getBoundingClientRect();
  const centerCol = Math.round((rect.width/2 - offsetX) / cellSize());
  const centerRow = Math.round((rect.height/2 - offsetY) / cellSize());
  for (const [dx,dy] of offsets){ marked.add(keyFromColRow(centerCol + dx, centerRow + dy)); }
  drawFullGrid();
}

// apply explicit list of col,row strings (e.g. ["14,10","15,10",...]) and center them
function applyCoordsList(list, {cell=40} = {}){
  if (!Array.isArray(list) || list.length === 0) return;
  // convert list to grid points relative to their own bounding box
  const pts = list.map(s => s.split(',').map(Number));
  const cols = pts.map(p => p[0]);
  const rows = pts.map(p => p[1]);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const widthCols = maxCol - minCol + 1;
  const heightRows = maxRow - minRow + 1;

  // compute center of viewport in grid coords
  const rect = canvas.getBoundingClientRect();
  const centerCol = Math.round((rect.width/2 - offsetX) / cellSize());
  const centerRow = Math.round((rect.height/2 - offsetY) / cellSize());
  const topLeftCol = centerCol - Math.floor(widthCols/2) - minCol;
  const topLeftRow = centerRow - Math.floor(heightRows/2) - minRow;
  marked.clear();
  for (const [c,r] of pts){ const col = topLeftCol + c; const row = topLeftRow + r; marked.add(keyFromColRow(col,row)); }
  updateCoordsPanel(); drawFullGrid();
}

window.addEventListener('resize', () => {
  drawFullGrid({cell:40, dot:6});
});

