// script.js - päivittynyt: piirrä pelipöytä (ruudukko), vahvemmat viivat joka N, reunaviiva ja PNG-export
const canvas = document.getElementById('paper');
const ctx = canvas.getContext('2d');

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

function drawFullGrid({cell=40, dot=6} = {}){
  resizeToFullViewport();
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.scale(dpr, dpr);
  const vw = Math.floor(canvas.width / dpr);
  const vh = Math.floor(canvas.height / dpr);
  // clear
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,vw,vh);

  ctx.strokeStyle = '#e6e6e6';
  ctx.lineWidth = 1;
  for (let x = 0; x <= vw; x += cell){
    ctx.beginPath();
    ctx.moveTo(0.5 + x, 0);
    ctx.lineTo(0.5 + x, vh);
    ctx.stroke();
  }
  for (let y = 0; y <= vh; y += cell){
    ctx.beginPath();
    ctx.moveTo(0, 0.5 + y);
    ctx.lineTo(vw, 0.5 + y);
    ctx.stroke();
  }

  // coordinate labels removed per user request

  // helper: convert grid index or stored gx (col*cell) to css pixel center
  function gridToCssX(gx){ return gx + 0.5; }
  function gridToCssY(gy){ return gy + 0.5; }
  // draw marked dots only from state
  ctx.fillStyle = '#000';
  const half = dot / 2;
  const arm = Math.max(1, Math.round(dot));
  for (const key of marked) {
    const [gx, gy] = key.split(',').map(Number);
    const cx = gridToCssX(gx);
    const cy = gridToCssY(gy);
    ctx.fillRect(Math.round(cx - arm/2), Math.round(cy - half), Math.round(arm), Math.round(dot));
    ctx.fillRect(Math.round(cx - half), Math.round(cy - arm/2), Math.round(dot), Math.round(arm));
  }

  // draw any persistent scored lines (thin, centered on intersections)
  if (scoredLines.length) drawScoredLines(cell);
  // draw preview (if available) inside the same scaled context so coordinates match
  if (previewSegments) drawPreviewLine(cell);

  ctx.restore();
}

function nearestIntersection(clientX, clientY, cell=40){
  // map client coords to canvas logical coordinates (CSS pixels)
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const ix = Math.round(x / cell) * cell;
  const iy = Math.round(y / cell) * cell;
  return {x: ix, y: iy};
}

// --- Game state & helpers ---
let score = 0;
let bonus = 0;
let awaitingBonusSecond = false;
let firstPlacement = null; // {col,row}
const scoredLines = [];

function isOccupied(col,row,cell=40){
  const key = (col*cell) + ',' + (row*cell);
  return marked.has(key);
}

function addStoneAt(col,row,cell=40){
  const key = (col*cell) + ',' + (row*cell);
  marked.add(key);
}

function removeStoneAt(col,row,cell=40){
  const key = (col*cell) + ',' + (row*cell);
  marked.delete(key);
}

function findFiveAt(col,row,cell=40){
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dx,dy] of dirs){
    const seq = [[col,row]];
    for (let k=1;k<10;k++){ const c = col + dx*k, r = row + dy*k; if (isOccupied(c,r,cell)) seq.push([c,r]); else break; }
    for (let k=1;k<10;k++){ const c = col - dx*k, r = row - dy*k; if (isOccupied(c,r,cell)) seq.unshift([c,r]); else break; }
    if (seq.length >= 5){
      for (let i=0;i+5<=seq.length;i++){
        const seg = seq.slice(i,i+5);
        if (seg.some(p=>p[0]===col && p[1]===row)) return {seg,dir:[dx,dy]};
      }
    }
  }
  return null;
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
    const x1 = gridToCssX(first[0]*cell), y1 = gridToCssY(first[1]*cell);
    const x2 = gridToCssX(last[0]*cell), y2 = gridToCssY(last[1]*cell);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  ctx.restore();
}

function handleGridClick(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left; const y = clientY - rect.top;
  const col = Math.round(x / 40); const row = Math.round(y / 40);
  if (isOccupied(col,row,40)) return;
  addStoneAt(col,row,40);
  drawFullGrid({cell:40,dot:6});
  // check immediate five
  const found = findFiveAt(col,row,40);
  if (found){ score += 1; bonus += 1; scoredLines.push({seg: found.seg}); drawFullGrid({cell:40,dot:6}); return; }
  // no five
  if (bonus > 0 && !awaitingBonusSecond){ awaitingBonusSecond = true; firstPlacement={col,row}; bonus -=1; return; }
  if (awaitingBonusSecond){
    // second placement
    const f1 = findFiveAt(firstPlacement.col, firstPlacement.row,40);
    const f2 = findFiveAt(col,row,40);
    const any = f1 || f2;
    if (any){ const toScore = f2 || f1; score +=1; bonus +=1; scoredLines.push({seg: toScore.seg}); awaitingBonusSecond=false; firstPlacement=null; drawFullGrid({cell:40,dot:6}); return; }
    // failed: remove both and return bonus
    removeStoneAt(firstPlacement.col, firstPlacement.row,40); removeStoneAt(col,row,40); bonus +=1; awaitingBonusSecond=false; firstPlacement=null; drawFullGrid({cell:40,dot:6}); return;
  }
  // not allowed
  removeStoneAt(col,row,40); drawFullGrid({cell:40,dot:6});
}

// draw a hover preview square at given intersection
// draw a preview line (80% opacity) when a hover-placement would create a 5-in-a-row
function drawPreviewLine(cell=40){
  if (!previewSegments) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(138,43,226,0.8)'; // purple at 80% opacity
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  const first = previewSegments.seg[0], last = previewSegments.seg[previewSegments.seg.length-1];
  const x1 = gridToCssX(first[0]*cell), y1 = gridToCssY(first[1]*cell);
  const x2 = gridToCssX(last[0]*cell), y2 = gridToCssY(last[1]*cell);
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.restore();
}

function clearPreview(){ previewSegments = null; }

// simulate placing at client coordinates to see if it would produce a five-in-a-row
function setPreviewAt(clientX, clientY, cell=40){
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left; const y = clientY - rect.top;
  const col = Math.round(x / cell); const row = Math.round(y / cell);
  if (isOccupied(col,row,cell)) { clearPreview(); return; }
  // temporarily place and test
  addStoneAt(col,row,cell);
  const found = findFiveAt(col,row,cell);
  removeStoneAt(col,row,cell);
  if (found) previewSegments = found; else previewSegments = null;
}

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
  // click handler -> game logic
  canvas.addEventListener('click', (ev) => { handleGridClick(ev.clientX, ev.clientY); });
  // mousemove preview
  canvas.addEventListener('mousemove', (ev) => {
    setPreviewAt(ev.clientX, ev.clientY, 40);
    // redraw grid which now also draws the preview (inside scaled context)
    drawFullGrid({cell:40, dot:6});
  });
  // touch handler (single touch)
  canvas.addEventListener('touchstart', (ev) => {
    if (ev.touches && ev.touches.length) {
      const t = ev.touches[0];
      toggleMarkAt(t.clientX, t.clientY, 40);
      ev.preventDefault();
    }
  }, {passive:false});
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

  // compute center intersection in CSS pixels
  const rect = canvas.getBoundingClientRect();
  const cx = Math.round((rect.width/2) / cell) * cell;
  const cy = Math.round((rect.height/2) / cell) * cell;

  for (const [dx,dy] of offsets){
    const gx = cx + dx * cell;
    const gy = cy + dy * cell;
    marked.add(gx + ',' + gy);
  }
  drawFullGrid({cell, dot:6});
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
  const centerCol = Math.round((rect.width/2) / cell);
  const centerRow = Math.round((rect.height/2) / cell);

  // compute top-left corner so pattern is centered around centerCol,centerRow
  const topLeftCol = centerCol - Math.floor(widthCols/2) - minCol;
  const topLeftRow = centerRow - Math.floor(heightRows/2) - minRow;

  // set marked
  marked.clear();
  for (const [c,r] of pts){
    const col = topLeftCol + c;
    const row = topLeftRow + r;
    const gx = col * cell;
    const gy = row * cell;
    marked.add(gx + ',' + gy);
  }
  updateCoordsPanel();
  drawFullGrid({cell,dot:6});
}

window.addEventListener('resize', () => {
  drawFullGrid({cell:40, dot:6});
});

