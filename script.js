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
let hover = null; // {x,y} in CSS pixels for preview

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

  // draw marked dots only from state
  ctx.fillStyle = '#000';
  const half = dot / 2;
  const arm = Math.max(1, Math.round(dot));
  for (const key of marked) {
    const [gx, gy] = key.split(',').map(Number);
    ctx.fillRect(Math.round(gx - arm/2), Math.round(gy - half), Math.round(arm), Math.round(dot));
    ctx.fillRect(Math.round(gx - half), Math.round(gy - arm/2), Math.round(dot), Math.round(arm));
  }

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

function toggleMarkAt(clientX, clientY, cell=40){
  const {x,y} = nearestIntersection(clientX, clientY, cell);
  const key = x + ',' + y;
  if (marked.has(key)) marked.delete(key);
  else marked.add(key);
  drawFullGrid({cell, dot:6});
  updateCoordsPanel();
}

// draw a hover preview square at given intersection
function drawHoverPreview(cell=40, dot=6){
  if (!hover) return;
  const ctxSave = ctx.getImageData ? null : null; // placeholder to show we preserve state
  const half = dot / 2;
  const arm = Math.max(1, Math.round(dot));
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  const gx = hover.x;
  const gy = hover.y;
  ctx.fillRect(Math.round(gx - arm/2), Math.round(gy - half), Math.round(arm), Math.round(dot));
  ctx.fillRect(Math.round(gx - half), Math.round(gy - arm/2), Math.round(dot), Math.round(arm));
  ctx.restore();
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
  // click handler
  canvas.addEventListener('click', (ev) => {
    toggleMarkAt(ev.clientX, ev.clientY, 40);
  });
  // mousemove preview
  canvas.addEventListener('mousemove', (ev) => {
    const p = nearestIntersection(ev.clientX, ev.clientY, 40);
    hover = p;
    // redraw grid and then overlay preview
    drawFullGrid({cell:40, dot:6});
    drawHoverPreview(40,6);
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

