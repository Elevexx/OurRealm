import React, { useEffect, useMemo, useRef } from "react";

// Sandboxed game runtime v3: ORAi-generated specs run in an isolated iframe
// (sandbox="allow-scripts" — no cookies, auth, APIs or parent DOM).
// One data-driven renderer with a procedural VISUAL ASSET SYSTEM:
// painted sprites (hover vehicles, energy cores, hazard families, pickups,
// animated portals) + layered parallax environments — no network, no files.
// Runtimes: quiz_adventure, matching, sorting, memory, rhythm, puzzle_room
// (DOM) · top_down, platformer, dodge_collect (canvas).
// Dodge & Collect presentation modes: vertical | lane_runner | road_3d |
// space_flight | arena_360 | tunnel.
const RUNTIME_JS = String.raw`
const S=window.__SPEC__;const SAVE=window.__SAVE__||{};const root=document.getElementById('g');
let score=0,stageIdx=0,correctTotal=0,answered=0;
let lives=S.lives||3,combo=0,comboMult=1,best=SAVE.best_score||0,earned=[];
const ARC={top_down:1,platformer:1,dodge_collect:1};
let startMs=Date.now(),maxCombo=1,dmg=0;
/* ── WebAudio synth SFX (no files, mobile-safe) ── */
/* ── Controls & Input Modes (per-game config) ── */
const CTRL=window.__CTRL__||{};
const DESK=CTRL.desktop_enabled!==false,MOB=CTRL.mobile_enabled!==false;
const SENS=CTRL.sensitivity||1;
const DEFKEYS={left:['ArrowLeft','a'],right:['ArrowRight','d'],up:['ArrowUp','w'],down:['ArrowDown','s'],jump:['ArrowUp','w',' '],pause:['p'],restart:['r']};
const KMAP=CTRL.keyboard_map||{};
function akeys(n){return (KMAP[n]&&KMAP[n].length?KMAP[n]:DEFKEYS[n])||[]}
function clr(n){akeys(n).forEach(k=>keys2[k]=false)}
let PAUSED=false,lastInput='key';
function vib(ms){if(CTRL.haptics!==false&&navigator.vibrate)try{navigator.vibrate(ms)}catch(e){}}
if(CTRL.high_contrast)document.documentElement.style.filter='contrast(1.18) saturate(1.25)';
const AUD=window.__AUDIO__||{};let AU=null;
function au(){if(AU===null){try{AU=new (window.AudioContext||window.webkitAudioContext)()}catch(e){AU=false}}return AU}
document.addEventListener('pointerdown',()=>{const a=au();if(a&&a.resume)a.resume()});
const SFX={collect:[880,1320,0.09,'sine'],combo:[660,990,0.14,'square'],hit:[200,60,0.28,'sawtooth'],
 shield:[520,780,0.16,'triangle'],boost:[440,1760,0.22,'sawtooth'],portal:[330,660,0.5,'sine'],
 checkpoint:[700,1050,0.13,'triangle'],stage:[523,784,0.4,'sine'],achievement:[784,1175,0.35,'triangle'],
 victory:[523,1047,0.8,'sine'],gameover:[220,70,0.8,'sawtooth'],click:[600,600,0.05,'square']};
function sfx(name){if(AUD.muted)return;const a=au();if(!a)return;const cf=SFX[name];if(!cf)return;
 try{const t0=a.currentTime,o=a.createOscillator(),gn=a.createGain();
 o.type=cf[3];o.frequency.setValueAtTime(cf[0],t0);o.frequency.exponentialRampToValueAtTime(Math.max(30,cf[1]),t0+cf[2]);
 const v=0.22*(AUD.master!==undefined?AUD.master:0.8)*(AUD.effects!==undefined?AUD.effects:0.8);
 if(v<=0)return;gn.gain.setValueAtTime(v,t0);gn.gain.exponentialRampToValueAtTime(0.001,t0+cf[2]);
 o.connect(gn);gn.connect(a.destination);o.start(t0);o.stop(t0+cf[2]+0.02)}catch(e){}}
let musicTimer=null;const SCALE=[261.6,311.1,392,466.2,523.3];
function music(on){if(musicTimer){clearInterval(musicTimer);musicTimer=null}
 if(!on||AUD.muted)return;const mv=(AUD.master!==undefined?AUD.master:0.8)*(AUD.music!==undefined?AUD.music:0.5);
 if(mv<=0)return;
 musicTimer=setInterval(()=>{const a=au();if(!a)return;try{const t0=a.currentTime,o=a.createOscillator(),gn=a.createGain();
  o.type='sine';o.frequency.value=SCALE[Math.floor(Math.random()*SCALE.length)]*(Math.random()<0.3?0.5:1);
  gn.gain.setValueAtTime(0.05*mv,t0);gn.gain.exponentialRampToValueAtTime(0.001,t0+1.4);
  o.connect(gn);gn.connect(a.destination);o.start(t0);o.stop(t0+1.5)}catch(e){}},640)}
const V=S.visual_theme||{};const PAL=V.palette||{};
const T=S.theme||{bg:PAL.bg||'#0b1220',accent:PAL.glow||'#2EE6FF',text:'#EAF2FF'};
const GLOW=PAL.glow||T.accent,ACC=PAL.accent||'#F4A73B',HAZC=PAL.hazard||'#FF3D5A';
const PCOL=PAL.player&&PAL.player.length?PAL.player:['#C26BFF','#2EE6FF'];
document.body.style.cssText='margin:0;font-family:system-ui,sans-serif;background:'+(PAL.bg||T.bg)+';color:'+T.text+';min-height:100vh;overflow:hidden';
root.style.transition='opacity .25s ease';
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e}
function post(completed){parent.postMessage({type:'game_score',score:score,completed:!!completed,title:S.title,
 time_s:Math.round((Date.now()-startMs)/1000),stage_reached:stageIdx,max_combo:maxCombo,
 no_damage:dmg===0,achievements:earned.slice()},'*')}
function saveGame(){best=Math.max(best,score);parent.postMessage({type:'game_save',save:{best_score:best,stage:stageIdx}},'*')}
function hud(){const h=el('div','','');h.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:8px 12px;font-size:12px;opacity:.92;flex-wrap:wrap';
 let r='<span>Stage '+(Math.min(stageIdx,S.stages.length-1)+1)+'/'+S.stages.length+' · Score <b style="color:'+GLOW+'">'+score+'</b></span>';
 if(ARC[S.runtime]){r+='<span><span style="color:#FF6B6B">'+'\u2665'.repeat(Math.max(0,lives))+'</span>'+(S.combo?' · <span style="color:'+ACC+'">x'+comboMult.toFixed(1)+'</span>':'')+(best?' · Best '+best:'')+'</span>'}
 h.innerHTML='<b>'+S.title+'</b>'+r;return h}
function btn(label,fn){const b=el('button','',label);b.style.cssText='margin:6px;padding:12px 18px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'22;color:'+T.text+';font-size:15px;cursor:pointer;min-height:44px;transition:transform .1s';
 b.onpointerdown=()=>b.style.transform='scale(0.95)';b.onpointerup=()=>b.style.transform='';b.onclick=()=>{sfx('click');fn()};return b}
function fb(ok,msg,then){const f=el('div','',(ok?'\u2713 ':'\u2717 ')+(msg||''));f.style.cssText='padding:10px 14px;font-size:13px;color:'+(ok?'#10E670':'#FF6B6B');root.appendChild(f);setTimeout(()=>{f.remove();then()},950)}
function addScore(pts){let p=(pts!==undefined?pts:((S.scoring||{}).points_per_correct||10));
 if(S.combo){combo++;const nm=1+Math.min(3,Math.floor(combo/4)*0.5);if(nm>comboMult)sfx('combo');comboMult=nm;maxCombo=Math.max(maxCombo,comboMult);p=Math.round(p*comboMult)}
 sfx('collect');score+=p;correctTotal++;answered++;post(false);return p}
function comboBreak(){combo=0;comboMult=1}
function unlockMsg(){const u=(S.unlockables||[]).find(x=>Number(x.stage)===stageIdx+1);return u?' \u2605 Unlocked: '+u.label:''}
function checkAchievements(pct){(S.achievements||[]).forEach(a=>{if(!earned.includes(a.label)&&(a.id==='perfect'?pct===100:true))earned.push(a.label)})}
function done(){music(false);sfx('victory');if(earned.length)sfx('achievement');root.innerHTML='';root.appendChild(hud());const pct=answered?Math.round(correctTotal/answered*100):100;
 const pass=pct>=((S.scoring||{}).pass_pct||60)||ARC[S.runtime];checkAchievements(pct);saveGame();
 const secs=Math.round((Date.now()-startMs)/1000),mm=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
 const stats=[['SCORE',score],['BEST',Math.max(best,score)],['TIME',mm]];
 if(S.combo)stats.push(['MAX COMBO','x'+maxCombo.toFixed(1)]);
 if(!ARC[S.runtime])stats.push(['ACCURACY',pct+'%']);
 const d=el('div','','<div style="font-size:46px;animation:orpop .7s backwards">'+(pass?'\uD83C\uDFC6':'\uD83C\uDF31')+'</div>'+
  '<h2 style="margin:8px 0 2px;color:'+GLOW+';animation:orglow 2.4s infinite">'+(pass?'DEMO COMPLETE':'Keep practicing!')+'</h2>'+
  (score>=best&&score>0?'<div style="color:#10E670;font-size:12px;letter-spacing:0.2em">\u2605 NEW BEST SCORE \u2605</div>':'')+
  statRow(stats)+
  (earned.length?'<p style="color:'+ACC+';animation:orfade .8s .5s backwards">\u2605 '+earned.join(' \u00b7 ')+'</p>':'')+
  (pass&&ARC[S.runtime]?'<p style="font-size:11px;opacity:0.75;animation:orfade .8s .8s backwards">\uD83D\uDD25 Fire Power rewards land in your Fire Vault</p>':''));
 d.style.cssText='text-align:center;padding:22px 16px;animation:orfade .4s';root.appendChild(d);
 if(pass)confetti();
 root.appendChild(btn('Play again',restart));post(true)}
function gameOver(){music(false);sfx('gameover');root.innerHTML='';root.appendChild(hud());saveGame();
 const secs=Math.round((Date.now()-startMs)/1000),mm=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
 const d=el('div','','<div style="font-size:40px;animation:orpop .6s backwards">\uD83D\uDC80</div>'+
  '<h2 style="margin:8px 0 2px;color:#FF6B6B;text-shadow:0 0 22px #FF6B6B66;animation:orpop .5s">GAME OVER</h2>'+
  (score>=best&&score>0?'<div style="color:#10E670;font-size:12px;letter-spacing:0.2em">\u2605 NEW BEST SCORE \u2605</div>':'')+
  statRow([['SCORE',score],['BEST',Math.max(best,score)],['TIME',mm],['STAGE',(Math.min(stageIdx,S.stages.length-1)+1)+'/'+S.stages.length]]));
 d.style.cssText='text-align:center;padding:24px 16px;animation:orfade .35s';root.appendChild(d);
 root.appendChild(btn('Try again',restart));post(true)}
function statRow(items){return '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:14px 0;animation:orfade .6s .3s backwards">'+items.map(i=>'<div style="min-width:72px;padding:8px 10px;border-radius:12px;background:'+GLOW+'12;border:1px solid '+GLOW+'33"><div style="font-size:17px;font-weight:800;color:'+GLOW+'">'+i[1]+'</div><div style="font-size:9px;letter-spacing:0.12em;opacity:0.7">'+i[0]+'</div></div>').join('')+'</div>'}
function confetti(){for(let i=0;i<44;i++){const s=el('span','');const c=[GLOW,ACC,'#10E670','#FF8AC2','#FFD34D'][i%5];
 s.style.cssText='position:fixed;top:-14px;left:'+(Math.random()*100)+'%;width:'+(4+Math.random()*5)+'px;height:'+(8+Math.random()*7)+'px;background:'+c+';z-index:70;border-radius:2px;pointer-events:none;box-shadow:0 0 6px '+c+';animation:orconf '+(1.7+Math.random()*1.9)+'s '+(Math.random()*0.8)+'s ease-in forwards';
 document.body.appendChild(s);setTimeout(()=>s.remove(),4600)}}
let titleDone=false;
function titleScreen(){const ov=el('div','');
 ov.style.cssText='position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(ellipse at 50% 30%,'+GLOW+'26,transparent 62%),'+(PAL.bg||T.bg)+';animation:orfade .6s ease';
 for(let i=0;i<14;i++){const p=el('span','');const sz=2+Math.random()*3;
  p.style.cssText='position:absolute;left:'+(Math.random()*100)+'%;top:'+(Math.random()*100)+'%;width:'+sz+'px;height:'+sz+'px;border-radius:50%;background:'+(Math.random()<0.5?GLOW:ACC)+';opacity:'+(0.2+Math.random()*0.5)+';box-shadow:0 0 8px '+GLOW+';animation:orpulse '+(2+Math.random()*3)+'s '+(Math.random()*2)+'s infinite';ov.appendChild(p)}
 const badge=el('div','','ORAi PRESENTS');badge.style.cssText='font-size:10px;letter-spacing:0.5em;color:'+ACC+';animation:orfade .8s .2s backwards';
 const h=el('h1','',S.title);h.style.cssText='margin:14px 12px 6px;font-size:clamp(26px,6vw,44px);color:'+GLOW+';letter-spacing:0.05em;animation:orpop .7s .4s backwards,orglow 2.6s 1.2s infinite';
 const sub=el('p','',(S.description||'').slice(0,150));sub.style.cssText='max-width:430px;font-size:13px;color:'+T.text+'cc;animation:orfade .8s .9s backwards;padding:0 18px;margin:0';
 const cta=el('div','','TAP OR PRESS ANY KEY TO START');
 cta.style.cssText='margin-top:26px;font-size:11px;letter-spacing:0.32em;color:'+ACC+';animation:orfade 1s 1.3s backwards,orpulse 1.9s 1.5s infinite';
 ov.appendChild(badge);ov.appendChild(h);ov.appendChild(sub);ov.appendChild(cta);document.body.appendChild(ov);
 const go=()=>{if(titleDone)return;titleDone=true;sfx('click');ov.style.transition='opacity .45s';ov.style.opacity=0;setTimeout(()=>ov.remove(),480);stage()};
 ov.addEventListener('pointerdown',go);document.addEventListener('keydown',go)}
function restart(){score=0;stageIdx=0;correctTotal=0;answered=0;lives=S.lives||3;combo=0;comboMult=1;earned=[];startMs=Date.now();maxCombo=1;dmg=0;stage()}
function next(){saveGame();stageIdx++;if(stageIdx>=S.stages.length)done();else stage()}
function mark(ok,pts){answered++;if(ok){addScore(pts);answered--;}else comboBreak();post(false)}
function stage(){root.style.opacity=0;if(ARC[S.runtime])music(true);setTimeout(()=>{root.innerHTML='';root.appendChild(hud());const st=S.stages[stageIdx];
 const h=el('div','','<h3 style="margin:6px 12px;color:'+GLOW+'">'+(st.title||'')+'</h3>');root.appendChild(h);
 if(titleDone&&!CTRL.reduced_motion){const bn=el('div','','<div style="font-size:10px;letter-spacing:0.42em;color:'+ACC+'">STAGE '+(stageIdx+1)+' / '+S.stages.length+'</div><div style="font-size:21px;font-weight:800;color:'+GLOW+';text-shadow:0 0 18px '+GLOW+'77">'+(st.title||'')+'</div>');
  bn.style.cssText='position:fixed;top:18%;left:50%;z-index:55;text-align:center;pointer-events:none;animation:orbanner 2.1s ease forwards';
  document.body.appendChild(bn);setTimeout(()=>bn.remove(),2200)}
 ({quiz_adventure:qa,matching:ma,sorting:so,memory:me,rhythm:rh,top_down:td,platformer:pf,dodge_collect:dc,puzzle_room:pz})[S.runtime](st);
 root.style.opacity=1},220)}

/* ── input ──────────────────────────────────────────────────────────── */
const keys={};const keys2=keys;
function act(n){const ks=akeys(n);for(let i=0;i<ks.length;i++)if(keys[ks[i]])return true;return false}
document.addEventListener('keydown',e=>{if(!DESK)return;lastInput='key';keys[e.key]=true;
 if(['ArrowUp','ArrowDown',' '].includes(e.key))e.preventDefault();
 if(akeys('pause').includes(e.key))PAUSED=!PAUSED;
 if(akeys('restart').includes(e.key)&&ARC[S.runtime]&&!PAUSED)restart()});
document.addEventListener('keyup',e=>{if(!DESK)return;keys[e.key]=false});
let guideShown=false;
function ctrlGuide(){if(guideShown||CTRL.show_guide===false)return;guideShown=true;const L=[];
 if(DESK&&ARC[S.runtime]){const p=[(akeys('left')[0]||'\u2190')+'/'+(akeys('right')[0]||'\u2192')+' move'];
  if(S.runtime==='platformer')p.push((akeys('jump')[0]===' '?'Space':akeys('jump')[0])+' jump');
  else p.push((akeys('up')[0]||'\u2191')+'/'+(akeys('down')[0]||'\u2193')+' '+(S.runtime==='top_down'?'move':'fly'));
  p.push('P pause \u00b7 R restart');L.push('\u2328 '+p.join(' \u00b7 '))}
 else if(DESK)L.push('\u2328 Mouse \u2014 click to interact');
 if(MOB)L.push('\uD83D\uDC46 '+({dodge_collect:'Drag to steer',platformer:'On-screen buttons',top_down:'Drag to move'}[S.runtime]||'Tap to play'));
 if(!L.length)return;const gd=el('div','',L.join('<br>'));
 gd.style.cssText='position:fixed;left:50%;bottom:76px;transform:translateX(-50%);background:rgba(4,8,20,0.92);border:1px solid '+GLOW+'55;padding:9px 16px;border-radius:12px;font-size:12px;z-index:60;text-align:center;max-width:92%';
 document.body.appendChild(gd);setTimeout(()=>{gd.style.transition='opacity .5s';gd.style.opacity=0;setTimeout(()=>gd.remove(),600)},3400)}
const ptr={active:false,x:0,y:0};
function mkCanvas(extraH){const c=el('canvas','');const W=Math.min(root.clientWidth||360,900);
 const H=Math.max(280,window.innerHeight-96-(extraH||0));c.width=W;c.height=H;
 c.style.cssText='display:block;touch-action:none;border-radius:12px';
 const wrap=el('div','');wrap.style.cssText='position:relative;width:'+W+'px;margin:0 auto;border-radius:12px;border:1px solid '+GLOW+'26;overflow:hidden';
 wrap.appendChild(c);
 const vg=el('div','');vg.style.cssText='position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 44%,transparent 54%,rgba(0,0,0,0.42) 100%)';
 wrap.appendChild(vg);
 const bl=el('div','');bl.style.cssText='position:absolute;left:0;right:0;top:0;height:34%;pointer-events:none;background:linear-gradient(180deg,'+GLOW+'0d,transparent)';
 wrap.appendChild(bl);
 root.appendChild(wrap);
 c.addEventListener('pointerdown',e=>{const r=c.getBoundingClientRect();ptr.active=true;ptr.x=e.clientX-r.left;ptr.y=e.clientY-r.top});
 c.addEventListener('pointermove',e=>{if(!ptr.active)return;const r=c.getBoundingClientRect();ptr.x=e.clientX-r.left;ptr.y=e.clientY-r.top});
 c.addEventListener('pointerup',()=>ptr.active=false);c.addEventListener('pointercancel',()=>ptr.active=false);
 return c}
function touchRow(defs){if(!MOB)return null;const row=el('div','');
 const bs=Math.round(48*(CTRL.button_size||1)),bw=Math.round(64*(CTRL.button_size||1));
 if(CTRL.left_handed)defs=defs.slice().reverse();
 row.style.cssText='display:flex;justify-content:'+(CTRL.button_position==='left'?'flex-start':CTRL.button_position==='right'?'flex-end':'center')+';gap:10px;padding:6px;opacity:'+(CTRL.touch_opacity!==undefined?CTRL.touch_opacity:0.85);
 defs.forEach(d=>{const b=el('button','',d.label);
  b.style.cssText='width:'+bw+'px;height:'+bs+'px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'18;color:'+T.text+';font-size:20px;touch-action:none;user-select:none';
  const on=e=>{e.preventDefault();lastInput='touch';keys[d.key]=true},off=e=>{e.preventDefault();keys[d.key]=false};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('pointercancel',off);
  row.appendChild(b)});root.appendChild(row);return row}
function refreshHud(){const h=root.querySelector('div');if(h)h.replaceWith(hud())}
function hz(n){n=Math.sin(n*127.1)*43758.5;return n-Math.floor(n)}

/* ── particles + fx ─────────────────────────────────────────────────── */
let parts=[],popups=[],shake=0;
function burst(x,y,color,n,sp){for(let i=0;i<n;i++){const a=Math.random()*6.28,v=(sp||90)*(0.4+Math.random());
 parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:0.8+Math.random()*0.5,color,r:1.5+Math.random()*2.5})}}
function popup(x,y,txt,color){popups.push({x,y,txt,color,life:1.1})}
function drawFx(g,dt){
 parts.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=40*dt;p.life-=dt*1.4;
  g.globalAlpha=Math.max(0,p.life);g.fillStyle=p.color;g.shadowColor=p.color;g.shadowBlur=8;
  g.beginPath();g.arc(p.x,p.y,p.r,0,7);g.fill();g.shadowBlur=0});
 parts=parts.filter(p=>p.life>0);g.globalAlpha=1;
 popups.forEach(p=>{p.y-=34*dt;p.life-=dt;g.globalAlpha=Math.max(0,p.life);
  g.font='bold 15px system-ui';g.fillStyle=p.color;g.shadowColor=p.color;g.shadowBlur=10;
  g.fillText(p.txt,p.x,p.y);g.shadowBlur=0});
 popups=popups.filter(p=>p.life>0);g.globalAlpha=1}

/* ── PROCEDURAL ASSET PAINTERS ──────────────────────────────────────── */
function paintPlayer(g,x,y,w,tilt,boostT,shieldN,t){
 g.save();g.translate(x,y);g.rotate((tilt||0)*0.3);const h=w*1.25;
 const fl=(7+Math.abs(Math.sin(t*22))*7)*(boostT>0?2.2:1);
 [[-0.2,1],[0.2,1]].forEach(f=>{const fx=f[0]*w;
  const fg=g.createLinearGradient(fx,h*0.42,fx,h*0.42+fl+8);
  fg.addColorStop(0,boostT>0?'#FFD34D':'#F4A73B');fg.addColorStop(1,'rgba(244,167,59,0)');
  g.fillStyle=fg;g.beginPath();g.moveTo(fx-w*0.09,h*0.42);g.lineTo(fx,h*0.42+fl);g.lineTo(fx+w*0.09,h*0.42);g.fill()});
 const bg2=g.createLinearGradient(0,-h/2,0,h/2);bg2.addColorStop(0,PCOL[0]);bg2.addColorStop(1,PCOL[1]||PCOL[0]);
 g.shadowColor=GLOW;g.shadowBlur=boostT>0?26:16;g.fillStyle=bg2;
 g.beginPath();g.moveTo(0,-h*0.52);g.bezierCurveTo(w*0.38,-h*0.2,w*0.5,h*0.1,w*0.34,h*0.44);
 g.lineTo(w*0.12,h*0.34);g.lineTo(-w*0.12,h*0.34);g.lineTo(-w*0.34,h*0.44);
 g.bezierCurveTo(-w*0.5,h*0.1,-w*0.38,-h*0.2,0,-h*0.52);g.fill();g.shadowBlur=0;
 g.fillStyle='rgba(180,240,255,0.9)';g.beginPath();g.ellipse(0,-h*0.14,w*0.13,h*0.17,0,0,7);g.fill();
 g.fillStyle='rgba(255,255,255,0.28)';g.beginPath();g.ellipse(-w*0.04,-h*0.2,w*0.05,h*0.07,-0.5,0,7);g.fill();
 g.fillStyle=PCOL[1]||GLOW;
 g.beginPath();g.moveTo(w*0.34,h*0.05);g.lineTo(w*0.56,h*0.32);g.lineTo(w*0.32,h*0.32);g.fill();
 g.beginPath();g.moveTo(-w*0.34,h*0.05);g.lineTo(-w*0.56,h*0.32);g.lineTo(-w*0.32,h*0.32);g.fill();
 if(shieldN>0){g.strokeStyle=GLOW;g.globalAlpha=0.55+Math.sin(t*6)*0.25;g.lineWidth=2;g.shadowColor=GLOW;g.shadowBlur=14;
  g.beginPath();g.arc(0,0,w*0.85,0,7);g.stroke();g.setLineDash([6,6]);g.lineDashOffset=t*30;
  g.beginPath();g.arc(0,0,w*0.98,0,7);g.stroke();g.setLineDash([]);g.globalAlpha=1;g.shadowBlur=0}
 g.restore()}
/* ── PLAYER REPRESENTATION SYSTEM — each runtime has its own identity ── */
const REP=(S.player_representation||'').toLowerCase();
function repFor(mode){if(REP)return REP;
 if(S.runtime==='platformer')return 'platform_hero';
 if(S.runtime==='top_down')return 'explorer';
 return mode==='space_flight'?'spaceship':'hovercraft'}
function paintShieldRing(g,w,t,n){if(!(n>0))return;g.strokeStyle=GLOW;g.globalAlpha=0.55+Math.sin(t*6)*0.25;g.lineWidth=2;g.shadowColor=GLOW;g.shadowBlur=14;
 g.beginPath();g.arc(0,0,w*0.85,0,7);g.stroke();g.setLineDash([6,6]);g.lineDashOffset=t*30;
 g.beginPath();g.arc(0,0,w*0.98,0,7);g.stroke();g.setLineDash([]);g.globalAlpha=1;g.shadowBlur=0}
function paintShipP(g,x,y,w,tilt,boostT,shieldN,t){g.save();g.translate(x,y);g.rotate((tilt||0)*0.2);const L=w*1.5;
 const fl=(8+Math.abs(Math.sin(t*20))*8)*(boostT>0?2:1);
 const fg=g.createLinearGradient(-L*0.5,0,-L*0.5-fl-8,0);
 fg.addColorStop(0,boostT>0?'#FFD34D':'#F4A73B');fg.addColorStop(1,'rgba(244,167,59,0)');
 g.fillStyle=fg;g.beginPath();g.moveTo(-L*0.5,-w*0.12);g.lineTo(-L*0.5-fl,0);g.lineTo(-L*0.5,w*0.12);g.fill();
 const hg=g.createLinearGradient(0,-w*0.4,0,w*0.4);hg.addColorStop(0,PCOL[0]);hg.addColorStop(1,PCOL[1]||PCOL[0]);
 g.shadowColor=GLOW;g.shadowBlur=boostT>0?24:14;g.fillStyle=hg;
 g.beginPath();g.moveTo(L*0.55,0);g.bezierCurveTo(L*0.2,-w*0.32,-L*0.3,-w*0.3,-L*0.5,-w*0.16);
 g.lineTo(-L*0.5,w*0.16);g.bezierCurveTo(-L*0.3,w*0.3,L*0.2,w*0.32,L*0.55,0);g.fill();g.shadowBlur=0;
 g.fillStyle=PCOL[1]||GLOW;
 g.beginPath();g.moveTo(-L*0.05,-w*0.22);g.lineTo(-L*0.42,-w*0.62);g.lineTo(-L*0.45,-w*0.2);g.fill();
 g.beginPath();g.moveTo(-L*0.05,w*0.22);g.lineTo(-L*0.42,w*0.62);g.lineTo(-L*0.45,w*0.2);g.fill();
 g.fillStyle='rgba(180,240,255,0.9)';g.beginPath();g.ellipse(L*0.18,0,w*0.16,w*0.11,0,0,7);g.fill();
 paintShieldRing(g,w,t,shieldN);g.restore()}
function paintOrbP(g,x,y,w,tilt,boostT,shieldN,t){g.save();g.translate(x,y);const r=w*0.55;
 const rg=g.createRadialGradient(-r*0.3,-r*0.3,0,0,0,r);rg.addColorStop(0,'#fff');rg.addColorStop(0.4,PCOL[0]);rg.addColorStop(1,PCOL[1]||PCOL[0]);
 g.shadowColor=GLOW;g.shadowBlur=boostT>0?24:14;g.fillStyle=rg;g.beginPath();g.arc(0,0,r,0,7);g.fill();g.shadowBlur=0;
 g.strokeStyle='rgba(255,255,255,0.5)';g.lineWidth=2;g.save();g.rotate(t*4+(tilt||0));
 g.beginPath();g.ellipse(0,0,r*0.95,r*0.35,0,0,7);g.stroke();g.restore();
 paintShieldRing(g,w,t,shieldN);g.restore()}
function paintBikeP(g,x,y,w,tilt,boostT,shieldN,t){g.save();g.translate(x,y);g.rotate((tilt||0)*0.4);const h=w*1.3;
 const fl=(6+Math.abs(Math.sin(t*24))*6)*(boostT>0?2.2:1);
 const fg=g.createLinearGradient(0,h*0.4,0,h*0.4+fl+6);fg.addColorStop(0,boostT>0?'#FFD34D':'#F4A73B');fg.addColorStop(1,'rgba(244,167,59,0)');
 g.fillStyle=fg;g.beginPath();g.moveTo(-w*0.1,h*0.4);g.lineTo(0,h*0.4+fl);g.lineTo(w*0.1,h*0.4);g.fill();
 g.shadowColor=GLOW;g.shadowBlur=12;g.fillStyle=PCOL[1]||GLOW;
 g.beginPath();g.moveTo(0,-h*0.5);g.lineTo(w*0.18,h*0.1);g.lineTo(w*0.14,h*0.42);g.lineTo(-w*0.14,h*0.42);g.lineTo(-w*0.18,h*0.1);g.fill();g.shadowBlur=0;
 g.fillStyle=PCOL[0];g.beginPath();g.ellipse(0,-h*0.05,w*0.16,h*0.2,0,0,7);g.fill();
 g.fillStyle='rgba(180,240,255,0.95)';g.beginPath();g.arc(0,-h*0.28,w*0.11,0,7);g.fill();
 g.strokeStyle=PCOL[0];g.lineWidth=2.5;g.beginPath();g.moveTo(-w*0.3,-h*0.32);g.lineTo(w*0.3,-h*0.32);g.stroke();
 paintShieldRing(g,w,t,shieldN);g.restore()}
function paintRunnerP(g,x,y,w,tilt,boostT,shieldN,t){g.save();g.translate(x,y);g.rotate((tilt||0)*0.2);const h=w*1.5,rp=t*11;
 g.strokeStyle=PCOL[1]||GLOW;g.lineWidth=3;g.lineCap='round';
 g.beginPath();g.moveTo(-w*0.09,h*0.08);g.lineTo(-w*0.09+Math.sin(rp)*w*0.1,h*0.45);g.stroke();
 g.beginPath();g.moveTo(w*0.09,h*0.08);g.lineTo(w*0.09-Math.sin(rp)*w*0.1,h*0.45);g.stroke();
 g.shadowColor=GLOW;g.shadowBlur=10;g.fillStyle=PCOL[0];
 g.beginPath();g.moveTo(-w*0.2,-h*0.28);g.lineTo(w*0.2,-h*0.28);g.lineTo(w*0.14,h*0.12);g.lineTo(-w*0.14,h*0.12);g.fill();g.shadowBlur=0;
 g.beginPath();g.moveTo(-w*0.2,-h*0.22);g.lineTo(-w*0.3,-h*0.22+Math.sin(rp)*w*0.14);g.stroke();
 g.beginPath();g.moveTo(w*0.2,-h*0.22);g.lineTo(w*0.3,-h*0.22-Math.sin(rp)*w*0.14);g.stroke();
 g.fillStyle='rgba(180,240,255,0.95)';g.beginPath();g.arc(0,-h*0.4,w*0.13,0,7);g.fill();
 paintShieldRing(g,w,t,shieldN);g.restore()}
function paintAvatar(g,x,y,w,tilt,boostT,shieldN,t,mode){const rp=repFor(mode);
 if(rp==='spaceship')paintShipP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='rolling_orb')paintOrbP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='hover_bike')paintBikeP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='runner')paintRunnerP(g,x,y,w,tilt,boostT,shieldN,t);
 else paintPlayer(g,x,y,w,tilt,boostT,shieldN,t)}
function paintHeroSide(g,x,y,w,h,face,wph,grounded,rep,inv,t){g.save();g.translate(x+w/2,y+h);if(face<0)g.scale(-1,1);
 const cA=inv>0?ACC:PCOL[0],cB=PCOL[1]||GLOW;const lg2=grounded?Math.sin(wph)*w*0.3:w*0.18;
 g.strokeStyle=cB;g.lineWidth=3;g.lineCap='round';
 g.beginPath();g.moveTo(0,-h*0.42);g.lineTo(lg2,0);g.stroke();
 g.beginPath();g.moveTo(0,-h*0.42);g.lineTo(-lg2,0);g.stroke();
 g.shadowColor=GLOW;g.shadowBlur=10;g.fillStyle=cA;g.fillRect(-w*0.26,-h*0.8,w*0.52,h*0.42);g.shadowBlur=0;
 g.beginPath();g.moveTo(0,-h*0.72);g.lineTo(w*0.36,-h*0.5+(grounded?Math.sin(wph+3.14)*4:2));g.stroke();
 g.fillStyle='#F5D7B8';g.beginPath();g.arc(0,-h*0.94,w*0.24,0,7);g.fill();
 if(rep==='knight'){g.fillStyle=cB;g.beginPath();g.arc(0,-h*0.94,w*0.27,3.3,6.2);g.fill();
  g.fillStyle=cA;g.shadowColor=GLOW;g.shadowBlur=8;g.beginPath();g.arc(w*0.34,-h*0.5,w*0.24,0,7);g.fill();g.shadowBlur=0}
 else if(rep==='robot'){g.fillStyle=cB;g.fillRect(-w*0.24,-h*1.14,w*0.48,w*0.46);
  g.fillStyle='#0b1220';g.fillRect(-w*0.15,-h*1.05,w*0.12,w*0.12);g.fillRect(w*0.03,-h*1.05,w*0.12,w*0.12);
  g.strokeStyle=cB;g.beginPath();g.moveTo(0,-h*1.14);g.lineTo(0,-h*1.26);g.stroke();
  g.fillStyle=ACC;g.beginPath();g.arc(0,-h*1.28,2.4,0,7);g.fill()}
 else if(rep==='wizard'){g.fillStyle=cB;g.beginPath();g.moveTo(-w*0.32,-h*1.04);g.lineTo(w*0.32,-h*1.04);g.lineTo(w*0.02,-h*1.46);g.fill();
  g.strokeStyle=ACC;g.beginPath();g.moveTo(w*0.42,-h*0.9);g.lineTo(w*0.42,0);g.stroke();
  g.fillStyle=ACC;g.shadowColor=ACC;g.shadowBlur=10;g.beginPath();g.arc(w*0.42,-h*0.93,3,0,7);g.fill();g.shadowBlur=0}
 else if(rep==='explorer'){g.fillStyle=cB;g.fillRect(-w*0.3,-h*1.1,w*0.6,w*0.18);
  g.fillRect(-w*0.44,-h*0.76,w*0.16,h*0.3)}
 else{g.fillStyle=cB;g.fillRect(-w*0.25,-h*1.08,w*0.5,w*0.14)}
 g.restore()}
function paintHeroTop(g,x,y,r,ang,rep,inv,t){g.save();g.translate(x,y);g.rotate(ang);
 const cA=inv>0?ACC:PCOL[0],cB=PCOL[1]||GLOW;
 if(rep==='stealth_operative'){g.fillStyle='rgba(46,230,255,0.06)';g.beginPath();g.moveTo(0,0);g.arc(0,0,r*4,-0.55,0.55);g.closePath();g.fill()}
 g.shadowColor=GLOW;g.shadowBlur=12;
 if(rep==='robot'){g.fillStyle=cA;g.fillRect(-r*0.85,-r*0.85,r*1.7,r*1.7);g.shadowBlur=0;
  g.fillStyle=cB;g.fillRect(r*0.2,-r*0.4,r*0.65,r*0.8);
  g.fillStyle=ACC;g.beginPath();g.arc(-r*0.3,0,r*0.18,0,7);g.fill()}
 else if(rep==='rolling_orb'){g.fillStyle=cA;g.beginPath();g.arc(0,0,r,0,7);g.fill();g.shadowBlur=0;
  g.strokeStyle='rgba(255,255,255,0.5)';g.lineWidth=2;g.save();g.rotate(t*4);g.beginPath();g.ellipse(0,0,r*0.9,r*0.35,0,0,7);g.stroke();g.restore()}
 else{const walk=Math.sin(t*8)*r*0.15;
  g.fillStyle=cA;g.beginPath();g.ellipse(0,0,r,r*0.82,0,0,7);g.fill();g.shadowBlur=0;
  g.fillStyle=cB;g.beginPath();g.arc(r*0.55,-r*0.6+walk,r*0.28,0,7);g.fill();
  g.beginPath();g.arc(r*0.55,r*0.6-walk,r*0.28,0,7);g.fill();
  g.fillStyle=rep==='stealth_operative'?'#0d1526':cB;g.beginPath();g.arc(0,0,r*0.55,0,7);g.fill();
  if(rep==='stealth_operative'){g.fillStyle=GLOW;g.shadowColor=GLOW;g.shadowBlur=8;g.fillRect(r*0.12,-r*0.26,r*0.36,r*0.52);g.shadowBlur=0}
  else if(rep==='knight'){g.fillStyle='rgba(235,240,255,0.85)';g.beginPath();g.arc(r*0.95,0,r*0.5,-1.25,1.25);g.fill()}
  else if(rep==='wizard'){g.fillStyle=cB;g.beginPath();g.arc(0,0,r*0.66,0,7);g.fill();
   g.fillStyle=ACC;g.shadowColor=ACC;g.shadowBlur=8;g.beginPath();g.arc(0,0,r*0.2,0,7);g.fill();g.shadowBlur=0}}
 g.restore()}
function paintCore(g,x,y,r,t){g.save();g.translate(x,y);
 const pr=r*(1+Math.sin(t*5+x)*0.12);
 const rg=g.createRadialGradient(0,0,0,0,0,pr*1.6);
 rg.addColorStop(0,'#ffffff');rg.addColorStop(0.35,GLOW);rg.addColorStop(1,'rgba(46,230,255,0)');
 g.fillStyle=rg;g.beginPath();g.arc(0,0,pr*1.6,0,7);g.fill();
 g.strokeStyle=GLOW;g.lineWidth=1.5;g.globalAlpha=0.8;g.rotate(t*2);
 g.beginPath();g.ellipse(0,0,pr*1.35,pr*0.5,0,0,7);g.stroke();g.globalAlpha=1;g.restore()}
function paintHazard(g,x,y,r,kind,t,px){g.save();g.translate(x,y);g.shadowColor=HAZC;g.shadowBlur=12;
 if(kind==='barrier'){const w2=r*3.2;
  const bg2=g.createLinearGradient(-w2,0,w2,0);bg2.addColorStop(0,'rgba(255,61,90,0)');bg2.addColorStop(0.5,HAZC);bg2.addColorStop(1,'rgba(255,61,90,0)');
  g.fillStyle=bg2;g.globalAlpha=0.75+Math.sin(t*17)*0.2;g.fillRect(-w2,-r*0.35,w2*2,r*0.7);g.globalAlpha=1;
  g.fillStyle='#FF8A9E';g.fillRect(-w2-3,-r*0.5,6,r);g.fillRect(w2-3,-r*0.5,6,r)}
 else if(kind==='seeker'){const a=Math.atan2(0,(px||0)-x)||1.57;g.rotate(t*0+1.57);
  g.fillStyle=HAZC;g.beginPath();g.moveTo(0,-r*1.4);g.lineTo(r*0.8,r);g.lineTo(0,r*0.5);g.lineTo(-r*0.8,r);g.fill();
  g.fillStyle='#FFD0D8';g.beginPath();g.arc(0,-r*0.4,r*0.22,0,7);g.fill()}
 else if(kind==='mine'){g.fillStyle='#611';g.beginPath();g.arc(0,0,r*0.8,0,7);g.fill();
  g.strokeStyle=HAZC;g.lineWidth=2;for(let i=0;i<6;i++){const a=i*1.047+t;
   g.beginPath();g.moveTo(Math.cos(a)*r*0.8,Math.sin(a)*r*0.8);g.lineTo(Math.cos(a)*r*1.3,Math.sin(a)*r*1.3);g.stroke()}
  g.fillStyle=Math.sin(t*10)>0?'#FF6B6B':'#802';g.beginPath();g.arc(0,0,r*0.3,0,7);g.fill()}
 else{g.fillStyle='#30122a';g.beginPath();g.arc(0,0,r*0.85,0,7);g.fill();
  g.strokeStyle=HAZC;g.lineWidth=2.5;for(let i=0;i<3;i++){g.save();g.rotate(t*9+i*2.094);
   g.beginPath();g.moveTo(0,0);g.lineTo(r*1.35,0);g.stroke();g.restore()}
  g.fillStyle=HAZC;g.beginPath();g.arc(0,0,r*0.32,0,7);g.fill();
  g.fillStyle='#fff';g.beginPath();g.arc(r*0.08,-r*0.08,r*0.1,0,7);g.fill()}
 g.shadowBlur=0;g.restore()}
function paintShieldPickup(g,x,y,r,t){g.save();g.translate(x,y);g.rotate(Math.sin(t*3)*0.2);
 g.shadowColor=GLOW;g.shadowBlur=14;g.strokeStyle=GLOW;g.fillStyle='rgba(46,230,255,0.16)';g.lineWidth=2;
 g.beginPath();for(let i=0;i<6;i++){const a=i*1.047-0.52;const px2=Math.cos(a)*r*1.15,py2=Math.sin(a)*r*1.15;
  i?g.lineTo(px2,py2):g.moveTo(px2,py2)}g.closePath();g.fill();g.stroke();
 g.beginPath();g.moveTo(0,-r*0.55);g.lineTo(r*0.45,-r*0.2);g.lineTo(r*0.45,r*0.15);g.bezierCurveTo(r*0.45,r*0.5,0,r*0.62,0,r*0.62);
 g.bezierCurveTo(0,r*0.62,-r*0.45,r*0.5,-r*0.45,r*0.15);g.lineTo(-r*0.45,-r*0.2);g.closePath();g.stroke();g.shadowBlur=0;g.restore()}
function paintBoostPickup(g,x,y,r,t){g.save();g.translate(x,y);
 g.shadowColor='#FFD34D';g.shadowBlur=14;g.fillStyle='#FFD34D';
 const o=Math.sin(t*6)*2;
 [[-r*0.35+o*0,0],[r*0.05,0]].forEach((p,i)=>{g.save();g.translate(p[0],0);
  g.beginPath();g.moveTo(-r*0.3,-r*0.7);g.lineTo(r*0.45,0);g.lineTo(-r*0.3,r*0.7);g.lineTo(-r*0.05,0);g.closePath();g.fill();g.restore()});
 g.shadowBlur=0;g.restore()}
function paintPortal(g,x,y,r,t){g.save();g.translate(x,y);
 const rg=g.createRadialGradient(0,0,0,0,0,r);
 rg.addColorStop(0,'rgba(255,255,255,0.85)');rg.addColorStop(0.4,'#C26BFF');rg.addColorStop(1,'rgba(194,107,255,0)');
 g.fillStyle=rg;g.beginPath();g.arc(0,0,r,0,7);g.fill();
 g.shadowColor='#C26BFF';g.shadowBlur=20;g.lineWidth=3;
 [[1,'#C26BFF'],[-1.6,GLOW],[2.3,'#C26BFF']].forEach((s,i)=>{g.strokeStyle=s[1];g.save();g.rotate(t*s[0]);
  g.beginPath();g.arc(0,0,r*(1.05+i*0.22),i,i+4.2);g.stroke();g.restore()});
 for(let i=0;i<5;i++){const a=t*2+i*1.256;g.fillStyle=i%2?GLOW:'#C26BFF';
  g.beginPath();g.arc(Math.cos(a)*r*1.5,Math.sin(a)*r*1.5,2.5,0,7);g.fill()}
 g.shadowBlur=0;g.restore()}

/* ── ENVIRONMENT BACKGROUNDS (layered parallax) ─────────────────────── */
function skyGrad(g,W,H,c1,c2){const sg=g.createLinearGradient(0,0,0,H);sg.addColorStop(0,c1);sg.addColorStop(1,c2);g.fillStyle=sg;g.fillRect(0,0,W,H)}
function cityLayer(g,W,H,base,seed,colw,color,winCol,off){g.fillStyle=color;
 const n=Math.ceil(W/colw)+2,shift=off%colw;
 for(let i=0;i<n;i++){const bh=(0.25+hz(seed+i)*0.55)*base;const bx=i*colw-shift;
  g.fillRect(bx,H-bh,colw-4,bh);
  if(winCol){g.fillStyle=winCol;for(let wy=H-bh+8;wy<H-10;wy+=14)for(let wx=bx+5;wx<bx+colw-10;wx+=12)
   if(hz(seed*3+wx*wy)>0.55)g.fillRect(wx,wy,4,6);g.fillStyle=color}}}
const BG={
 cyber_city(g,W,H,t,sp){skyGrad(g,W,H,'#0a0f2e','#05060f');
  g.fillStyle='rgba(194,107,255,0.12)';g.beginPath();g.arc(W*0.72,H*0.22,60,0,7);g.fill();
  cityLayer(g,W,H*0.78,H*0.5,7,54,'#0a1030',null,t*sp*6);
  cityLayer(g,W,H*0.85,H*0.42,13,40,'#101a44','rgba(46,230,255,0.5)',t*sp*16)},
 space(g,W,H,t,sp){skyGrad(g,W,H,'#040414','#0a0524');
  const ng=g.createRadialGradient(W*0.3,H*0.3,0,W*0.3,H*0.3,H*0.6);
  ng.addColorStop(0,'rgba(194,107,255,0.14)');ng.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=ng;g.fillRect(0,0,W,H);
  for(let i=0;i<70;i++){const d=1+(i%3);const sx=(hz(i)*W+t*sp*d*8)%W,sy=hz(i*2)*H;
   g.globalAlpha=0.25*d;g.fillStyle=i%7?'#fff':GLOW;g.fillRect(W-sx,sy,d,d)}g.globalAlpha=1},
 sunset(g,W,H,t,sp){skyGrad(g,W,H,'#3d1140','#0d0618');
  const sg2=g.createRadialGradient(W/2,H*0.42,0,W/2,H*0.42,90);
  sg2.addColorStop(0,'#FF8A5A');sg2.addColorStop(1,'rgba(255,138,90,0)');g.fillStyle=sg2;
  g.beginPath();g.arc(W/2,H*0.42,90,0,7);g.fill();
  g.fillStyle='#1a0a2e';g.beginPath();g.moveTo(0,H*0.6);
  for(let x=0;x<=W;x+=40)g.lineTo(x,H*0.6-hz(x+31)*H*0.14);g.lineTo(W,H);g.lineTo(0,H);g.fill()},
 crystal(g,W,H,t,sp){skyGrad(g,W,H,'#07222e','#03101a');
  for(let i=0;i<8;i++){const cx2=(hz(i*5)*W+t*sp*10)%W,ch=H*(0.2+hz(i)*0.3);
   g.fillStyle='rgba(120,220,255,0.08)';g.beginPath();
   g.moveTo(W-cx2,H);g.lineTo(W-cx2+22,H-ch);g.lineTo(W-cx2+44,H);g.fill()}},
 lava(g,W,H,t,sp){skyGrad(g,W,H,'#2a0800','#12030a');
  g.fillStyle='rgba(255,90,40,0.14)';g.beginPath();g.moveTo(0,H*0.75);
  for(let x=0;x<=W;x+=30)g.lineTo(x,H*0.75+Math.sin(x*0.04+t*2)*8);g.lineTo(W,H);g.lineTo(0,H);g.fill();
  for(let i=0;i<10;i++){const ex=hz(i*9)*W,ey=H*0.8-((t*30+i*60)%(H*0.5));
   g.globalAlpha=0.5;g.fillStyle='#FF8A5A';g.fillRect(ex,ey,3,3)}g.globalAlpha=1},
 tunnel(g,W,H,t,sp){skyGrad(g,W,H,'#060a18','#02040c');
  for(let i=0;i<7;i++){const r=((t*sp*70+i*90)%(Math.max(W,H)));
   g.strokeStyle=GLOW;g.globalAlpha=Math.max(0,0.35-r/(Math.max(W,H)*2.6));g.lineWidth=2;
   g.beginPath();g.arc(W/2,H*0.42,r,0,7);g.stroke()}g.globalAlpha=1},
 grid(g,W,H,t,sp){skyGrad(g,W,H,'#0b1220','#060a14');
  g.strokeStyle='rgba(46,230,255,0.12)';g.lineWidth=1;
  const off=(t*sp*40)%40;
  for(let y=off;y<H;y+=40){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke()}
  for(let x=0;x<W;x+=40){g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke()}}};
function drawEnv(g,W,H,env,t,sp){(BG[env]||BG.grid)(g,W,H,t,sp)}

/* ── DODGE & COLLECT — 6 presentation modes ─────────────────────────── */
function dc(st){const c=mkCanvas(0),g=c.getContext('2d');
 const W=c.width,H=c.height;
 const mode=st.mode||S.mode||'vertical';
 const env=st.environment||V.environment||'grid';
 const lanes=Math.max(2,Math.min(5,st.lanes||3));
 const target=st.target_cores||8,fall=(st.fall_speed||140)*(1+stageIdx*0.1),
  spawnMs=Math.max(240,(st.spawn_ms||700)-stageIdx*50),ratio=(st.core_ratio!==undefined?st.core_ratio:0.6);
 const hazKinds=(st.hazard_types&&st.hazard_types.length?st.hazard_types:['drone']);
 const pick=st.pickups||{};const formation=st.formation||'random';
 const pw=Math.max(30,W*0.075);
 let P={x:W/2,y:H-56,rx:0,lane:Math.floor(lanes/2),tilt:0};
 let items=[],got=0,inv=0,shield=0,boostT=0,over=false,wave=0,spawnAcc=0;
 let portal=null,banner=1.8,last=performance.now(),t0=last,laneCd=0;
 const hor=H*0.32,cx=W/2;
 const road=mode==='road_3d'||mode==='tunnel';
 function halfW(z){return W*0.46*(0.12+0.88*(1-z))}
 function py2(z){const e=1-z;return hor+(H-70-hor)*e*e}
 function formX(){wave++;
  if(formation==='zigzag')return 0.7*Math.sin(wave*0.7);
  if(formation==='line')return -0.7+((wave%4)/3)*1.4;
  if(formation==='arc')return 0.7*Math.cos(wave*0.45);
  return (Math.random()*2-1)*0.8}
 function spawnOne(){const r=Math.random();let kind='core';
  if(r>=ratio){const pr=Math.random();
   if(pick.shield&&pr<pick.shield*3)kind='shield';
   else if(pick.boost&&pr<(pick.shield?pick.shield*3:0)+pick.boost*3)kind='boost';
   else kind=hazKinds[Math.floor(Math.random()*hazKinds.length)]}
  const it={kind,r:kind==='barrier'?12:11,z:1,y:-18,lane:Math.floor(Math.random()*lanes),rx:formX(),
   x:20+Math.random()*(W-40),vx:0,seed:Math.random()*9};
  if(mode==='space_flight'){it.x=W+24;it.y=24+Math.random()*(H-48)}
  if(mode==='arena_360'){const a=Math.random()*6.28;it.x=cx+Math.cos(a)*(W/2+20);it.y=H/2+Math.sin(a)*(H/2+20);
   const m=Math.hypot(cx-it.x,H/2-it.y);it.vx=(cx-it.x)/m;it.vy=(H/2-it.y)/m}
  if(kind==='core'&&(mode==='vertical'||mode==='lane_runner'))it.x=cx+it.rx*W*0.42;
  items.push(it)}
 function playerPos(){
  if(mode==='lane_runner'){const lw=W/(lanes+1);return{x:lw*(P.lane+1),y:H-56}}
  if(road){return{x:cx+P.rx*halfW(0)*0.82,y:H-64}}
  return{x:P.x,y:P.y}}
 function hit(){if(shield>0){shield--;burst(playerPos().x,playerPos().y,GLOW,16,120);popup(playerPos().x,playerPos().y-30,'SHIELD!',GLOW);comboBreak();return}
  comboBreak();lives--;inv=1.3;shake=9;vib(60);burst(playerPos().x,playerPos().y,HAZC,22,150);refreshHud();
  if(lives<=0){over=true;setTimeout(gameOver,400)}}
 function collect(it,x,y){const p=addScore();got++;burst(x,y,GLOW,14,110);popup(x,y-16,'+'+p+(comboMult>1?' x'+comboMult.toFixed(1):''),GLOW);refreshHud()}
 function frame(now){if(over)return;if(PAUSED){last=now;g.fillStyle='rgba(4,8,20,0.5)';g.fillRect(0,0,W,H);g.fillStyle=GLOW;g.font='bold 22px system-ui';g.textAlign='center';g.fillText('PAUSED — press P',W/2,H*0.45);g.textAlign='left';return requestAnimationFrame(frame)}
  const dt=Math.min(0.05,(now-last)/1000);last=now;const t=(now-t0)/1000;
  const spd=(boostT>0?1.45:1);if(boostT>0)boostT-=dt;if(inv>0)inv-=dt;if(laneCd>0)laneCd-=dt;
  // ── movement ──
  if(mode==='lane_runner'){
   if(laneCd<=0){if(act('left')){P.lane=Math.max(0,P.lane-1);laneCd=0.16;clr('left')}
    if(act('right')){P.lane=Math.min(lanes-1,P.lane+1);laneCd=0.16;clr('right')}
    if(ptr.active){P.lane=Math.max(0,Math.min(lanes-1,Math.floor(ptr.x/(W/lanes))));laneCd=0.12}}}
  else if(road){let dx=0;if(act('left'))dx-=1;if(act('right'))dx+=1;
   if(ptr.active)dx=(ptr.x-playerPos().x)/60;
   P.rx=Math.max(-1,Math.min(1,P.rx+dx*2.4*SENS*dt));P.tilt=dx*0.5}
  else if(mode==='space_flight'||mode==='arena_360'){let dx=0,dy=0;
   if(act('left'))dx-=1;if(act('right'))dx+=1;
   if(act('up'))dy-=1;if(act('down'))dy+=1;
   if(ptr.active){const vx=ptr.x-P.x,vy=ptr.y-P.y,m=Math.hypot(vx,vy);if(m>8){dx=vx/m;dy=vy/m}}
   P.x=Math.max(pw/2,Math.min(W-pw/2,P.x+dx*300*SENS*dt));P.y=Math.max(30,Math.min(H-30,P.y+dy*300*SENS*dt));P.tilt=dx*0.4}
  else{if(act('left'))P.x-=310*SENS*dt;if(act('right'))P.x+=310*SENS*dt;
   if(ptr.active)P.x+=(ptr.x-P.x)*Math.min(1,12*dt);
   P.tilt=(ptr.active?(ptr.x-P.x)/120:(act('left')?-0.5:act('right')?0.5:0));
   P.x=Math.max(pw/2,Math.min(W-pw/2,P.x))}
  // ── spawn + advance ──
  spawnAcc+=dt*1000*spd;while(spawnAcc>spawnMs&&!portal){spawnAcc-=spawnMs;spawnOne()}
  const pp=playerPos();
  items.forEach(it=>{
   if(road){it.z-=dt*(fall/620)*spd;if(mode==='tunnel')it.rx+=Math.sin(t*2+it.seed)*dt*0.5}
   else if(mode==='space_flight')it.x-=fall*dt*spd*1.1;
   else if(mode==='arena_360'){it.x+=it.vx*fall*dt*spd*0.8;it.y+=it.vy*fall*dt*spd*0.8}
   else it.y+=fall*dt*spd*(it.kind==='core'?1:1.18);
   if(it.kind==='seeker'){const sx=road?0:(pp.x-it.x);it.x+=(sx>0?1:-1)*Math.min(Math.abs(sx),46)*dt;
    if(road)it.rx+=Math.max(-0.4,Math.min(0.4,(P.rx-it.rx)))*dt*1.2}});
  items=items.filter(it=>{
   let ix,iy,ir=it.r;
   if(road){if(it.z<=-0.02)return false;ix=cx+it.rx*halfW(it.z)*0.82;iy=py2(it.z);ir=it.r*(0.2+1.5*(1-it.z))}
   else if(mode==='lane_runner'){ix=(W/(lanes+1))*(it.lane+1);iy=it.y;if(iy>H+24)return false}
   else{ix=it.x;iy=it.y;if(iy>H+26||ix<-30||(mode==='space_flight'&&ix<-24))return false;
    if(mode==='arena_360'&&Math.hypot(ix-cx,iy-H/2)>Math.max(W,H))return false}
   const hitDist=(it.kind==='barrier'?ir*2.6:ir)+pw*0.42;
   const near=road?(it.z<0.1&&Math.abs(ix-pp.x)<hitDist):(Math.hypot(ix-pp.x,iy-pp.y)<hitDist);
   if(near){if(it.kind==='core'){collect(it,ix,iy)}
    else if(it.kind==='shield'){shield=Math.min(2,shield+1);sfx('shield');burst(ix,iy,GLOW,12,100);popup(ix,iy-16,'SHIELD +1',GLOW)}
    else if(it.kind==='boost'){boostT=4;sfx('boost');burst(ix,iy,'#FFD34D',14,120);popup(ix,iy-16,'BOOST!','#FFD34D')}
    else if(inv<=0)hit();
    return false}
   return true});
  if(got>=target&&!portal){portal=road?{z:1}:{x:cx,y:mode==='space_flight'?H/2:-40};sfx('portal')}
  if(portal){if(road){portal.z-=dt*(fall/700);if(portal.z<0.09&&Math.abs(cx+0*halfW(0)-pp.x)<halfW(0)){over=true}}
   else{if(mode==='space_flight'){portal.x=(portal.x===cx?W+60:portal.x);portal.x-=fall*dt*0.9}
    else portal.y+=fall*dt*0.8;
    if(Math.hypot(portal.x-pp.x,portal.y-pp.y)<40)over=true}
   if(over){burst(pp.x,pp.y,'#C26BFF',30,180);sfx('stage');
    setTimeout(()=>fb(true,(st.title||'Stage')+' cleared!'+unlockMsg(),next),350);return requestAnimationFrame(paintOnly)}}
  // ── draw ──
  g.save();if(shake>0.4&&!CTRL.reduced_motion){g.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);shake*=0.86}
  drawEnv(g,W,H,env,t,spd*(fall/140));
  if(road){g.fillStyle='rgba(10,16,40,0.85)';g.beginPath();
   g.moveTo(cx-halfW(1),hor);g.lineTo(cx+halfW(1),hor);g.lineTo(cx+halfW(0),H);g.lineTo(cx-halfW(0),H);g.fill();
   g.strokeStyle=PAL.lane||GLOW;g.shadowColor=GLOW;g.shadowBlur=8;g.lineWidth=2.5;
   [[-1],[1]].forEach(s=>{g.beginPath();g.moveTo(cx+s[0]*halfW(1),hor);g.lineTo(cx+s[0]*halfW(0),H);g.stroke()});
   g.shadowBlur=0;g.lineWidth=1.5;g.globalAlpha=0.7;
   for(let li=1;li<lanes;li++){const lx=-1+2*li/lanes;
    for(let d=0;d<8;d++){const z1=((t*spd*0.5+d/8)%1),z2=Math.max(0,z1-0.05);
     g.strokeStyle='rgba(46,230,255,0.5)';g.beginPath();
     g.moveTo(cx+lx*halfW(z1)*0.82,py2(z1));g.lineTo(cx+lx*halfW(z2)*0.82,py2(z2));g.stroke()}}
   g.globalAlpha=1}
  if(mode==='lane_runner'){const lw=W/(lanes+1);
   g.strokeStyle='rgba(46,230,255,0.22)';g.lineWidth=1.5;g.setLineDash([10,14]);g.lineDashOffset=-t*120;
   for(let li=0;li<lanes;li++){g.beginPath();g.moveTo(lw*(li+1),0);g.lineTo(lw*(li+1),H);g.stroke()}
   g.setLineDash([])}
  items.forEach(it=>{let ix,iy,ir=it.r;
   if(road){ix=cx+it.rx*halfW(it.z)*0.82;iy=py2(it.z);ir=Math.max(2,it.r*(0.2+1.5*(1-it.z)))}
   else if(mode==='lane_runner'){ix=(W/(lanes+1))*(it.lane+1);iy=it.y}
   else{ix=it.x;iy=it.y}
   if(it.kind==='core')paintCore(g,ix,iy,ir*0.8,t);
   else if(it.kind==='shield')paintShieldPickup(g,ix,iy,ir,t);
   else if(it.kind==='boost')paintBoostPickup(g,ix,iy,ir,t);
   else paintHazard(g,ix,iy,ir,it.kind,t,pp.x)});
  if(portal){if(road)paintPortal(g,cx,py2(Math.max(0,portal.z)),26*(1.6-portal.z),t);
   else paintPortal(g,portal.x,portal.y,30,t)}
  if(boostT>0){for(let i=0;i<2;i++)parts.push({x:pp.x+(Math.random()-0.5)*pw*0.5,y:pp.y+pw*0.6,vx:0,vy:120,life:0.4,color:'#FFD34D',r:2})}
  paintAvatar(g,pp.x,pp.y,pw,P.tilt,boostT,shield,t,mode);
  drawFx(g,dt);
  // canvas HUD
  g.fillStyle='rgba(4,8,20,0.55)';g.fillRect(0,0,W,26);
  paintCore(g,14,13,5,t);g.fillStyle=T.text;g.font='bold 12px system-ui';
  g.fillText(got+'/'+target,26,17);
  if(shield>0){paintShieldPickup(g,W*0.42,13,7,t);g.fillText('x'+shield,W*0.42+12,17)}
  if(boostT>0){g.fillStyle='#FFD34D';g.fillRect(W*0.56,9,60*(boostT/4),8);g.strokeStyle='#FFD34D';g.strokeRect(W*0.56,9,60,8)}
  g.fillStyle='rgba(234,242,255,0.6)';g.font='10px system-ui';
  g.fillText((st.environment||env).replace(/_/g,' ').toUpperCase()+' · '+mode.replace(/_/g,' ').toUpperCase(),W-170,17);
  if(banner>0){banner-=dt;g.globalAlpha=Math.min(1,banner);
   g.fillStyle='rgba(4,8,20,0.6)';g.fillRect(0,H*0.36,W,60);
   g.fillStyle=GLOW;g.font='bold 20px system-ui';g.textAlign='center';g.shadowColor=GLOW;g.shadowBlur=16;
   g.fillText('STAGE '+(stageIdx+1)+' — '+(st.title||''),W/2,H*0.42+14);
   g.shadowBlur=0;g.font='11px system-ui';g.fillStyle=T.text;
   g.fillText((env).replace(/_/g,' ').toUpperCase(),W/2,H*0.42+32);g.textAlign='left';g.globalAlpha=1}
  g.restore();
  requestAnimationFrame(frame)}
 function paintOnly(){}
 requestAnimationFrame(frame)}

/* ── TOP-DOWN MOVEMENT (themed env + portal + particles) ────────────── */
function td(st){const c=mkCanvas(0),g=c.getContext('2d');
 const env=st.environment||V.environment||'grid';
 const speed=(st.player_speed||180)*(1+stageIdx*0.06);
 const P={x:30,y:c.height/2,r:11};let cp={x:P.x,y:P.y};let head=0;
 const obs=[];const nOb=st.obstacles!==undefined?st.obstacles:3;
 for(let i=0;i<nOb;i++){obs.push({x:60+Math.random()*(c.width-160),y:30+Math.random()*(c.height-100),w:24+Math.random()*70,h:16+Math.random()*60})}
 function freeSpot(){for(let t=0;t<40;t++){const x=30+Math.random()*(c.width-60),y=30+Math.random()*(c.height-60);
  if(!obs.some(o=>x>o.x-16&&x<o.x+o.w+16&&y>o.y-16&&y<o.y+o.h+16)&&Math.hypot(x-P.x,y-P.y)>60)return{x,y}}return{x:c.width-40,y:40}}
 let cores=[];const nC=st.cores||6;for(let i=0;i<nC;i++)cores.push(freeSpot());
 const hzs=(st.hazards&&st.hazards.length?st.hazards:[{type:'patrol'},{type:'chaser'}]).map(h=>{
  const s=freeSpot();return{x:s.x,y:s.y,vx:(Math.random()<.5?-1:1),vy:(Math.random()<.5?-1:1),
  type:h.type==='chaser'?'chaser':'patrol',sp:(h.speed||(h.type==='chaser'?80:120))*(1+stageIdx*0.1)}});
 let portal=null,inv=0,over=false,last=performance.now(),t0=last;
 function hitObs(x,y,r){return obs.some(o=>x>o.x-r&&x<o.x+o.w+r&&y>o.y-r&&y<o.y+o.h+r)}
 function frame(now){if(over)return;if(PAUSED){last=now;g.fillStyle='rgba(4,8,20,0.5)';g.fillRect(0,0,c.width,c.height);g.fillStyle=GLOW;g.font='bold 22px system-ui';g.textAlign='center';g.fillText('PAUSED — press P',c.width/2,c.height*0.45);g.textAlign='left';return requestAnimationFrame(frame)}
  const dt=Math.min(0.05,(now-last)/1000);last=now;const t=(now-t0)/1000;
  let dx=0,dy=0;
  if(act('left'))dx-=1;if(act('right'))dx+=1;
  if(act('up'))dy-=1;if(act('down'))dy+=1;
  if(ptr.active){const vx=ptr.x-P.x,vy=ptr.y-P.y,m=Math.hypot(vx,vy);if(m>8){dx=vx/m;dy=vy/m}}
  if(dx||dy)head=Math.atan2(dy,dx);
  const nx=P.x+dx*speed*SENS*dt,ny=P.y+dy*speed*SENS*dt;
  if(nx>P.r&&nx<c.width-P.r&&!hitObs(nx,P.y,P.r))P.x=nx;
  if(ny>P.r&&ny<c.height-P.r&&!hitObs(P.x,ny,P.r))P.y=ny;
  cores=cores.filter(co=>{if(Math.hypot(co.x-P.x,co.y-P.y)<20){const p=addScore();burst(co.x,co.y,GLOW,12,100);popup(co.x,co.y-14,'+'+p,GLOW);if(S.checkpoints){cp={x:co.x,y:co.y};popup(co.x,co.y-32,'\u2691 CHECKPOINT',ACC)}refreshHud();return false}return true});
  if(!cores.length&&!portal)portal={x:c.width-36,y:36};
  hzs.forEach(h=>{
   if(h.type==='chaser'){const vx=P.x-h.x,vy=P.y-h.y,m=Math.hypot(vx,vy)||1;h.x+=vx/m*h.sp*dt;h.y+=vy/m*h.sp*dt}
   else{h.x+=h.vx*h.sp*dt;h.y+=h.vy*h.sp*dt;
    if(h.x<14||h.x>c.width-14)h.vx*=-1;if(h.y<14||h.y>c.height-14)h.vy*=-1;
    if(hitObs(h.x+h.vx*4,h.y,12))h.vx*=-1;if(hitObs(h.x,h.y+h.vy*4,12))h.vy*=-1}
   if(inv<=0&&Math.hypot(h.x-P.x,h.y-P.y)<P.r+11){comboBreak();lives--;inv=1.5;shake=8;vib(60);burst(P.x,P.y,HAZC,18,140);P.x=cp.x;P.y=cp.y;refreshHud();
    if(lives<=0){over=true;setTimeout(gameOver,300)}}});
  if(inv>0)inv-=dt;
  if(portal&&Math.hypot(portal.x-P.x,portal.y-P.y)<26){over=true;burst(P.x,P.y,'#C26BFF',24,160);setTimeout(()=>fb(true,(st.title||'Zone')+' cleared!'+unlockMsg(),next),300);return}
  g.save();if(shake>0.4&&!CTRL.reduced_motion){g.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);shake*=0.86}
  drawEnv(g,c.width,c.height,env,t,0.25);
  g.strokeStyle=GLOW+'40';g.strokeRect(1,1,c.width-2,c.height-2);
  obs.forEach(o=>{g.fillStyle='rgba(138,147,166,0.3)';g.fillRect(o.x,o.y,o.w,o.h);
   g.strokeStyle=GLOW+'33';g.strokeRect(o.x,o.y,o.w,o.h)});
  cores.forEach(co=>paintCore(g,co.x,co.y,8,t));
  hzs.forEach(h=>paintHazard(g,h.x,h.y,11,h.type==='chaser'?'seeker':'drone',t,P.x));
  if(portal)paintPortal(g,portal.x,portal.y,16,t);
  paintHeroTop(g,P.x,P.y,P.r+2,head,repFor(''),inv,t);
  drawFx(g,dt);
  g.fillStyle=T.text;g.font='12px system-ui';g.fillText(cores.length?('Cores left: '+cores.length):'Reach the portal!',10,18);
  g.restore();
  requestAnimationFrame(frame)}
 ctrlGuide();
 requestAnimationFrame(frame)}

/* ── PLATFORMER LITE (themed env + portal + particles) ──────────────── */
function pf(st){const c=mkCanvas(64),g=c.getContext('2d');
 const env=st.environment||V.environment||'grid';
 const px_=v=>v/100*c.width,py_=v=>v/100*c.height;
 const plats=(st.platforms&&st.platforms.length?st.platforms:[{x:0,y:92,w:100},{x:6,y:74,w:22},{x:40,y:62,w:20},{x:70,y:50,w:24},{x:28,y:38,w:18},{x:58,y:24,w:22}])
  .map(p=>({x:px_(p.x),y:py_(p.y),w:px_(p.w),h:10}));
 const cores=(st.cores&&st.cores.length?st.cores.map(o=>({x:px_(o.x),y:py_(o.y)})):plats.slice(1).map(p=>({x:p.x+p.w/2,y:p.y-22})));
 const hazards=(st.hazards||[]).map(o=>({x:px_(o.x),y:py_(o.y)}));
 const goal=st.goal?{x:px_(st.goal.x),y:py_(st.goal.y)}:{x:plats[plats.length-1].x+plats[plats.length-1].w/2,y:plats[plats.length-1].y-26};
 const start={x:plats[0].x+30,y:plats[0].y-30};
 const P={x:start.x,y:start.y,vx:0,vy:0,w:18,h:24,ground:false};let cp={...start};let face=1,wph=0;
 let got=[],inv=0,over=false,last=performance.now(),t0=last;
 const spd=190*(1+stageIdx*0.05),grav=980,jump=-450;
 touchRow([{label:'\u25C0',key:'ArrowLeft'},{label:'\u2B06',key:'ArrowUp'},{label:'\u25B6',key:'ArrowRight'}]);
 function frame(now){if(over)return;const dt=Math.min(0.04,(now-last)/1000);last=now;const t=(now-t0)/1000;
  P.vx=0;if(keys.ArrowLeft||keys.a)P.vx=-spd;if(keys.ArrowRight||keys.d)P.vx=spd;
  if(P.vx>0)face=1;else if(P.vx<0)face=-1;if(P.ground&&P.vx)wph+=dt*11;
  if((keys.ArrowUp||keys.w||keys[' '])&&P.ground){P.vy=jump;P.ground=false}
  P.vy+=grav*dt;const oy=P.y;P.x+=P.vx*dt;P.y+=P.vy*dt;
  P.x=Math.max(0,Math.min(c.width-P.w,P.x));P.ground=false;
  plats.forEach(pl=>{if(P.vy>=0&&oy+P.h<=pl.y+6&&P.y+P.h>=pl.y&&P.x+P.w>pl.x&&P.x<pl.x+pl.w){P.y=pl.y-P.h;P.vy=0;P.ground=true}});
  cores.forEach((co,i)=>{if(!got.includes(i)&&Math.abs(co.x-(P.x+P.w/2))<18&&Math.abs(co.y-(P.y+P.h/2))<20){got.push(i);const p=addScore();burst(co.x,co.y,GLOW,12,100);popup(co.x,co.y-14,'+'+p,GLOW);if(S.checkpoints){cp={x:co.x-9,y:co.y-30};popup(co.x,co.y-32,'\u2691 CHECKPOINT',ACC)}refreshHud()}});
  const die=()=>{comboBreak();lives--;inv=1.2;shake=8;vib(60);burst(P.x+P.w/2,P.y+P.h/2,HAZC,16,130);P.x=cp.x;P.y=cp.y;P.vy=0;refreshHud();if(lives<=0){over=true;setTimeout(gameOver,300)}};
  if(inv<=0){hazards.forEach(hz2=>{if(Math.abs(hz2.x-(P.x+P.w/2))<16&&Math.abs(hz2.y-(P.y+P.h))<16)die()});
   if(P.y>c.height+10)die()}
  if(inv>0)inv-=dt;
  if(Math.abs(goal.x-(P.x+P.w/2))<22&&Math.abs(goal.y-(P.y+P.h/2))<28){over=true;burst(goal.x,goal.y,'#C26BFF',24,160);setTimeout(()=>fb(true,(st.title||'Level')+' complete!'+unlockMsg(),next),300);return}
  g.save();if(shake>0.4&&!CTRL.reduced_motion){g.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);shake*=0.86}
  drawEnv(g,c.width,c.height,env,t,0.2);
  plats.forEach(pl=>{const pg=g.createLinearGradient(0,pl.y,0,pl.y+pl.h);
   pg.addColorStop(0,GLOW+'66');pg.addColorStop(1,GLOW+'22');
   g.fillStyle=pg;g.fillRect(pl.x,pl.y,pl.w,pl.h);
   g.fillStyle=GLOW;g.globalAlpha=0.7;g.fillRect(pl.x,pl.y,pl.w,2);g.globalAlpha=1});
  cores.forEach((co,i)=>{if(!got.includes(i))paintCore(g,co.x,co.y,7,t)});
  hazards.forEach(hz2=>{g.save();g.translate(hz2.x,hz2.y);g.shadowColor=HAZC;g.shadowBlur=10;g.fillStyle=HAZC;
   g.beginPath();g.moveTo(-9,8);g.lineTo(0,-8);g.lineTo(9,8);g.fill();g.shadowBlur=0;g.restore()});
  paintPortal(g,goal.x,goal.y,13,t);
  paintHeroSide(g,P.x,P.y,P.w,P.h,face,wph,P.ground,repFor(''),inv,t);
  drawFx(g,dt);g.restore();
  requestAnimationFrame(frame)}
 ctrlGuide();
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
    else{mark(false);[...row.children].forEach(x=>{x.style.background=GLOW+'22';x.disabled=false});step=0;
     const w=el('div','','Wrong order \u2014 starting over');w.style.cssText='color:#FF6B6B;font-size:12px;padding:4px 8px';box.appendChild(w);setTimeout(()=>w.remove(),900)}});
    row.appendChild(b)});box.appendChild(row)}
  else if(p.options){p.options.forEach((o,i)=>box.appendChild(btn(o,()=>{
    if(i===(p.answer_index||0))solved();else{mark(false);fb(false,'Not quite \u2014 look again.',()=>{})}})))}
  else{const inp=el('input','');inp.placeholder='Your answer\u2026';
   inp.style.cssText='margin:6px;padding:12px;border-radius:12px;border:1px solid '+GLOW+'44;background:rgba(255,255,255,0.06);color:'+T.text+';font-size:15px;width:70%';
   const go=()=>{const a=(inp.value||'').trim().toLowerCase(),k=String(p.answer||'').trim().toLowerCase();
    if(a&&(a===k||(k.length>3&&a.includes(k))))solved();
    else{mark(false);inp.style.borderColor='#FF6B6B';setTimeout(()=>inp.style.borderColor=GLOW+'44',700)}};
   inp.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
   box.appendChild(inp);box.appendChild(btn('Unlock',go))}
  if(p.hint){const hb=btn('\uD83D\uDCA1 Hint',()=>{hb.replaceWith(el('div','','<p style="font-size:12px;color:'+ACC+';padding:0 8px">'+p.hint+'</p>'))});
   hb.style.fontSize='12px';box.appendChild(hb)}
  root.appendChild(box)}
 show()}

/* ── Original DOM runtimes ──────────────────────────────────────────── */
function qa(st){if(st.story){const p=el('div','',st.story);p.style.cssText='padding:0 14px 8px;font-size:14px;opacity:.85';root.appendChild(p)}
 let qi=0;function ask(){const q=st.questions[qi];if(!q){next();return}
  const box=el('div','');box.style.cssText='padding:0 10px';box.appendChild(el('div','','<p style="padding:0 6px;font-size:15px"><b>'+q.q+'</b></p>'));
  q.options.forEach((o,i)=>box.appendChild(btn(o,()=>{const ok=i===q.answer_index;mark(ok);
   box.remove();fb(ok,q.explanation||'',()=>{qi++;ask()})})));
  root.appendChild(box)}ask()}
function ma(st){let sel=null,left=el('div',''),right=el('div',''),wrap=el('div','');wrap.style.cssText='display:flex;gap:8px;padding:0 10px';
 left.style.flex=right.style.flex='1';let remaining=st.pairs.length;
 const R=st.pairs.map(p=>p.right).sort(()=>Math.random()-.5);
 st.pairs.forEach(p=>{const b=btn(p.left,()=>{sel=p;[...left.children].forEach(c=>c.style.outline='');b.style.outline='2px solid '+GLOW});left.appendChild(b)});
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
  const on=st.pattern[i]===1;window_open=on;tapped=false;disp.textContent=on?'TAP!':'\u2026';disp.style.color=on?GLOW:T.text;i++},beatMs)}
titleScreen();
`;

function buildSrcdoc(spec, save, audio, controls) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="g"></div><script>window.__SPEC__=${JSON.stringify(spec).replace(/</g, "\\u003c")};window.__SAVE__=${JSON.stringify(save || {}).replace(/</g, "\\u003c")};window.__AUDIO__=${JSON.stringify(audio || {}).replace(/</g, "\\u003c")};window.__CTRL__=${JSON.stringify(controls || {}).replace(/</g, "\\u003c")};<\/script>
<script>${RUNTIME_JS}<\/script></body></html>`;
}

export default function GameRuntime({ spec, onScore, height = 460, gameId, controls }) {
  const ref = useRef(null);
  const srcdoc = useMemo(() => {
    if (!spec) return "";
    let save = {}, audio = {};
    if (gameId) {
      try { save = JSON.parse(localStorage.getItem(`or-game-save-${gameId}`) || "{}"); } catch { save = {}; }
    }
    try { audio = JSON.parse(localStorage.getItem("or-game-audio") || "{}"); } catch { audio = {}; }
    return buildSrcdoc(spec, save, audio, controls);
  }, [spec, gameId, controls]);
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
