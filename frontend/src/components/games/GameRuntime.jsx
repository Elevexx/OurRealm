import React, { useEffect, useMemo, useRef } from "react";

// Sandboxed game runtime: the ORAi-generated spec runs inside an isolated
// iframe (sandbox="allow-scripts", separate origin — no cookies, no auth,
// no production APIs, no parent DOM). Scores/saves come back via postMessage.
// One data-driven renderer, 9 runtime families:
//   DOM:    quiz_adventure, matching, sorting, memory, rhythm, puzzle_room
//   Canvas: top_down, platformer, dodge_collect
const RUNTIME_JS = String.raw`
const S=window.__SPEC__;const SAVE=window.__SAVE__||{};const root=document.getElementById('g');
let score=0,stageIdx=0,correctTotal=0,answered=0;
let lives=S.lives||3,combo=0,comboMult=1,best=SAVE.best_score||0,earned=[];
const ARC={top_down:1,platformer:1,dodge_collect:1};
const T=S.theme||{bg:'#0b1220',accent:'#2EE6FF',text:'#EAF2FF'};
document.body.style.cssText='margin:0;font-family:system-ui,sans-serif;background:'+T.bg+';color:'+T.text+';min-height:100vh;overflow:hidden';
root.style.transition='opacity .25s ease';
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e}
function post(completed){parent.postMessage({type:'game_score',score:score,completed:!!completed,title:S.title},'*')}
function saveGame(){best=Math.max(best,score);parent.postMessage({type:'game_save',save:{best_score:best,stage:stageIdx}},'*')}
function hud(){const h=el('div','','');h.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:8px 12px;font-size:12px;opacity:.92;flex-wrap:wrap';
 let r='<span>Stage '+(Math.min(stageIdx,S.stages.length-1)+1)+'/'+S.stages.length+' · Score <b style="color:'+T.accent+'">'+score+'</b></span>';
 if(ARC[S.runtime]){r+='<span><span style="color:#FF6B6B">'+'\u2665'.repeat(Math.max(0,lives))+'</span>'+(S.combo?' · <span style="color:#F4A73B">x'+comboMult.toFixed(1)+'</span>':'')+(best?' · Best '+best:'')+'</span>'}
 h.innerHTML='<b>'+S.title+'</b>'+r;return h}
function btn(label,fn){const b=el('button','',label);b.style.cssText='margin:6px;padding:12px 18px;border-radius:12px;border:1px solid '+T.accent+'55;background:'+T.accent+'22;color:'+T.text+';font-size:15px;cursor:pointer;min-height:44px';b.onclick=fn;return b}
function fb(ok,msg,then){const f=el('div','',(ok?'\u2713 ':'\u2717 ')+(msg||''));f.style.cssText='padding:10px 14px;font-size:13px;color:'+(ok?'#10E670':'#FF6B6B');root.appendChild(f);setTimeout(()=>{f.remove();then()},950)}
function addScore(pts){let p=(pts!==undefined?pts:((S.scoring||{}).points_per_correct||10));
 if(S.combo){combo++;comboMult=1+Math.min(3,Math.floor(combo/4)*0.5);p=Math.round(p*comboMult)}
 score+=p;correctTotal++;answered++;post(false)}
function comboBreak(){combo=0;comboMult=1}
function unlockMsg(){const u=(S.unlockables||[]).find(x=>Number(x.stage)===stageIdx+1);return u?' \u2605 Unlocked: '+u.label:''}
function checkAchievements(pct){(S.achievements||[]).forEach(a=>{if(!earned.includes(a.label)&&(a.id==='perfect'?pct===100:true))earned.push(a.label)})}
function done(){root.innerHTML='';root.appendChild(hud());const pct=answered?Math.round(correctTotal/answered*100):100;
 const pass=pct>=((S.scoring||{}).pass_pct||60)||ARC[S.runtime];checkAchievements(pct);saveGame();
 const d=el('div','','<h2 style="color:'+T.accent+'">'+(pass?'\uD83C\uDFC6 Well done!':'Keep practicing!')+'</h2><p>Final score: <b>'+score+'</b>'+(score>=best&&score>0?' \u2014 <span style="color:#10E670">Best score!</span>':(best?' \u00b7 Best: '+best:''))+(ARC[S.runtime]?'':' \u00b7 Accuracy '+pct+'%')+'</p>'+
  (earned.length?'<p style="color:#F4A73B">\u2605 '+earned.join(' \u00b7 ')+'</p>':''));
 d.style.cssText='text-align:center;padding:26px 16px';root.appendChild(d);
 root.appendChild(btn('Play again',restart));post(true)}
function gameOver(){root.innerHTML='';root.appendChild(hud());saveGame();
 const d=el('div','','<h2 style="color:#FF6B6B">Game Over</h2><p>Score: <b>'+score+'</b>'+(score>=best&&score>0?' \u2014 <span style="color:#10E670">Best score!</span>':(best?' \u00b7 Best: '+best:''))+'</p>');
 d.style.cssText='text-align:center;padding:30px 16px';root.appendChild(d);
 root.appendChild(btn('Try again',restart));post(true)}
function restart(){score=0;stageIdx=0;correctTotal=0;answered=0;lives=S.lives||3;combo=0;comboMult=1;earned=[];stage()}
function next(){saveGame();stageIdx++;if(stageIdx>=S.stages.length)done();else stage()}
function mark(ok,pts){answered++;if(ok){addScore(pts);answered--;}else comboBreak();post(false)}
function stage(){root.style.opacity=0;setTimeout(()=>{root.innerHTML='';root.appendChild(hud());const st=S.stages[stageIdx];
 const h=el('div','','<h3 style="margin:6px 12px;color:'+T.accent+'">'+(st.title||'')+'</h3>');root.appendChild(h);
 ({quiz_adventure:qa,matching:ma,sorting:so,memory:me,rhythm:rh,top_down:td,platformer:pf,dodge_collect:dc,puzzle_room:pz})[S.runtime](st);
 root.style.opacity=1},220)}

/* ── keyboard + pointer input (canvas runtimes) ─────────────────────── */
const keys={};document.addEventListener('keydown',e=>{keys[e.key]=true;if(['ArrowUp','ArrowDown',' '].includes(e.key))e.preventDefault()});
document.addEventListener('keyup',e=>{keys[e.key]=false});
const ptr={active:false,x:0,y:0};
function mkCanvas(extraH){const c=el('canvas','');const W=Math.min(root.clientWidth||360,900);
 const H=Math.max(280,window.innerHeight-96-(extraH||0));c.width=W;c.height=H;
 c.style.cssText='display:block;touch-action:none;background:rgba(255,255,255,0.02);border-radius:12px;margin:0 auto;border:1px solid rgba(46,230,255,0.15)';
 root.appendChild(c);
 c.addEventListener('pointerdown',e=>{const r=c.getBoundingClientRect();ptr.active=true;ptr.x=e.clientX-r.left;ptr.y=e.clientY-r.top});
 c.addEventListener('pointermove',e=>{if(!ptr.active)return;const r=c.getBoundingClientRect();ptr.x=e.clientX-r.left;ptr.y=e.clientY-r.top});
 c.addEventListener('pointerup',()=>ptr.active=false);c.addEventListener('pointercancel',()=>ptr.active=false);
 return c}
function touchRow(defs){const row=el('div','');row.style.cssText='display:flex;justify-content:center;gap:10px;padding:6px';
 defs.forEach(d=>{const b=el('button','',d.label);
  b.style.cssText='width:64px;height:48px;border-radius:12px;border:1px solid '+T.accent+'55;background:'+T.accent+'18;color:'+T.text+';font-size:20px;touch-action:none;user-select:none';
  const on=e=>{e.preventDefault();keys[d.key]=true},off=e=>{e.preventDefault();keys[d.key]=false};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('pointercancel',off);
  row.appendChild(b)});root.appendChild(row);return row}
function glow(g,color,r){g.shadowColor=color;g.shadowBlur=r}
function refreshHud(){const h=root.querySelector('div');if(h)h.replaceWith(hud())}

/* ── DODGE & COLLECT ARCADE ─────────────────────────────────────────── */
function dc(st){const c=mkCanvas(0),g=c.getContext('2d');
 let px=c.width/2;const pw=Math.max(34,c.width*0.085),py=c.height-44;
 let items=[],last=performance.now(),spawnAcc=0,got=0,inv=0,over=false;
 const target=st.target_cores||8,fall=(st.fall_speed||140)*(1+stageIdx*0.12),spawn=Math.max(260,(st.spawn_ms||700)-stageIdx*60),ratio=(st.core_ratio!==undefined?st.core_ratio:0.6);
 function frame(now){if(over)return;const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(keys.ArrowLeft||keys.a)px-=300*dt;if(keys.ArrowRight||keys.d)px+=300*dt;
  if(ptr.active)px+=(ptr.x-px)*Math.min(1,12*dt);
  px=Math.max(pw/2,Math.min(c.width-pw/2,px));
  spawnAcc+=dt*1000;while(spawnAcc>spawn){spawnAcc-=spawn;items.push({x:20+Math.random()*(c.width-40),y:-16,core:Math.random()<ratio,r:11,w:Math.random()*60-30})}
  items.forEach(it=>{it.y+=fall*dt*(it.core?1:1.2);it.x+=it.w*dt});
  items=items.filter(it=>{
   if(Math.abs(it.x-px)<pw/2+it.r&&Math.abs(it.y-py)<24){
    if(it.core){addScore();got++;refreshHud()}
    else if(inv<=0){comboBreak();lives--;inv=1.2;refreshHud();if(lives<=0){over=true;setTimeout(gameOver,300)}}
    return false}
   return it.y<c.height+24});
  if(inv>0)inv-=dt;
  g.clearRect(0,0,c.width,c.height);
  items.forEach(it=>{g.beginPath();
   if(it.core){glow(g,T.accent,16);g.fillStyle=T.accent;g.arc(it.x,it.y,it.r,0,7);g.fill()}
   else{glow(g,'#FF6B6B',12);g.fillStyle='#FF6B6B';g.moveTo(it.x,it.y-12);g.lineTo(it.x+10,it.y);g.lineTo(it.x,it.y+12);g.lineTo(it.x-10,it.y);g.fill()}
   g.shadowBlur=0});
  g.beginPath();glow(g,inv>0?'#F4A73B':'#C26BFF',18);g.fillStyle=inv>0?'#F4A73B':'#C26BFF';
  g.moveTo(px,py-16);g.lineTo(px+pw/2,py+12);g.lineTo(px-pw/2,py+12);g.fill();g.shadowBlur=0;
  g.fillStyle=T.text;g.font='12px system-ui';g.fillText('Cores '+got+'/'+target,10,18);
  if(got>=target){over=true;fb(true,(st.title||'Stage')+' cleared!'+unlockMsg(),next);return}
  requestAnimationFrame(frame)}
 requestAnimationFrame(frame)}

/* ── TOP-DOWN MOVEMENT ──────────────────────────────────────────────── */
function td(st){const c=mkCanvas(0),g=c.getContext('2d');
 const speed=(st.player_speed||180)*(1+stageIdx*0.06);
 const P={x:30,y:c.height/2,r:11};let cp={x:P.x,y:P.y};
 const obs=[];const nOb=st.obstacles!==undefined?st.obstacles:3;
 for(let i=0;i<nOb;i++){obs.push({x:60+Math.random()*(c.width-160),y:30+Math.random()*(c.height-100),w:24+Math.random()*70,h:16+Math.random()*60})}
 function freeSpot(){for(let t=0;t<40;t++){const x=30+Math.random()*(c.width-60),y=30+Math.random()*(c.height-60);
  if(!obs.some(o=>x>o.x-16&&x<o.x+o.w+16&&y>o.y-16&&y<o.y+o.h+16)&&Math.hypot(x-P.x,y-P.y)>60)return{x,y}}return{x:c.width-40,y:40}}
 let cores=[];const nC=st.cores||6;for(let i=0;i<nC;i++)cores.push(freeSpot());
 const hz=(st.hazards&&st.hazards.length?st.hazards:[{type:'patrol'},{type:'chaser'}]).map(h=>{
  const s=freeSpot();return{x:s.x,y:s.y,vx:(Math.random()<.5?-1:1),vy:(Math.random()<.5?-1:1),
  type:h.type==='chaser'?'chaser':'patrol',sp:(h.speed||(h.type==='chaser'?80:120))*(1+stageIdx*0.1)}});
 let portal=null,inv=0,over=false,last=performance.now(),tick=0;
 function hitObs(x,y,r){return obs.some(o=>x>o.x-r&&x<o.x+o.w+r&&y>o.y-r&&y<o.y+o.h+r)}
 function frame(now){if(over)return;const dt=Math.min(0.05,(now-last)/1000);last=now;tick+=dt;
  let dx=0,dy=0;
  if(keys.ArrowLeft||keys.a)dx-=1;if(keys.ArrowRight||keys.d)dx+=1;
  if(keys.ArrowUp||keys.w)dy-=1;if(keys.ArrowDown||keys.s)dy+=1;
  if(ptr.active){const vx=ptr.x-P.x,vy=ptr.y-P.y,m=Math.hypot(vx,vy);if(m>8){dx=vx/m;dy=vy/m}}
  const nx=P.x+dx*speed*dt,ny=P.y+dy*speed*dt;
  if(nx>P.r&&nx<c.width-P.r&&!hitObs(nx,P.y,P.r))P.x=nx;
  if(ny>P.r&&ny<c.height-P.r&&!hitObs(P.x,ny,P.r))P.y=ny;
  cores=cores.filter(co=>{if(Math.hypot(co.x-P.x,co.y-P.y)<20){addScore();if(S.checkpoints)cp={x:co.x,y:co.y};refreshHud();return false}return true});
  if(!cores.length&&!portal)portal={x:c.width-36,y:36};
  hz.forEach(h=>{
   if(h.type==='chaser'){const vx=P.x-h.x,vy=P.y-h.y,m=Math.hypot(vx,vy)||1;h.x+=vx/m*h.sp*dt;h.y+=vy/m*h.sp*dt}
   else{h.x+=h.vx*h.sp*dt;h.y+=h.vy*h.sp*dt;
    if(h.x<14||h.x>c.width-14)h.vx*=-1;if(h.y<14||h.y>c.height-14)h.vy*=-1;
    if(hitObs(h.x+h.vx*4,h.y,12))h.vx*=-1;if(hitObs(h.x,h.y+h.vy*4,12))h.vy*=-1}
   if(inv<=0&&Math.hypot(h.x-P.x,h.y-P.y)<P.r+11){comboBreak();lives--;inv=1.5;P.x=cp.x;P.y=cp.y;refreshHud();
    if(lives<=0){over=true;setTimeout(gameOver,300)}}});
  if(inv>0)inv-=dt;
  if(portal&&Math.hypot(portal.x-P.x,portal.y-P.y)<24){over=true;fb(true,(st.title||'Zone')+' cleared!'+unlockMsg(),next);return}
  g.clearRect(0,0,c.width,c.height);
  g.strokeStyle='rgba(46,230,255,0.25)';g.strokeRect(1,1,c.width-2,c.height-2);
  obs.forEach(o=>{g.fillStyle='rgba(138,147,166,0.35)';g.fillRect(o.x,o.y,o.w,o.h)});
  cores.forEach(co=>{g.beginPath();glow(g,T.accent,14);g.fillStyle=T.accent;g.arc(co.x,co.y,8,0,7);g.fill();g.shadowBlur=0});
  hz.forEach(h=>{g.beginPath();glow(g,'#FF6B6B',12);g.fillStyle=h.type==='chaser'?'#FF8A5A':'#FF6B6B';g.arc(h.x,h.y,11,0,7);g.fill();g.shadowBlur=0});
  if(portal){g.beginPath();glow(g,'#C26BFF',20);g.strokeStyle='#C26BFF';g.lineWidth=3;g.arc(portal.x,portal.y,14+Math.sin(tick*5)*3,0,7);g.stroke();g.shadowBlur=0;g.lineWidth=1}
  g.beginPath();glow(g,inv>0?'#F4A73B':'#10E670',16);g.fillStyle=inv>0?'#F4A73B':'#10E670';g.arc(P.x,P.y,P.r,0,7);g.fill();g.shadowBlur=0;
  g.fillStyle=T.text;g.font='12px system-ui';g.fillText(cores.length?('Cores left: '+cores.length):'Reach the portal!',10,18);
  requestAnimationFrame(frame)}
 requestAnimationFrame(frame)}

/* ── PLATFORMER LITE ────────────────────────────────────────────────── */
function pf(st){const c=mkCanvas(64),g=c.getContext('2d');
 const px_=v=>v/100*c.width,py_=v=>v/100*c.height;
 const plats=(st.platforms&&st.platforms.length?st.platforms:[{x:0,y:92,w:100},{x:6,y:74,w:22},{x:40,y:62,w:20},{x:70,y:50,w:24},{x:28,y:38,w:18},{x:58,y:24,w:22}])
  .map(p=>({x:px_(p.x),y:py_(p.y),w:px_(p.w),h:10}));
 const cores=(st.cores&&st.cores.length?st.cores.map(o=>({x:px_(o.x),y:py_(o.y)})):plats.slice(1).map(p=>({x:p.x+p.w/2,y:p.y-22})));
 const hazards=(st.hazards||[]).map(o=>({x:px_(o.x),y:py_(o.y)}));
 const goal=st.goal?{x:px_(st.goal.x),y:py_(st.goal.y)}:{x:plats[plats.length-1].x+plats[plats.length-1].w/2,y:plats[plats.length-1].y-26};
 const start={x:plats[0].x+30,y:plats[0].y-30};
 const P={x:start.x,y:start.y,vx:0,vy:0,w:18,h:24,ground:false};let cp={...start};
 let got=[],inv=0,over=false,last=performance.now();
 const spd=190*(1+stageIdx*0.05),grav=980,jump=-450;
 touchRow([{label:'\u25C0',key:'ArrowLeft'},{label:'\u2B06',key:'ArrowUp'},{label:'\u25B6',key:'ArrowRight'}]);
 function frame(now){if(over)return;const dt=Math.min(0.04,(now-last)/1000);last=now;
  P.vx=0;if(keys.ArrowLeft||keys.a)P.vx=-spd;if(keys.ArrowRight||keys.d)P.vx=spd;
  if((keys.ArrowUp||keys.w||keys[' '])&&P.ground){P.vy=jump;P.ground=false}
  P.vy+=grav*dt;const oy=P.y;P.x+=P.vx*dt;P.y+=P.vy*dt;
  P.x=Math.max(0,Math.min(c.width-P.w,P.x));P.ground=false;
  plats.forEach(pl=>{if(P.vy>=0&&oy+P.h<=pl.y+6&&P.y+P.h>=pl.y&&P.x+P.w>pl.x&&P.x<pl.x+pl.w){P.y=pl.y-P.h;P.vy=0;P.ground=true}});
  cores.forEach((co,i)=>{if(!got.includes(i)&&Math.abs(co.x-(P.x+P.w/2))<18&&Math.abs(co.y-(P.y+P.h/2))<20){got.push(i);addScore();if(S.checkpoints)cp={x:co.x-9,y:co.y-30};refreshHud()}});
  const die=()=>{comboBreak();lives--;inv=1.2;P.x=cp.x;P.y=cp.y;P.vy=0;refreshHud();if(lives<=0){over=true;setTimeout(gameOver,300)}};
  if(inv<=0){hazards.forEach(hz2=>{if(Math.abs(hz2.x-(P.x+P.w/2))<16&&Math.abs(hz2.y-(P.y+P.h))<16)die()});
   if(P.y>c.height+10)die()}
  if(inv>0)inv-=dt;
  if(Math.abs(goal.x-(P.x+P.w/2))<20&&Math.abs(goal.y-(P.y+P.h/2))<26){over=true;fb(true,(st.title||'Level')+' complete!'+unlockMsg(),next);return}
  g.clearRect(0,0,c.width,c.height);
  plats.forEach(pl=>{g.fillStyle='rgba(46,230,255,0.28)';g.fillRect(pl.x,pl.y,pl.w,pl.h)});
  cores.forEach((co,i)=>{if(got.includes(i))return;g.beginPath();glow(g,T.accent,12);g.fillStyle=T.accent;g.arc(co.x,co.y,7,0,7);g.fill();g.shadowBlur=0});
  hazards.forEach(hz2=>{g.beginPath();glow(g,'#FF6B6B',10);g.fillStyle='#FF6B6B';g.moveTo(hz2.x-9,hz2.y+8);g.lineTo(hz2.x,hz2.y-8);g.lineTo(hz2.x+9,hz2.y+8);g.fill();g.shadowBlur=0});
  g.beginPath();glow(g,'#C26BFF',16);g.strokeStyle='#C26BFF';g.lineWidth=3;g.arc(goal.x,goal.y,12,0,7);g.stroke();g.shadowBlur=0;g.lineWidth=1;
  glow(g,inv>0?'#F4A73B':'#10E670',12);g.fillStyle=inv>0?'#F4A73B':'#10E670';g.fillRect(P.x,P.y,P.w,P.h);g.shadowBlur=0;
  requestAnimationFrame(frame)}
 requestAnimationFrame(frame)}

/* ── PUZZLE ROOM ────────────────────────────────────────────────────── */
function pz(st){if(st.intro||st.story){const p=el('div','',st.intro||st.story);p.style.cssText='padding:0 14px 8px;font-size:13px;opacity:.85';root.appendChild(p)}
 const puzzles=st.puzzles||[];let pi=0;
 function show(){const p=puzzles[pi];if(!p){fb(true,'\uD83D\uDEAA The door unlocks!'+unlockMsg(),next);return}
  const box=el('div','pzb');box.style.cssText='padding:0 12px';
  box.appendChild(el('div','','<p style="font-size:14px"><b>Puzzle '+(pi+1)+'/'+puzzles.length+':</b> '+(p.prompt||'')+'</p>'));
  const solved=()=>{addScore();refreshHud();box.remove();pi++;fb(true,'Solved!',show)};
  if(p.type==='sequence'&&p.options){let need=(p.order||p.options.map((_,i)=>i)).slice();let step=0;
   const row=el('div','');row.style.cssText='display:flex;flex-wrap:wrap';
   p.options.forEach((o,i)=>{const b=btn(o,()=>{
    if(i===need[step]){b.style.background='rgba(16,230,112,0.25)';b.disabled=true;step++;
     if(step>=need.length){box.remove();addScore();refreshHud();pi++;fb(true,'Sequence complete!',show)}}
    else{mark(false);[...row.children].forEach(x=>{x.style.background=T.accent+'22';x.disabled=false});step=0;
     const w=el('div','','Wrong order \u2014 starting over');w.style.cssText='color:#FF6B6B;font-size:12px;padding:4px 8px';box.appendChild(w);setTimeout(()=>w.remove(),900)}});
    row.appendChild(b)});box.appendChild(row)}
  else if(p.options){p.options.forEach((o,i)=>box.appendChild(btn(o,()=>{
    if(i===(p.answer_index||0))solved();else{mark(false);fb(false,'Not quite \u2014 look again.',()=>{})}})))}
  else{const inp=el('input','');inp.placeholder='Your answer\u2026';
   inp.style.cssText='margin:6px;padding:12px;border-radius:12px;border:1px solid '+T.accent+'44;background:rgba(255,255,255,0.06);color:'+T.text+';font-size:15px;width:70%';
   const go=()=>{const a=(inp.value||'').trim().toLowerCase(),k=String(p.answer||'').trim().toLowerCase();
    if(a&&(a===k||(k.length>3&&a.includes(k))))solved();
    else{mark(false);inp.style.borderColor='#FF6B6B';setTimeout(()=>inp.style.borderColor=T.accent+'44',700)}};
   inp.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
   box.appendChild(inp);box.appendChild(btn('Unlock',go))}
  if(p.hint){const hb=btn('\uD83D\uDCA1 Hint',()=>{hb.replaceWith(el('div','','<p style="font-size:12px;color:#F4A73B;padding:0 8px">'+p.hint+'</p>'))});
   hb.style.fontSize='12px';box.appendChild(hb)}
  root.appendChild(box)}
 show()}

/* ── Original DOM runtimes (unchanged behavior) ─────────────────────── */
function qa(st){if(st.story){const p=el('div','',st.story);p.style.cssText='padding:0 14px 8px;font-size:14px;opacity:.85';root.appendChild(p)}
 let qi=0;function ask(){const q=st.questions[qi];if(!q){next();return}
  const box=el('div','');box.style.cssText='padding:0 10px';box.appendChild(el('div','','<p style="padding:0 6px;font-size:15px"><b>'+q.q+'</b></p>'));
  q.options.forEach((o,i)=>box.appendChild(btn(o,()=>{const ok=i===q.answer_index;mark(ok);
   box.remove();fb(ok,q.explanation||'',()=>{qi++;ask()})})));
  root.appendChild(box)}ask()}
function ma(st){let sel=null,left=el('div',''),right=el('div',''),wrap=el('div','');wrap.style.cssText='display:flex;gap:8px;padding:0 10px';
 left.style.flex=right.style.flex='1';let remaining=st.pairs.length;
 const R=st.pairs.map(p=>p.right).sort(()=>Math.random()-.5);
 st.pairs.forEach(p=>{const b=btn(p.left,()=>{sel=p;[...left.children].forEach(c=>c.style.outline='');b.style.outline='2px solid '+T.accent});left.appendChild(b)});
 R.forEach(r=>{const b=btn(r,()=>{if(!sel)return;const ok=sel.right===r;mark(ok);if(ok){b.disabled=true;b.style.opacity=.4;
  [...left.children].find(c=>c.textContent===sel.left).style.cssText+=';opacity:.4;pointer-events:none';remaining--;sel=null;if(!remaining)fb(true,'Stage complete!',next)}else fb(false,'Not a match \u2014 try again',()=>{})});right.appendChild(b)});
 wrap.appendChild(left);wrap.appendChild(right);root.appendChild(wrap)}
function so(st){let idx=0;const items=[...st.items].sort(()=>Math.random()-.5);
 function ask(){const it=items[idx];if(!it){next();return}root.querySelector('.sq')&&root.querySelector('.sq').remove();
  const box=el('div','sq','<p style="text-align:center;font-size:17px;padding:8px"><b>'+it.label+'</b></p>');box.style.cssText='text-align:center';
  st.categories.forEach(c=>box.appendChild(btn(c,()=>{const ok=it.category===c;mark(ok);fb(ok,ok?'':'It belongs in '+it.category,()=>{idx++;ask()})})));
  root.appendChild(box)}ask()}
function me(st){const cards=[...st.cards,...st.cards].sort(()=>Math.random()-.5);let open=[],found=0;
 const grid=el('div','');grid.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px';
 cards.forEach(c=>{const b=btn('?',()=>{if(b.dataset.done||open.length===2||open.includes(b))return;b.textContent=c;open.push(b);
  if(open.length===2){const[a,d]=open;if(a.textContent===d.textContent){a.dataset.done=d.dataset.done='1';a.style.opacity=d.style.opacity=.45;mark(true);found++;open=[];
   if(found===st.cards.length)fb(true,'All pairs found!',next)}else{mark(false);setTimeout(()=>{a.textContent=d.textContent='?';open=[]},700)}}});
  b.dataset.v=c;b.style.minWidth='0';grid.appendChild(b)});root.appendChild(grid)}
function rh(st){const beatMs=60000/(st.bpm||90);let i=0,hits=0,taps=st.pattern.filter(x=>x).length;
 const disp=el('div','','Get ready\u2026');disp.style.cssText='text-align:center;font-size:34px;padding:26px;min-height:60px';root.appendChild(disp);
 if(st.lesson_tip)root.appendChild(el('div','','<p style="text-align:center;font-size:12px;opacity:.7;padding:0 14px">'+st.lesson_tip+'</p>'));
 let window_open=false,tapped=false;
 const tap=btn('TAP \uD83E\uDD41',()=>{if(window_open&&!tapped){tapped=true;hits++;mark(true);disp.style.color='#10E670'}else{mark(false);disp.style.color='#FF6B6B'}});
 tap.style.cssText+=';display:block;margin:10px auto;font-size:22px;padding:18px 44px';root.appendChild(tap);
 const timer=setInterval(()=>{if(i>=st.pattern.length){clearInterval(timer);fb(hits>=Math.ceil(taps*.6),'You hit '+hits+'/'+taps+' beats',next);return}
  const on=st.pattern[i]===1;window_open=on;tapped=false;disp.textContent=on?'TAP!':'\u2026';disp.style.color=on?T.accent:T.text;i++},beatMs)}
stage();
`;

function buildSrcdoc(spec, save) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="g"></div><script>window.__SPEC__=${JSON.stringify(spec).replace(/</g, "\\u003c")};window.__SAVE__=${JSON.stringify(save || {}).replace(/</g, "\\u003c")};<\/script>
<script>${RUNTIME_JS}<\/script></body></html>`;
}

export default function GameRuntime({ spec, onScore, height = 460, gameId }) {
  const ref = useRef(null);
  const srcdoc = useMemo(() => {
    if (!spec) return "";
    let save = {};
    if (gameId) {
      try { save = JSON.parse(localStorage.getItem(`or-game-save-${gameId}`) || "{}"); } catch { save = {}; }
    }
    return buildSrcdoc(spec, save);
  }, [spec, gameId]);
  useEffect(() => {
    const h = (e) => {
      if (e?.data?.type === "game_score" && onScore) onScore(e.data);
      if (e?.data?.type === "game_save" && gameId) {
        try { localStorage.setItem(`or-game-save-${gameId}`, JSON.stringify(e.data.save || {})); } catch { /* full */ }
      }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [onScore, gameId]);
  if (!spec) return null;
  return (
    <iframe ref={ref} title={spec.title || "game"} srcDoc={srcdoc} sandbox="allow-scripts"
      className="w-full rounded-xl" style={{ height, border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}
      data-testid="game-runtime-iframe" />
  );
}
