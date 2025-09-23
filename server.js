const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
// serve static files (index.html, script.js, styles.css) from project root for local dev
const STATIC_ROOT = path.join(__dirname);
app.use(express.static(STATIC_ROOT));

const DATA = path.join(__dirname, 'data');
const HS_FILE = path.join(DATA, 'highscores.json');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
if (!fs.existsSync(HS_FILE)) fs.writeFileSync(HS_FILE, '[]');

function readHighs(){
  try{ return JSON.parse(fs.readFileSync(HS_FILE, 'utf8') || '[]'); }catch(e){ return []; }
}
function writeHighs(arr){ fs.writeFileSync(HS_FILE, JSON.stringify(arr, null, 2)); }

// validate payload: {score: number, lines: Array<{key:string}>}
function validatePayload(body){
  if (!body || typeof body.score !== 'number') return false;
  if (!Array.isArray(body.lines)) return false;
  // basic sanity on lines
  for (const l of body.lines){ if (!l || typeof l.key !== 'string') return false; }
  return true;
}

app.get('/api/highscores', (req,res)=>{
  const hs = readHighs();
  res.json(hs);
});

// ensure root serves index.html via static middleware; fallback for single-page dev
app.get('/', (req,res)=>{
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

app.post('/api/highscores', (req,res)=>{
  const body = req.body;
  if (!validatePayload(body)) return res.status(400).json({error: 'invalid payload'});
  // server trusts the lines array and computes canonical score
  const canonical = body.lines.length;
  if (canonical !== body.score) return res.status(400).json({error: 'score mismatch'});
  const highs = readHighs();
  highs.push({score: body.score, date: (new Date()).toISOString()});
  highs.sort((a,b)=>b.score - a.score);
  const top = highs.slice(0, 100);
  writeHighs(top);
  res.json({ok:true, top});
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log('Highscore server listening on', port));
