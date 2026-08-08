import React, { useEffect, useMemo, useRef } from "react";
import apiClient from "@/api/client";

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
const ARC={top_down:1,platformer:1,dodge_collect:1,action_rpg_2_5d:1};
let startMs=Date.now(),maxCombo=1,dmg=0;
/* ── WebAudio synth SFX (no files, mobile-safe) ── */
/* ── Controls & Input Modes (per-game config) ── */
const CTRL=window.__CTRL__||{};
const DESK=CTRL.desktop_enabled!==false,MOB=CTRL.mobile_enabled!==false;
const SENS=CTRL.sensitivity||1;
const DEFKEYS={left:['ArrowLeft','a'],right:['ArrowRight','d'],up:['ArrowUp','w'],down:['ArrowDown','s'],jump:['ArrowUp','w',' '],attack:['j',' '],spell:['k'],dodge:['l','Shift'],interact:['e','Enter'],pause:['p'],restart:['r']};
const KMAP=CTRL.keyboard_map||{};
function akeys(n){return (KMAP[n]&&KMAP[n].length?KMAP[n]:DEFKEYS[n])||[]}
function clr(n){akeys(n).forEach(k=>keys2[k]=false)}
let PAUSED=false,lastInput='key';let SAVE_X={};
function vib(ms){if(CTRL.haptics!==false&&navigator.vibrate)try{navigator.vibrate(ms)}catch(e){}}
if(CTRL.high_contrast)document.documentElement.style.filter='contrast(1.18) saturate(1.25)';
const AUD=window.__AUDIO__||{};let AU=null;
function au(){if(AU===null){try{AU=new (window.AudioContext||window.webkitAudioContext)()}catch(e){AU=false}}return AU}
document.addEventListener('pointerdown',()=>{const a=au();if(a&&a.resume)a.resume()});
const SFX={collect:[880,1320,0.09,'sine'],combo:[660,990,0.14,'square'],hit:[200,60,0.28,'sawtooth'],
 shield:[520,780,0.16,'triangle'],boost:[440,1760,0.22,'sawtooth'],portal:[330,660,0.5,'sine'],
 checkpoint:[700,1050,0.13,'triangle'],stage:[523,784,0.4,'sine'],achievement:[784,1175,0.35,'triangle'],
 victory:[523,1047,0.8,'sine'],gameover:[220,70,0.8,'sawtooth'],click:[600,600,0.05,'square'],
 wrong:[280,120,0.18,'square'],laser:[980,320,0.08,'sawtooth']};
function sfx(name){if(AUD.muted)return;const a=au();if(!a)return;const cf=SFX[name];if(!cf)return;
 const SV=1+((S.audio_variant_sfx||0)%8)*0.05;
 try{const t0=a.currentTime,o=a.createOscillator(),gn=a.createGain();
 o.type=cf[3];o.frequency.setValueAtTime(cf[0]*SV,t0);o.frequency.exponentialRampToValueAtTime(Math.max(30,cf[1]*SV),t0+cf[2]);
 const v=0.22*(AUD.master!==undefined?AUD.master:0.8)*(AUD.effects!==undefined?AUD.effects:0.8);
 if(v<=0)return;gn.gain.setValueAtTime(v,t0);gn.gain.exponentialRampToValueAtTime(0.001,t0+cf[2]);
 o.connect(gn);gn.connect(a.destination);o.start(t0);o.stop(t0+cf[2]+0.02)}catch(e){}}
let musicTimer=null;let musicEl=null;const SCALE=[261.6,311.1,392,466.2,523.3];
function music(on){if(musicTimer){clearInterval(musicTimer);musicTimer=null}
 if(musicEl){try{musicEl.pause()}catch(e){}musicEl=null}
 if(!on||AUD.muted)return;const mv=(AUD.master!==undefined?AUD.master:0.8)*(AUD.music!==undefined?AUD.music:0.5);
 if(mv<=0)return;
 const mu=aurl('music_theme');
 if(mu){try{musicEl=new Audio(mu);musicEl.loop=true;musicEl.volume=Math.min(1,0.6*mv);musicEl.play().catch(()=>{});return}catch(e){}}
 musicTimer=setInterval(()=>{const a=au();if(!a)return;try{const t0=a.currentTime,o=a.createOscillator(),gn=a.createGain();
  const MV2=Math.pow(1.0595,(S.audio_variant_music||0)%12);
  o.type='sine';o.frequency.value=SCALE[Math.floor(Math.random()*SCALE.length)]*MV2*(Math.random()<0.3?0.5:1);
  gn.gain.setValueAtTime(0.05*mv,t0);gn.gain.exponentialRampToValueAtTime(0.001,t0+1.4);
  o.connect(gn);gn.connect(a.destination);o.start(t0);o.stop(t0+1.5)}catch(e){}},640)}
const V=S.visual_theme||{};const PAL=V.palette||{};
const T=S.theme||{bg:PAL.bg||'#0b1220',accent:PAL.glow||'#2EE6FF',text:'#EAF2FF'};
const GLOW=PAL.glow||T.accent,ACC=PAL.accent||'#F4A73B',HAZC=PAL.hazard||'#FF3D5A';
const PCOL=PAL.player&&PAL.player.length?PAL.player:['#C26BFF','#2EE6FF'];
/* ── Real image assets (Game Asset Studio): S.assets = {slot:{url,meta}} ── */
const AST=S.assets||{};const AIMG={};
for(const k in AST){if(AST[k]&&AST[k].url){const im=new Image();im.src=AST[k].url;AIMG[k]=im}}
function aimg(k){const im=AIMG[k];return im&&im.complete&&im.naturalWidth>0?im:null}
function drawSpr(g,k,x,y,size,ang,t,flip){const im=aimg(k);if(!im)return false;const m=(AST[k]&&AST[k].meta)||{};
 const fr=m.frames&&m.frames>1?m.frames:1;const fi=fr>1?Math.floor((t||0)*(m.fps||6))%fr:0;
 const fw=im.naturalWidth/fr,fh=im.naturalHeight;const ar=fw/fh;
 g.save();g.translate(x,y);if(ang)g.rotate(ang);if(flip)g.scale(-1,1);
 g.drawImage(im,fi*fw,0,fw,fh,-size*ar/2,-size/2,size*ar,size);g.restore();return true}
function drawTileFill(g,x,y,w,h2,row,col){const im=aimg('tileset');if(!im)return false;
 const m=(AST.tileset&&AST.tileset.meta&&AST.tileset.meta.tile)||{cols:4,rows:4};
 const tw=im.naturalWidth/(m.cols||4),th=im.naturalHeight/(m.rows||4);
 const sx=(col||0)*tw,sy=(row||0)*th;g.save();g.beginPath();g.rect(x,y,w,h2);g.clip();
 for(let ty=y;ty<y+h2;ty+=24)for(let tx=x;tx<x+w;tx+=24)g.drawImage(im,sx,sy,tw,th,tx,ty,24,24);
 g.restore();return true}
function drawFxAt(g,x,y,size,t){return drawSpr(g,'effect_fx',x,y,size,(t||0)*2.4,t)}
function aurl(k){return AST[k]&&AST[k].url?AST[k].url:null}
function sprHtml(k,px,fb){const u=aurl(k);return u?'<img src="'+u+'" style="width:'+px+'px;height:'+px+'px;object-fit:contain;image-rendering:pixelated;pointer-events:none;vertical-align:middle" alt=""/>':(fb||'')}
function bgify(elm,k,dim){const u=aurl(k);if(!u)return false;const d2=dim===undefined?0.72:dim;
 elm.style.backgroundImage='linear-gradient(rgba(5,9,20,'+d2+'),rgba(5,9,20,'+d2+')),url("'+u+'")';
 elm.style.backgroundSize='cover';elm.style.backgroundPosition='center';return true}
document.body.style.cssText='margin:0;font-family:system-ui,sans-serif;background:'+(PAL.bg||T.bg)+';color:'+T.text+';min-height:100vh;overflow:hidden';
root.style.transition='opacity .25s ease';
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e}
function post(completed){parent.postMessage({type:'game_score',score:score,completed:!!completed,title:S.title,
 time_s:Math.round((Date.now()-startMs)/1000),stage_reached:stageIdx,max_combo:maxCombo,
 no_damage:dmg===0,achievements:earned.slice()},'*')}
function saveGame(){best=Math.max(best,score);parent.postMessage({type:'game_save',save:Object.assign({best_score:best,stage:stageIdx},SAVE_X)},'*')}
function hud(){const h=el('div','','');h.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:8px 12px;font-size:12px;opacity:.92;flex-wrap:wrap';
 if(AST.ui_frame&&AST.ui_frame.url){h.style.borderImage='url('+AST.ui_frame.url+') 24 fill / 12px stretch';h.style.borderWidth='6px';h.style.borderStyle='solid'}
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
function stage(){root.style.opacity=0;if(ARC[S.runtime])music(true);bgify(document.body,'background',0.8);setTimeout(()=>{root.innerHTML='';root.appendChild(hud());const st=S.stages[stageIdx];
 const h=el('div','','<h3 style="margin:6px 12px;color:'+GLOW+'">'+(st.title||'')+'</h3>');root.appendChild(h);
 if(titleDone&&!CTRL.reduced_motion){const bn=el('div','','<div style="font-size:10px;letter-spacing:0.42em;color:'+ACC+'">STAGE '+(stageIdx+1)+' / '+S.stages.length+'</div><div style="font-size:21px;font-weight:800;color:'+GLOW+';text-shadow:0 0 18px '+GLOW+'77">'+(st.title||'')+'</div>');
  bn.style.cssText='position:fixed;top:18%;left:50%;z-index:55;text-align:center;pointer-events:none;animation:orbanner 2.1s ease forwards';
  document.body.appendChild(bn);setTimeout(()=>bn.remove(),2200)}
 const rt=({quiz_adventure:qa,matching:ma,sorting:so,memory:me,rhythm:rh,top_down:td,platformer:pf,dodge_collect:dc,puzzle_room:pz,card_battle:cb,tower_defense:tdf,match3:m3,rpg:rpg,turn_based_creature_rpg:rpg,racing:rac,farming:frm,city_builder:cbl,roguelike:rgl,tactics:tac,idle:idl,visual_novel:vn,fishing:fsh,action_rpg_2_5d:arpg})[S.runtime];
 if(rt)rt(st);else root.innerHTML='<div style="text-align:center;padding:50px 20px;font-size:13px;opacity:.8">This game uses a dedicated renderer — open it from the Games hub.</div>';
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
  else if(S.runtime==='action_rpg_2_5d')p.push('W/\u2191 jump \u00b7 J attack \u00b7 K spell \u00b7 L dodge');
  else p.push((akeys('up')[0]||'\u2191')+'/'+(akeys('down')[0]||'\u2193')+' '+(S.runtime==='top_down'?'move':'fly'));
  p.push('P pause \u00b7 R restart');L.push('\u2328 '+p.join(' \u00b7 '))}
 else if(DESK)L.push('\u2328 Mouse \u2014 click to interact');
 if(MOB)L.push('\uD83D\uDC46 '+({dodge_collect:'Drag to steer',platformer:'On-screen buttons',top_down:'Drag to move',action_rpg_2_5d:'Left: drag joystick \u00b7 Right: ATK / SPL / DODGE',card_battle:'Tap cards to play \u00b7 End Turn',tower_defense:'Tap tower, then a build spot',match3:'Tap two adjacent tiles to swap',rpg:'Tap tiles to walk',turn_based_creature_rpg:'Tap tiles to walk · battle buttons',racing:'Steer & drift buttons',farming:'Tap plots to farm',city_builder:'Tap building, tap tile',roguelike:'Tap tiles to step & fight',tactics:'Tap unit, tile, then target',idle:'Tap to generate',visual_novel:'Tap choices',fishing:'Tap Cast, then Hook on time'}[S.runtime]||'Tap to play'));
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
  if(d.testid)b.setAttribute('data-testid',d.testid);
  b.style.cssText='width:'+bw+'px;height:'+bs+'px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'18;color:'+T.text+';font-size:20px;touch-action:none;user-select:none';
  const on=e=>{e.preventDefault();lastInput='touch';keys[d.key]=true},off=e=>{e.preventDefault();keys[d.key]=false};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointerleave',off);b.addEventListener('pointercancel',off);
  b.addEventListener('click',()=>{keys[d.key]=true;setTimeout(()=>keys[d.key]=false,120)});
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
 if(aimg('player_sprite')){if(boostT>0)drawFxAt(g,x,y,w*3,t);
  drawSpr(g,'player_sprite',x,y,w*2.3,(tilt||0)*0.4,t);
  if(shieldN){g.save();g.translate(x,y);paintShieldRing(g,w,t,shieldN);g.restore()}return}
 if(rp==='spaceship')paintShipP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='rolling_orb')paintOrbP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='hover_bike')paintBikeP(g,x,y,w,tilt,boostT,shieldN,t);
 else if(rp==='runner')paintRunnerP(g,x,y,w,tilt,boostT,shieldN,t);
 else paintPlayer(g,x,y,w,tilt,boostT,shieldN,t)}
function paintHeroSide(g,x,y,w,h,face,wph,grounded,rep,inv,t){g.save();g.translate(x+w/2,y+h);if(face<0)g.scale(-1,1);
 if(aimg('player_sprite')){g.restore();if(inv>0)drawFxAt(g,x+w/2,y+h/2,h*2,t);
  drawSpr(g,'player_sprite',x+w/2,y+h*0.42,h*1.35,0,t,face<0);return}
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
 if(aimg('player_sprite')){g.restore();if(inv>0)drawFxAt(g,x,y,r*3.4,t);
  drawSpr(g,'player_sprite',x,y,r*2.6,ang+1.5708,t);return}
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
function paintHazard(g,x,y,r,kind,t,px){
 if(kind==='boss'&&drawSpr(g,'boss_sprite',x,y,r*3.4,0,t))return;
 if(drawSpr(g,'enemy_sprite',x,y,r*2.7,0,t))return;
 g.save();g.translate(x,y);g.shadowColor=HAZC;g.shadowBlur=12;
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
function skyGrad(g,W,H,c1,c2){const bim=aimg('background');
 if(bim){g.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,0,0,W,H);
  g.fillStyle='rgba(4,8,20,0.28)';g.fillRect(0,0,W,H);return}
 const sg=g.createLinearGradient(0,0,0,H);sg.addColorStop(0,c1);sg.addColorStop(1,c2);g.fillStyle=sg;g.fillRect(0,0,W,H)}
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
/* ── Card Battle runtime (tpl_card_battle_v1) — turn-based, no movement ─ */
function cb(st){const en=st.enemy||{};let eHp=en.hp||30,eMax=eHp,pHp=st.player_hp||30,pMax=pHp,block=0,energy=st.energy_per_turn||3,bonus=0,turn=1,over=false;
 let deck=(st.deck||[]).slice().sort(()=>Math.random()-.5),hand=[],disc=[];
 const HS=st.hand_size||4;
 function draw(){while(hand.length<HS){if(!deck.length){if(!disc.length)break;deck=disc.sort(()=>Math.random()-.5);disc=[]}hand.push(deck.pop())}}
 draw();
 const wrap=el('div','');wrap.style.cssText='max-width:560px;margin:0 auto;padding:0 10px';
 const eBox=el('div',''),pBox=el('div',''),handBox=el('div',''),ctl=el('div','');
 handBox.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:10px 0';
 ctl.style.cssText='text-align:center';
 function bar(v,m,col){const p=Math.max(0,Math.round(v/m*100));return '<div style="height:10px;border-radius:6px;background:#ffffff14;overflow:hidden;margin:4px 0"><div style="width:'+p+'%;height:100%;background:'+col+';transition:width .3s"></div></div>'}
 function intent(){const a=en.attack_min||3,b=en.attack_max||6;return (en.intent_telegraph===false)?'':'<span data-testid="cb-enemy-intent" style="font-size:11px;color:'+HAZC+'">Intent: attack '+a+'-'+b+'</span>'}
 function paint(){eBox.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px"><b>'+sprHtml('boss_sprite',44,sprHtml('enemy_sprite',44,'\uD83D\uDC79'))+' '+(en.name||'Enemy')+'</b><span data-testid="cb-enemy-hp">'+Math.max(0,eHp)+'/'+eMax+' HP</span></div>'+bar(eHp,eMax,HAZC)+intent();
  eBox.style.cssText='padding:10px 12px;border:1px solid '+HAZC+'44;border-radius:12px;background:'+HAZC+'0d;margin-bottom:8px';
  bgify(eBox,'battle_scene',0.84);
  pBox.innerHTML='<div style="display:flex;justify-content:space-between;flex-wrap:wrap;font-size:13px"><b>\uD83E\uDDD9 You</b><span data-testid="cb-player-hp">'+Math.max(0,pHp)+'/'+pMax+' HP'+(block?' \u00b7 \uD83D\uDEE1 '+block:'')+'</span></div>'+bar(pHp,pMax,'#10E670')+
   '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px"><span data-testid="cb-mana" style="color:'+GLOW+'">\u26A1 '+energy+' mana</span><span data-testid="cb-turn" style="color:'+ACC+'">Turn '+turn+' \u2014 YOUR TURN</span><span data-testid="cb-piles">\uD83C\uDCCF '+deck.length+' \u00b7 \uD83D\uDDD1 '+disc.length+'</span></div>';
  pBox.style.cssText='padding:10px 12px;border:1px solid '+GLOW+'44;border-radius:12px;background:'+GLOW+'0d;margin-bottom:4px';
  handBox.innerHTML='';
  hand.forEach((c,i)=>{const ico=c.type==='attack'?'\u2694\uFE0F':c.type==='defense'?'\uD83D\uDEE1':'\u2728';
   const b=el('button','','<div style="font-size:16px">'+ico+'</div><b style="font-size:12px">'+c.name+'</b><div style="font-size:10px;opacity:.75">'+(c.desc||'')+'</div><div style="font-size:10px;color:'+GLOW+'">\u26A1'+c.cost+'</div>');
   b.setAttribute('data-testid','cb-card-'+i);
   b.style.cssText='width:98px;min-height:96px;border-radius:12px;border:1px solid '+(c.cost<=energy?GLOW:'#666')+'66;background:'+(c.cost<=energy?GLOW+'1a':'#ffffff08')+';color:'+T.text+';cursor:pointer;padding:6px 4px';
   bgify(b,'card_face',0.6);
   b.onclick=()=>{if(over||c.cost>energy){sfx('wrong');return}energy-=c.cost;hand.splice(i,1);disc.push(c);
    if(c.type==='attack'){eHp-=c.value||4;sfx('hit')}else if(c.type==='defense'){block+=c.value||4;sfx('click')}else{bonus+=c.value||1;sfx('combo')}
    addScore(c.value||3);
    if(eHp<=0){over=true;paint();fb(true,'Enemy defeated!',next);return}
    paint()};
   handBox.appendChild(b)});
  const endB=el('button','','END TURN \u23F5');endB.setAttribute('data-testid','cb-end-turn');
  endB.style.cssText='padding:12px 26px;border-radius:12px;border:1px solid '+ACC+'88;background:'+ACC+'22;color:'+T.text+';font-weight:700;cursor:pointer';
  endB.onclick=()=>{if(over)return;over=true;
   const dmgv=Math.max(0,Math.round((en.attack_min||3)+Math.random()*((en.attack_max||6)-(en.attack_min||3)))-block);
   pHp-=dmgv;block=0;sfx(dmgv>0?'hit':'click');
   if(pHp<=0){paint();gameOver();return}
   turn++;energy=(st.energy_per_turn||3)+bonus;bonus=0;draw();over=false;paint()};
  ctl.innerHTML='';ctl.appendChild(endB)}
 wrap.appendChild(eBox);wrap.appendChild(pBox);wrap.appendChild(handBox);wrap.appendChild(ctl);root.appendChild(wrap);paint()}

/* ── Tower Defense runtime (tpl_tower_defense_v1) — no player character ─ */
function tdf(st){const c=mkCanvas(96),ctx=c.getContext('2d'),W=c.width,H=c.height;
 let res=st.start_resources!==undefined?st.start_resources:100,baseHp=st.base_hp||10,waveIdx=0,enemies=[],towers=[],sel=0,selTower=null,speed=1,paused=false,phase='build',spawnQ=[],spawnT=0,raf=null,doneFlag=false,shots=[];
 const defs=st.towers||[{name:'Arrow',cost:40,damage:3,range:95,fire_ms:600}];
 const waves=st.waves||[{enemies:[{type:'grunt',count:5,hp:10,speed:40,bounty:8}]}];
 const P=[[0,0.25],[0.35,0.25],[0.35,0.65],[0.7,0.65],[0.7,0.35],[1,0.35]].map(p=>[p[0]*W,p[1]*H]);
 const ui=el('div','');ui.style.cssText='display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center;padding:6px;font-size:12px';
 root.insertBefore(ui,root.lastChild);
 function uiPaint(){ui.innerHTML='<span data-testid="td-wave" style="color:'+ACC+'">Wave '+Math.min(waveIdx+1,waves.length)+'/'+waves.length+'</span>'+
  '<span data-testid="td-resources" style="color:'+GLOW+'">\uD83D\uDCB0 '+res+'</span><span data-testid="td-base" style="color:#10E670">\uD83C\uDFF0 '+baseHp+'</span>';
  defs.forEach((d,i)=>{const b=el('button','',d.name+' $'+d.cost);b.setAttribute('data-testid','td-tower-btn-'+i);
   b.style.cssText='padding:7px 10px;border-radius:10px;border:1px solid '+(i===sel?GLOW:'#556')+';background:'+(i===sel?GLOW+'33':'#ffffff0a')+';color:'+T.text+';cursor:pointer;font-size:11px';
   b.onclick=()=>{sel=i;selTower=null;uiPaint()};ui.appendChild(b)});
  const pb=el('button','',paused?'\u25B6':'\u23F8');pb.setAttribute('data-testid','td-pause');pb.style.cssText='padding:7px 10px;border-radius:10px;border:1px solid #556;background:#ffffff0a;color:'+T.text+';cursor:pointer';
  pb.onclick=()=>{paused=!paused;uiPaint()};ui.appendChild(pb);
  const sp=el('button','',speed+'x');sp.setAttribute('data-testid','td-speed');sp.style.cssText=pb.style.cssText;
  sp.onclick=()=>{speed=speed===1?2:1;uiPaint()};ui.appendChild(sp);
  if(selTower){const up=el('button','','\u2B06 Upgrade $'+Math.round(selTower.def.cost*0.8));up.setAttribute('data-testid','td-upgrade');
   up.style.cssText='padding:7px 10px;border-radius:10px;border:1px solid '+ACC+';background:'+ACC+'22;color:'+T.text+';cursor:pointer;font-size:11px';
   up.onclick=()=>{const cost=Math.round(selTower.def.cost*0.8);if(res>=cost){res-=cost;selTower.dmg=Math.round(selTower.dmg*1.5);selTower.lvl++;sfx('combo');uiPaint()}else sfx('wrong')};
   const sl=el('button','','Sell +$'+Math.round(selTower.def.cost*0.6));sl.setAttribute('data-testid','td-sell');sl.style.cssText=up.style.cssText;
   sl.onclick=()=>{res+=Math.round(selTower.def.cost*0.6);towers=towers.filter(t=>t!==selTower);selTower=null;sfx('click');uiPaint()};
   ui.appendChild(up);ui.appendChild(sl)}}
 function startWave(){const w=waves[waveIdx];spawnQ=[];(w.enemies||[]).forEach(g=>{for(let i=0;i<(g.count||3);i++)spawnQ.push({type:g.type||'grunt',hp:g.hp||10,mx:g.hp||10,speed:g.speed||40,bounty:g.bounty||8})});phase='wave';spawnT=0}
 function distToPath(x,y){let m=1e9;for(let i=0;i<P.length-1;i++){const ax=P[i][0],ay=P[i][1],bx=P[i+1][0],by=P[i+1][1];
  const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)*(bx-ax)+(by-ay)*(by-ay)||1)));
  const dx=x-(ax+t*(bx-ax)),dy=y-(ay+t*(by-ay));m=Math.min(m,Math.sqrt(dx*dx+dy*dy))}return m}
 c.addEventListener('pointerdown',e=>{const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  const hit=towers.find(t=>Math.hypot(t.x-x,t.y-y)<20);
  if(hit){selTower=hit;uiPaint();return}
  selTower=null;const d=defs[sel];
  if(distToPath(x,y)<26){sfx('wrong');uiPaint();return}
  if(res>=d.cost){res-=d.cost;towers.push({x:x,y:y,def:d,dmg:d.damage||3,range:d.range||90,fire:d.fire_ms||600,cd:0,lvl:1});sfx('collect');addScore(5)}else sfx('wrong');
  uiPaint()});
 let last=0;
 function loop(ts){if(doneFlag)return;raf=requestAnimationFrame(loop);const dt=Math.min(50,ts-(last||ts))*speed;last=ts;
  if(paused||PAUSED){drawTD();return}
  if(phase==='wave'){spawnT-=dt;if(spawnQ.length&&spawnT<=0){const s=spawnQ.shift();enemies.push({hp:s.hp,mx:s.mx,speed:s.speed,bounty:s.bounty,type:s.type,seg:0,t:0});spawnT=700}
   enemies.forEach(en=>{const a=P[en.seg],b=P[en.seg+1];if(!b){return}const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    en.t+=en.speed*dt/1000/len;if(en.t>=1){en.seg++;en.t=0;if(en.seg>=P.length-1){en.dead=true;baseHp--;sfx('hit');uiPaint();
     if(baseHp<=0){doneFlag=true;cancelAnimationFrame(raf);gameOver();return}}}});
   enemies=enemies.filter(en=>!en.dead&&en.hp>0);
   towers.forEach(t=>{t.cd-=dt;if(t.cd<=0){const tg=enemies.find(en=>{const p=epos(en);return p&&Math.hypot(p[0]-t.x,p[1]-t.y)<=t.range});
    if(tg){tg.hp-=t.dmg;t.cd=t.fire;t.flash=6;sfx('laser');const tp=epos(tg);if(tp)shots.push({x1:t.x,y1:t.y,x2:tp[0],y2:tp[1],life:1});if(tg.hp<=0){res+=tg.bounty;addScore(tg.bounty);uiPaint()}}}});
   if(!spawnQ.length&&!enemies.length&&phase==='wave'){waveIdx++;uiPaint();
    if(waveIdx>=waves.length){doneFlag=true;cancelAnimationFrame(raf);fb(true,'Base defended \u2014 all waves survived!',next);return}
    phase='build';setTimeout(()=>{if(!doneFlag)startWave()},2500)}}
  drawTD()}
 function epos(en){const a=P[en.seg],b=P[en.seg+1];if(!b)return null;return [a[0]+(b[0]-a[0])*en.t,a[1]+(b[1]-a[1])*en.t]}
 function drawTD(){const bim=aimg('background');
  if(bim){ctx.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,0,0,W,H);ctx.fillStyle='rgba(4,8,20,0.45)';ctx.fillRect(0,0,W,H)}
  else{ctx.fillStyle=PAL.bg||T.bg;ctx.fillRect(0,0,W,H)}
  ctx.strokeStyle=ACC+'88';ctx.lineWidth=22;ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);P.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.stroke();
  ctx.strokeStyle='#00000055';ctx.lineWidth=16;ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);P.forEach(p=>ctx.lineTo(p[0],p[1]));ctx.stroke();
  ctx.font='18px system-ui';ctx.fillText('\uD83C\uDFF0',P[P.length-1][0]-12,P[P.length-1][1]+7);
  towers.forEach(t=>{if(t===selTower){ctx.beginPath();ctx.arc(t.x,t.y,t.range,0,7);ctx.strokeStyle=GLOW+'44';ctx.lineWidth=1;ctx.stroke()}
   t.flash=(t.flash||0)-1;
   if(!drawSpr(ctx,'tower_sprite',t.x,t.y,26+t.lvl*4,0,performance.now()/1000)){
    ctx.fillStyle=t.flash>0?'#fff':GLOW;ctx.beginPath();ctx.arc(t.x,t.y,10+t.lvl,0,7);ctx.fill()}
   ctx.fillStyle=aimg('tower_sprite')?'#fff':'#0b1220';ctx.font='9px system-ui';ctx.textAlign='center';ctx.fillText(String(t.lvl),t.x,t.y+3);ctx.textAlign='left'});
  shots=shots.filter(s=>(s.life-=0.1)>0);
  shots.forEach(s=>{const k2=1-s.life,sx=s.x1+(s.x2-s.x1)*k2,sy=s.y1+(s.y2-s.y1)*k2;
   if(!drawSpr(ctx,'projectile_sprite',sx,sy,14,Math.atan2(s.y2-s.y1,s.x2-s.x1))){ctx.fillStyle=ACC;ctx.beginPath();ctx.arc(sx,sy,3,0,7);ctx.fill()}});
  enemies.forEach(en=>{const p=epos(en);if(!p)return;const col=en.type==='tank'?'#B14BF4':en.type==='fast'?'#FFD34D':HAZC;
   if(!drawSpr(ctx,en.type==='tank'?'boss_sprite':'enemy_sprite',p[0],p[1],en.type==='tank'?30:22,0,performance.now()/1000)&&!(en.type==='tank'&&drawSpr(ctx,'enemy_sprite',p[0],p[1],30,0,performance.now()/1000))){
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(p[0],p[1],en.type==='tank'?11:7,0,7);ctx.fill()}
   ctx.fillStyle='#10E670';ctx.fillRect(p[0]-10,p[1]-14,20*Math.max(0,en.hp/en.mx),3)});
  if(phase==='build'){ctx.fillStyle=T.text;ctx.font='13px system-ui';ctx.textAlign='center';
   ctx.fillText(waveIdx===0?'Place towers, then the wave begins\u2026':'Wave cleared \u2014 reinforce!',W/2,24);ctx.textAlign='left'}}
 uiPaint();setTimeout(()=>{if(!doneFlag)startWave()},3000);raf=requestAnimationFrame(loop)}

/* ── Match-3 runtime (tpl_match3_v1) — swap, match, cascade ───────────── */
function m3(st){const GW=st.grid_w||7,GH=st.grid_h||8,NC=Math.min(6,st.colors||5);
 const COLS=['#FF5A8A','#2EE6FF','#FFD34D','#10E670','#B14BF4','#FF8C42'];
 const ICOS=['\u2665','\u25C6','\u2605','\u25CF','\u25B2','\u2B22'];
 let movesLeft=st.moves||20,scoreGoal=0,cleared=0,busy=false,sel=null,comboN=0;
 const obj=st.objective||{type:'score',target:500};
 let grid=[];
 function rnd(){return Math.floor(Math.random()*NC)}
 function matchAt(g,x,y,v){return (x>=2&&g[y][x-1]===v&&g[y][x-2]===v)||(y>=2&&g[y-1][x]===v&&g[y-2][x]===v)}
 for(let y=0;y<GH;y++){grid.push([]);for(let x=0;x<GW;x++){let v=rnd();let guard=0;while(matchAt(grid,x,y,v)&&guard++<20)v=rnd();grid[y].push(v)}}
 const top=el('div','');top.style.cssText='display:flex;justify-content:center;gap:14px;font-size:12px;padding:4px;flex-wrap:wrap';
 const board=el('div','');board.style.cssText='display:grid;grid-template-columns:repeat('+GW+',1fr);gap:4px;max-width:'+Math.min(430,GW*54)+'px;margin:6px auto;padding:8px;border:1px solid '+GLOW+'33;border-radius:14px;background:#ffffff06';
 root.appendChild(top);root.appendChild(board);
 function objText(){if(obj.type==='clear_color')return 'Clear '+(obj.target||20)+' '+ICOS[obj.color||0]+' tiles \u2014 '+Math.min(cleared,obj.target||20)+'/'+(obj.target||20);
  return 'Score '+(obj.target||500)+' pts \u2014 '+Math.min(scoreGoal,obj.target)+'/'+obj.target}
 function paintTop(){top.innerHTML='<span data-testid="m3-objective" style="color:'+ACC+'">\uD83C\uDFAF '+objText()+'</span>'+
  '<span data-testid="m3-moves" style="color:'+(movesLeft<=3?HAZC:T.text)+'">Moves: '+movesLeft+'</span>'+
  '<span data-testid="m3-combo" style="color:'+GLOW+'">'+(comboN>1?'\uD83D\uDD25 Combo x'+comboN:'')+'</span>'}
 function cells(){return [...board.children]}
 function paint(){board.innerHTML='';const iu=aurl('icon_set');for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const v=grid[y][x];const d=el('div','',v===null?'':(iu?'':ICOS[v]));
  d.setAttribute('data-testid','m3-tile-'+x+'-'+y);
  d.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:10px;font-size:20px;cursor:pointer;user-select:none;background:'+(v===null?'transparent':COLS[v]+'22')+';color:'+(v===null?'transparent':COLS[v])+';border:1px solid '+(sel&&sel[0]===x&&sel[1]===y?GLOW:COLS[v||0]+'33')+';transition:transform .12s';
  if(iu&&v!==null){d.style.backgroundImage='url("'+iu+'")';d.style.backgroundSize='400% 200%';d.style.backgroundPosition=((v%4)*100/3)+'% '+(Math.floor(v/4)*100)+'%';d.style.backgroundColor=COLS[v]+'22'}
  d.onpointerdown=()=>tap(x,y);board.appendChild(d)}paintTop()}
 function findMatches(){const hit=new Set();
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const v=grid[y][x];if(v===null)continue;
   if(x<=GW-3&&grid[y][x+1]===v&&grid[y][x+2]===v){let k=x;while(k<GW&&grid[y][k]===v){hit.add(k+','+y);k++}}
   if(y<=GH-3&&grid[y+1][x]===v&&grid[y+2][x]===v){let k=y;while(k<GH&&grid[k][x]===v){hit.add(x+','+k);k++}}}
  return hit}
 function collapse(){for(let x=0;x<GW;x++){let stack=[];for(let y=GH-1;y>=0;y--)if(grid[y][x]!==null)stack.push(grid[y][x]);
  for(let y=GH-1;y>=0;y--)grid[y][x]=stack[GH-1-y]!==undefined?stack[GH-1-y]:rnd()}}
 function resolve(after){const hit=findMatches();
  if(!hit.size){comboN=0;busy=false;paintTop();if(after)after();return}
  comboN++;const mult=1+Math.min(3,(comboN-1)*0.5);
  hit.forEach(kk=>{const p=kk.split(',');const x=+p[0],y=+p[1];
   if(obj.type==='clear_color'&&grid[y][x]===(obj.color||0))cleared++;
   grid[y][x]=null});
  const pts=Math.round(hit.size*10*mult);scoreGoal+=pts;addScore(pts);sfx(comboN>1?'combo':'collect');
  paint();
  setTimeout(()=>{collapse();paint();
   if(checkWin())return;
   setTimeout(()=>resolve(after),160)},240)}
 function checkWin(){const won=obj.type==='clear_color'?cleared>=(obj.target||20):scoreGoal>=(obj.target||500);
  if(won){busy=true;fb(true,'Objective complete!',next);return true}return false}
 function tap(x,y){if(busy||grid[y][x]===null)return;
  if(!sel){sel=[x,y];paint();return}
  const dx=Math.abs(sel[0]-x),dy=Math.abs(sel[1]-y);
  if(dx+dy!==1){sel=[x,y];paint();return}
  busy=true;const a=grid[sel[1]][sel[0]];grid[sel[1]][sel[0]]=grid[y][x];grid[y][x]=a;
  const s0=sel;sel=null;paint();
  if(!findMatches().size){setTimeout(()=>{const b2=grid[s0[1]][s0[0]];grid[s0[1]][s0[0]]=grid[y][x];grid[y][x]=b2;busy=false;sfx('wrong');paint()},260);return}
  movesLeft--;comboN=0;
  setTimeout(()=>resolve(()=>{if(!checkWin()&&movesLeft<=0){busy=true;gameOver()}}),180)}
 paint()}

/* ── RPG runtime (tpl_rpg_v1) — explore/quest/loot/level ─────────────── */
function rpg(st){const GW=st.grid_w||9,GH=st.grid_h||7;let pHp=st.player_hp||24,pMax=pHp,lvl=SAVE_X.level||1,xp=SAVE_X.xp||0,atk=4,wpn=null,arm=null,potions=0,questItem=null,questDone=false,busy=false;
 let party=(SAVE_X.party||[]).map(c=>({...c}));
 if(!party.length&&st.starter_creature)party.push({...st.starter_creature,hp:st.starter_creature.hp||14,mx:st.starter_creature.hp||14,level:1,cxp:0});
 let px=0,py=0;const npcs=(st.npcs||[]).map(n=>({...n}));
 const mons=(st.monsters||[]).map(m=>({...m,alive:true,catchable:false}));
 const wilds=(st.creatures||[]).map(m=>({...m,alive:true,catchable:m.catchable!==false,mx:m.hp}));
 const chests=(st.chests||[]).map(c=>({...c,open:false}));
 const ex=st.exit||{x:GW-1,y:GH-1};const q=st.quest||{};
 const ZI={town:'\uD83C\uDFD8',dungeon:'\uD83D\uDD73',overworld:'\uD83D\uDDFA'};
 const top=el('div','');top.style.cssText='display:flex;justify-content:center;gap:12px;font-size:11px;padding:4px;flex-wrap:wrap';
 const zone=el('div','',(ZI[st.zone]||ZI.overworld)+' '+(st.zone||'overworld').toUpperCase()+' \u2014 World Map '+(stageIdx+1)+'/'+S.stages.length);
 zone.style.cssText='text-align:center;font-size:9.5px;letter-spacing:2px;color:'+ACC+';opacity:.8';
 const board=el('div','');board.style.cssText='display:grid;grid-template-columns:repeat('+GW+',1fr);gap:3px;max-width:'+Math.min(500,GW*52)+'px;margin:4px auto;padding:8px;border:1px solid '+GLOW+'33;border-radius:14px;background:'+(st.zone==='dungeon'?'#00000033':st.zone==='town'?GLOW+'08':'#ffffff06');
 bgify(board,'background',0.82);
 const log=el('div','');log.style.cssText='text-align:center;font-size:11px;min-height:18px;color:'+ACC;
 const inv=el('div','');inv.style.cssText='display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:4px';
 const pty=el('div','');pty.style.cssText='display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:2px';
 root.appendChild(zone);root.appendChild(top);root.appendChild(board);root.appendChild(log);root.appendChild(pty);root.appendChild(inv);
 function say(m){log.textContent=m}
 function totalAtk(){return atk+(wpn?wpn.power:0)}
 function savePt(){SAVE_X.level=lvl;SAVE_X.xp=xp;SAVE_X.party=party.map(c=>({name:c.name,hp:c.mx,mx:c.mx,attack:c.attack,level:c.level,cxp:c.cxp,evolves_to:c.evolves_to,evolve_level:c.evolve_level}))}
 function paintTop(){top.innerHTML='<span data-testid="rpg-hp" style="color:#10E670">\u2764 '+pHp+'/'+pMax+'</span><span data-testid="rpg-level" style="color:'+GLOW+'">Lv '+lvl+' \u00b7 XP '+xp+'</span><span data-testid="rpg-quest" style="color:'+ACC+'">\uD83D\uDCDC '+(questDone?'Quest complete!':questItem?'Return to '+(q.giver||'giver'):(q.text||'Explore'))+'</span>'}
 function paintParty(){pty.innerHTML='';party.forEach((c,i)=>{const s=el('span','','\uD83D\uDC3E '+c.name+' Lv'+c.level+' ('+c.hp+'/'+c.mx+')');
  s.setAttribute('data-testid','rpg-party-'+i);
  s.style.cssText='font-size:9.5px;padding:3px 8px;border-radius:8px;border:1px solid '+(i===0?GLOW:'#556')+';background:'+(i===0?GLOW+'15':'#ffffff06');
  s.onclick=()=>{if(i>0&&!busy){party.unshift(party.splice(i,1)[0]);sfx('click');paintParty()}};pty.appendChild(s)})}
 function paintInv(){inv.innerHTML='';[['\u2694\uFE0F',wpn],['\uD83D\uDEE1',arm]].forEach(([ico,it])=>{const s=el('span','',ico+' '+(it?it.name+' +'+it.power:'\u2014'));s.style.cssText='font-size:10px;padding:4px 8px;border-radius:8px;border:1px solid #556;background:#ffffff08';inv.appendChild(s)});
  if(potions>0){const b=el('button','','\uD83E\uDDEA Potion \u00d7'+potions);b.setAttribute('data-testid','rpg-potion');b.style.cssText='font-size:10px;padding:4px 8px;border-radius:8px;border:1px solid #10E67066;background:#10E6701a;color:'+T.text+';cursor:pointer';
   b.onclick=()=>{if(potions>0&&pHp<pMax){potions--;pHp=Math.min(pMax,pHp+10);sfx('collect');paintTop();paintInv()}};inv.appendChild(b)}
  if(questItem){const s=el('span','','\uD83C\uDFC6 '+questItem);s.style.cssText='font-size:10px;padding:4px 8px;border-radius:8px;border:1px solid '+ACC+'66;background:'+ACC+'1a';inv.appendChild(s)}}
 function tileAt(x,y){if(px===x&&py===y)return sprHtml('player_sprite',30,'\uD83E\uDDD9');const n=npcs.find(n=>n.x===x&&n.y===y);if(n)return sprHtml('npc_sprite',28,'\uD83E\uDDD3');
  const m=mons.find(m=>m.alive&&m.x===x&&m.y===y);if(m)return sprHtml('enemy_sprite',28,'\uD83D\uDC7E');
  const w=wilds.find(w=>w.alive&&w.x===x&&w.y===y);if(w)return sprHtml('creature_sprite',28,'\uD83D\uDC32');
  const c=chests.find(c=>c.x===x&&c.y===y);if(c)return c.open?'\uD83D\uDCE6':'\uD83C\uDF81';
  if(ex.x===x&&ex.y===y)return questDone?'\uD83C\uDFF0':'\uD83D\uDD12';return ''}
 function paint(){board.innerHTML='';for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const d=el('div','',tileAt(x,y));
  d.setAttribute('data-testid','rpg-tile-'+x+'-'+y);
  d.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:17px;border-radius:8px;cursor:pointer;background:'+((x+y)%2?'#ffffff08':'#ffffff04')+';border:1px solid #ffffff0a';
  d.onpointerdown=()=>step(x,y);board.appendChild(d)}paintTop();paintInv();paintParty()}
 function step(tx,ty){if(busy)return;const dx=Math.sign(tx-px),dy=Math.sign(ty-py);
  const nx=px+(Math.abs(tx-px)>=Math.abs(ty-py)?dx:0),ny=py+(Math.abs(ty-py)>Math.abs(tx-px)?dy:0);
  if(nx===px&&ny===py)return;
  const n=npcs.find(n=>n.x===nx&&n.y===ny);if(n){talk(n);return}
  const m=mons.find(m=>m.alive&&m.x===nx&&m.y===ny);if(m){fight(m);return}
  const w=wilds.find(w=>w.alive&&w.x===nx&&w.y===ny);if(w){fight(w);return}
  px=nx;py=ny;sfx('click');
  const c=chests.find(c=>c.x===px&&c.y===py&&!c.open);if(c){c.open=true;loot(c.loot||{})}
  if(ex.x===px&&ex.y===py){if(questDone){addScore(30);savePt();fb(true,'Region cleared!',next);busy=true}else say('The gate is locked \u2014 finish the quest first.')}
  paint()}
 function talk(n){sfx('click');if(questItem&&(q.giver===n.name)){questDone=true;questItem=null;addScore(40);say('"'+(n.name)+'": Thank you, hero! The gate is open.');sfx('achievement')}else say('"'+n.name+'": '+(n.dialog||'...'));paint()}
 function loot(l){if(l.kind==='weapon'){wpn=l;say('Found '+l.name+' (+'+l.power+' atk)')}else if(l.kind==='armor'){arm=l;say('Found '+l.name+' (+'+l.power+' def)')}else if(l.kind==='potion'){potions++;say('Found a potion!')}else if(l.kind==='quest_item'){questItem=l.name;say('Found the '+l.name+'! Return it to '+(q.giver||'the giver')+'.')}addScore(10);sfx('collect')}
 function creatureXp(c,gain){c.cxp=(c.cxp||0)+gain;if(c.cxp>=c.level*15){c.level++;c.attack+=2;c.mx+=4;c.hp=c.mx;sfx('achievement');
  if(c.evolves_to&&c.level>=(c.evolve_level||3)){say(c.name+' evolved into '+c.evolves_to+'!');c.name=c.evolves_to;c.evolves_to=null;c.attack+=3;c.mx+=8;c.hp=c.mx;sfx('victory')}}}
 function fight(m){busy=true;const ov=el('div','');ov.style.cssText='position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:50';
  const box=el('div','');box.style.cssText='background:'+T.bg+';border:1px solid '+HAZC+'66;border-radius:16px;padding:16px;text-align:center;max-width:320px';
  bgify(box,'battle_scene',0.8);
  function endWin(){m.alive=false;const gain=(m.xp||8);xp+=gain;addScore(gain);
   if(party[0])creatureXp(party[0],gain);
   if(xp>=lvl*20){lvl++;atk+=2;pMax+=4;pHp=pMax;sfx('achievement');say('Level up! Lv '+lvl)}else say(m.name+' defeated!');
   savePt();ov.remove();busy=false;paint()}
  function pb(){const ac=party[0];
   box.innerHTML='<div style="font-size:26px">'+(m.catchable?sprHtml('creature_sprite',54,'\uD83D\uDC32'):sprHtml('enemy_sprite',54,'\u2694\uFE0F'))+'</div><b data-testid="rpg-combat-name">'+m.name+'</b><div data-testid="rpg-combat-hp" style="font-size:12px;color:'+HAZC+'">'+Math.max(0,m.hp)+' HP</div>'+
    '<div style="font-size:11px;margin:4px 0">You: '+pHp+' HP \u00b7 atk '+totalAtk()+(ac?'<br>\uD83D\uDC3E '+ac.name+' Lv'+ac.level+' ('+ac.hp+'/'+ac.mx+') atk '+ac.attack:'')+'</div>';
   function mkBtn(label,tid,col,fn){const b=el('button','',label);b.setAttribute('data-testid',tid);
    b.style.cssText='margin:3px;padding:9px 14px;border-radius:10px;border:1px solid '+col+'88;background:'+col+'22;color:'+T.text+';cursor:pointer;font-weight:700;font-size:11px';b.onclick=fn;box.appendChild(b)}
   mkBtn('ATTACK','rpg-attack',HAZC,()=>{m.hp-=totalAtk();sfx('hit');if(m.hp<=0){endWin();return}enemyTurn()});
   if(party[0])mkBtn('\uD83D\uDC3E '+party[0].name.toUpperCase(),'rpg-creature-attack',GLOW,()=>{m.hp-=party[0].attack;sfx('laser');if(m.hp<=0){endWin();return}enemyTurn(true)});
   if(m.catchable&&party.length<3)mkBtn('CATCH','rpg-catch',ACC,()=>{const odds=Math.max(0.25,1-(m.hp/m.mx));
    if(Math.random()<odds){m.alive=false;party.push({name:m.name,hp:m.mx,mx:m.mx,attack:m.attack||4,level:1,cxp:0,evolves_to:m.evolves_to,evolve_level:m.evolve_level});
     say(m.name+' joined your party!');addScore(15);sfx('victory');savePt();ov.remove();busy=false;paint();return}
    say('It broke free!');sfx('wrong');enemyTurn()});
   if(party.length>1)mkBtn('SWAP','rpg-swap','#778899',()=>{party.push(party.shift());sfx('click');pb()});
   mkBtn('FLEE','rpg-flee','#778899',()=>{ov.remove();busy=false;say('You fled.');paint()})}
  function enemyTurn(hitCreature){const dmg=Math.max(1,(m.attack||3)-(arm?arm.power:0));
   if(hitCreature&&party[0]){party[0].hp-=dmg;if(party[0].hp<=0){say(party[0].name+' fainted!');party.shift();savePt()}}
   else{pHp-=dmg;if(pHp<=0){ov.remove();gameOver();return}}
   pb()}
  pb();ov.appendChild(box);root.appendChild(ov)}
 paint();say(q.text?('Quest: '+q.text):'Explore the region')}

/* ── 2.5D Action RPG runtime (tpl_action_rpg_2_5d_v1 · renderer_action_rpg_2_5d_v1)
   Real-time 8-dir movement, camera follow, layered 2.5D canvas (parallax + y-sort +
   shadows + lighting/fog overlays), animation state machine, melee/projectile/spell,
   dodge i-frames, enemy AI profiles, multi-phase boss w/ arena lock, quests, NPC
   dialogue, inventory/equipment, XP/leveling, checkpoints, save/load. ── */
function arpg(st){if(st.mode==='side_scroll')return (st.schema_version>=2?arpgXY(st):arpgSS(st));const c=mkCanvas(MOB?70:8),g=c.getContext('2d'),W=c.width,H=c.height;
 const WORLD=Math.max(900,st.width||1600),GY=H*0.42;// GY = top of walkable band
 const AX=SAVE_X.arpg||(SAVE_X.arpg={lvl:1,xp:0,eqp:null,potions:1});
 let pMax=(st.player_hp||30)+((AX.lvl-1)*4),pHp=pMax,mMax=st.player_mana||12,mana=mMax,sMax=st.player_stamina||100,stam=sMax;
 let atkBase=5+(AX.lvl-1)*2,busy=false,doneFlag=false,raf=null;
 const P={x:60,y:GY+(H-GY)*0.5,vx:0,vy:0,face:1,st:'idle',stT:0,inv:0,atkCd:0,splCd:0,dgCd:0,burn:0};
 let cam=0,camY=0,shakeT=0,quest=st.quest||{},qKills=0,qItem=null,qDone=false,talkNpc=null,dlg=null;
 let check={x:60,y:P.y};const obs=(st.obstacles||[]).map(o=>({...o}));
 const npcs=(st.npcs||[]).map(n=>({...n,y:Math.max(GY+8,Math.min(H-24,n.y||GY+40))}));
 const foes=(st.enemies||[]).map((e,i)=>({...e,id:i,mx:e.hp||12,y:Math.max(GY+8,Math.min(H-24,e.y||GY+50)),
  hx:e.x,vx:0,vy:0,cd:0,tele:0,state:'patrol',dir:1,flash:0,burn:0,type:e.type||'melee',speed:e.speed||55}));
 const B=st.boss?{...st.boss,mx:st.boss.hp||60,y:Math.max(GY+16,Math.min(H-30,st.boss.y||GY+60)),
  vx:0,vy:0,cd:1.2,tele:0,phase:1,phases:st.boss.phases||2,engaged:false,dead:false,flash:0,enraged:false}:null;
 const loots=(st.loot||[]).map(l=>({...l,y:Math.max(GY+10,Math.min(H-20,l.y||GY+60)),got:false}));
 if(st.checkpoint)check={x:st.checkpoint.x,y:Math.max(GY+10,Math.min(H-20,st.checkpoint.y||GY+60))};
 let cpReached=false;const ex=st.exit||{x:WORLD-60,y:GY+60};
 let projs=[],eprojs=[],drops=[],msg='',msgT=0;
 function say(m){msg=m;msgT=3.2}
 function savePt(){saveGame()}
 function setSt(s){if(P.st!==s){P.st=s;P.stT=0}}
 function collide(x,y,r){if(x<r||x>WORLD-r||y<GY+6||y>H-14)return true;
  for(let i=0;i<obs.length;i++){const o=obs[i];if(x>o.x-r&&x<o.x+o.w+r&&y>o.y-r&&y<o.y+(o.h||30)+r)return true}
  if(B&&B.engaged&&!B.dead){const a0=Math.max(0,B.x-(st.arena_w||420));if(x<a0+6||x>Math.min(WORLD,B.x+200))return true}
  return false}
 function tryMove(o,dx,dy,r){if(!collide(o.x+dx,o.y,r))o.x+=dx;else if(!collide(o.x+dx,o.y+Math.sign(dy||1)*8,r)){o.y+=Math.sign(dy||1)*2;o.x+=dx*0.5}
  if(!collide(o.x,o.y+dy,r))o.y+=dy}
 function gainXp(n){AX.xp+=n;addScore(n);if(AX.xp>=AX.lvl*25){AX.lvl++;atkBase+=2;pMax+=4;pHp=pMax;sfx('achievement');popup(P.x-cam,P.y-40,'LEVEL '+AX.lvl+'!',ACC)}savePt()}
 function pAtk(){return atkBase+(AX.eqp?AX.eqp.power||2:0)}
 function hurt(dmg,kx){if(P.inv>0||P.st==='dodge')return;pHp-=dmg;P.inv=0.9;P.vx+=kx*140;setSt('hurt');shakeT=0.28;vib(60);sfx('hit');burst(P.x-cam,P.y,HAZC,10,110);
  if(pHp<=0){setSt('death');busy=true;setTimeout(()=>{lives--;refreshHud();
   if(lives<=0){doneFlag=true;cancelAnimationFrame(raf);gameOver();return}
   pHp=Math.ceil(pMax*0.6);mana=mMax;P.x=check.x;P.y=check.y;P.inv=1.5;busy=false;setSt('idle');say('Restored at the checkpoint.')},700)}}
 function hitFoe(f,dmg,kx,crit){f.hp-=dmg;f.flash=0.15;f.vx+=kx*120;sfx('hit');burst(f.x-cam,f.y,crit?'#FFD34D':GLOW,crit?14:7,100);
  popup(f.x-cam,f.y-30,(crit?'CRIT ':'')+dmg,crit?'#FFD34D':T.text);
  if(f.hp<=0){f.dead=true;gainXp(f.xp||8);burst(f.x-cam,f.y,ACC,16,130);
   if(Math.random()<0.35)drops.push({x:f.x,y:f.y,kind:'potion'});
   if(quest.type!=='collect'&&(!quest.type||quest.type==='defeat')){qKills++;if(qKills>=(quest.target||3)&&!qDone){qDone=true;say('Quest complete! Head to the exit \u27A1');sfx('victory')}}}}
 function meleeHit(){const R=54,cx=P.x+P.face*34;setSt('attack');P.atkCd=0.42;stam=Math.max(0,stam-8);
  const crit=Math.random()<0.12;const dmg=Math.round(pAtk()*(crit?2:1));sfx('laser');
  foes.forEach(f=>{if(!f.dead&&Math.abs(f.x-cx)<R&&Math.abs(f.y-P.y)<40)hitFoe(f,dmg,P.face,crit)});
  if(B&&!B.dead&&B.engaged&&Math.abs(B.x-cx)<R+24&&Math.abs(B.y-P.y)<52)bossHit(dmg,crit)}
 function castSpell(){if(mana<3){say('Not enough mana');sfx('wrong');return}mana-=3;setSt('cast');P.splCd=0.9;sfx('combo');
  projs.push({x:P.x+P.face*20,y:P.y-14,vx:P.face*300,life:1.6,burn:true})}
 function doDodge(){if(stam<20){say('Exhausted \u2014 stamina too low');return}stam-=20;setSt('dodge');P.dgCd=0.8;P.inv=0.45;
  P.vx=P.face*330;sfx('click');burst(P.x-cam,P.y+8,GLOW,6,60)}
 function bossHit(dmg,crit){B.hp-=dmg;B.flash=0.15;popup(B.x-cam,B.y-56,(crit?'CRIT ':'')+dmg,'#FFD34D');
  const pct=B.hp/B.mx;const ph=Math.min(B.phases,1+Math.floor((1-pct)*B.phases));
  if(ph>B.phase){B.phase=ph;B.tele=0.9;shakeT=0.5;say(B.name+' enters phase '+ph+'!');sfx('stage');
   if(st.boss.summons&&foes.filter(f=>!f.dead).length<4)foes.push({name:'Summoned '+(foes[0]?foes[0].name:'Minion'),id:99+ph,x:B.x-120,hx:B.x-120,y:B.y+20,hp:8,mx:8,attack:B.attack-2,speed:70,xp:5,vx:0,vy:0,cd:0,tele:0,state:'chase',dir:1,flash:0,burn:0,type:'melee'})}
  if(!B.enraged&&pct<=(st.boss.enrage_pct||0.25)){B.enraged=true;say(B.name+' is ENRAGED!');shakeT=0.5}
  if(B.hp<=0){B.dead=true;B.engaged=false;gainXp(st.boss.xp||40);burst(B.x-cam,B.y,'#FFD34D',30,180);sfx('victory');
   drops.push({x:B.x,y:B.y,kind:'potion'});say(B.name+' has fallen!');savePt()}}
 function foeAI(f,dt){if(f.dead)return;f.cd-=dt;f.flash-=dt;if(f.burn>0){f.burn-=dt;if(Math.random()<dt*2){f.hp-=1;if(f.hp<=0){f.dead=true;gainXp(f.xp||8)}}}
  const dx=P.x-f.x,dy=P.y-f.y,d=Math.hypot(dx,dy);
  const low=f.hp/f.mx<0.25&&f.type!=='melee';
  if(low&&d<160){f.state='retreat'}else if(d<(f.aggro||190)&&!busy){f.state='chase'}else if(f.state!=='patrol'&&d>320){f.state='patrol'}
  let sx=0,sy=0;const sp=f.speed*(f.tele>0?0.2:1);
  if(f.state==='patrol'){if(Math.abs(f.x-(f.hx+f.dir*70))<8)f.dir*=-1;sx=f.dir*sp*0.5}
  else if(f.state==='retreat'){sx=-Math.sign(dx)*sp;sy=-Math.sign(dy)*sp*0.6}
  else{const rng=f.type==='melee'?34:f.type==='ranged'?170:210;
   if(d>rng){sx=Math.sign(dx)*sp;sy=Math.sign(dy)*sp*0.7}
   else if(f.cd<=0&&f.tele<=0){f.tele=0.5}}
  if(f.tele>0){f.tele-=dt;if(f.tele<=0){f.cd=f.type==='melee'?1.1:1.8;
   if(f.type==='melee'){if(d<50)hurt(f.attack||3,Math.sign(dx)*-1||-1)}
   else eprojs.push({x:f.x,y:f.y-12,vx:Math.sign(dx)*(f.type==='caster'?170:230),vy:dy/Math.max(1,d)*120,life:2,burn:f.type==='caster'})}}
  tryMove(f,sx*dt,sy*dt,10)}
 function bossAI(dt){if(!B||B.dead)return;B.flash-=dt;
  const dx=P.x-B.x,dy=P.y-B.y,d=Math.hypot(dx,dy);
  if(!B.engaged&&d<(st.arena_w||420)*0.7){B.engaged=true;say(B.name+' blocks your path!');shakeT=0.4;sfx('stage')}
  if(!B.engaged)return;B.cd-=dt;
  const rage=B.enraged?1.5:1,phb=1+(B.phase-1)*0.25;
  if(B.tele>0){B.tele-=dt;if(B.tele<=0){
   if(B.mode==='slam'){if(d<90)hurt(Math.round((B.attack||7)*phb),Math.sign(dx)*-1||-1);shakeT=0.4;burst(B.x-cam,B.y+10,HAZC,20,160)}
   else{for(let i=-1;i<2;i++)eprojs.push({x:B.x,y:B.y-16,vx:Math.sign(dx)*200,vy:i*70,life:2.2,burn:B.phase>1})}
   B.cd=(B.enraged?0.9:1.6)/phb}return}
  if(B.cd<=0){B.mode=d<100?'slam':'volley';B.tele=B.enraged?0.35:0.6}
  else{const sp=45*rage*phb;tryMove(B,Math.sign(dx)*sp*dt,Math.sign(dy)*sp*0.6*dt,16)}}
 /* animation state machine: state -> pose params for the procedural hero + drawSpr frames */
 const ANIM={idle:{bob:2,arm:0},walk:{bob:4,arm:0.6},run:{bob:5,arm:1},attack:{bob:1,arm:1.6},cast:{bob:1,arm:-1.2},dodge:{bob:0,arm:0.3},hurt:{bob:6,arm:-0.4},death:{bob:0,arm:-1.6},interact:{bob:2,arm:-0.8}};
 function drawHero(t){const a=ANIM[P.st]||ANIM.idle;const sc=1+((P.y-GY)/(H-GY))*0.22;// depth scale
  g.save();g.globalAlpha=0.32;g.fillStyle='#000';g.beginPath();g.ellipse(P.x-cam,P.y+16,15*sc,5*sc,0,0,7);g.fill();g.restore();
  if(P.inv>0&&Math.floor(t*14)%2)return;
  if(drawSpr(g,'player_sprite',P.x-cam,P.y-8,58*sc,P.st==='dodge'?P.face*0.5:0,t,P.face<0))return;
  g.save();g.translate(P.x-cam,P.y);g.scale(P.face*sc,sc);
  const bob=Math.sin(t*(P.st==='run'?13:7))*a.bob;
  g.fillStyle=PCOL[0];g.fillRect(-7,-26+bob*0.4,14,20);// robe
  g.fillStyle='#F2C9A0';g.beginPath();g.arc(0,-32+bob*0.4,6,0,7);g.fill();// head
  g.strokeStyle=PCOL[1];g.lineWidth=3;g.beginPath();g.moveTo(5,-20);g.lineTo(5+Math.cos(a.arm)*13,-20+Math.sin(a.arm)*13);g.stroke();// staff arm
  g.strokeStyle='#8A5A2B';g.lineWidth=2.5;const ax=5+Math.cos(a.arm)*13,ay=-20+Math.sin(a.arm)*13;
  g.beginPath();g.moveTo(ax,ay+8);g.lineTo(ax,ay-14);g.stroke();g.fillStyle=GLOW;g.beginPath();g.arc(ax,ay-16,3,0,7);g.fill();
  g.fillStyle=PCOL[0];g.fillRect(-6,-7+bob*0.2,4,8);g.fillRect(2,-7-bob*0.2,4,8);g.restore()}
 function drawFoe(f,t){if(f.dead)return;const sc=1+((f.y-GY)/(H-GY))*0.22;
  g.save();g.globalAlpha=0.3;g.fillStyle='#000';g.beginPath();g.ellipse(f.x-cam,f.y+13,12*sc,4*sc,0,0,7);g.fill();g.restore();
  if(f.tele>0){g.strokeStyle=HAZC;g.globalAlpha=0.5+Math.sin(t*20)*0.3;g.beginPath();g.arc(f.x-cam,f.y-8,20*sc,0,7);g.stroke();g.globalAlpha=1}
  if(!drawSpr(g,'enemy_sprite',f.x-cam,f.y-8,48*sc,0,t,f.x>P.x)){
   g.fillStyle=f.flash>0?'#fff':(f.type==='caster'?'#B14BF4':f.type==='ranged'?'#FFD34D':HAZC);
   g.beginPath();g.arc(f.x-cam,f.y-8,11*sc,0,7);g.fill();
   g.fillStyle='#0b1220';g.fillRect(f.x-cam-4,f.y-12,3,3);g.fillRect(f.x-cam+1,f.y-12,3,3)}
  g.fillStyle='#10E670';g.fillRect(f.x-cam-13,f.y-26*sc,26*Math.max(0,f.hp/f.mx),3)}
 function drawBoss(t){if(!B||B.dead)return;const sc=1.35+((B.y-GY)/(H-GY))*0.2;
  g.save();g.globalAlpha=0.35;g.fillStyle='#000';g.beginPath();g.ellipse(B.x-cam,B.y+20,24*sc,7*sc,0,0,7);g.fill();g.restore();
  if(B.tele>0){g.strokeStyle=B.mode==='slam'?HAZC:'#FFD34D';g.lineWidth=2;g.globalAlpha=0.5+Math.sin(t*18)*0.35;
   g.beginPath();g.arc(B.x-cam,B.y-14,(B.mode==='slam'?70:36)*sc,0,7);g.stroke();g.globalAlpha=1;g.lineWidth=1}
  if(!drawSpr(g,'boss_sprite',B.x-cam,B.y-18,118*sc,0,t,B.x>P.x)){
   g.fillStyle=B.flash>0?'#fff':(B.enraged?'#FF3D5A':'#B14BF4');
   g.beginPath();g.arc(B.x-cam,B.y-16,24*sc,0,7);g.fill();
   g.beginPath();g.moveTo(B.x-cam-24*sc,B.y-24);g.lineTo(B.x-cam-34*sc,B.y-46);g.lineTo(B.x-cam-10,B.y-30);g.fill();
   g.beginPath();g.moveTo(B.x-cam+24*sc,B.y-24);g.lineTo(B.x-cam+34*sc,B.y-46);g.lineTo(B.x-cam+10,B.y-30);g.fill()}}
 function drawWorld(t){/* layered 2.5D: sky/parallax -> ground -> y-sorted actors -> fg -> light/fog */
  const bim=aimg('background');
  if(bim){const pw=W*1.3;g.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,-((cam*0.35)%pw),0,pw,H*0.95);
   g.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,-((cam*0.35)%pw)+pw,0,pw,H*0.95);
   g.fillStyle='rgba(4,8,20,0.35)';g.fillRect(0,0,W,H)}
  else{skyGrad(g,W,H,'#101c30','#060a14');
   g.fillStyle='rgba(46,230,255,0.06)';for(let i=0;i<9;i++){const mx=(hz(i*7)*WORLD*1.2-cam*0.3)%(W+300)-150;
    g.beginPath();g.moveTo(mx,H*0.46);g.lineTo(mx+90,H*0.16+hz(i)*40);g.lineTo(mx+200,H*0.46);g.fill()}}
  const gim=aimg('background');
  if(gim){/* ground = darkened mirrored slice of the panorama for cohesive 2.5D depth */
   g.save();g.translate(0,GY*2+ (H-GY));g.scale(1,-1);
   g.globalAlpha=0.5;g.drawImage(gim,0,gim.naturalHeight*0.55,gim.naturalWidth,gim.naturalHeight*0.45,-(cam*0.5)%W,GY,W*1.4,H-GY);g.restore();g.globalAlpha=1;
   const gg=g.createLinearGradient(0,GY,0,H);gg.addColorStop(0,'rgba(8,14,20,0.72)');gg.addColorStop(1,'rgba(4,8,14,0.92)');
   g.fillStyle=gg;g.fillRect(0,GY,W,H-GY);
   g.strokeStyle='rgba(120,200,160,0.05)';for(let y=GY+14;y<H;y+=26){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke()}}
  else if(!drawTileFill(g,0,GY,W,H-GY,0,0)){g.fillStyle='rgba(20,34,28,0.9)';g.fillRect(0,GY,W,H-GY);
   g.strokeStyle='rgba(255,255,255,0.05)';for(let y=GY;y<H;y+=18){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke()}}
  obs.forEach(o=>{const sx=o.x-cam;if(sx<-120||sx>W+40)return;
   const tim=aimg('tileset');
   if(tim){const tm=(AST.tileset&&AST.tileset.meta&&AST.tileset.meta.tile)||{cols:4,rows:4};
    const tw=tim.naturalWidth/(tm.cols||4),th=tim.naturalHeight/(tm.rows||4);
    g.drawImage(tim,tw,th,tw,th,sx,o.y-14,o.w,(o.h||30)+14);// wall cell (row 1)
    g.fillStyle='rgba(4,8,16,0.25)';g.fillRect(sx,o.y-14,o.w,(o.h||30)+14)}
   else{g.fillStyle='#22303f';g.fillRect(sx,o.y,o.w,o.h||30);g.fillStyle='#2e4152';g.fillRect(sx,o.y,o.w,6)}});
  if(cpReached||true){const cx=check.x-cam;if(cx>-30&&cx<W+30){g.fillStyle=cpReached?'#10E670':'#556';
   g.fillRect(cx-2,check.y-34,4,34);g.beginPath();g.moveTo(cx+2,check.y-34);g.lineTo(cx+20,check.y-28);g.lineTo(cx+2,check.y-22);g.fill()}}
  const exs=ex.x-cam;if(exs>-40&&exs<W+40){g.strokeStyle=qDone&&(!B||B.dead)?GLOW:'#445';g.lineWidth=3;
   g.beginPath();g.ellipse(exs,GY+50,16,30,0,0,7);g.stroke();g.lineWidth=1;
   if(qDone&&(!B||B.dead)){g.fillStyle=GLOW+'33';g.beginPath();g.ellipse(exs,GY+50,12,26,0,0,7);g.fill()}}
  loots.forEach(l=>{if(l.got)return;const lx=l.x-cam;if(lx<-20||lx>W+20)return;
   g.fillStyle=ACC;g.save();g.translate(lx,l.y+Math.sin(t*3)*3);g.rotate(0.785);g.fillRect(-6,-6,12,12);g.restore()});
  drops.forEach(d2=>{const dx2=d2.x-cam;g.fillStyle='#10E670';g.beginPath();g.arc(dx2,d2.y+Math.sin(t*4)*3,6,0,7);g.fill()});
  const actors=[...npcs.map(n=>({y:n.y,f:()=>{const nx=n.x-cam;
    g.save();g.globalAlpha=0.3;g.fillStyle='#000';g.beginPath();g.ellipse(nx,n.y+13,11,4,0,0,7);g.fill();g.restore();
    if(!drawSpr(g,'npc_sprite',nx,n.y-8,44,0,t)){g.fillStyle='#7B8CFF';g.fillRect(nx-6,n.y-22,12,18);
     g.fillStyle='#F2C9A0';g.beginPath();g.arc(nx,n.y-27,5,0,7);g.fill()}
    if(Math.abs(n.x-P.x)<60&&Math.abs(n.y-P.y)<50){g.fillStyle=ACC;g.font='11px system-ui';g.textAlign='center';
     g.fillText(MOB?'\uD83D\uDCAC TALK':'[E] Talk \u00b7 '+n.name,nx,n.y-40);g.textAlign='left'}}})),
   ...foes.map(f=>({y:f.y,f:()=>drawFoe(f,t)})),...(B?[{y:B.y,f:()=>drawBoss(t)}]:[]),{y:P.y,f:()=>drawHero(t)}];
  actors.sort((a,b)=>a.y-b.y).forEach(a=>a.f());// depth ordering
  projs.forEach(p=>{if(!drawSpr(g,'projectile_sprite',p.x-cam,p.y,16,Math.atan2(0,p.vx),t)){
   g.fillStyle=GLOW;g.shadowColor=GLOW;g.shadowBlur=10;g.beginPath();g.arc(p.x-cam,p.y,4,0,7);g.fill();g.shadowBlur=0}});
  eprojs.forEach(p=>{g.fillStyle=p.burn?'#FF8A5A':HAZC;g.shadowColor=HAZC;g.shadowBlur=8;g.beginPath();g.arc(p.x-cam,p.y,4,0,7);g.fill();g.shadowBlur=0});
  const fg=g.createLinearGradient(0,H-40,0,H);fg.addColorStop(0,'rgba(0,0,0,0)');fg.addColorStop(1,'rgba(3,6,14,0.55)');
  g.fillStyle=fg;g.fillRect(0,H-40,W,40);// foreground depth strip
  const lg=g.createRadialGradient(P.x-cam,P.y-10,30,P.x-cam,P.y-10,Math.max(W,H)*0.75);
  lg.addColorStop(0,'rgba(0,0,0,0)');lg.addColorStop(1,'rgba(2,4,12,0.5)');g.fillStyle=lg;g.fillRect(0,0,W,H);// lighting overlay
  g.fillStyle='rgba(90,120,160,0.05)';g.fillRect(0,GY-((t*9)%30),W,12)}// drifting fog band
 function drawHUD(){g.save();g.shadowColor=GLOW;g.shadowBlur=14;g.fillStyle='rgba(4,8,20,0.72)';
  if(g.roundRect){g.beginPath();g.roundRect(8,8,176,62,12);g.fill()}else g.fillRect(8,8,176,62);
  g.shadowBlur=0;g.strokeStyle=GLOW+'44';if(g.roundRect){g.stroke()}g.restore();
  const bars=[['\u2764',pHp/pMax,'#10E670',pHp+'/'+pMax],['\u2728',mana/mMax,'#2EA0FF',Math.floor(mana)],['\u26A1',stam/sMax,'#FFD34D','']];
  bars.forEach((b,i)=>{g.font='bold 11px system-ui';g.fillStyle=T.text;g.fillText(b[0],13,22+i*16);
   g.fillStyle='#ffffff18';g.fillRect(28,14+i*16,110,8);g.save();g.shadowColor=b[2];g.shadowBlur=6;
   g.fillStyle=b[2];g.fillRect(28,14+i*16,110*Math.max(0,Math.min(1,b[1])),8);g.restore();
   g.fillStyle=T.text;g.fillText(String(b[3]),142,22+i*16)});
  g.fillStyle=T.text;g.font='10px system-ui';
  g.fillText('Lv '+AX.lvl+' \u00b7 XP '+AX.xp+' \u00b7 \uD83E\uDDEA'+AX.potions+(AX.eqp?' \u00b7 \u2694 '+AX.eqp.name:''),12,74);
  const qtxt=qDone?'\u2713 Quest done \u2014 reach the exit':(quest.type==='collect'?'\uD83D\uDCDC Find the '+(quest.item||'relic'):'\uD83D\uDCDC '+(quest.text||'Defeat enemies')+' ('+qKills+'/'+(quest.target||3)+')');
  g.fillStyle=ACC;g.fillText(qtxt,12,88);
  if(B&&B.engaged&&!B.dead){g.fillStyle='rgba(4,8,20,0.7)';g.fillRect(W/2-130,12,260,26);
   g.fillStyle=T.text;g.font='10px system-ui';g.textAlign='center';g.fillText(B.name+' \u2014 PHASE '+B.phase+(B.enraged?' \u00b7 ENRAGED':''),W/2,22);g.textAlign='left';
   g.fillStyle='#ffffff18';g.fillRect(W/2-120,26,240,8);g.fillStyle=B.enraged?'#FF3D5A':'#B14BF4';g.fillRect(W/2-120,26,240*Math.max(0,B.hp/B.mx),8)}
  if(msgT>0){g.fillStyle='rgba(4,8,20,0.8)';const tw=g.measureText(msg).width+24;g.fillRect(W/2-tw/2,H-72,tw,22);
   g.fillStyle=T.text;g.textAlign='center';g.fillText(msg,W/2,H-57);g.textAlign='left'}}
 function openDlg(n){busy=true;setSt('interact');talkNpc=n;
  dlg=el('div','');dlg.setAttribute('data-testid','arpg-dialog');
  dlg.style.cssText='position:fixed;left:50%;bottom:90px;transform:translateX(-50%);width:min(480px,92%);background:rgba(6,10,22,0.95);border:1px solid '+GLOW+'55;border-radius:14px;padding:12px;z-index:70;display:flex;gap:10px;align-items:flex-start';
  const pt=aurl('character_portrait')?'<img src="'+aurl('character_portrait')+'" style="width:52px;height:52px;object-fit:cover;border-radius:10px"/>':'<div style="font-size:34px">\uD83E\uDDD3</div>';
  let body='<b style="color:'+ACC+'">'+n.name+'</b><div style="font-size:12.5px;margin:4px 0">'+(n.dialog||'...')+'</div>';
  if(quest.giver===n.name&&!qDone&&quest.type==='collect'&&qItem)body+='<div style="font-size:11px;color:#10E670">You hand over the '+qItem+'.</div>';
  dlg.innerHTML='<div>'+pt+'</div><div style="flex:1">'+body+'</div>';
  const b=el('button','','\u2713');b.setAttribute('data-testid','arpg-dialog-close');
  b.style.cssText='padding:8px 14px;border-radius:10px;border:1px solid '+GLOW+'66;background:'+GLOW+'22;color:'+T.text+';cursor:pointer';
  b.onclick=()=>{if(quest.giver===n.name&&quest.type==='collect'&&qItem&&!qDone){qDone=true;qItem=null;say('Quest complete! The exit portal opens.');sfx('victory');gainXp(quest.xp||20)}
   dlg.remove();dlg=null;busy=false;setSt('idle')};
  dlg.appendChild(b);document.body.appendChild(dlg)}
 /* touch: left-half virtual joystick + action buttons */
 const latch={};
 document.addEventListener('keydown',e=>{['attack','spell','dodge','interact'].forEach(a=>{if(akeys(a).includes(e.key))latch[a]=true})});
 function tap(a){if(latch[a]){latch[a]=false;return true}return act(a)}
 let joy={on:false,cx:0,cy:0,dx:0,dy:0};
 if(MOB){c.addEventListener('pointerdown',e=>{const r=c.getBoundingClientRect(),x=e.clientX-r.left;
   if(x<W*0.45){joy.on=true;joy.cx=x;joy.cy=e.clientY-r.top;joy.dx=0;joy.dy=0;lastInput='touch'}});
  c.addEventListener('pointermove',e=>{if(!joy.on)return;const r=c.getBoundingClientRect();
   joy.dx=(e.clientX-r.left-joy.cx)/40;joy.dy=(e.clientY-r.top-joy.cy)/40});
  c.addEventListener('pointerup',()=>{joy.on=false;joy.dx=0;joy.dy=0});
  touchRow([{label:'\u2694',key:akeys('attack')[0]||'j',testid:'arpg-touch-attack'},{label:'\u2728',key:akeys('spell')[0]||'k',testid:'arpg-touch-spell'},
            {label:'\uD83D\uDCA8',key:akeys('dodge')[0]||'l',testid:'arpg-touch-dodge'},{label:'\uD83D\uDCAC',key:akeys('interact')[0]||'e',testid:'arpg-touch-talk'}])}
 c.addEventListener('pointerup',e=>{const r2=c.getBoundingClientRect(),wx=e.clientX-r2.left+cam,wy=e.clientY-r2.top;
  const n=npcs.find(n=>Math.abs(n.x-wx)<46&&Math.abs(n.y-wy)<56&&Math.abs(n.x-P.x)<80&&Math.abs(n.y-P.y)<70);
  if(n&&!dlg&&!busy)openDlg(n)});
 let last=0;
 function loop(ts){if(doneFlag)return;raf=requestAnimationFrame(loop);
  const dt=Math.min(0.05,(ts-(last||ts))/1000);last=ts;const t=ts/1000;
  if(PAUSED||dlg){drawWorld(t);drawHUD();drawFx(g,0);return}
  msgT-=dt;P.inv-=dt;P.atkCd-=dt;P.splCd-=dt;P.dgCd-=dt;P.stT+=dt;
  if(Math.random()<dt*2.2)parts.push({x:Math.random()*W,y:Math.random()*H*0.7,vx:-14-Math.random()*12,vy:6+Math.random()*10,life:2.2,color:Math.random()<0.5?GLOW:ACC,r:1+Math.random()*1.6});
  stam=Math.min(sMax,stam+dt*14);mana=Math.min(mMax,mana+dt*0.7);
  if(!busy){
   let ix=(act('right')?1:0)-(act('left')?1:0),iy=(act('down')?1:0)-(act('up')?1:0);
   if(joy.on){ix+=Math.max(-1,Math.min(1,joy.dx));iy+=Math.max(-1,Math.min(1,joy.dy))}
   try{const gp=navigator.getGamepads&&navigator.getGamepads()[0];// controller support
    if(gp){if(Math.abs(gp.axes[0])>0.25)ix+=gp.axes[0];if(Math.abs(gp.axes[1])>0.25)iy+=gp.axes[1];
     if(gp.buttons[0]&&gp.buttons[0].pressed)keys[akeys('attack')[0]||'j']=true;
     if(gp.buttons[2]&&gp.buttons[2].pressed)keys[akeys('spell')[0]||'k']=true;
     if(gp.buttons[1]&&gp.buttons[1].pressed)keys[akeys('dodge')[0]||'l']=true}}catch(e){}
   const mag=Math.hypot(ix,iy);if(mag>1){ix/=mag;iy/=mag}
   const SPD=170*SENS;
   P.vx+=(ix*SPD-P.vx)*Math.min(1,dt*9);P.vy+=(iy*SPD*0.75-P.vy)*Math.min(1,dt*9);// accel/decel
   if(ix)P.face=ix>0?1:-1;
   if(P.st!=='attack'&&P.st!=='cast'&&P.st!=='dodge'||P.stT>0.35){
    if(mag>0.6)setSt('run');else if(mag>0.05)setSt('walk');else if(!['attack','cast','dodge','hurt','death','interact'].includes(P.st)||P.stT>0.4)setSt('idle')}
   tryMove(P,P.vx*dt,P.vy*dt,9);
   if(tap('attack')&&P.atkCd<=0){clr('attack');meleeHit()}
   if(tap('spell')&&P.splCd<=0){clr('spell');castSpell()}
   if(tap('dodge')&&P.dgCd<=0){clr('dodge');doDodge()}
   if(tap('interact')){clr('interact');const n=npcs.find(n=>Math.abs(n.x-P.x)<60&&Math.abs(n.y-P.y)<50);
    if(n)openDlg(n);else if(AX.potions>0&&pHp<pMax){AX.potions--;pHp=Math.min(pMax,pHp+12);sfx('collect');say('Potion used (+12)');savePt()}}
   if(MOB&&!joy.on){const n=npcs.find(n=>Math.abs(n.x-P.x)<60&&Math.abs(n.y-P.y)<50);if(n&&keys[akeys('interact')[0]||'e'])openDlg(n)}
  }
  if(P.burn>0){P.burn-=dt;if(Math.random()<dt*1.5)hurt(1,0)}
  /* trigger volumes: checkpoint / loot / drops / exit */
  if(!cpReached&&Math.abs(P.x-check.x)<24&&Math.abs(P.y-check.y)<40){cpReached=true;say('\u2691 Checkpoint reached');sfx('stage');popup(P.x-cam,P.y-44,'\u2691 CHECKPOINT','#10E670');savePt()}
  loots.forEach(l=>{if(!l.got&&Math.abs(l.x-P.x)<22&&Math.abs(l.y-P.y)<26){l.got=true;sfx('collect');addScore(10);
   if(l.kind==='equipment'){AX.eqp={name:l.name||'Runed Staff',power:l.power||3};say('Equipped '+AX.eqp.name+' (+'+AX.eqp.power+' atk)')}
   else if(l.kind==='quest_item'){qItem=l.name||quest.item||'Relic';say('Found the '+qItem+' \u2014 return it to '+(quest.giver||'the giver'))}
   else{AX.potions++;say('Found a potion!')}savePt()}});
  drops=drops.filter(d2=>{if(Math.abs(d2.x-P.x)<20&&Math.abs(d2.y-P.y)<24){AX.potions++;sfx('collect');say('Potion looted');savePt();return false}return true});
  if(Math.abs(P.x-ex.x)<26&&Math.abs(P.y-(ex.y||GY+50))<44){
   if(qDone&&(!B||B.dead)){doneFlag=true;cancelAnimationFrame(raf);addScore(30);savePt();fb(true,'Region cleared!'+unlockMsg(),next);return}
   else if(msgT<=0)say(B&&!B.dead?'The '+(B.name||'boss')+' still guards the way.':'The portal is sealed \u2014 finish the quest first.')}
  projs=projs.filter(p=>{p.x+=p.vx*dt;p.life-=dt;
   const f=foes.find(f=>!f.dead&&Math.abs(f.x-p.x)<16&&Math.abs(f.y-p.y+10)<26);
   if(f){hitFoe(f,Math.round(pAtk()*0.8),Math.sign(p.vx),false);if(p.burn){f.burn=2}return false}
   if(B&&!B.dead&&B.engaged&&Math.abs(B.x-p.x)<26&&Math.abs(B.y-p.y+12)<34){bossHit(Math.round(pAtk()*0.8),false);return false}
   return p.life>0&&!collide(p.x,P.y,2)===true||p.life>0});
  eprojs=eprojs.filter(p=>{p.x+=p.vx*dt;p.y+=(p.vy||0)*dt;p.life-=dt;
   if(Math.abs(P.x-p.x)<14&&Math.abs(P.y-10-p.y)<22){hurt(3,Math.sign(p.vx));if(p.burn)P.burn=1.5;return false}
   return p.life>0});
  foes.forEach(f=>foeAI(f,dt));bossAI(dt);
  /* camera: follow + look-ahead + bounds + shake */
  let target=P.x-W*0.42+P.face*46+P.vx*0.18;
  if(B&&B.engaged&&!B.dead)target=Math.max(target,B.x-(st.arena_w||420));
  cam+=(Math.max(0,Math.min(WORLD-W,target))-cam)*Math.min(1,dt*4.5);
  if(shakeT>0){shakeT-=dt;cam+=Math.sin(t*70)*shakeT*14}
  drawWorld(t);drawFx(g,dt);drawHUD()}
 ctrlGuide();say(quest.text?('Quest: '+quest.text):'Explore the region');raf=requestAnimationFrame(loop)}

/* ── 2.5D side-scroll mode (action_rpg_2_5d · gravity platform adventure)
   Countdown, gravity/jump physics, one-way + moving + crumbling platforms,
   biome hazards (water/lava/crystal) with restart-level-on-death, walker/bat/
   spitter AI, hovering multi-phase dragon boss w/ breath volleys + swoops,
   pickups (coins/gems/potions/mana/fire), per-level asset slots (_l2/_l3). ── */
function arpgSS(st){const c=mkCanvas(MOB?70:8),g=c.getContext('2d'),W=c.width,H=c.height,k=H/360;
 const LP=st.palette||{};const LG=LP.glow||GLOW,LA=LP.accent||ACC,LH=LP.hazard||HAZC;
 const WORLD=Math.max(1200,st.width||2200),HZ=st.hazard||'water',ZONE=st.zone||'forest';
 const sk=q=>{const sf=st.asset_suffix!==undefined?st.asset_suffix:(stageIdx?'_l'+(stageIdx+1):'');
  const s2=q+sf;return sf&&AST[s2]&&AST[s2].url?s2:q};
 const limg=q=>aimg(sk(q));
 const AX=SAVE_X.arpg||(SAVE_X.arpg={lvl:1,xp:0,eqp:null,potions:1});
 let pMax=(st.player_hp||24)+((AX.lvl-1)*3),mMax=st.player_mana||12;
 let atkBase=6+(AX.lvl-1)*2,doneFlag=false,raf=null,busy=true,cd3=3.6;
 let pHp,mana,P,foes,B,picks,projs,eprojs,cam,shakeT,msg='',msgT=0,coins,gems,firePk,crumb,cpIdx,fireBuff=0,rapid=0,props,fp,keysL;
 const FPV={walker:3,spitter:5,bat:4,brute:10};
 const PLATS=(st.platforms||[]).map(p=>({...p}));
 const FEAT=st.features||[];
 const CPX=(st.checkpoints_x&&st.checkpoints_x.length?st.checkpoints_x:(st.checkpoint_x?[st.checkpoint_x]:[])).slice().sort((a,b)=>a-b);
 const FO=22*k,HERO=104*(st.hero_scale||1)*k;const wrap2=(v,m)=>((v%m)+m)%m;
 const AMB=st.ambient==='bright';const KEYNEED=(st.exit&&st.exit.requires_keys)||0;let keyHintT=0,endT=0;
 const WH=Math.max(360,(st.world_h||360))*k;let camY=0;
 function pTop(p,t){return (p.y+(p.move?Math.sin(t*(p.move.speed||1)+(p.move.ph||0))*(p.move.amp||0):0))*k}
 function groundYAt(x){let best=(st.ground_default!==undefined?st.ground_default:(st.world_h||360)-58)*k;
  PLATS.forEach(p=>{if(p.move||p.crumble)return;
  if(x>=p.x-6&&x<=p.x+p.w+6){const pt=p.y*k;if(pt<best)best=pt}});return best}
 function resetLevel(keepCp){if(!keepCp)cpIdx=-1;pHp=pMax;mana=mMax;shakeT=0;projs=[];eprojs=[];crumb={};fireBuff=0;
  const keptKeys=keepCp&&picks?keysL:0;
  const keptKeyXs=keepCp&&picks?picks.filter(p=>p.got&&p.kind==='key').map(p=>p.x):[];
  const cx0=cpIdx>=0?CPX[cpIdx]:(st.start_x||60);
  P={x:cx0,y:groundYAt(cx0)-FO,vx:0,vy:0,face:1,onG:true,st:'idle',stT:0,inv:1.2,atkCd:0,splCd:0,dgCd:0,coyote:0,land:0,animT:0,
   pose:{rot:0,sx:1,sy:1,oy:0,ox:0}};
  cam=Math.max(0,Math.min(WORLD-W,P.x-W*0.38));
  camY=Math.max(0,Math.min(WH-H,P.y-H*0.55));
  foes=(st.enemies||[]).map((e,i)=>({...e,id:i,mx:e.hp||10,x:e.x,y:0,vx:0,vy:0,cd:1,tele:0,dir:1,flash:0,dead:false,
   type:e.type||'walker',speed:e.speed||45,ph:Math.random()*6}));
  picks=(st.pickups||[]).map(p=>({...p,got:p.kind==='key'&&keptKeyXs.indexOf(p.x)>=0}));coins=0;gems=0;firePk=0;rapid=0;fp=0;keysL=keptKeys;
  props=(st.props||[]).map(p=>({...p,broken:false}));
  B=st.boss?{...st.boss,mx:st.boss.hp||60,x:st.boss.x||WORLD-260,by:(st.boss.y||120)*k,y:(st.boss.y||120)*k,vx:0,cd:2,
   tele:0,mode:'volley',phase:1,phases:st.boss.phases||2,engaged:false,dead:false,dying:0,flash:0,enraged:false,bre:0,breA:0,wob:0}:null}
 resetLevel(false);
 function say(m){msg=m;msgT=3}
 function setSt(s){if(P.st!==s){P.st=s;P.stT=0}}
 function gainXp(n){AX.xp+=n;addScore(n);if(AX.xp>=AX.lvl*30){AX.lvl++;atkBase+=2;pMax+=3;pHp=pMax;sfx('achievement');
  popup(P.x-cam,P.y-60*k,'LEVEL '+AX.lvl+'!',LA);burst(P.x-cam,P.y-20*k,LA,20,150)}saveGame()}
 function pAtk(){return Math.round((atkBase+(AX.eqp?AX.eqp.power||2:0))*(fireBuff>0?1.5:1))}
 function die(reason){if(doneFlag||busy)return;busy=true;setSt('death');sfx('gameover');shakeT=0.4;vib(120);
  burst(P.x-cam,P.y,LH,20,160);
  setTimeout(()=>{lives--;refreshHud();
   if(lives<=0){doneFlag=true;cancelAnimationFrame(raf);gameOver();return}
   say(reason+(cpIdx>=0?' — back to the checkpoint':' — level restarted'));resetLevel(true);cd3=2.2;P.inv=1.8;busy=true},900)}
 function hazardRespawn(){if(doneFlag||busy)return;busy=true;setSt('death');shakeT=0.35;vib(90);sfx('hit');
  burst(P.x-cam,H-30*k,HZ==='lava'?'#FF8A3D':HZ==='crystal'?'#B14BF4':'#6ec6ff',22,170);
  setTimeout(()=>{lives--;refreshHud();
   if(lives<=0){doneFlag=true;cancelAnimationFrame(raf);gameOver();return}
   const cx0=cpIdx>=0?CPX[cpIdx]:(st.start_x||60);
   P.x=cx0;P.y=groundYAt(cx0)-FO;P.vx=0;P.vy=0;P.onG=true;P.inv=1.8;setSt('idle');busy=false;
   say(cpIdx>=0?'\u2691 Returned to checkpoint':'\u2691 Returned to the start')},700)}
 function hurt(dmg,kx){if(P.inv>0||P.st==='dodge'||busy)return;pHp-=dmg;P.inv=0.9;P.vx+=kx*150;setSt('hurt');shakeT=0.25;vib(60);sfx('hit');
  burst(P.x-cam,P.y,LH,9,110);if(pHp<=0)die('You fell in battle')}
 function hitFoe(f,dmg,kx,crit){f.hp-=dmg;f.flash=0.15;f.vx+=kx*100;sfx('hit');shakeT=Math.max(shakeT,0.07);
  burst(f.x-cam,f.y,crit?'#FFD34D':LG,crit?13:7,100);
  popup(f.x-cam,f.y-30,(crit?'CRIT ':'')+dmg,crit?'#FFD34D':T.text);
  if(f.hp<=0){f.dead=true;gainXp(f.xp||7);burst(f.x-cam,f.y,LA,14,130);
   const fv=FPV[f.type]||3;fp+=fv;popup(f.x-cam,f.y-48,'+'+fv+' \uD83D\uDD25','#FF7A3D');
   if(Math.random()<0.35)picks.push({x:f.x,y:(f.y/k)-14,kind:Math.random()<0.5?'coin':'potion',got:false})}}
 function bossHit(dmg,crit){if(!B||B.dead||B.dying>0)return;B.hp-=dmg;B.flash=0.15;shakeT=Math.max(shakeT,0.1);
  popup(B.x-cam,B.y-70,(crit?'CRIT ':'')+dmg,'#FFD34D');
  burst(B.x-cam,B.y,crit?'#FFD34D':LG,crit?14:8,120);
  const pct=B.hp/B.mx,ph=Math.min(B.phases,1+Math.floor((1-pct)*B.phases));
  if(ph>B.phase){B.phase=ph;B.tele=0.9;shakeT=0.5;say(B.name+' enters phase '+ph+'!');sfx('stage');
   for(let i=0;i<24;i++)parts.push({x:B.x-cam+(Math.random()-0.5)*80,y:B.y+(Math.random()-0.5)*60,vx:(Math.random()-0.5)*160,vy:-Math.random()*120,life:1,color:'#FF8A3D',r:2.4})}
  if(!B.enraged&&pct<=(st.boss.enrage_pct||0.22)){B.enraged=true;say(B.name+' is ENRAGED!');shakeT=0.5}
  if(B.hp<=0){B.dying=1.5;B.bre=0;sfx('victory');say(B.name+' falls!')}}
 function meleeHit(){const R=62*k,cx=P.x+P.face*34*k;setSt('attack');P.atkCd=0.38;sfx('laser');
  const crit=Math.random()<0.12,dmg=Math.round(pAtk()*(crit?2:1));
  burst(P.x-cam+P.face*30*k,P.y-14*k,fireBuff>0?'#FF8A3D':LG,6,90);
  props.forEach(pr=>{if(!pr.broken&&Math.abs(pr.x-cx)<R&&Math.abs((pr.y!==undefined?pr.y*k:groundYAt(pr.x))-14*k-P.y)<70*k){pr.broken=true;
   sfx('collect');burst(pr.x-cam,groundYAt(pr.x)-14*k,'#FFD34D',14,130);popup(pr.x-cam,groundYAt(pr.x)-40*k,'TREASURE!','#FFD34D');
   const gyc=groundYAt(pr.x)/k;const r2=Math.random();
   picks.push({x:pr.x-16,y:gyc-16,kind:'coin',got:false});
   picks.push({x:pr.x+16,y:gyc-16,kind:'coin',got:false});
   picks.push({x:pr.x,y:gyc-30,kind:r2<0.35?'gem':r2<0.65?'potion':r2<0.85?'fire':'star',got:false})}});
  foes.forEach(f=>{if(!f.dead&&Math.abs(f.x-cx)<R&&Math.abs(f.y-P.y)<72*k)hitFoe(f,dmg,P.face,crit)});
  if(B&&!B.dead&&!B.dying&&B.engaged&&Math.abs(B.x-cx)<R+44*k&&Math.abs(B.y-P.y)<100*k)bossHit(dmg,crit)}
 function castSpell(){const cost=rapid>0?1:3;if(mana<cost){say('Not enough mana');sfx('wrong');return}mana-=cost;
  setSt('cast');P.splCd=rapid>0?0.28:0.75;sfx('combo');
  const bh=B&&!B.dead&&!B.dying&&B.engaged&&Math.abs(B.x-P.x)<460;
  burst(P.x-cam+P.face*20*k,P.y-24*k,fireBuff>0?'#FF8A3D':LG,8,80);
  projs.push({x:P.x+P.face*22*k,y:P.y-16*k,vx:P.face*400,vy:bh?(B.y-(P.y-16*k))*0.95:0,life:1.7,fire:fireBuff>0})}
 function doDodge(){if(P.dgCd>0)return;setSt('dodge');P.dgCd=0.9;P.inv=0.45;P.vx=P.face*380;sfx('click');burst(P.x-cam,P.y+8,LG,6,60)}
 function landOn(t,prevY){if(P.vy<0)return;for(let i=0;i<PLATS.length;i++){const p=PLATS[i];
   if(p.crumble&&crumb[i]&&crumb[i].gone>0)continue;
   const pt=pTop(p,t);
   if(P.x>p.x-8&&P.x<p.x+p.w+8&&prevY+FO<=pt+4&&P.y+FO>=pt){P.y=pt-FO;P.vy=0;
    if(!P.onG){P.land=0.18;if(P.st==='fall'||P.st==='jump')setSt('idle');burst(P.x-cam,P.y+FO,'#ffffff55',4,50)}
    P.onG=true;P.coyote=0.12;P.dbl=false;
    if(p.crumble){crumb[i]=crumb[i]||{t:0,gone:0};crumb[i].t+=0.016;
     if(crumb[i].t>0.55){crumb[i].gone=2.8;sfx('hit');burst(P.x-cam,pt,'#8a6a4a',10,100)}}
    return}}
  P.onG=false}
 function foeAI(f,dt,t){if(f.dead)return;f.cd-=dt;f.flash-=dt;
  const dx=P.x-f.x,dy=P.y-f.y,d=Math.hypot(dx,dy);
  if(f.type==='bat'){f.y=(f.anchor_y||110)*k+Math.sin(t*2+f.ph)*26*k;
   if(d<230&&f.cd<=0&&f.tele<=0)f.tele=0.4;
   if(f.tele>0){f.tele-=dt;if(f.tele<=0){f.cd=1.7;const m=Math.max(1,d);eprojs.push({x:f.x,y:f.y,vx:dx/m*215,vy:dy/m*215,life:1.7})}}
   f.x+=Math.sin(t*1.3+f.ph)*24*dt;return}
  const p=PLATS[f.pi||0]||PLATS[0];const eh=f.type==='brute'?32*k:24*k;f.y=pTop(p,t)-eh;
  if(f.type==='spitter'){if(d<280&&f.cd<=0&&f.tele<=0)f.tele=0.5;
   if(f.tele>0){f.tele-=dt;if(f.tele<=0){f.cd=2;eprojs.push({x:f.x,y:f.y-8*k,vx:Math.sign(dx)*245,vy:-40,life:1.9})}}
   return}
  const rng=f.type==='brute'?38:28,atk=f.attack||(f.type==='brute'?6:3),spd2=f.type==='brute'?f.speed*0.6:f.speed;
  if(d<200){f.dir=Math.sign(dx)||1;f.x+=f.dir*spd2*dt;
   if(Math.abs(dx)<rng&&Math.abs(dy)<56*k&&f.cd<=0){f.cd=f.type==='brute'?1.6:1.1;hurt(atk,Math.sign(dx)*-1||-1);
    if(f.type==='brute')shakeT=0.2}}
  else{if(f.x<p.x+8)f.dir=1;if(f.x>p.x+p.w-8)f.dir=-1;f.x+=f.dir*spd2*0.5*dt}
  f.x=Math.max(p.x+4,Math.min(p.x+p.w-4,f.x))}
 function bossAI(dt,t){if(!B||B.dead)return;B.flash-=dt;
  if(B.dying>0){B.dying-=dt;B.by+=190*k*dt;B.y=B.by;B.wob+=dt*7;
   if(Math.random()<dt*14)burst(B.x-cam+(Math.random()-0.5)*70,B.y+(Math.random()-0.5)*50,'#FFD34D',8,140);
   if(B.dying<=0){B.dead=true;B.engaged=false;gainXp(st.boss.xp||45);shakeT=0.6;
    fp+=1000;popup(B.x-cam,B.y-40,'+1000 \uD83D\uDD25 BOSS SLAIN','#FF7A3D');
    burst(B.x-cam,B.y,'#FFD34D',44,220);burst(B.x-cam,B.y,'#FF8A3D',30,160);sfx('victory');
    picks.push({x:B.x-40,y:270,kind:'fire',got:false});picks.push({x:B.x+40,y:270,kind:'potion',got:false});
    say(B.name+' defeated! Enter the portal \u27A1');saveGame()}return}
  const dx=P.x-B.x,d=Math.abs(dx);
  if(!B.engaged&&d<380){B.engaged=true;say(B.name+' descends!');shakeT=0.45;sfx('stage')}
  if(!B.engaged)return;B.cd-=dt;
  const rage=(B.enraged?1.5:1)*(1+(B.phase-1)*0.3);
  B.y=B.by+Math.sin(t*1.6)*20*k;
  if(B.bre>0){B.bre-=dt;B.breA+=dt;
   if(B.breA>0.06){B.breA=0;const a=Math.sin(t*9)*0.24;
    eprojs.push({x:B.x+Math.sign(dx)*46*k,y:B.y+6*k,vx:Math.sign(dx)*330*rage,vy:a*130,life:1.6,fire:true})}
   if(d<120&&Math.abs(B.y-P.y)<60*k)hurt(2,Math.sign(dx));return}
  if(B.tele>0){B.tele-=dt;if(B.tele<=0){
   if(B.mode==='swoop'){B.vx=Math.sign(dx)*320;setTimeout(()=>B.vx=0,420);
    if(d<120&&Math.abs(B.y-P.y)<75*k)hurt(Math.round((B.attack||6)*1.2),Math.sign(dx))}
   else if(B.mode==='breath'){B.bre=0.8;B.breA=0.1;sfx('boost')}
   else{const n=2+B.phase;for(let i=0;i<n;i++){const a=Math.atan2((P.y-B.y),(P.x-B.x))+(i-(n-1)/2)*0.22;
     eprojs.push({x:B.x,y:B.y,vx:Math.cos(a)*235*rage,vy:Math.sin(a)*235*rage,life:2.2,fire:true})}}
   B.cd=(B.enraged?1:1.7)/Math.sqrt(rage)}return}
  if(B.cd<=0){B.atkN=(B.atkN||0)+1;
   B.mode=(d<160&&B.phase>1)?'swoop':(B.phase>=2&&B.atkN%3===0)?'breath':'volley';
   B.tele=B.enraged?0.35:0.55}
  const gy=groundYAt(P.x);
  B.by+=(Math.max(120*k,Math.min(gy-46*k,P.y-34*k))-B.by)*dt*0.8;
  B.x+=B.vx*dt;B.x=Math.max(st.arena_x||WORLD-520,Math.min(WORLD-60,B.x))}
 /* ── animation blending ── */
 const POSES={idle:s=>({rot:0,sx:1,sy:1+Math.sin(s.t*2.4)*0.018,oy:0,ox:0}),
  walk:s=>({rot:s.f*0.03,sx:1,sy:1+Math.abs(Math.sin(s.t*7))*0.03,oy:-Math.abs(Math.sin(s.t*7))*2*k,ox:0}),
  run:s=>({rot:s.f*0.07,sx:1,sy:1+Math.abs(Math.sin(s.t*10))*0.05,oy:-Math.abs(Math.sin(s.t*10))*3.4*k,ox:0}),
  jump:s=>({rot:-s.f*0.06,sx:0.94,sy:1.08,oy:-2*k,ox:0}),
  fall:s=>({rot:s.f*0.05,sx:1.05,sy:0.93,oy:0,ox:0}),
  attack:s=>({rot:s.f*(s.st<0.14?0.2:0.1),sx:1.05,sy:0.97,oy:0,ox:s.f*(s.st<0.16?9:4)*k}),
  cast:s=>({rot:-s.f*0.05,sx:0.97,sy:1.05,oy:-2*k,ox:-s.f*3*k}),
  dodge:s=>({rot:s.f*0.55,sx:1.06,sy:0.9,oy:2*k,ox:s.f*5*k}),
  hurt:s=>({rot:-s.f*0.14,sx:1.04,sy:0.95,oy:0,ox:-s.f*4*k}),
  death:s=>({rot:s.f*Math.min(1.5,s.st*2.4),sx:1,sy:1,oy:s.st*26*k,ox:0})};
 function drawHero(t,dt){if(P.inv>0&&P.st!=='dodge'&&P.st!=='death'&&Math.floor(t*14)%2)return;
  const tgt=(POSES[P.st]||POSES.idle)({t:t,f:P.face,st:P.stT});
  if(P.land>0){tgt.sy*=0.86;tgt.sx*=1.1}
  const po=P.pose,bl=Math.min(1,dt*13);
  po.rot+=(tgt.rot-po.rot)*bl;po.sx+=(tgt.sx-po.sx)*bl;po.sy+=(tgt.sy-po.sy)*bl;
  po.oy+=(tgt.oy-po.oy)*bl;po.ox+=((tgt.ox||0)-po.ox)*bl;
  const hx=P.x-cam+po.ox,hy=P.y+FO-HERO*0.303+po.oy;
  g.save();g.globalAlpha=0.32;g.fillStyle='#000';g.beginPath();g.ellipse(P.x-cam,P.y+FO,20*k,5*k,0,0,7);g.fill();g.restore();
  if(fireBuff>0){const fg2=g.createRadialGradient(hx,hy,4,hx,hy,54*k);
   fg2.addColorStop(0,'rgba(255,140,60,0.28)');fg2.addColorStop(1,'rgba(255,140,60,0)');
   g.fillStyle=fg2;g.beginPath();g.arc(hx,hy,54*k,0,7);g.fill()}
  g.save();g.translate(hx,hy);g.rotate(po.rot);g.scale(po.sx,po.sy);
  if(P.st==='death')g.globalAlpha=Math.max(0.25,1-P.stT*0.8);
  if(!drawSpr(g,sk('player_sprite'),0,0,HERO,0,P.animT,P.face<0)){
   g.scale(P.face*k,k);g.fillStyle=PCOL[0];g.fillRect(-13,-30,26,44);g.fillStyle='#F2C9A0';g.beginPath();g.arc(0,-40,10,0,7);g.fill();
   g.strokeStyle='#8A5A2B';g.lineWidth=4;g.beginPath();g.moveTo(13,-6);g.lineTo(20,-44);g.stroke();
   g.fillStyle=LG;g.beginPath();g.arc(20,-48,5,0,7);g.fill()}
  g.restore();
  if(P.st==='attack'&&P.stT<0.18){g.save();g.translate(P.x-cam,P.y-16*k);g.scale(P.face,1);
   g.strokeStyle=fireBuff>0?'#FF8A3D':LG;g.lineWidth=3.5;g.shadowColor=LG;g.shadowBlur=14;g.globalAlpha=1-P.stT*4.5;
   g.beginPath();g.arc(0,0,52*k,-1.1+P.stT*5,0.4+P.stT*5);g.stroke();g.restore()}
  if(P.st==='cast'&&P.stT<0.3){g.save();g.strokeStyle=LG;g.globalAlpha=1-P.stT*3;g.lineWidth=2;
   g.beginPath();g.arc(P.x-cam,P.y-16*k,20*k+P.stT*120*k,0,7);g.stroke();g.restore()}}
 /* ── zone mid-layer silhouettes (parallax 0.45) ── */
 function midLayer(t){const off=cam*0.45;g.save();
  if(ZONE==='forest'){
   for(let i=0;i<3;i++){const cx3=wrap2(hz(i*3)*W*2-cam*0.08-t*6,W+240)-120,cy3=H*(0.07+hz(i*7)*0.13);
    g.fillStyle='rgba(235,240,255,0.10)';g.beginPath();g.ellipse(cx3,cy3,70,16,0,0,7);g.fill();
    g.beginPath();g.ellipse(cx3+42,cy3-8,46,13,0,0,7);g.fill()}
   for(let i=0;i<3;i++){const rx=wrap2(i*W*0.42-cam*0.3,W+320)-160;
    g.save();g.globalAlpha=0.05+Math.sin(t*0.7+i*2)*0.02;g.fillStyle='#ffe9a8';
    g.beginPath();g.moveTo(rx,0);g.lineTo(rx+90,0);g.lineTo(rx-70,H);g.lineTo(rx-170,H);g.fill();g.restore()}
   g.fillStyle='rgba(16,40,60,0.55)';
   const cx2=W*0.55-((cam*0.22)%(W*2));
   [[cx2,H*0.30],[cx2+W*2,H*0.30]].forEach(cp2=>{const bx=cp2[0],by=cp2[1];
    g.fillRect(bx-26,by-40,52,60);g.fillRect(bx-54,by-16,26,36);g.fillRect(bx+28,by-16,26,36);
    g.beginPath();g.moveTo(bx-26,by-40);g.lineTo(bx,by-64);g.lineTo(bx+26,by-40);g.fill();
    g.beginPath();g.moveTo(bx-54,by-16);g.lineTo(bx-41,by-34);g.lineTo(bx-28,by-16);g.fill();
    g.beginPath();g.moveTo(bx+28,by-16);g.lineTo(bx+41,by-34);g.lineTo(bx+54,by-16);g.fill()});
   g.fillStyle='rgba(10,34,22,0.72)';g.beginPath();g.moveTo(0,H);
   for(let x=0;x<=W;x+=26){const n=hz(Math.floor((x+off)/26));g.lineTo(x,H*0.52-n*H*0.16)}
   g.lineTo(W,H);g.fill();
   g.fillStyle='rgba(6,24,14,0.8)';g.beginPath();g.moveTo(0,H);
   for(let x=0;x<=W;x+=18){const n=hz(Math.floor((x+cam*0.6)/18)+77);g.lineTo(x,H*0.66-n*H*0.12)}
   g.lineTo(W,H);g.fill()}
  else if(ZONE==='caves'){
   for(let x=0;x<=W;x+=44){const n=hz(Math.floor((x+off)/44)+11);
    g.fillStyle='rgba(90,50,160,0.20)';g.beginPath();
    g.moveTo(x,0);g.lineTo(x+16,(0.16+n*0.3)*H);g.lineTo(x+32,0);g.fill()}
   for(let x=0;x<=W;x+=52){const n=hz(Math.floor((x+cam*0.6)/52)+31);
    g.fillStyle='rgba(140,80,220,'+(0.10+n*0.14)+')';g.beginPath();
    g.moveTo(x,H);g.lineTo(x+14,H-(0.2+n*0.34)*H);g.lineTo(x+28,H);g.fill()}
   for(let i=0;i<7;i++){const gx=(hz(i*13)*W*3-off)%(W+200)-100,gy=H*(0.2+hz(i*7)*0.4);
    const gl=g.createRadialGradient(gx,gy,0,gx,gy,46);gl.addColorStop(0,'rgba(185,139,255,'+(0.10+Math.sin(t*1.4+i)*0.05)+')');gl.addColorStop(1,'rgba(185,139,255,0)');
    g.fillStyle=gl;g.beginPath();g.arc(gx,gy,46,0,7);g.fill()}}
  else if(ZONE==='nexus'){
   for(let i=0;i<26;i++){const sx2=wrap2(hz(i*5)*W*3-cam*0.06,W+40)-20,sy2=hz(i*11)*H*0.9;
    g.fillStyle='rgba(230,240,255,'+(0.25+Math.sin(t*1.2+i*2)*0.2)+')';g.fillRect(sx2,sy2,1.6,1.6)}
   for(let i=0;i<4;i++){const nx2=wrap2(hz(i*9)*W*2.5-cam*0.12,W+340)-170,ny2=H*(0.12+hz(i*3)*0.4);
    const ng=g.createRadialGradient(nx2,ny2,0,nx2,ny2,120);
    ng.addColorStop(0,'rgba('+(i%2?'150,90,255':'70,190,255')+','+(0.08+Math.sin(t*0.8+i)*0.03)+')');
    ng.addColorStop(1,'rgba(80,60,200,0)');
    g.fillStyle=ng;g.beginPath();g.arc(nx2,ny2,120,0,7);g.fill()}
   for(let i=0;i<5;i++){const rx2=wrap2(hz(i*17)*W*2.4-cam*0.3,W+260)-130,ry2=H*(0.14+hz(i*23)*0.34)+Math.sin(t*0.9+i*2)*8;
    g.fillStyle='rgba(26,20,52,0.85)';g.beginPath();
    g.moveTo(rx2-34,ry2);g.lineTo(rx2-12,ry2-16);g.lineTo(rx2+22,ry2-12);g.lineTo(rx2+34,ry2+4);g.lineTo(rx2+10,ry2+18);g.lineTo(rx2-24,ry2+14);g.fill();
    g.fillStyle='rgba(120,90,255,'+(0.3+Math.sin(t*2+i)*0.15)+')';
    g.beginPath();g.moveTo(rx2+6,ry2-12);g.lineTo(rx2+12,ry2-26);g.lineTo(rx2+18,ry2-12);g.fill()}}
  else{
   g.fillStyle='rgba(60,16,8,0.65)';g.beginPath();g.moveTo(0,H);
   for(let x=0;x<=W;x+=30){const n=hz(Math.floor((x+off)/30)+5);g.lineTo(x,H*0.42-n*H*0.2)}
   g.lineTo(W,H);g.fill();
   const vx2=W*0.62-((cam*0.2)%(W*2.2));
   g.fillStyle='rgba(40,10,6,0.85)';g.beginPath();g.moveTo(vx2-90,H*0.55);g.lineTo(vx2,H*0.16);g.lineTo(vx2+90,H*0.55);g.fill();
   const vg2=g.createRadialGradient(vx2,H*0.16,0,vx2,H*0.16,54);
   vg2.addColorStop(0,'rgba(255,120,40,'+(0.4+Math.sin(t*2.6)*0.15)+')');vg2.addColorStop(1,'rgba(255,120,40,0)');
   g.fillStyle=vg2;g.beginPath();g.arc(vx2,H*0.16,54,0,7);g.fill();
   g.fillStyle='rgba(28,8,4,0.85)';g.beginPath();g.moveTo(0,H);
   for(let x=0;x<=W;x+=22){const n=hz(Math.floor((x+cam*0.6)/22)+91);g.lineTo(x,H*0.6-n*H*0.14)}
   g.lineTo(W,H);g.fill()}
  g.restore()}
 function drawFeature(f,t){const fx=f.x-cam;if(fx<-260||fx>W+260)return;
  const gy0=(f.y!==undefined?f.y*k:groundYAt(f.x));
  if(f.type==='arch'){const gy=gy0,ac=f.color||'#B14BF4';g.save();
   g.fillStyle='#241d2e';g.fillRect(fx-30,gy-74*k,10,74*k);g.fillRect(fx+20,gy-74*k,10,74*k);
   g.fillStyle='#332a40';g.beginPath();g.arc(fx,gy-70*k,32,Math.PI,0);g.fill();
   const ag=g.createRadialGradient(fx,gy-40*k,2,fx,gy-40*k,34);
   ag.addColorStop(0,'rgba(255,255,255,0.8)');ag.addColorStop(0.4,ac+'bb');ag.addColorStop(1,'rgba(20,8,40,0)');
   g.fillStyle=ag;g.globalAlpha=0.75+Math.sin(t*2.4)*0.2;
   g.beginPath();g.ellipse(fx,gy-38*k,22,38*k,0,0,7);g.fill();g.globalAlpha=1;
   for(let i=0;i<4;i++){const a4=t*1.8+i*1.6;g.fillStyle=ac;g.globalAlpha=0.5;
    g.beginPath();g.arc(fx+Math.cos(a4)*26,gy-38*k+Math.sin(a4)*34*k,1.8,0,7);g.fill()}
   g.globalAlpha=1;g.restore();return}
  if(f.type==='waterfall'){const top=(f.top||150)*k,w2=f.w||46;
   g.save();const wg=g.createLinearGradient(fx,top,fx,H);
   wg.addColorStop(0,'rgba(160,220,255,0.10)');wg.addColorStop(1,'rgba(120,190,255,0.34)');
   g.fillStyle=wg;g.fillRect(fx-w2/2,top,w2,H-top);
   g.strokeStyle='rgba(220,245,255,0.5)';g.lineWidth=2;
   for(let i=0;i<5;i++){const yy=((t*230+i*(H-top)/5)%(H-top));
    g.globalAlpha=0.5-yy/(H-top)*0.3;g.beginPath();
    g.moveTo(fx-w2/2+4+i*(w2-8)/5,top+yy);g.lineTo(fx-w2/2+4+i*(w2-8)/5,top+yy+22);g.stroke()}
   g.globalAlpha=0.32;g.fillStyle='#cfeaff';g.beginPath();g.ellipse(fx,H-22*k,w2*0.9,8,0,0,7);g.fill();
   g.restore();
   if(Math.random()<0.1)parts.push({x:fx+(Math.random()-0.5)*w2,y:H-26*k,vx:(Math.random()-0.5)*40,vy:-40-Math.random()*40,life:0.6,color:'#bfe6ff',r:1.6})}
  else if(f.type==='cave'){const gy=gy0,w2=f.w||160;
   g.save();const cg=g.createRadialGradient(fx,gy,10,fx,gy,w2*0.7);
   cg.addColorStop(0,'rgba(2,4,10,0.85)');cg.addColorStop(1,'rgba(2,4,10,0)');
   g.fillStyle=cg;g.beginPath();g.ellipse(fx,gy,w2*0.62,w2*0.42,0,3.14,0);g.fill();
   g.strokeStyle='rgba(0,0,0,0.5)';g.lineWidth=6;g.beginPath();g.ellipse(fx,gy,w2*0.55,w2*0.36,0,3.14,0);g.stroke();g.restore()}
  else if(f.type==='tree'){const gy=gy0;g.save();
   const vr=hz(Math.floor(f.x/13));
   g.fillStyle='rgba(38,24,12,0.92)';g.fillRect(fx-5,gy-72*k,10,72*k);
   const c1='rgba('+(14+Math.floor(vr*14))+','+(46+Math.floor(vr*20))+','+(24+Math.floor(vr*10))+',0.9)';
   const c2='rgba('+(20+Math.floor(vr*14))+','+(62+Math.floor(vr*22))+','+(32+Math.floor(vr*12))+',0.9)';
   [[0,-62,42,c1],[0,-88,33,c2],[0,-110,23,c1]].forEach(l2=>{g.fillStyle=l2[3];
    g.beginPath();g.moveTo(fx-l2[2],gy+l2[1]*k+26*k);
    g.lineTo(fx,gy+l2[1]*k-14*k);g.lineTo(fx+l2[2],gy+l2[1]*k+26*k);g.fill()});
   g.fillStyle='rgba(170,230,140,0.14)';g.beginPath();g.moveTo(fx,gy-124*k);
   g.lineTo(fx+16,gy-92*k);g.lineTo(fx+4,gy-92*k);g.fill();
   g.restore()}
  else if(f.type==='crystal'){const gy=gy0;g.save();
   g.shadowColor='#B98BFF';g.shadowBlur=16;
   [[-14,44,10],[6,66,13],[22,36,8]].forEach(cs=>{g.fillStyle='rgba(185,139,255,'+(0.5+Math.sin(t*2+cs[0])*0.2)+')';
    g.beginPath();g.moveTo(fx+cs[0]-cs[2],gy);g.lineTo(fx+cs[0],gy-cs[1]*k);g.lineTo(fx+cs[0]+cs[2],gy);g.fill()});
   g.shadowBlur=0;g.restore()}
  else if(f.type==='rock'){const gy=gy0;g.save();g.fillStyle='rgba(60,50,48,0.9)';
   g.beginPath();g.moveTo(fx-26,gy);g.lineTo(fx-14,gy-26*k);g.lineTo(fx+8,gy-32*k);g.lineTo(fx+24,gy-10*k);g.lineTo(fx+28,gy);g.fill();g.restore()}}
 function drawWorld(t){const bim=limg('background');
  if(bim){const pw=W*1.4;const ox=(cam*0.18)%pw;
   g.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,-ox,0,pw,H);
   g.drawImage(bim,0,0,bim.naturalWidth,bim.naturalHeight,-ox+pw,0,pw,H);
   g.fillStyle='rgba(6,10,20,'+(AMB?0.05:0.20)+')';g.fillRect(0,0,W,H)}
  else skyGrad(g,W,H,LP.sky||'#12203a',LP.bg||'#070c18');
  const nim=limg('background_near');
  if(!nim)midLayer(t);
  if(nim){const nw=W*1.25,nh=H*0.72,noy=H-nh;const nox=(cam*0.45)%nw;
   g.save();g.globalAlpha=0.5;
   g.drawImage(nim,0,0,nim.naturalWidth,nim.naturalHeight,-nox,noy,nw,nh);
   g.drawImage(nim,0,0,nim.naturalWidth,nim.naturalHeight,-nox+nw,noy,nw,nh);
   g.globalAlpha=1;
   const hzg=g.createLinearGradient(0,noy,0,noy+nh*0.5);
   hzg.addColorStop(0,'rgba(180,215,255,0)');hzg.addColorStop(1,'rgba(180,215,255,0.10)');
   g.fillStyle=hzg;g.fillRect(0,noy,W,nh);g.restore()}
  const hy=H-26*k;
  if(HZ==='lava'){g.fillStyle='#5a1408';g.fillRect(0,hy,W,60*k);
   for(let x=0;x<W;x+=26){g.fillStyle='rgba(255,'+(110+Math.floor(Math.sin(t*3+x)*60))+',40,0.85)';g.fillRect(x,hy+Math.sin(t*2.4+x*0.2)*3,20,6)}
   g.fillStyle='rgba(255,140,50,0.14)';g.fillRect(0,hy-14,W,14)}
  else if(HZ==='crystal'){g.fillStyle='#1a0f33';g.fillRect(0,hy,W,60*k);
   for(let x=0;x<W;x+=32){g.fillStyle='#B14BF4';g.globalAlpha=0.5+Math.sin(t*2+x)*0.3;
    g.beginPath();g.moveTo(x,hy+34*k);g.lineTo(x+8,hy-6+Math.sin(x)*4);g.lineTo(x+16,hy+34*k);g.fill()}g.globalAlpha=1}
  else if(HZ==='void'){const vg3=g.createLinearGradient(0,hy-30,0,hy+64*k);
   vg3.addColorStop(0,'rgba(10,6,26,0)');vg3.addColorStop(1,'rgba(4,2,14,0.95)');
   g.fillStyle=vg3;g.fillRect(0,hy-30,W,94*k);
   for(let x=0;x<W;x+=38){const n4=hz(Math.floor((x+cam*0.3)/38)+3);
    g.fillStyle='rgba(150,110,255,'+(0.10+n4*0.12+Math.sin(t*1.6+x)*0.05)+')';
    g.beginPath();g.ellipse(x+19,hy+10+n4*8,26,7,0,0,7);g.fill()}}
  else{g.fillStyle='#0d2c4a';g.fillRect(0,hy,W,60*k);g.strokeStyle='rgba(120,200,255,0.4)';
   for(let x=0;x<W;x+=18){g.beginPath();g.moveTo(x,hy+2+Math.sin(t*2.2+x*0.3)*2.5);g.lineTo(x+10,hy+2+Math.sin(t*2.2+x*0.3+1)*2.5);g.stroke()}}
  FEAT.forEach(f=>{if(f.type==='cave'||f.type==='waterfall'||f.type==='tree'||f.type==='arch')drawFeature(f,t)});
  const tim=limg('tileset');
  PLATS.forEach((p,i)=>{if(p.crumble&&crumb[i]&&crumb[i].gone>0)return;
   const sx=p.x-cam,pt=pTop(p,t);if(sx>W+60||sx+p.w<-60)return;
   const deep=p.deep!==undefined?p.deep:(!p.move&&!p.crumble&&!p.bridge&&p.y>=250);
   const th=deep?(p.depth?p.depth*k:Math.max(26*k,WH-pt)):Math.min(20*k,WH-pt);
   if(p.bridge){g.fillStyle='#5a4028';g.fillRect(sx,pt,p.w,9*k);
    g.fillStyle='#7a5838';for(let xx=2;xx<p.w-2;xx+=16)g.fillRect(sx+xx,pt,11,9*k);
    g.strokeStyle='#3a2818';g.lineWidth=3;
    for(let xx=8;xx<p.w;xx+=52){g.beginPath();g.moveTo(sx+xx,pt+9*k);g.lineTo(sx+xx,pt+30*k);g.stroke()}
    g.strokeStyle='#8a6a48';g.lineWidth=2;g.beginPath();g.moveTo(sx,pt-14*k);
    g.quadraticCurveTo(sx+p.w/2,pt-4*k,sx+p.w,pt-14*k);g.stroke();
    if(p.crumble){g.fillStyle='rgba(255,120,60,0.5)';g.fillRect(sx,pt,p.w,3)}return}
   if(tim){const tw=tim.naturalWidth/4,thh=tim.naturalHeight/4;
    if(th>36){const bod={forest:['#181009','#090603'],caves:['#140d22','#070511'],lava:['#1c0c08','#0c0503'],nexus:['#171331','#0a0820']}[ZONE]||['#141210','#080606'];
     const gr2=g.createLinearGradient(0,pt+30,0,pt+th);gr2.addColorStop(0,bod[0]);gr2.addColorStop(1,bod[1]);
     g.fillStyle=gr2;g.fillRect(sx,pt+30,p.w,th-30);
     g.globalAlpha=0.18;
     for(let xx=10;xx<p.w-34;xx+=86){const n3=hz(Math.floor((p.x+xx)/86)+7);
      if(n3>0.4)g.drawImage(tim,2*tw,0,tw,thh,sx+xx,pt+40+n3*Math.max(0,th-90),30,30)}
     g.globalAlpha=1}
    for(let xx=0;xx<p.w;xx+=34){const n2=hz(Math.floor((p.x+xx)/34));
     g.drawImage(tim,0,0,tw,thh,sx+xx,pt,Math.min(34,p.w-xx),Math.min(34,th));
     g.fillStyle='rgba(0,0,0,'+(0.02+n2*0.08)+')';g.fillRect(sx+xx,pt,Math.min(34,p.w-xx),Math.min(34,th))}
    g.fillStyle='rgba(0,0,0,0.2)';g.fillRect(sx,pt,6,th);g.fillRect(sx+p.w-6,pt,6,th);
    g.fillStyle=AMB?'rgba(255,244,200,0.4)':'rgba(210,230,255,0.28)';g.fillRect(sx,pt,p.w,2.5);
    if(!deep){g.fillStyle='rgba(0,0,0,0.28)';g.fillRect(sx+2,pt+th,p.w-4,4)}}
   else{g.fillStyle=LP.terrain||'#1d3a2a';g.fillRect(sx,pt,p.w,th);g.fillStyle=LG+'55';g.fillRect(sx,pt,p.w,4)}
   if(deep&&ZONE==='forest'){g.fillStyle='rgba(80,180,80,0.5)';
    for(let xx=3;xx<p.w;xx+=9)g.fillRect(sx+xx,pt-3,2,4)}
   if(p.move){g.fillStyle=LG+'33';g.fillRect(sx,pt+th,p.w,3);
    g.fillStyle=LG;g.globalAlpha=0.5+Math.sin(t*4)*0.25;g.fillRect(sx+p.w/2-3,pt+th+3,6,4);g.globalAlpha=1}
   if(p.crumble){g.fillStyle='rgba(255,120,60,0.5)';g.fillRect(sx,pt,p.w,3)}});
  FEAT.forEach(f=>{if(f.type!=='cave'&&f.type!=='waterfall'&&f.type!=='tree')drawFeature(f,t)});
  CPX.forEach((cx2,i)=>{const fx=cx2-cam;if(fx<-40||fx>W+40)return;const gy=groundYAt(cx2);
   g.strokeStyle='#8a7a5a';g.lineWidth=4;g.beginPath();g.moveTo(fx,gy);g.lineTo(fx,gy-78*k);g.stroke();g.lineWidth=1;
   g.fillStyle=i<=cpIdx?'#10E670':'#66707e';
   g.beginPath();g.moveTo(fx,gy-78*k);g.lineTo(fx+30,gy-67*k+Math.sin(t*3)*3);g.lineTo(fx,gy-56*k);g.fill();
   if(i<=cpIdx){g.shadowColor='#10E670';g.shadowBlur=16;g.fillRect(fx-2,gy-78*k,4,4);g.shadowBlur=0}});
  picks.forEach(pk=>{if(pk.got)return;const px2=pk.x-cam;if(px2<-20||px2>W+20)return;const py=pk.y*k+Math.sin(t*3+pk.x)*3;
   const IC={coin:['#FFD34D','\u25CF'],gem:['#4de3ff','\u25C6'],potion:['#FF5A6E','\u2665'],mana:['#2EA0FF','\u25B2'],fire:['#FF7A3D','\u25B2'],star:['#B98BFF','\u2605'],key:['#FFD34D','\u26B7']}[pk.kind]||['#fff','\u25CF'];
   const iu=aurl('icon_set');const idx={coin:0,gem:1,potion:2,fire:3,mana:4,star:5,key:7}[pk.kind]||0;
   const BIGP=pk.kind==='key'||pk.kind==='potion'||pk.kind==='fire'||pk.kind==='star'||pk.kind==='mana';
   const isz=BIGP?38:22;
   if(pk.kind==='fire'||pk.kind==='key'){const fg3=g.createRadialGradient(px2,py,0,px2,py,isz);
    fg3.addColorStop(0,pk.kind==='key'?'rgba(255,211,77,0.5)':'rgba(255,122,61,0.4)');fg3.addColorStop(1,'rgba(255,180,61,0)');
    g.fillStyle=fg3;g.beginPath();g.arc(px2,py,isz,0,7);g.fill()}
   if(iu&&aimg('icon_set')&&aimg('icon_set').naturalWidth){const im2=aimg('icon_set'),iw=im2.naturalWidth/4,ih=im2.naturalHeight/2;
    g.drawImage(im2,(idx%4)*iw,Math.floor(idx/4)*ih,iw,ih,px2-isz/2,py-isz/2,isz,isz)}
   else{g.fillStyle=IC[0];g.shadowColor=IC[0];g.shadowBlur=BIGP?16:8;g.font=(BIGP?26:14)+'px system-ui';g.textAlign='center';g.fillText(IC[1],px2,py+(BIGP?9:5));g.shadowBlur=0;g.textAlign='left'}
   if(pk.kind==='gem'||pk.kind==='fire'||pk.kind==='star'||pk.kind==='key'){g.save();g.translate(px2,py);g.rotate(t*2);
    const rr2=BIGP?16:9;
    g.strokeStyle=pk.kind==='gem'?'#bfefff':pk.kind==='star'?'#e0ccff':pk.kind==='key'?'#ffe9a8':'#ffd0a8';g.globalAlpha=0.45+Math.sin(t*5+pk.x)*0.3;g.lineWidth=1.4;
    g.beginPath();g.moveTo(-rr2,0);g.lineTo(rr2,0);g.moveTo(0,-rr2);g.lineTo(0,rr2);g.stroke();g.restore();g.globalAlpha=1;g.lineWidth=1}});
  props.forEach(pr=>{if(pr.broken)return;const px3=pr.x-cam;if(px3<-40||px3>W+40)return;const gy=(pr.y!==undefined?pr.y*k:groundYAt(pr.x));
   const im3=aimg('icon_set');
   g.save();g.globalAlpha=0.3;g.fillStyle='#000';g.beginPath();g.ellipse(px3,gy-1,22,6,0,0,7);g.fill();g.restore();
   g.save();g.shadowColor='#FFD34D';g.shadowBlur=14;
   if(im3&&im3.naturalWidth){const iw=im3.naturalWidth/4,ih=im3.naturalHeight/2;
    g.drawImage(im3,2*iw,ih,iw,ih,px3-25,gy-48,50,50)}
   else{g.fillStyle='#8a5a2b';g.fillRect(px3-20,gy-34,40,34);g.strokeStyle='#FFD34D';g.lineWidth=2;g.strokeRect(px3-20,gy-34,40,34);g.lineWidth=1}
   g.restore();
   g.fillStyle='#FFD34D';g.globalAlpha=0.5+Math.sin(t*4+pr.x)*0.3;g.fillRect(px3-2,gy-54,4,5);g.globalAlpha=1});
  foes.forEach(f=>{if(f.dead)return;const fx=f.x-cam;if(fx<-70||fx>W+70)return;
   const big=f.type==='brute';
   const sz=f.type==='bat'?68*k:big?116*k:88*k;
   const eh2=big?32*k:24*k;
   const dy=f.type==='bat'?f.y:f.y+eh2-sz*0.42;
   g.save();g.globalAlpha=0.28;g.fillStyle='#000';g.beginPath();
   g.ellipse(fx,f.type==='bat'?f.y+44*k:f.y+eh2,big?28:19,5,0,0,7);g.fill();g.restore();
   if(f.tele>0){g.strokeStyle=LH;g.globalAlpha=0.5+Math.sin(t*18)*0.3;g.beginPath();g.arc(fx,dy,24,0,7);g.stroke();g.globalAlpha=1}
   if(!drawSpr(g,sk('enemy_sprite'),fx,dy,sz,big?Math.sin(t*2+f.ph)*0.03:0,t,f.x>P.x)){
    g.fillStyle=f.flash>0?'#fff':(f.type==='bat'?'#B14BF4':f.type==='spitter'?'#FFD34D':big?'#8a4a2a':LH);
    g.beginPath();g.arc(fx,dy,(big?24:16)*k,0,7);g.fill()}
   if(f.flash>0){g.globalAlpha=0.5;g.fillStyle='#fff';g.beginPath();g.arc(fx,dy,sz*0.3,0,7);g.fill();g.globalAlpha=1}
   g.fillStyle='#0008';g.fillRect(fx-14,dy-sz*0.52,28,4);
   g.fillStyle='#10E670';g.fillRect(fx-13,dy-sz*0.52+1,26*Math.max(0,f.hp/f.mx),2)});
  if(B&&!B.dead){const bx=B.x-cam,BSZ=150*k;
   g.save();g.globalAlpha=0.3;g.fillStyle='#000';g.beginPath();g.ellipse(bx,groundYAt(B.x)+16*k,42,8,0,0,7);g.fill();g.restore();
   if(B.engaged&&!B.dying){const bg3=g.createRadialGradient(bx,B.y,10,bx,B.y,110*k);
    bg3.addColorStop(0,'rgba(255,90,40,'+(B.enraged?0.16:0.08)+')');bg3.addColorStop(1,'rgba(255,90,40,0)');
    g.fillStyle=bg3;g.beginPath();g.arc(bx,B.y,110*k,0,7);g.fill()}
   if(B.tele>0){g.strokeStyle=B.mode==='swoop'?LH:B.mode==='breath'?'#FF8A3D':'#FFD34D';g.lineWidth=2.5;
    g.globalAlpha=0.5+Math.sin(t*16)*0.3;g.beginPath();g.arc(bx,B.y,60*k,0,7);g.stroke();g.globalAlpha=1;g.lineWidth=1}
   if(B.bre>0){g.save();const fdir=Math.sign(P.x-B.x)||1;
    const brg=g.createLinearGradient(bx,B.y,bx+fdir*260,B.y);
    brg.addColorStop(0,'rgba(255,170,60,0.45)');brg.addColorStop(1,'rgba(255,60,20,0)');
    g.fillStyle=brg;g.beginPath();g.moveTo(bx+fdir*40*k,B.y-4*k);
    g.lineTo(bx+fdir*280,B.y-34*k+Math.sin(t*10)*8);g.lineTo(bx+fdir*280,B.y+40*k+Math.sin(t*11)*8);
    g.lineTo(bx+fdir*40*k,B.y+12*k);g.fill();g.restore()}
   if(B.engaged&&!B.dying&&Math.random()<0.12)parts.push({x:bx+(Math.random()-0.5)*90,y:B.y+(Math.random()-0.3)*60,
    vx:(Math.random()-0.5)*30,vy:-20-Math.random()*40,life:0.8,color:B.enraged?'#FF5A3D':'#FF9A4D',r:1.6});
   const wob=B.dying>0?Math.sin(B.wob)*0.4:Math.sin(t*3)*0.03;
   if(B.dying>0)g.globalAlpha=Math.max(0.3,B.dying/1.5);
   if(!drawSpr(g,sk('boss_sprite'),bx,B.y,BSZ,wob,t,B.x>P.x)){
    g.fillStyle=B.flash>0?'#fff':(B.enraged?'#FF3D5A':LH);g.beginPath();g.arc(bx,B.y,30*k,0,7);g.fill();
    g.beginPath();g.moveTo(bx-30,B.y-8);g.lineTo(bx-54,B.y-40+Math.sin(t*6)*7);g.lineTo(bx-10,B.y-18);g.fill();
    g.beginPath();g.moveTo(bx+30,B.y-8);g.lineTo(bx+54,B.y-40+Math.sin(t*6)*7);g.lineTo(bx+10,B.y-18);g.fill()}
   g.globalAlpha=1;
   if(B.flash>0){g.globalAlpha=0.4;g.fillStyle='#fff';g.beginPath();g.arc(bx,B.y,BSZ*0.3,0,7);g.fill();g.globalAlpha=1}}
  const exx=(st.exit&&st.exit.x||WORLD-60),exs=exx-cam;
  if(exs>-180&&exs<W+180){const open=(!B||B.dead)&&keysL>=KEYNEED;const psz=((st.exit&&st.exit.size)||1)*k;
   const LGX=(st.exit&&st.exit.color)||LG;
   const exy=groundYAt(exx)-64*psz;const prx=44*psz,pry=62*psz;
   const pc=open?LGX:'#5a6478';
   if(open){const pool=g.createRadialGradient(exs,exy+pry,4,exs,exy+pry,prx*2.4);
    pool.addColorStop(0,LGX+'44');pool.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=pool;g.beginPath();g.ellipse(exs,exy+pry+4,prx*2.4,16*psz,0,0,7);g.fill()}
   g.save();
   g.fillStyle='#241d14';g.beginPath();g.ellipse(exs,exy,prx+13*psz,pry+13*psz,0,0,7);g.fill();
   g.fillStyle='#3a3226';g.beginPath();g.ellipse(exs,exy,prx+9*psz,pry+9*psz,0,0,7);g.fill();
   g.strokeStyle='#57492f';g.lineWidth=3*psz;g.beginPath();g.ellipse(exs,exy,prx+11*psz,pry+11*psz,0,0,7);g.stroke();
   for(let i=0;i<8;i++){const ra=i/8*6.283+0.39;
    g.fillStyle=open?(i%2?'#6f5c38':'#57492f'):'#4a4438';
    g.beginPath();g.arc(exs+Math.cos(ra)*(prx+10*psz),exy+Math.sin(ra)*(pry+10*psz),4.6*psz,0,7);g.fill();
    if(open){g.fillStyle=LGX;g.globalAlpha=0.5+Math.sin(t*3+i)*0.4;
     g.beginPath();g.arc(exs+Math.cos(ra)*(prx+10*psz),exy+Math.sin(ra)*(pry+10*psz),1.8*psz,0,7);g.fill();g.globalAlpha=1}}
   if(open){
    const ig=g.createRadialGradient(exs,exy,2,exs,exy,Math.max(prx,pry));
    ig.addColorStop(0,'rgba(255,255,255,0.92)');ig.addColorStop(0.35,LGX+'cc');ig.addColorStop(0.8,'#1440aa88');ig.addColorStop(1,'rgba(4,10,30,0.9)');
    g.fillStyle=ig;g.beginPath();g.ellipse(exs,exy,prx,pry,0,0,7);g.fill();
    g.save();g.beginPath();g.ellipse(exs,exy,prx,pry,0,0,7);g.clip();
    g.strokeStyle='rgba(255,255,255,0.55)';g.lineWidth=2*psz;
    for(let i=0;i<4;i++){g.beginPath();
     for(let a2=0;a2<6.283;a2+=0.42){const rr=(a2/6.283)*prx*(0.9-i*0.16);
      const px4=exs+Math.cos(a2+t*(1.4+i*0.3))*rr,py4=exy+Math.sin(a2+t*(1.4+i*0.3))*rr*(pry/prx);
      a2===0?g.moveTo(px4,py4):g.lineTo(px4,py4)}g.globalAlpha=0.25+i*0.12;g.stroke()}
    g.globalAlpha=1;g.restore();
    for(let i=0;i<6;i++){const a3=t*1.7+i*1.05;
     g.fillStyle=i%2?'#bfe9ff':LGX;g.globalAlpha=0.55+Math.sin(t*4+i)*0.3;
     g.beginPath();g.arc(exs+Math.cos(a3)*(prx+16*psz),exy+Math.sin(a3)*(pry+16*psz),2.2*psz,0,7);g.fill()}
    g.globalAlpha=1;
    if(Math.random()<0.2)parts.push({x:exs+(Math.random()-0.5)*prx*1.6,y:exy+(Math.random()-0.5)*pry*1.6,vx:(Math.random()-0.5)*24,vy:-26-Math.random()*30,life:1,color:'#9fe2ff',r:1.8})}
   else{g.fillStyle='rgba(8,12,24,0.88)';g.beginPath();g.ellipse(exs,exy,prx,pry,0,0,7);g.fill();
    g.strokeStyle=pc;g.lineWidth=2;g.globalAlpha=0.5+Math.sin(t*2)*0.15;
    g.beginPath();g.ellipse(exs,exy,prx*0.72,pry*0.72,0,0,7);g.stroke();g.globalAlpha=1;
    if(KEYNEED>keysL){g.fillStyle='#FFD34D';g.font='bold '+Math.round(15*psz)+'px system-ui';g.textAlign='center';
     g.fillText('\uD83D\uDDDD',exs,exy+5*psz);g.textAlign='left'}}
   g.restore()}
  projs.forEach(p=>{const pc=p.fire?'#FF8A3D':LG;
   if(!drawSpr(g,sk('projectile_sprite'),p.x-cam,p.y,17,0,t)){
    g.fillStyle=pc;g.shadowColor=pc;g.shadowBlur=12;g.beginPath();g.arc(p.x-cam,p.y,5,0,7);g.fill();g.shadowBlur=0}
   g.globalAlpha=0.4;g.fillStyle=pc;g.beginPath();g.arc(p.x-cam-Math.sign(p.vx)*9,p.y,3,0,7);g.fill();g.globalAlpha=1});
  eprojs.forEach(p=>{const ec=p.fire?'#FF8A3D':LH;
   g.globalAlpha=0.3;g.fillStyle=ec;g.beginPath();g.arc(p.x-cam-p.vx*0.03,p.y-(p.vy||0)*0.03,3,0,7);g.fill();g.globalAlpha=1;
   g.fillStyle=ec;g.shadowColor=ec;g.shadowBlur=9;
   g.beginPath();g.arc(p.x-cam,p.y,4.5,0,7);g.fill();g.shadowBlur=0});
  if(S.debug_collision){g.save();g.lineWidth=1.5;
   PLATS.forEach((p,i)=>{if(p.crumble&&crumb[i]&&crumb[i].gone>0)return;const pt=pTop(p,t);
    g.strokeStyle='#00ff88';g.strokeRect(p.x-cam,pt,p.w,4)});
   g.strokeStyle='#ff3355';g.strokeRect(0,H-26*k,W,26*k);
   g.strokeStyle='#00ccff';g.strokeRect(P.x-cam-10,P.y-30*k,20,30*k+FO);
   g.fillStyle='#ffff00';g.beginPath();g.arc(P.x-cam,P.y+FO,3,0,7);g.fill();
   CPX.forEach(cx2=>{g.strokeStyle='#10E670';g.strokeRect(cx2-cam-2,groundYAt(cx2)-60*k,4,60*k)});
   g.fillStyle='#fff';g.font='9px monospace';
   g.fillText('px:'+Math.round(P.x)+' py:'+Math.round(P.y)+' feet:'+Math.round(P.y+FO)+' onG:'+P.onG,W-210,H-8);
   g.restore()}
  g.restore();
  const deepF=WH>H?Math.min(1,camY/(WH-H)):0;const vy2=P.y-14*k-camY;
  const lg2=g.createRadialGradient(P.x-cam,vy2,50,P.x-cam,vy2,Math.max(W,H)*0.8);
  lg2.addColorStop(0,'rgba(0,0,0,0)');lg2.addColorStop(1,'rgba(2,4,12,'+((AMB?0.14:(ZONE==='caves'?0.5:0.4))+deepF*0.28).toFixed(2)+')');
  g.fillStyle=lg2;g.fillRect(0,0,W,H)}
 function fgLayer(t){const fim=limg('foreground');if(!fim)return;
  const fw=W*1.15,fh=H*0.32,foy=H-fh;const fox=(cam*1.3)%fw;
  g.save();g.globalAlpha=0.85;
  g.drawImage(fim,0,0,fim.naturalWidth,fim.naturalHeight,-fox,foy,fw,fh);
  g.drawImage(fim,0,0,fim.naturalWidth,fim.naturalHeight,-fox+fw,foy,fw,fh);g.restore()}
 function drawHUD(){
  const im5=aimg('character_portrait');const hasP=im5&&im5.naturalWidth;
  g.save();g.fillStyle='rgba(4,8,20,0.52)';
  if(g.roundRect){g.beginPath();g.roundRect(8,8,hasP?176:150,46,12);g.fill()}else g.fillRect(8,8,hasP?176:150,46);
  if(hasP){g.save();g.beginPath();g.arc(30,31,17,0,7);g.clip();
   g.drawImage(im5,0,0,im5.naturalWidth,im5.naturalHeight,13,14,34,34);g.restore();
   g.strokeStyle=LG+'88';g.lineWidth=1.5;g.beginPath();g.arc(30,31,17,0,7);g.stroke();g.lineWidth=1}
  const bx0=hasP?54:14;
  g.fillStyle='#ffffff20';g.fillRect(bx0,15,112,7);g.fillStyle='#10E670';g.fillRect(bx0,15,112*Math.max(0,pHp/pMax),7);
  g.fillStyle='#ffffff20';g.fillRect(bx0,25,112,5);g.fillStyle='#2EA0FF';g.fillRect(bx0,25,112*Math.max(0,mana/mMax),5);
  g.fillStyle='#ffffff20';g.fillRect(bx0,33,112,2.5);g.fillStyle=LA;g.fillRect(bx0,33,112*Math.min(1,AX.xp/(AX.lvl*30)),2.5);
  g.font='bold 9px system-ui';g.fillStyle='#FF5A6E';let hearts='';for(let i=0;i<lives;i++)hearts+='\u2665';g.fillText(hearts||'\u2620',bx0,48);
  g.fillStyle='rgba(234,242,255,0.7)';g.fillText('Lv'+AX.lvl,bx0+44,48);
  g.fillStyle='#FFD34D';g.fillText('\u25CF'+coins,bx0+70,48);
  g.fillStyle='#FFD34D';g.fillText('\uD83D\uDDDD'+keysL+(KEYNEED?'/'+KEYNEED:''),bx0+98,48);
  if(fireBuff>0){g.fillStyle='#FF7A3D';g.font='bold 8px system-ui';g.fillText('FIRE+'+Math.ceil(fireBuff),bx0+70,12)}
  else if(rapid>0){g.fillStyle='#B98BFF';g.font='bold 8px system-ui';g.fillText('SURGE '+Math.ceil(rapid),bx0+70,12)}
  g.restore();
  const obj=B&&!B.dead?(B.engaged?'\u25B8 Defeat '+B.name+'!':'\u25B8 Reach the boss \u27A1')
   :(keysL<KEYNEED?'\u25B8 Find the key \uD83D\uDDDD '+keysL+'/'+KEYNEED:'\u2713 Enter the portal \u27A1');
  g.save();g.font='bold 9px system-ui';g.textAlign='right';
  const ow=g.measureText(obj).width+18;
  g.fillStyle='rgba(4,8,20,0.5)';
  if(g.roundRect){g.beginPath();g.roundRect(W-ow-8,8,ow,18,8);g.fill()}else g.fillRect(W-ow-8,8,ow,18);
  g.fillStyle=keysL<KEYNEED&&(!B||B.dead)?'#FFD34D':LA;g.fillText(obj,W-16,21);
  g.fillStyle='rgba(234,242,255,0.5)';g.font='bold 8px system-ui';
  g.fillText('LEVEL '+(stageIdx+1)+'/'+S.stages.length+' \u00b7 '+(st.title||'').toUpperCase(),W-16,36);g.restore();
  if(!MOB){const im4=aimg('icon_set'),SL=[['\u2694','J',Math.max(0,P?P.atkCd:0)/0.38,LG],
    ['\u2726','K',Math.max(0,P?P.splCd:0)/(rapid>0?0.28:0.75),'#FF8A3D'],['\u27A0','L',Math.max(0,P?P.dgCd:0)/0.9,'#2EA0FF']];
   SL.forEach((s2,i)=>{const bx2=W/2-58+i*40,by2=H-46;
    g.fillStyle='rgba(4,8,20,0.72)';if(g.roundRect){g.beginPath();g.roundRect(bx2,by2,34,34,8);g.fill()}else g.fillRect(bx2,by2,34,34);
    g.strokeStyle=s2[3]+'55';g.strokeRect?0:0;g.lineWidth=1.5;
    if(g.roundRect){g.beginPath();g.roundRect(bx2,by2,34,34,8);g.stroke()}
    if(i===1&&im4&&im4.naturalWidth){const iw=im4.naturalWidth/4,ih=im4.naturalHeight/2;g.drawImage(im4,3*iw,0,iw,ih,bx2+5,by2+3,24,24)}
    else{g.fillStyle=s2[3];g.font='bold 15px system-ui';g.textAlign='center';g.fillText(s2[0],bx2+17,by2+22);g.textAlign='left'}
    if(s2[2]>0){g.fillStyle='rgba(0,0,0,0.62)';g.fillRect(bx2,by2,34,34*Math.min(1,s2[2]))}
    g.fillStyle='rgba(234,242,255,0.7)';g.font='bold 7.5px system-ui';g.fillText(s2[1],bx2+3,by2+31)})}
  if(B&&B.engaged&&!B.dead){g.fillStyle='rgba(4,8,20,0.78)';
   if(g.roundRect){g.beginPath();g.roundRect(W/2-140,10,280,32,10);g.fill()}else g.fillRect(W/2-140,10,280,32);
   g.save();g.beginPath();g.arc(W/2+158,26,15,0,7);g.clip();
   g.fillStyle='rgba(4,8,20,0.9)';g.fillRect(W/2+143,11,30,30);
   drawSpr(g,sk('boss_sprite'),W/2+158,28,40,0,0,false);g.restore();
   g.strokeStyle=B.enraged?'#FF3D5A':LH;g.lineWidth=2;g.beginPath();g.arc(W/2+158,26,15,0,7);g.stroke();g.lineWidth=1;
   g.font='bold 10px system-ui';g.fillStyle=T.text;g.textAlign='center';
   g.fillText(B.name+' \u2014 PHASE '+B.phase+'/'+B.phases+(B.enraged?' \u00b7 ENRAGED':''),W/2,22);g.textAlign='left';
   g.fillStyle='#ffffff18';g.fillRect(W/2-128,27,256,9);
   g.save();g.shadowColor=LH;g.shadowBlur=6;g.fillStyle=B.enraged?'#FF3D5A':LH;
   g.fillRect(W/2-128,27,256*Math.max(0,B.hp/B.mx),9);g.restore();
   for(let i=1;i<B.phases;i++){g.fillStyle='#0008';g.fillRect(W/2-128+256*(i/B.phases),27,2,9)}}
  if(msgT>0){g.font='bold 12px system-ui';const tw=g.measureText(msg).width+26;
   g.fillStyle='rgba(4,8,20,0.82)';g.fillRect(W/2-tw/2,H-100,tw,24);
   g.fillStyle=T.text;g.textAlign='center';g.fillText(msg,W/2,H-83);g.textAlign='left'}
  if(cd3>0&&cd3<3.5){const n=Math.ceil(cd3);g.font='bold 64px system-ui';g.textAlign='center';
   g.save();g.shadowColor=LG;g.shadowBlur=24;g.fillStyle=LG;g.fillText(n>3?'':String(n),W/2,H/2-20);g.restore();g.textAlign='left'}}
 const latch={},latchT={};
 document.addEventListener('keydown',e=>{['attack','spell','dodge','jump'].forEach(a=>{if(akeys(a).includes(e.key)){latch[a]=true;latchT[a]=performance.now()}}) });
 function tapA(a){if(latch[a]&&performance.now()-(latchT[a]||0)<350){latch[a]=false;return true}latch[a]=false;return false}
 const DP={left:false,right:false,up:false,down:false,h_jump:false,h_attack:false,h_spell:false,h_dodge:false};
 if(MOB){
  const wrapRow=el('div','');
  wrapRow.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 14px calc(10px + env(safe-area-inset-bottom,0px));touch-action:none;user-select:none';
  function holdEvents(b,onDn,onUp){
   const dn=e=>{e.preventDefault();e.stopPropagation();lastInput='touch';onDn(e);
    try{b.setPointerCapture(e.pointerId)}catch(err){}};
   const up=e=>{if(e&&e.preventDefault)e.preventDefault();onUp(e)};
   b.addEventListener('pointerdown',dn);b.addEventListener('pointerup',up);
   b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
   b.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
   b.addEventListener('contextmenu',e=>e.preventDefault())}
  function circleBtn(id,glyph,size,color){const b=el('button','',glyph);
   b.setAttribute('data-testid',id);
   b.style.cssText='width:'+size+'px;height:'+size+'px;flex:0 0 '+size+'px;border-radius:50%;'+
    'border:2px solid rgba(255,255,255,0.28);background:radial-gradient(circle at 35% 30%,rgba(255,255,255,0.16),rgba(10,16,32,0.42));'+
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:'+(color||'rgba(255,255,255,0.92)')+';'+
    'font-weight:900;font-size:'+Math.round(size*0.4)+'px;display:flex;align-items:center;justify-content:center;'+
    'box-shadow:0 4px 14px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.18);'+
    'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;padding:0';
   return b}
  const moveBox=el('div','');moveBox.style.cssText='display:flex;gap:14px;align-items:center';
  [['left','\u25C0'],['right','\u25B6']].forEach(cfg=>{const dir=cfg[0];
   const b=circleBtn('ss-dpad-'+dir,cfg[1],62);
   holdEvents(b,()=>{DP[dir]=true;b.style.transform='scale(0.9)';b.style.background='radial-gradient(circle at 35% 30%,rgba(255,255,255,0.3),rgba(20,30,54,0.6))';vib(8)},
    ()=>{DP[dir]=false;b.style.transform='';b.style.background='radial-gradient(circle at 35% 30%,rgba(255,255,255,0.16),rgba(10,16,32,0.42))'});
   moveBox.appendChild(b)});
  const actBox=el('div','');actBox.style.cssText='display:flex;gap:10px;align-items:center';
  const btns={};
  [['dodge','\u27A0','#FFD34D',44],['spell','\u2726','#2EA0FF',44],['attack','\u2694','#FF5A6E',50],['jump','\u2B06','#10E670',66]].forEach(cfg=>{
   const a=cfg[0],b=circleBtn('ss-btn-'+a,cfg[1],cfg[3],cfg[2]);
   b.style.borderColor=cfg[2]+'55';
   holdEvents(b,()=>{latch[a]=true;latchT[a]=performance.now();DP['h_'+a]=true;
     b.style.transform='scale(0.9)';vib(10)},
    ()=>{DP['h_'+a]=false;b.style.transform=''});
   actBox.appendChild(b);btns[a]=b});
  wrapRow.appendChild(moveBox);wrapRow.appendChild(actBox);root.appendChild(wrapRow);
  setInterval(()=>{if(!P)return;
   const cds={jump:0,attack:Math.max(0,P.atkCd),spell:Math.max(0,P.splCd),dodge:Math.max(0,P.dgCd)};
   [['jump'],['attack'],['spell'],['dodge']].forEach(x=>{const a=x[0];
    const off=cds[a]>0.05||(a==='spell'&&mana<(rapid>0?1:3));
    btns[a].style.opacity=off?'0.45':'1';btns[a].style.filter=off?'grayscale(0.6)':''})},120)}
 let last=0;
 function loop(ts){if(doneFlag)return;raf=requestAnimationFrame(loop);
  const dt=Math.min(0.045,(ts-(last||ts))/1000);last=ts;const t=ts/1000;
  if(PAUSED){drawWorld(t);g.save();g.translate(0,-camY);drawFx(g,0);g.restore();drawHUD();return}
  msgT-=dt;
  if(cd3>0){cd3-=dt;if(cd3<=0){busy=false;say(st.intro||'Adventure awaits \u2014 head right!')}
   drawWorld(t);drawHUD();drawFx(g,dt);return}
  P.inv-=dt;P.atkCd-=dt;P.splCd-=dt;P.dgCd-=dt;P.stT+=dt;P.coyote-=dt;if(P.land>0)P.land-=dt;
  if(fireBuff>0)fireBuff-=dt;if(rapid>0)rapid-=dt;
  mana=Math.min(mMax,mana+dt*0.9);
  for(const i in crumb)if(crumb[i].gone>0){crumb[i].gone-=dt;if(crumb[i].gone<=0)crumb[i]={t:0,gone:0}}
  if(Math.random()<dt*3){const ac=ZONE==='lava'?'#FF8A3D':ZONE==='caves'?'#B98BFF':ZONE==='nexus'?(Math.random()<0.5?'#9fe2ff':'#c9a8ff'):(Math.random()<0.5?'#aef29b':'#ffe28a');
   parts.push({x:Math.random()*W,y:Math.random()*H*0.7,vx:ZONE==='lava'?-10:(Math.random()-0.5)*16,
    vy:ZONE==='lava'?-22:(Math.random()-0.5)*12,life:1.6+Math.random(),color:ac,r:1.2+Math.random()})}
  if(ZONE==='lava'&&Math.random()<dt*4)parts.push({x:Math.random()*W,y:H-24*k,vx:0,vy:-34-Math.random()*30,life:0.5,color:'#FFB03D',r:1.9});
  if(ZONE==='caves'&&Math.random()<dt*1.6)parts.push({x:Math.random()*W,y:8,vx:0,vy:150,life:0.9,color:'rgba(150,190,255,0.5)',r:1.4});
  if(!busy){let ix=(act('right')?1:0)-(act('left')?1:0);
   ix+=(DP.right?1:0)-(DP.left?1:0);
   try{const gp=navigator.getGamepads&&navigator.getGamepads()[0];
    if(gp){if(Math.abs(gp.axes[0])>0.25)ix+=gp.axes[0];if(gp.buttons[0]&&gp.buttons[0].pressed){latch.jump=true;latchT.jump=performance.now()}
     if(gp.buttons[2]&&gp.buttons[2].pressed){latch.attack=true;latchT.attack=performance.now()}if(gp.buttons[1]&&gp.buttons[1].pressed){latch.dodge=true;latchT.dodge=performance.now()}
     if(gp.buttons[3]&&gp.buttons[3].pressed){latch.spell=true;latchT.spell=performance.now()}}}catch(e){}
   ix=Math.max(-1,Math.min(1,ix));
   const SPD=205*SENS;P.vx+=(ix*SPD-P.vx)*Math.min(1,dt*8);
   if(ix)P.face=ix>0?1:-1;
   const canJump=P.onG||P.coyote>0;
   const wantJump=tapA('jump')||DP.h_jump||(!MOB&&act('jump'));
   if(canJump&&wantJump){P.vy=-520*k;P.onG=false;P.coyote=0;P.dbl=false;setSt('jump');sfx('jump');
    burst(P.x-cam,P.y+FO,'#ffffff44',5,60)}
   else if(!canJump&&!P.dbl&&P.vy>-140*k&&st.double_jump!==false&&(tapA('jump')||(!MOB&&act('jump')&&!P.jHeld))){
    P.dbl=true;P.vy=-470*k;setSt('jump');sfx('jump');
    burst(P.x-cam,P.y+FO*0.4,'#9fe2ff66',8,90)}
   P.jHeld=!MOB&&act('jump');
   if((tapA('attack')||DP.h_attack)&&P.atkCd<=0)meleeHit();
   if((tapA('spell')||DP.h_spell)&&P.splCd<=0)castSpell();
   if(tapA('dodge'))doDodge();
   const prevY=P.y;P.vy+=1150*k*dt;P.x+=P.vx*dt;P.y+=P.vy*dt;
   P.x=Math.max(10,Math.min(WORLD-10,P.x));
   if(B&&B.engaged&&!B.dead)P.x=Math.max((st.arena_x||WORLD-520)-40,P.x);
   landOn(t,prevY);
   if(!P.onG&&P.vy>60&&P.st!=='jump')setSt('fall');
   if(P.onG&&!['attack','cast','dodge','hurt'].includes(P.st))setSt(Math.abs(P.vx)>110?'run':Math.abs(P.vx)>8?'walk':'idle');
   P.animT+=dt*(P.onG?(Math.abs(P.vx)>110?1.9:Math.abs(P.vx)>8?1.2:0.25):0.45);
   if(P.onG&&Math.abs(P.vx)>110&&Math.random()<dt*9)parts.push({x:P.x-cam-P.face*9,y:P.y+FO-3,vx:-P.face*32,vy:-16-Math.random()*18,life:0.5,color:'rgba(200,190,160,0.55)',r:1.8});
   if(P.y>WH-6*k)hazardRespawn();
  }
  picks.forEach(pk=>{if(pk.got)return;if(Math.abs(pk.x-P.x)<22&&Math.abs(pk.y*k-P.y)<34*k){pk.got=true;sfx('collect');
   if(pk.kind==='coin'){coins++;fp+=10;addScore(5)}else if(pk.kind==='gem'){gems++;fp+=50;addScore(15);popup(P.x-cam,P.y-40*k,'+50 \uD83D\uDD25','#4de3ff')}
   else if(pk.kind==='potion'){pHp=Math.min(pMax,pHp+Math.ceil(pMax*0.5));popup(P.x-cam,P.y-40*k,'+50% HP','#FF5A6E')}
   else if(pk.kind==='mana'){pHp=pMax;mana=mMax;popup(P.x-cam,P.y-40*k,'FULL RESTORE','#2EA0FF')}
   else if(pk.kind==='fire'){firePk++;fp+=100;fireBuff=8;addScore(20);popup(P.x-cam,P.y-46*k,'+100 \uD83D\uDD25 damage up!','#FF7A3D');burst(P.x-cam,P.y,'#FF7A3D',14,120)}
   else if(pk.kind==='star'){rapid=6;mana=mMax;fp+=500;addScore(15);popup(P.x-cam,P.y-46*k,'+500 \uD83D\uDD25 ARCANE SURGE!','#B98BFF');burst(P.x-cam,P.y,'#B98BFF',16,130)}
   else if(pk.kind==='key'){keysL++;const kid=(S.title||'game')+'-s'+(stageIdx+1);
    if(SAVE_X.arpg){SAVE_X.arpg.keys=(SAVE_X.arpg.keys||0)+1}saveGame();
    try{parent.postMessage({type:'game_key',key_id:kid,stage:stageIdx+1,title:st.title||''},'*')}catch(e){}
    popup(P.x-cam,P.y-46*k,'\uD83D\uDDDD GOLDEN KEY \u2192 Fire Vault Wallet','#FFD34D');burst(P.x-cam,P.y,'#FFD34D',18,140);sfx('achievement')}}});
  projs=projs.filter(p=>{p.x+=p.vx*dt;p.y+=(p.vy||0)*dt;p.life-=dt;
   if(Math.random()<0.5)parts.push({x:p.x-cam,y:p.y,vx:0,vy:0,life:0.3,color:p.fire?'#FF8A3D':LG,r:1.6});
   const f=foes.find(f=>!f.dead&&Math.abs(f.x-p.x)<22&&Math.abs(f.y-p.y)<44*k);
   if(f){hitFoe(f,Math.round(pAtk()*0.85),Math.sign(p.vx),false);return false}
   if(B&&!B.dead&&!B.dying&&B.engaged&&Math.abs(B.x-p.x)<40&&Math.abs(B.y-p.y)<56*k){bossHit(Math.round(pAtk()*0.85),false);return false}
   return p.life>0});
  eprojs=eprojs.filter(p=>{p.x+=p.vx*dt;p.y+=(p.vy||0)*dt;p.life-=dt;
   if(!busy&&Math.abs(P.x-p.x)<16&&Math.abs(P.y-p.y)<26*k){hurt(3,Math.sign(p.vx));return false}
   return p.life>0});
  foes.forEach(f=>foeAI(f,dt,t));bossAI(dt,t);
  if(st.checkpoints_enabled!==false)CPX.forEach((cx2,i)=>{if(i>cpIdx&&P.x>cx2){cpIdx=i;
   pHp=Math.min(pMax,pHp+6);mana=mMax;say('\u2691 Checkpoint reached');sfx('checkpoint');
   burst(cx2-cam,groundYAt(cx2)-40*k,'#10E670',14,110)}});
  const exx=st.exit&&st.exit.x||WORLD-60;
  if(Math.abs(P.x-exx)<34&&P.y>groundYAt(exx)-130*k){
   const open=(!B||B.dead)&&keysL>=KEYNEED;
   if(open&&endT<=0){
    if(st.ending&&stageIdx>=S.stages.length-1){endT=3.4;busy=true;sfx('victory');saveGame()}
    else{doneFlag=true;cancelAnimationFrame(raf);addScore(40);saveGame();
     fb(true,(st.title||'Level')+' complete!'+unlockMsg(),next);return}}
   else if(!open&&keyHintT<=0){keyHintT=4;sfx('wrong');
    say(keysL<KEYNEED?'\uD83D\uDDDD The portal is sealed \u2014 find the key ('+keysL+'/'+KEYNEED+')':'Defeat '+(B?B.name:'the guardian')+' to open the portal')}}
  if(keyHintT>0)keyHintT-=dt;
  if(endT>0){endT-=dt;
   if(endT<=0){doneFlag=true;cancelAnimationFrame(raf);addScore(80);saveGame();
    fb(true,(st.ending_title||'PART 2')+' \u2014 '+(st.ending_subtitle||'COMING SOON'),next);return}}
  let target=P.x-W*0.42+P.face*W*0.07+P.vx*0.24;
  if(B&&B.engaged&&!B.dead)target=Math.max(target,(st.arena_x||WORLD-520)-60);
  cam+=(Math.max(0,Math.min(WORLD-W,target))-cam)*Math.min(1,dt*3.8);
  const scr=P.x-cam;
  if(scr<W*0.18)cam=Math.max(0,P.x-W*0.18);
  if(scr>W*0.64)cam=Math.min(WORLD-W,P.x-W*0.64);
  if(WH>H){let cyT=camY;const sy=P.y-camY;
   if(sy>H*0.68)cyT=P.y-H*0.68;else if(sy<H*0.30)cyT=P.y-H*0.30;
   cyT=Math.max(0,Math.min(WH-H,cyT));
   camY+=(cyT-camY)*Math.min(1,dt*(P.onG?7:3.4))}
  if(shakeT>0){shakeT-=dt;cam+=Math.sin(t*70)*shakeT*13}
  drawWorld(t);
  g.save();g.translate(0,-camY);drawHero(t,dt);drawFx(g,dt);g.restore();
  fgLayer(t);drawHUD();
  if(endT>0){const ea=Math.min(1,(3.4-endT)*1.2);
   g.fillStyle='rgba(2,4,14,'+(ea*0.86).toFixed(2)+')';g.fillRect(0,0,W,H);
   g.save();g.textAlign='center';g.shadowColor='#B98BFF';g.shadowBlur=30;g.globalAlpha=ea;
   g.fillStyle='#EAF2FF';g.font='900 '+Math.round(52*k)+'px system-ui';
   g.fillText(st.ending_title||'PART 2',W/2,H/2-6*k);
   g.font='bold '+Math.round(19*k)+'px system-ui';g.fillStyle=LG;
   g.fillText(st.ending_subtitle||'COMING SOON',W/2,H/2+30*k);g.restore()}}
 ctrlGuide();raf=requestAnimationFrame(loop)}

/* ── XY ENGINE V2 (action_rpg_2_5d · schema_version:2) — true 2D multi-elevation
   world. Full AABB solids (floors/walls/ceilings), stair ramps, one-way platforms,
   ladders, rooms, hazards, smooth X+Y scrolling camera, exact key_id→portal state
   machine (locked→unlocking→active), animation state machine V2. Gameplay is
   STRICTLY X/Y — the 2.5D look comes from parallax + layering only. ── */
function arpgXY(st){const c=mkCanvas(0),g=c.getContext('2d'),W=c.width,H=c.height;
 const kk=H/(st.view_h||420),VW=W/kk,VH=H/kk;
 const WW=st.world_w||3200,WH2=st.world_h||1200;
 const LP=st.palette||{},LG=LP.glow||GLOW,LA=LP.accent||ACC,LH=LP.hazard||HAZC;
 const SOL=st.solids||[],OW=st.one_way||[],STR=st.stairs||[],LAD=st.ladders||[],RM=st.rooms||[],HZD=st.hazards||[];
 const CPS=(st.checkpoints||[]).map(x2=>({...x2,hit:false}));
 window.__INV2__=window.__INV2__||{};const INV=window.__INV2__;
 const KEYS=(st.keys||[]).map(kd=>({...kd,got:!!INV[kd.key_id]}));
 const PORT=(st.portals||[]).map(p=>({...p,state:p.required_key_id?'locked':'active',t:0}));
 const PICK=(st.pickups||[]).map(p=>({...p,got:false}));
 let pMax=st.player_hp||30,mMax=st.player_mana||12,atkBase=7;
 let pHp=pMax,mana=mMax,doneFlag=false,raf=null,busy=true,cd3=1.6;
 let msg='',msgT=0,coins=0,endT=0,shakeT=0,hintT=0;
 let cp={x:(st.spawn&&st.spawn.x)||80,y:(st.spawn&&st.spawn.y)||WH2-120};
 const PW2=8,PH2=36;
 const P={x:cp.x,y:cp.y,vx:0,vy:0,face:1,onG:false,wasG:false,st:'idle',stT:0,animT:0,inv:1.2,
  atkCd:0,splCd:0,dashCd:0,dashT:0,climb:false,drop:0,coyote:0,land:0,pose:{rot:0,sx:1,sy:1,ox:0,oy:0}};
 let camX=Math.max(0,Math.min(Math.max(0,WW-VW),P.x-VW*0.45)),camY=Math.max(0,Math.min(Math.max(0,WH2-VH),P.y-VH*0.6));
 const foes=(st.enemies||[]).map((e,i)=>({...e,id:i,mx:e.hp||12,hp:e.hp||12,home:e.x,y:e.y||WH2-60,
  vx:0,cd:1,flash:0,dead:false,dir:1,type:e.type||'walker',speed:e.speed||46,ph:Math.random()*6}));
 let projs=[],eprojs=[];
 function say(m){msg=m;msgT=3.2}
 function setSt(s){if(P.st!==s){P.st=s;P.stT=0}}
 function solidAt(x,y){for(let i=0;i<SOL.length;i++){const s=SOL[i];
  if(x+PW2>s.x&&x-PW2<s.x+s.w&&y>s.y&&y-PH2<s.y+s.h)return s}return null}
 function stairY(x){let best=null;for(let i=0;i<STR.length;i++){const s=STR[i];
  if(x>=s.x&&x<=s.x+s.w){const sy=s.yl+(s.yr-s.yl)*((x-s.x)/s.w);if(best===null||sy<best)best=sy}}return best}
 function groundY(x,fromY){let best=WH2;
  SOL.forEach(s=>{if(x>s.x&&x<s.x+s.w&&s.y>=fromY&&s.y<best)best=s.y});
  OW.forEach(s=>{if(x>s.x&&x<s.x+s.w&&s.y>=fromY&&s.y<best)best=s.y});
  const sy=stairY(x);if(sy!==null&&sy>=fromY&&sy<best)best=sy;return best}
 function die(reason){if(doneFlag||busy)return;busy=true;setSt('death');sfx('gameover');shakeT=0.4;vib(120);
  burst(P.x,P.y-16,LH,20,160);
  setTimeout(()=>{lives--;refreshHud();
   if(lives<=0){doneFlag=true;cancelAnimationFrame(raf);gameOver();return}
   P.x=cp.x;P.y=cp.y;P.vx=0;P.vy=0;P.climb=false;pHp=pMax;mana=mMax;P.inv=1.8;busy=false;setSt('idle');
   say(reason+' \u2014 keys kept, back at the checkpoint')},900)}
 function hurt(d2,kx){if(P.inv>0||P.dashT>0||busy)return;pHp-=d2;P.inv=0.9;P.vx+=kx*150;setSt('hurt');
  shakeT=0.25;vib(60);sfx('hit');burst(P.x,P.y-16,LH,9,110);if(pHp<=0)die('You fell in battle')}
 function hitFoe(f,d2,kx,crit){f.hp-=d2;f.flash=0.15;f.x+=kx*6;sfx('hit');shakeT=Math.max(shakeT,0.07);
  burst(f.x,f.y-14,crit?'#FFD34D':LG,crit?13:7,100);popup(f.x,f.y-40,(crit?'CRIT ':'')+d2,crit?'#FFD34D':T.text);
  if(f.hp<=0){f.dead=true;addScore(f.xp||8);burst(f.x,f.y-14,LA,14,130)}}
 function meleeHit(){setSt('attack');P.atkCd=0.38;sfx('laser');const R=64,cx=P.x+P.face*30;
  const crit=Math.random()<0.12,d2=Math.round(atkBase*(crit?2:1));
  burst(P.x+P.face*30,P.y-18,LG,6,90);
  foes.forEach(f=>{if(!f.dead&&Math.abs(f.x-cx)<R&&Math.abs(f.y-P.y)<72)hitFoe(f,d2,P.face,crit)})}
 function castSpell(){if(mana<3){say('Not enough mana');sfx('wrong');return}mana-=3;setSt('cast');P.splCd=0.8;
  sfx('combo');burst(P.x+P.face*20,P.y-24,LG,8,80);
  projs.push({x:P.x+P.face*22,y:P.y-20,vx:P.face*430,vy:0,life:1.6})}
 function doDash(){if(P.dashCd>0)return;setSt('dash');P.dashCd=0.9;P.dashT=0.2;P.inv=Math.max(P.inv,0.4);
  P.vx=P.face*470;sfx('click');burst(P.x,P.y-10,LG,6,60)}
 function foeAI(f,dt,t){if(f.dead)return;f.cd-=dt;f.flash-=dt;
  if(f.type==='bat'){f.y=(f.anchor_y||300)+Math.sin(t*2+f.ph)*24;f.x+=Math.sin(t*1.3+f.ph)*22*dt;
   const dx=P.x-f.x,dy=(P.y-18)-f.y,d=Math.hypot(dx,dy);
   if(d<240&&f.cd<=0){f.cd=1.8;const m=Math.max(1,d);eprojs.push({x:f.x,y:f.y,vx:dx/m*205,vy:dy/m*205,life:1.8})}return}
  f.y=groundY(f.x,f.y-44);
  const dx=P.x-f.x,dy=P.y-f.y,d=Math.hypot(dx,dy);
  const spd=f.type==='brute'?f.speed*0.6:f.speed,rng=f.type==='brute'?42:30,atk=f.attack||(f.type==='brute'?6:3);
  if(d<220&&Math.abs(dy)<90&&!busy){f.dir=Math.sign(dx)||1;f.x+=f.dir*spd*dt;
   if(Math.abs(dx)<rng&&Math.abs(dy)<60&&f.cd<=0){f.cd=f.type==='brute'?1.5:1.1;hurt(atk,Math.sign(dx)*-1||-1);
    if(f.type==='brute')shakeT=0.2}}
  else{if(f.x<f.home-(f.range||90))f.dir=1;if(f.x>f.home+(f.range||90))f.dir=-1;f.x+=f.dir*spd*0.5*dt}}
 /* ── ANIMATION ENGINE V2 — distinct pose per state, smooth blending ── */
 const PO2={idle:s=>({rot:0,sx:1,sy:1+Math.sin(s.t*2.2)*0.02,oy:0,ox:0,leg:Math.sin(s.t*2.2)*0.08,arm:0.2}),
  run:s=>({rot:s.f*0.08,sx:1,sy:1+Math.abs(Math.sin(s.t*11))*0.04,oy:-Math.abs(Math.sin(s.t*11))*3,ox:0,leg:Math.sin(s.t*11),arm:Math.sin(s.t*11+3.14)*0.9}),
  jump_rise:s=>({rot:-s.f*0.1,sx:0.92,sy:1.1,oy:-2,ox:0,leg:-0.7,arm:-1.5}),
  jump_fall:s=>({rot:s.f*0.06,sx:1.06,sy:0.92,oy:0,ox:0,leg:0.55,arm:0.9}),
  land:s=>({rot:0,sx:1.18,sy:0.78,oy:4,ox:0,leg:0.9,arm:0.5}),
  dash:s=>({rot:s.f*0.5,sx:1.3,sy:0.8,oy:2,ox:s.f*6,leg:0.2,arm:-0.6}),
  attack:s=>({rot:s.f*(s.st<0.12?0.22:0.1),sx:1.06,sy:0.96,oy:0,ox:s.f*(s.st<0.16?8:3),leg:0.3,arm:1.9}),
  cast:s=>({rot:-s.f*0.06,sx:0.96,sy:1.06,oy:-2,ox:-s.f*3,leg:0.1,arm:-1.9}),
  hurt:s=>({rot:-s.f*0.16,sx:1.05,sy:0.94,oy:0,ox:-s.f*5,leg:0.4,arm:0.8}),
  death:s=>({rot:s.f*Math.min(1.55,s.st*2.6),sx:1,sy:1,oy:s.st*26,ox:0,leg:0.2,arm:0.3}),
  climb:s=>({rot:0,sx:1,sy:1,oy:0,ox:0,leg:Math.sin(s.t*9),arm:Math.sin(s.t*9+3.14)})};
 function drawHeroXY(t,dt){
  g.save();g.globalAlpha=0.3;g.fillStyle='#000';
  const gsh=groundY(P.x,P.y-2);g.beginPath();g.ellipse(P.x,Math.min(gsh,P.y+40),14,4,0,0,7);g.fill();g.restore();
  if(P.inv>0&&P.st!=='dash'&&P.st!=='death'&&Math.floor(t*14)%2)return;
  const tgt=(PO2[P.st]||PO2.idle)({t:t*2+P.animT*3,f:P.face,st:P.stT});
  const po=P.pose,bl=Math.min(1,dt*13);
  po.rot+=(tgt.rot-po.rot)*bl;po.sx+=(tgt.sx-po.sx)*bl;po.sy+=(tgt.sy-po.sy)*bl;
  po.oy+=(tgt.oy-po.oy)*bl;po.ox+=(tgt.ox-po.ox)*bl;
  if(P.st==='dash'){g.save();g.globalAlpha=0.25;g.fillStyle=LG;
   for(let i=1;i<4;i++)g.fillRect(P.x-P.face*i*10-7,P.y-34,14,32);g.restore()}
  g.save();g.translate(P.x+po.ox,P.y+po.oy);g.rotate(po.rot);g.scale(po.sx,po.sy);
  if(P.st==='death')g.globalAlpha=Math.max(0.25,1-P.stT*0.8);
  g.strokeStyle='#8fa0bd';g.lineWidth=5;g.lineCap='round';
  const lg2=tgt.leg*9;
  g.beginPath();g.moveTo(-4,-15);g.lineTo(-4+lg2*P.face,0);g.moveTo(4,-15);g.lineTo(4-lg2*P.face,0);g.stroke();
  const a2=tgt.arm;
  g.strokeStyle='#7c8cab';g.beginPath();g.moveTo(-P.face*5,-29);
  g.lineTo(-P.face*5-P.face*Math.cos(a2)*11,-29+Math.sin(a2)*8);g.stroke();
  g.fillStyle='#cdd6e6';g.beginPath();
  if(g.roundRect)g.roundRect(-8,-34,16,21,5);else g.rect(-8,-34,16,21);g.fill();
  g.beginPath();g.arc(0,-40,7,0,7);g.fill();
  g.fillStyle='#31405c';g.fillRect(P.face>0?0:-6,-43,6,4);
  g.strokeStyle='#aab8d2';g.beginPath();g.moveTo(P.face*5,-29);
  g.lineTo(P.face*5+P.face*Math.cos(a2)*13,-29+Math.sin(a2)*11);g.stroke();
  g.restore();
  if(P.st==='attack'&&P.stT<0.18){g.save();g.translate(P.x,P.y-18);g.scale(P.face,1);
   g.strokeStyle=LG;g.lineWidth=3.5;g.shadowColor=LG;g.shadowBlur=14;g.globalAlpha=1-P.stT*4.5;
   g.beginPath();g.arc(0,0,46,-1.1+P.stT*5,0.4+P.stT*5);g.stroke();g.restore()}
  if(P.st==='cast'&&P.stT<0.3){g.save();g.strokeStyle=LG;g.globalAlpha=1-P.stT*3;g.lineWidth=2;
   g.beginPath();g.arc(P.x,P.y-18,18+P.stT*110,0,7);g.stroke();g.restore()}
  if(S.debug_collision){g.fillStyle='#fff';g.font='10px monospace';g.textAlign='center';
   g.fillText(P.st,P.x,P.y-56);g.textAlign='left'}}
 function drawPortal(p,t){const px=p.x,py=p.y-58,rx=32,ry=52,col=p.color||LG;
  g.save();
  g.fillStyle='#232b3d';g.beginPath();g.ellipse(px,py,rx+12,ry+12,0,0,7);g.fill();
  g.strokeStyle='#465372';g.lineWidth=4;g.beginPath();g.ellipse(px,py,rx+9,ry+9,0,0,7);g.stroke();
  for(let i=0;i<8;i++){const ra=i/8*6.283+0.39,gx=px+Math.cos(ra)*(rx+9),gy=py+Math.sin(ra)*(ry+9);
   g.fillStyle=p.state==='active'?col:p.state==='unlocking'?LA:'#3a4457';
   g.beginPath();g.arc(gx,gy,4,0,7);g.fill()}
  if(p.state==='locked'){g.fillStyle='rgba(10,14,26,0.92)';g.beginPath();g.ellipse(px,py,rx,ry,0,0,7);g.fill();
   g.strokeStyle='#5a6478';g.lineWidth=2;g.globalAlpha=0.6+Math.sin(t*2)*0.15;
   g.beginPath();g.ellipse(px,py,rx*0.7,ry*0.7,0,0,7);g.stroke();g.globalAlpha=1;
   g.fillStyle='#8b96ad';g.font='bold 20px system-ui';g.textAlign='center';g.fillText('\uD83D\uDD12',px,py+7);
   g.font='bold 10px system-ui';g.fillStyle='#7d8aa5';
   g.fillText('SEALED',px,py+ry+26);g.textAlign='left'}
  else if(p.state==='unlocking'){const pr=p.t/1.5;
   g.fillStyle='rgba(10,14,26,0.9)';g.beginPath();g.ellipse(px,py,rx,ry,0,0,7);g.fill();
   g.fillStyle=col+'66';g.beginPath();g.ellipse(px,py+ry*(1-pr),rx*pr,ry*pr,0,0,7);g.fill();
   g.strokeStyle=LA;g.lineWidth=3;g.globalAlpha=0.6+Math.sin(t*14)*0.4;
   g.beginPath();g.ellipse(px,py,rx+4+Math.sin(t*10)*4,ry+4+Math.sin(t*10)*4,0,0,7);g.stroke();g.globalAlpha=1;
   g.fillStyle=LA;g.font='bold 10px system-ui';g.textAlign='center';
   g.fillText('UNLOCKING\u2026',px,py+ry+26);g.textAlign='left';
   if(Math.random()<0.35)parts.push({x:px+(Math.random()-0.5)*rx*2,y:py+ry,vx:0,vy:-60-Math.random()*60,life:0.7,color:'#FFD34D',r:2})}
  else{const ig=g.createRadialGradient(px,py,2,px,py,Math.max(rx,ry));
   ig.addColorStop(0,'rgba(255,255,255,0.9)');ig.addColorStop(0.4,col+'cc');ig.addColorStop(1,'rgba(6,12,30,0.9)');
   g.fillStyle=ig;g.beginPath();g.ellipse(px,py,rx,ry,0,0,7);g.fill();
   g.save();g.beginPath();g.ellipse(px,py,rx,ry,0,0,7);g.clip();
   g.strokeStyle='rgba(255,255,255,0.5)';g.lineWidth=2;
   for(let i=0;i<3;i++){g.beginPath();
    for(let a3=0;a3<6.283;a3+=0.5){const rr=(a3/6.283)*rx*(0.9-i*0.2);
     const qx=px+Math.cos(a3+t*(1.5+i*0.4))*rr,qy=py+Math.sin(a3+t*(1.5+i*0.4))*rr*(ry/rx);
     a3===0?g.moveTo(qx,qy):g.lineTo(qx,qy)}g.globalAlpha=0.3+i*0.15;g.stroke()}
   g.globalAlpha=1;g.restore();
   g.fillStyle=col;g.font='bold 10px system-ui';g.textAlign='center';
   g.fillText('\u25B8 ENTER \u25C2',px,py+ry+26);g.textAlign='left';
   if(Math.random()<0.2)parts.push({x:px+(Math.random()-0.5)*rx*1.6,y:py+(Math.random()-0.5)*ry*1.6,vx:(Math.random()-0.5)*24,vy:-30,life:1,color:'#9fe2ff',r:1.8})}
  g.fillStyle='#c6d2e8';g.font='bold 11px system-ui';g.textAlign='center';
  g.fillText((p.label||p.portal_id||'PORTAL').toUpperCase(),px,py-ry-14);g.textAlign='left';g.restore()}
 function drawWorld(t,dt){
  skyGrad(g,W,H,LP.sky||'#16243c',LP.bg||'#0a1020');
  g.save();/* parallax silhouettes — visual 2.5D only */
  g.fillStyle='rgba(46,84,66,0.30)';g.beginPath();g.moveTo(0,H);
  for(let x=0;x<=W;x+=34){const n=hz(Math.floor((x+camX*0.22*kk)/34));g.lineTo(x,H*0.5-n*H*0.2-camY*0.06*kk)}
  g.lineTo(W,H);g.fill();
  g.fillStyle='rgba(24,48,40,0.5)';g.beginPath();g.moveTo(0,H);
  for(let x=0;x<=W;x+=24){const n=hz(Math.floor((x+camX*0.45*kk)/24)+41);g.lineTo(x,H*0.68-n*H*0.16-camY*0.1*kk)}
  g.lineTo(W,H);g.fill();g.restore();
  g.save();g.scale(kk,kk);g.translate(-camX,-camY);
  RM.forEach(r=>{g.fillStyle=r.tint||'rgba(255,255,255,0.03)';g.fillRect(r.x,r.y,r.w,r.h);
   g.fillStyle='rgba(234,242,255,0.14)';g.font='bold 26px system-ui';
   g.fillText(r.label||'',r.x+24,r.y+40)});
  STR.forEach(s=>{const yb=Math.max(s.yl,s.yr)+30;
   g.fillStyle='#33405a';g.beginPath();g.moveTo(s.x,s.yl);g.lineTo(s.x+s.w,s.yr);
   g.lineTo(s.x+s.w,yb);g.lineTo(s.x,yb);g.fill();
   g.strokeStyle='#93a7cc';g.lineWidth=3;g.beginPath();g.moveTo(s.x,s.yl);g.lineTo(s.x+s.w,s.yr);g.stroke();
   g.strokeStyle='rgba(147,167,204,0.25)';g.lineWidth=1.5;
   const nst=Math.max(3,Math.round(s.w/46));
   for(let i=1;i<nst;i++){const fx2=s.x+s.w*i/nst,fy2=s.yl+(s.yr-s.yl)*i/nst;
    g.beginPath();g.moveTo(fx2,fy2);g.lineTo(fx2,fy2+12);g.stroke()}});
  SOL.forEach(s=>{if(s.x-camX>VW+80||s.x+s.w-camX<-80)return;
   g.fillStyle=s.color||'#39445a';g.fillRect(s.x,s.y,s.w,s.h);
   g.fillStyle='rgba(160,180,215,0.5)';g.fillRect(s.x,s.y,s.w,3);
   g.strokeStyle='rgba(0,0,0,0.25)';g.strokeRect(s.x+0.5,s.y+0.5,s.w-1,s.h-1);
   g.fillStyle='rgba(0,0,0,0.14)';
   for(let yy=s.y+22;yy<s.y+s.h-8&&yy<s.y+130;yy+=26)
    for(let xx=s.x+((yy/26)%2)*22;xx<s.x+s.w-30;xx+=44)g.fillRect(xx+6,yy,30,1.5)});
  OW.forEach(o=>{g.fillStyle='#6b5a3f';g.fillRect(o.x,o.y,o.w,9);
   g.fillStyle='#8d7a55';for(let xx=2;xx<o.w-2;xx+=15)g.fillRect(o.x+xx,o.y,10,9);
   g.strokeStyle='rgba(141,122,85,0.4)';g.setLineDash([5,5]);
   g.beginPath();g.moveTo(o.x,o.y+11);g.lineTo(o.x+o.w,o.y+11);g.stroke();g.setLineDash([])});
  LAD.forEach(l=>{g.strokeStyle='#7d6a48';g.lineWidth=4;
   g.beginPath();g.moveTo(l.x-9,l.y);g.lineTo(l.x-9,l.y+l.h);g.moveTo(l.x+9,l.y);g.lineTo(l.x+9,l.y+l.h);g.stroke();
   g.lineWidth=3;g.strokeStyle='#93805c';
   for(let yy=l.y+8;yy<l.y+l.h;yy+=20){g.beginPath();g.moveTo(l.x-9,yy);g.lineTo(l.x+9,yy);g.stroke()}});
  HZD.forEach(h2=>{g.fillStyle='rgba(255,80,60,0.22)';g.fillRect(h2.x,h2.y,h2.w,h2.h);
   g.fillStyle=LH;for(let xx=h2.x;xx<h2.x+h2.w-8;xx+=14){
    g.beginPath();g.moveTo(xx,h2.y+h2.h);g.lineTo(xx+7,h2.y+Math.sin(t*3+xx)*2);g.lineTo(xx+14,h2.y+h2.h);g.fill()}});
  CPS.forEach(cpd=>{g.strokeStyle='#8a7a5a';g.lineWidth=4;
   g.beginPath();g.moveTo(cpd.x,cpd.y);g.lineTo(cpd.x,cpd.y-64);g.stroke();g.lineWidth=1;
   g.fillStyle=cpd.hit?'#10E670':'#66707e';
   g.beginPath();g.moveTo(cpd.x,cpd.y-64);g.lineTo(cpd.x+26,cpd.y-55+Math.sin(t*3)*3);g.lineTo(cpd.x,cpd.y-46);g.fill();
   if(cpd.hit){g.shadowColor='#10E670';g.shadowBlur=14;g.fillRect(cpd.x-2,cpd.y-64,4,4);g.shadowBlur=0}});
  PICK.forEach(pk=>{if(pk.got)return;const py=pk.y+Math.sin(t*3+pk.x)*3;
   g.fillStyle=pk.kind==='potion'?'#FF5A6E':pk.kind==='gem'?'#4de3ff':'#FFD34D';
   g.shadowColor=g.fillStyle;g.shadowBlur=8;
   if(pk.kind==='gem'){g.save();g.translate(pk.x,py);g.rotate(0.785);g.fillRect(-6,-6,12,12);g.restore()}
   else{g.beginPath();g.arc(pk.x,py,7,0,7);g.fill()}g.shadowBlur=0});
  KEYS.forEach(kd=>{if(kd.got)return;const py=kd.y+Math.sin(t*2.4)*4;
   const fg3=g.createRadialGradient(kd.x,py,0,kd.x,py,34);
   fg3.addColorStop(0,'rgba(255,211,77,0.5)');fg3.addColorStop(1,'rgba(255,211,77,0)');
   g.fillStyle=fg3;g.beginPath();g.arc(kd.x,py,34,0,7);g.fill();
   g.save();g.translate(kd.x,py);g.rotate(Math.sin(t*1.6)*0.3);
   g.fillStyle='#FFD34D';g.shadowColor='#FFD34D';g.shadowBlur=14;
   g.beginPath();g.arc(0,-6,7,0,7);g.fill();g.fillRect(-2.5,-2,5,16);g.fillRect(0,8,8,4);g.fillRect(0,14,6,3);
   g.shadowBlur=0;g.restore();
   g.fillStyle='#ffe9a8';g.font='bold 11px system-ui';g.textAlign='center';
   g.fillText((kd.label||kd.key_id).toUpperCase(),kd.x,py-24);g.textAlign='left'});
  PORT.forEach(p=>drawPortal(p,t));
  foes.forEach(f=>{if(f.dead)return;
   g.save();g.globalAlpha=0.28;g.fillStyle='#000';
   g.beginPath();g.ellipse(f.x,f.type==='bat'?groundY(f.x,f.y):f.y,f.type==='brute'?22:14,4,0,0,7);g.fill();g.restore();
   const fc=f.flash>0?'#fff':(f.type==='bat'?'#B14BF4':f.type==='brute'?'#a4502e':LH);
   if(f.type==='bat'){g.fillStyle=fc;const wf=Math.sin(t*14+f.ph)*10;
    g.beginPath();g.moveTo(f.x-16,f.y-wf);g.lineTo(f.x,f.y);g.lineTo(f.x-4,f.y+6);g.fill();
    g.beginPath();g.moveTo(f.x+16,f.y-wf);g.lineTo(f.x,f.y);g.lineTo(f.x+4,f.y+6);g.fill();
    g.beginPath();g.arc(f.x,f.y,7,0,7);g.fill()}
   else{const bw=f.type==='brute'?18:12,bh=f.type==='brute'?40:28;
    g.fillStyle=fc;g.beginPath();
    if(g.roundRect)g.roundRect(f.x-bw,f.y-bh,bw*2,bh,7);else g.rect(f.x-bw,f.y-bh,bw*2,bh);g.fill();
    g.fillStyle='#0b1220';const ey=f.y-bh+8;
    g.fillRect(f.x+(f.dir>0?2:-8),ey,6,5)}
   g.fillStyle='#0008';g.fillRect(f.x-15,f.y-(f.type==='brute'?52:f.type==='bat'?20:40),30,4);
   g.fillStyle='#10E670';g.fillRect(f.x-14,f.y-(f.type==='brute'?52:f.type==='bat'?20:40)+1,28*Math.max(0,f.hp/f.mx),2)});
  projs.forEach(p=>{g.fillStyle=LG;g.shadowColor=LG;g.shadowBlur=10;
   g.beginPath();g.arc(p.x,p.y,5,0,7);g.fill();g.shadowBlur=0});
  eprojs.forEach(p=>{g.fillStyle=LH;g.shadowColor=LH;g.shadowBlur=8;
   g.beginPath();g.arc(p.x,p.y,4.5,0,7);g.fill();g.shadowBlur=0});
  drawHeroXY(t,dt);drawFx(g,dt);
  if(S.debug_collision){g.lineWidth=1.5;
   SOL.forEach(s=>{g.strokeStyle='#00ff88';g.strokeRect(s.x,s.y,s.w,s.h)});
   OW.forEach(o=>{g.strokeStyle='#ffd34d';g.strokeRect(o.x,o.y,o.w,4)});
   STR.forEach(s=>{g.strokeStyle='#00ccff';g.beginPath();g.moveTo(s.x,s.yl);g.lineTo(s.x+s.w,s.yr);g.stroke()});
   g.strokeStyle='#ff3355';g.strokeRect(P.x-PW2,P.y-PH2,PW2*2,PH2)}
  g.restore();
  const lg3=g.createRadialGradient(W/2,H*0.45,60,W/2,H*0.45,Math.max(W,H)*0.8);
  lg3.addColorStop(0,'rgba(0,0,0,0)');lg3.addColorStop(1,'rgba(2,4,12,0.4)');
  g.fillStyle=lg3;g.fillRect(0,0,W,H)}
 function objTxt(){const lp=PORT.find(p=>p.state!=='active'&&p.required_key_id);
  if(lp&&!INV[lp.required_key_id]){const kd=KEYS.find(k2=>k2.key_id===lp.required_key_id);
   return '\u25B8 Find the '+((kd&&kd.label)||lp.required_key_id)}
  if(lp)return '\u25B8 Bring the key to the '+(lp.label||'portal');
  const ap=PORT.find(p=>p.state==='active');
  return ap?'\u2713 Enter the '+(ap.label||'portal'):'\u25B8 Explore'}
 function drawHUD(){g.save();g.fillStyle='rgba(4,8,20,0.55)';
  if(g.roundRect){g.beginPath();g.roundRect(8,8,158,52,12);g.fill()}else g.fillRect(8,8,158,52);
  g.fillStyle='#ffffff20';g.fillRect(16,15,112,7);g.fillStyle='#10E670';g.fillRect(16,15,112*Math.max(0,pHp/pMax),7);
  g.fillStyle='#ffffff20';g.fillRect(16,25,112,5);g.fillStyle='#2EA0FF';g.fillRect(16,25,112*Math.max(0,mana/mMax),5);
  g.font='bold 9px system-ui';g.fillStyle='#FF5A6E';let hearts='';for(let i=0;i<lives;i++)hearts+='\u2665';
  g.fillText(hearts||'\u2620',16,42);
  g.fillStyle='#FFD34D';g.fillText('\u25CF'+coins,70,42);
  const kl=Object.keys(INV);
  kl.forEach((kid,i)=>{g.fillStyle='rgba(255,211,77,0.16)';
   const kw=g.measureText(kid).width+22;
   if(g.roundRect){g.beginPath();g.roundRect(16+i*(kw+6),46,kw,12,6);g.fill()}else g.fillRect(16+i*(kw+6),46,kw,12);
   g.fillStyle='#FFD34D';g.font='bold 8px system-ui';g.fillText('\uD83D\uDDDD '+kid,20+i*(kw+6),55)});
  const obj=objTxt();g.font='bold 10px system-ui';g.textAlign='right';
  const ow2=g.measureText(obj).width+18;
  g.fillStyle='rgba(4,8,20,0.5)';
  if(g.roundRect){g.beginPath();g.roundRect(W-ow2-8,8,ow2,20,8);g.fill()}else g.fillRect(W-ow2-8,8,ow2,20);
  g.fillStyle=LA;g.fillText(obj,W-16,22);
  g.fillStyle='rgba(234,242,255,0.5)';g.font='bold 8px system-ui';
  g.fillText('LEVEL '+(stageIdx+1)+'/'+S.stages.length+' \u00b7 '+(st.title||'').toUpperCase(),W-16,38);
  const rm=RM.find(r=>P.x>r.x&&P.x<r.x+r.w&&P.y>r.y&&P.y<r.y+r.h);
  if(rm&&rm.label){g.textAlign='center';g.fillStyle='rgba(234,242,255,0.35)';g.font='bold 9px system-ui';
   g.fillText(rm.label,W/2,18)}
  g.textAlign='left';g.restore();
  if(msgT>0){g.font='bold 12px system-ui';const tw2=g.measureText(msg).width+26;
   g.fillStyle='rgba(4,8,20,0.82)';g.fillRect(W/2-tw2/2,H-100,tw2,24);
   g.fillStyle=T.text;g.textAlign='center';g.fillText(msg,W/2,H-83);g.textAlign='left'}
  if(cd3>0&&cd3<3.5){g.font='bold 40px system-ui';g.textAlign='center';
   g.save();g.shadowColor=LG;g.shadowBlur=20;g.fillStyle=LG;g.fillText('READY',W/2,H/2-16);g.restore();g.textAlign='left'}}
 /* input: edge-latched actions + fixed viewport touch controls */
 const latch2={};
 document.addEventListener('keydown',e=>{if(e.repeat)return;
  ['attack','spell','dodge','jump'].forEach(a=>{if(akeys(a).includes(e.key))latch2[a]=true})});
 function tap2(a){if(latch2[a]){latch2[a]=false;return true}return false}
 const DP2={left:false,right:false,jump:false,down:false};
 if(MOB){
  function fxBtn(id,glyph,size,color,pos){const b=el('button','',glyph);
   b.setAttribute('data-testid',id);
   b.style.cssText='position:fixed;'+pos+';width:'+size+'px;height:'+size+'px;border-radius:50%;z-index:45;'+
    'border:2px solid '+(color||'rgba(255,255,255,0.3)')+'55;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,0.14),rgba(10,16,32,0.4));'+
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:'+(color||'rgba(255,255,255,0.92)')+';'+
    'font-weight:900;font-size:'+Math.round(size*0.4)+'px;display:flex;align-items:center;justify-content:center;'+
    'box-shadow:0 4px 14px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.16);opacity:0.88;'+
    'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;padding:0;transition:transform .08s';
   const dn=e=>{e.preventDefault();e.stopPropagation();lastInput='touch';
    b.style.transform='scale(0.86)';b.style.background='radial-gradient(circle at 35% 30%,rgba(255,255,255,0.3),rgba(24,36,64,0.62))';vib(8);
    try{b.setPointerCapture(e.pointerId)}catch(err){}b._on&&b._on()};
   const up=e=>{if(e&&e.preventDefault)e.preventDefault();
    b.style.transform='';b.style.background='radial-gradient(circle at 35% 30%,rgba(255,255,255,0.14),rgba(10,16,32,0.4))';b._off&&b._off()};
   b.addEventListener('pointerdown',dn);b.addEventListener('pointerup',up);
   b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
   b.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
   b.addEventListener('contextmenu',e=>e.preventDefault());
   document.body.appendChild(b);return b}
  const SB='calc(14px + env(safe-area-inset-bottom,0px))',SB2='calc(88px + env(safe-area-inset-bottom,0px))';
  const bl=fxBtn('xy-btn-left','\u25C0',60,null,'left:calc(14px + env(safe-area-inset-left,0px));bottom:'+SB);
  bl._on=()=>DP2.left=true;bl._off=()=>DP2.left=false;
  const br=fxBtn('xy-btn-right','\u25B6',60,null,'left:calc(86px + env(safe-area-inset-left,0px));bottom:'+SB);
  br._on=()=>DP2.right=true;br._off=()=>DP2.right=false;
  const bj=fxBtn('xy-btn-jump','\u2B06',66,'#10E670','right:calc(14px + env(safe-area-inset-right,0px));bottom:'+SB);
  bj._on=()=>{DP2.jump=true;latch2.jump=true};bj._off=()=>DP2.jump=false;
  const ba=fxBtn('xy-btn-attack','\u2694',52,'#FF5A6E','right:calc(92px + env(safe-area-inset-right,0px));bottom:'+SB);
  ba._on=()=>latch2.attack=true;
  const bd=fxBtn('xy-btn-dash','\u27A0',46,'#FFD34D','right:calc(20px + env(safe-area-inset-right,0px));bottom:'+SB2);
  bd._on=()=>latch2.dodge=true;
  const bc=fxBtn('xy-btn-cast','\u2726',46,'#2EA0FF','right:calc(96px + env(safe-area-inset-right,0px));bottom:'+SB2);
  bc._on=()=>latch2.spell=true;
  const oldClean=window.__XYBTNS__||[];oldClean.forEach(b2=>{try{b2.remove()}catch(e){}});
  window.__XYBTNS__=[bl,br,bj,ba,bd,bc]}
 let last=0;
 function loop(ts){if(doneFlag)return;raf=requestAnimationFrame(loop);
  const dt=Math.min(0.045,(ts-(last||ts))/1000);last=ts;const t=ts/1000;
  if(PAUSED){drawWorld(t,0);drawHUD();return}
  msgT-=dt;hintT-=dt;
  if(cd3>0){cd3-=dt;if(cd3<=0){busy=false;say(st.intro||'The ruins await \u2014 explore!')}
   drawWorld(t,dt);drawHUD();return}
  P.inv-=dt;P.atkCd-=dt;P.splCd-=dt;P.dashCd-=dt;P.stT+=dt;P.coyote-=dt;
  if(P.land>0)P.land-=dt;if(P.drop>0)P.drop-=dt;
  mana=Math.min(mMax,mana+dt*0.9);
  if(!busy){
   let ix=(act('right')?1:0)-(act('left')?1:0)+((DP2.right?1:0)-(DP2.left?1:0));
   ix=Math.max(-1,Math.min(1,ix));
   const lad=LAD.find(l=>Math.abs(P.x-l.x)<16&&P.y>l.y+2&&P.y-PH2<l.y+l.h+4);
   const upIn=act('up')||act('jump')||DP2.jump,dnIn=act('down')||DP2.down;
   if(P.climb){
    if(!lad){P.climb=false}
    else{P.vx=0;P.vy=0;setSt('climb');
     if(upIn)P.y-=140*dt;if(dnIn)P.y+=140*dt;
     P.animT+=dt*((upIn||dnIn)?1.7:0);
     if(ix){P.climb=false;P.vx=ix*120}
     if(P.y<=lad.y+1){P.y=lad.y;P.climb=false;P.onG=true;P.vy=0;setSt('idle');latch2.jump=false}
     if(P.y>=lad.y+lad.h-2){P.climb=false}}}
   if(!P.climb){
    if(P.dashT>0){P.dashT-=dt}
    else P.vx+=(ix*230*SENS-P.vx)*Math.min(1,dt*9);
    if(ix)P.face=ix>0?1:-1;
    if(lad&&upIn&&!P.onG){P.climb=true;latch2.jump=false;P.vy=0}
    else if(lad&&P.onG&&upIn&&P.y>lad.y+30){P.climb=true;latch2.jump=false;P.vy=0;P.onG=false}
    else{const canJ=P.onG||P.coyote>0;
     if(dnIn&&tap2('jump')&&P.onG){P.drop=0.3;P.vy=Math.max(P.vy,80);P.onG=false}
     else if(canJ&&tap2('jump')){P.vy=-620;P.onG=false;P.coyote=0;setSt('jump_rise');sfx('jump');
      burst(P.x,P.y,'#ffffff44',5,60)}}
    if(tap2('attack')&&P.atkCd<=0)meleeHit();
    if(tap2('spell')&&P.splCd<=0)castSpell();
    if(tap2('dodge'))doDash();
    if(!P.climb){
     P.wasG=P.onG;
     P.x+=P.vx*dt;
     let s=solidAt(P.x,P.y);
     if(s){if(P.onG&&P.vy>=0&&s.y>=P.y-16&&!solidAt(P.x,s.y)){P.y=s.y}
      else{P.x=P.vx>0?s.x-PW2:s.x+s.w+PW2;P.vx=0}}
     P.x=Math.max(PW2,Math.min(WW-PW2,P.x));
     const prevY=P.y;P.vy+=1500*dt;P.vy=Math.min(P.vy,920);P.y+=P.vy*dt;P.onG=false;
     s=solidAt(P.x,P.y);
     if(s){if(P.vy>=0&&prevY<=s.y+1){P.y=s.y;P.vy=0;P.onG=true}
      else if(P.vy<0){P.y=s.y+s.h+PH2;P.vy=30}
      else{P.y=prevY}}
     if(!P.onG&&P.drop<=0&&P.vy>=0)for(let i=0;i<OW.length;i++){const o=OW[i];
      if(P.x>o.x-2&&P.x<o.x+o.w+2&&prevY<=o.y+1&&P.y>=o.y){P.y=o.y;P.vy=0;P.onG=true;break}}
     const sy=stairY(P.x);
     if(sy!==null&&P.vy>=0&&((prevY<=sy+2&&P.y>=sy)||(P.wasG&&Math.abs(sy-P.y)<28))){P.y=sy;P.vy=0;P.onG=true}
     if(P.onG){P.coyote=0.12;
      if(P.st==='jump_fall'||P.st==='jump_rise'){P.land=0.15;setSt('land');
       burst(P.x,P.y,'#ffffff44',4,50)}}
     if(P.y>WH2-4){P.y=WH2-4;P.vy=0;P.onG=true}}}
   HZD.forEach(h2=>{if(P.x+PW2>h2.x&&P.x-PW2<h2.x+h2.w&&P.y>h2.y&&P.y-PH2<h2.y+h2.h){
    hurt(h2.dmg||2,P.face*-1);P.vy=-380;P.onG=false}});
   const hold={attack:0.3,cast:0.35,dash:0.24,hurt:0.4,land:0.15};
   if(!P.climb&&(!hold[P.st]||P.stT>hold[P.st])&&P.st!=='death'){
    if(!P.onG)setSt(P.vy<-40?'jump_rise':'jump_fall');
    else setSt(Math.abs(P.vx)>30?'run':'idle')}
   P.animT+=dt*(P.onG?(Math.abs(P.vx)>30?1.8:0.3):0.6);
  }
  KEYS.forEach(kd=>{if(kd.got)return;
   if(Math.abs(kd.x-P.x)<28&&Math.abs(kd.y-(P.y-16))<38){kd.got=true;INV[kd.key_id]=1;
    sfx('achievement');vib(40);burst(kd.x,kd.y,'#FFD34D',18,150);
    popup(kd.x,kd.y-30,'\uD83D\uDDDD '+(kd.label||kd.key_id),'#FFD34D');
    const lp=PORT.find(p=>p.required_key_id===kd.key_id);
    say('Got the '+(kd.label||kd.key_id)+(lp?' \u2014 it opens the '+(lp.label||'portal')+'!':'!'));
    try{parent.postMessage({type:'game_key',key_id:kd.key_id,stage:stageIdx+1,title:st.title||''},'*')}catch(e){}
    saveGame()}});
  CPS.forEach(cpd=>{if(!cpd.hit&&Math.abs(cpd.x-P.x)<44&&Math.abs(cpd.y-P.y)<80){cpd.hit=true;
   cp={x:cpd.x,y:cpd.y};pHp=Math.min(pMax,pHp+8);mana=mMax;
   say('\u2691 Checkpoint \u2014 progress & keys saved');sfx('checkpoint');
   burst(cpd.x,cpd.y-30,'#10E670',14,110)}});
  PICK.forEach(pk=>{if(pk.got)return;if(Math.abs(pk.x-P.x)<24&&Math.abs(pk.y-(P.y-14))<34){pk.got=true;sfx('collect');
   if(pk.kind==='potion'){pHp=Math.min(pMax,pHp+Math.ceil(pMax*0.5));popup(P.x,P.y-44,'+50% HP','#FF5A6E')}
   else if(pk.kind==='gem'){coins+=5;addScore(15);popup(P.x,P.y-44,'+GEM','#4de3ff')}
   else{coins++;addScore(5)}}});
  let enterP=null;
  PORT.forEach(p=>{const d=Math.hypot(p.x-P.x,(p.y-56)-(P.y-18));
   if(p.state==='locked'&&p.required_key_id&&INV[p.required_key_id]&&d<160){
    p.state='unlocking';p.t=0;sfx('checkpoint');
    say('The '+(p.label||'portal')+' recognises your key\u2026')}
   else if(p.state==='locked'&&d<80&&hintT<=0){hintT=4;sfx('wrong');
    const kd=KEYS.find(k2=>k2.key_id===p.required_key_id);
    say('\uD83D\uDD12 Sealed \u2014 requires the '+((kd&&kd.label)||p.required_key_id))}
   else if(p.state==='unlocking'){p.t+=dt;
    if(p.t>=1.5){p.state='active';sfx('portal');shakeT=0.3;
     burst(p.x,p.y-56,p.color||LG,26,180);
     say('The '+(p.label||'portal')+' is OPEN!')}}
   else if(p.state==='active'&&!busy&&Math.abs(p.x-P.x)<34&&Math.abs(p.y-P.y)<90)enterP=p});
  if(enterP){
   if(enterP.target==='end'||(st.ending&&stageIdx>=S.stages.length-1)){
    if(endT<=0){endT=3.2;busy=true;sfx('victory');saveGame()}}
   else{doneFlag=true;cancelAnimationFrame(raf);addScore(40);sfx('portal');saveGame();
    fb(true,(st.title||'Level')+' complete!'+unlockMsg(),next);return}}
  if(endT>0){endT-=dt;
   if(endT<=0){doneFlag=true;cancelAnimationFrame(raf);addScore(80);saveGame();
    fb(true,(st.ending_title||'PART 2')+' \u2014 '+(st.ending_subtitle||'COMING SOON'),next);return}}
  projs=projs.filter(p=>{p.x+=p.vx*dt;p.life-=dt;
   if(solidAt(p.x,p.y+18))return false;
   const f=foes.find(f2=>!f2.dead&&Math.abs(f2.x-p.x)<22&&Math.abs(f2.y-18-p.y)<34);
   if(f){hitFoe(f,Math.round(atkBase*0.85),Math.sign(p.vx),false);return false}
   return p.life>0});
  eprojs=eprojs.filter(p=>{p.x+=p.vx*dt;p.y+=(p.vy||0)*dt;p.life-=dt;
   if(solidAt(p.x,p.y+18))return false;
   if(!busy&&Math.abs(P.x-p.x)<16&&Math.abs(P.y-18-p.y)<26){hurt(3,Math.sign(p.vx));return false}
   return p.life>0});
  foes.forEach(f=>foeAI(f,dt,t));
  /* camera: smooth X+Y follow, deadzone + look-ahead, world-clamped */
  const tx=P.x-VW*(0.5-P.face*0.06)+P.vx*0.14;
  camX+=(Math.max(0,Math.min(Math.max(0,WW-VW),tx))-camX)*Math.min(1,dt*5);
  let ty=camY;const syp=P.y-camY;
  if(syp>VH*0.62)ty=P.y-VH*0.62;else if(syp<VH*0.35)ty=P.y-VH*0.35;
  ty=Math.max(0,Math.min(Math.max(0,WH2-VH),ty));
  camY+=(ty-camY)*Math.min(1,dt*(P.onG?7:3.6));
  if(shakeT>0){shakeT-=dt;camX+=Math.sin(t*70)*shakeT*10;camY+=Math.cos(t*63)*shakeT*6}
  window.__GB__={x:Math.round(P.x),y:Math.round(P.y),st:P.st,onG:P.onG,climb:P.climb,hp:pHp,lives:lives,busy:busy,
   keys:Object.keys(INV),portals:PORT.map(p=>({id:p.portal_id,state:p.state})),
   cam:[Math.round(camX),Math.round(camY)],stage:stageIdx,cp:CPS.filter(c2=>c2.hit).length,
   respawn:[cp.x,cp.y]};
  drawWorld(t,dt);drawHUD();
  if(endT>0){const ea=Math.min(1,(3.2-endT)*1.2);
   g.fillStyle='rgba(2,4,14,'+(ea*0.86).toFixed(2)+')';g.fillRect(0,0,W,H);
   g.save();g.textAlign='center';g.shadowColor='#B98BFF';g.shadowBlur=30;g.globalAlpha=ea;
   g.fillStyle='#EAF2FF';g.font='900 46px system-ui';
   g.fillText(st.ending_title||'PART 2',W/2,H/2-6);
   g.font='bold 17px system-ui';g.fillStyle=LG;
   g.fillText(st.ending_subtitle||'COMING SOON',W/2,H/2+28);g.restore()}}
 window.__GBGEO__={solids:SOL,one_way:OW,stairs:STR,ladders:LAD,hazards:HZD,
  keys:KEYS.map(k2=>({id:k2.key_id,x:k2.x,y:k2.y})),portals:PORT.map(p=>({id:p.portal_id,x:p.x,y:p.y})),
  checkpoints:CPS.map(c2=>({id:c2.id,x:c2.x,y:c2.y})),world:[WW,WH2]};
 ctrlGuide();raf=requestAnimationFrame(loop)}

/* ── Racing runtime (tpl_racing_v1) — laps/checkpoints/AI/drift/boost ── */
function rac(st){const c=mkCanvas(60),ctx=c.getContext('2d'),W=c.width,H=c.height;
 const LAPS=st.laps||3,NAI=Math.min(5,st.ai_racers!==undefined?st.ai_racers:3);
 const cx=W/2,cy=H/2,rx=W*0.38,ry=H*0.34,inner=0.55;
 function wp(t){return [cx+Math.cos(t)*rx,cy+Math.sin(t)*ry*( (st.track==='figure8')?Math.cos(t):1 )]}
 const CPS=[0,Math.PI/2,Math.PI,Math.PI*1.5];
 let a=0,speed=0,drift=false,boost=0,lap=1,cpIdx=1,doneFlag=false,steer=0;
 const MAXS=(st.car_speed||150)/60,AIS=(st.ai_speed||135)/60;
 const ais=[];for(let i=0;i<NAI;i++)ais.push({t:-0.15*(i+1),lap:1,col:['#FF5A8A','#FFD34D','#B14BF4','#2EE6FF','#10E670'][i%5],sp:AIS*(0.92+Math.random()*0.16)});
 const boosts=[];for(let i=0;i<(st.boosts||2);i++)boosts.push({t:Math.PI*0.4+i*Math.PI,taken:false});
 const hudR=el('div','');hudR.style.cssText='display:flex;justify-content:center;gap:14px;font-size:12px;padding:4px';
 root.insertBefore(hudR,root.lastChild);
 function pos(){let ahead=0;ais.forEach(o=>{if(o.lap>lap||(o.lap===lap&&norm(o.t)>norm(a)))ahead++});return ahead+1}
 function norm(t){let v=t%(Math.PI*2);if(v<0)v+=Math.PI*2;return v}
 function hudPaint(){hudR.innerHTML='<span data-testid="rac-lap" style="color:'+ACC+'">Lap '+Math.min(lap,LAPS)+'/'+LAPS+'</span><span data-testid="rac-pos" style="color:'+GLOW+'">Position '+pos()+'/'+(NAI+1)+'</span><span data-testid="rac-boost" style="color:#FFD34D">'+(boost>0?'\uD83D\uDE80 BOOST':'')+'</span>'}
 const keys={};
 document.addEventListener('keydown',e=>{keys[e.key]=1;if(e.key===' ')e.preventDefault()});
 document.addEventListener('keyup',e=>{keys[e.key]=0});
 if(MOB){const row=el('div','');row.style.cssText='display:flex;justify-content:center;gap:10px;padding:6px';
  [['\u2B05',()=>steer=-1,()=>steer=0],['DRIFT',()=>drift=true,()=>drift=false],['\u27A1',()=>steer=1,()=>steer=0]].forEach(([l,dn,up])=>{const b=el('button','',l);
   b.style.cssText='padding:14px 20px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'22;color:'+T.text+';font-weight:700';
   b.addEventListener('pointerdown',dn);b.addEventListener('pointerup',up);b.addEventListener('pointerleave',up);row.appendChild(b)});
  root.appendChild(row)}
 let raf=null,last=0;
 function loop(ts){if(doneFlag)return;raf=requestAnimationFrame(loop);const dt=Math.min(50,ts-(last||ts))/16.7;last=ts;
  if(PAUSED){draw();return}
  const sIn=(keys.ArrowLeft||keys.a?-1:0)+(keys.ArrowRight||keys.d?1:0)+steer;
  if(!MOB)drift=!!keys[' '];
  speed=Math.min(MAXS*(boost>0?1.5:1),speed+0.08*dt);
  if(drift)speed*=0.985;
  a+=(speed/ (rx))*dt*(1+(sIn*0.35)*(drift?1.6:1));
  boost=Math.max(0,boost-dt*16);
  boosts.forEach(b=>{if(!b.taken&&Math.abs(norm(a)-norm(b.t))<0.08){b.taken=true;boost=90;sfx('boost');addScore(5)}});
  const cpT=CPS[cpIdx%4];
  if(Math.abs(norm(a)-norm(cpT))<0.07){cpIdx++;sfx('collect');
   if(cpIdx%4===0){lap++;sfx('achievement');hudPaint();
    if(lap>LAPS){doneFlag=true;cancelAnimationFrame(raf);const p=pos();SAVE_X.best_position=Math.min(SAVE_X.best_position||9,p);addScore(Math.max(10,(NAI+2-p)*20));
     if(p<=3)fb(true,'Finished P'+p+'!',next);else{fb(false,'Finished P'+p+' \u2014 top 3 needed',()=>gameOver())}return}}
   hudPaint()}
  ais.forEach(o=>{o.t+=(o.sp/rx)*dt;if(norm(o.t)<0.05&&o._c!==lap){o._c=lap;o.lap++}});
  draw()}
 function draw(){ctx.fillStyle=PAL.bg||T.bg;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#ffffff18';ctx.lineWidth=Math.min(rx,ry)*(1-inner);ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,7);ctx.stroke();
  ctx.strokeStyle=ACC+'55';ctx.lineWidth=2;ctx.setLineDash([8,10]);ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,7);ctx.stroke();ctx.setLineDash([]);
  CPS.forEach((t,i)=>{const p=wp(t);ctx.fillStyle=(i===cpIdx%4)?GLOW:'#ffffff33';ctx.beginPath();ctx.arc(p[0],p[1],6,0,7);ctx.fill()});
  boosts.forEach(b=>{if(b.taken)return;const p=wp(b.t);ctx.fillStyle='#FFD34D';ctx.font='13px system-ui';ctx.fillText('\u26A1',p[0]-6,p[1]+5)});
  ais.forEach(o=>{const p=wp(o.t);ctx.fillStyle=o.col;ctx.beginPath();ctx.arc(p[0],p[1],8,0,7);ctx.fill()});
  const p=wp(a);ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(a+Math.PI/2);
  ctx.fillStyle=boost>0?'#FFD34D':GLOW;ctx.fillRect(-6,-10,12,20);ctx.fillStyle='#0b1220';ctx.fillRect(-4,-6,8,5);ctx.restore();
  if(drift){ctx.fillStyle='#ffffff44';ctx.beginPath();ctx.arc(p[0],p[1],12,0,7);ctx.fill()}}
 hudPaint();raf=requestAnimationFrame(loop)}

/* ── Farming runtime (tpl_farming_v1) — plant/water/harvest/craft/sell ── */
function frm(st){const NP=st.plots||8,DAYS=st.days||10,GOAL=st.coin_goal||120;
 const crops=st.crops||[{name:'Wheat',cost:4,grow_days:1,sell:9}];const recipes=st.recipes||[];
 let coins=12,day=1,pickPlot=null,invC={},doneFlag=false;
 const plots=[];for(let i=0;i<NP;i++)plots.push({state:'empty',crop:null,water:false,left:0});
 const top=el('div',''),grid=el('div',''),shop=el('div',''),picker=el('div',''),invR=el('div','');
 top.style.cssText='display:flex;justify-content:center;gap:12px;font-size:12px;padding:4px;flex-wrap:wrap';
 grid.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:380px;margin:6px auto';
 shop.style.cssText='display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px';
 picker.style.cssText='display:none;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px';
 invR.style.cssText='display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px;font-size:11px';
 root.appendChild(top);root.appendChild(shop);root.appendChild(picker);root.appendChild(grid);root.appendChild(invR);
 function paintTop(){top.innerHTML='<span data-testid="frm-coins" style="color:#FFD34D">\uD83D\uDCB0 '+coins+'/'+GOAL+'</span><span data-testid="frm-day" style="color:'+ACC+'">\uD83D\uDCC5 Day '+day+'/'+DAYS+'</span><span style="color:'+GLOW+'">Season progress '+Math.round(day/DAYS*100)+'%</span>'}
 function paintShop(){shop.innerHTML='';
  const nd=el('button','','END DAY \u2600');nd.setAttribute('data-testid','frm-end-day');
  nd.style.cssText='padding:6px 12px;border-radius:10px;border:1px solid '+ACC+'88;background:'+ACC+'22;color:'+T.text+';cursor:pointer;font-size:11px;font-weight:700';
  nd.onclick=endDay;shop.appendChild(nd)}
 function paintPicker(){picker.innerHTML='';if(pickPlot===null){picker.style.display='none';return}
  picker.style.display='flex';
  const lb=el('span','','\uD83C\uDF31 Plant:');lb.style.cssText='font-size:11px;color:'+ACC+';align-self:center';picker.appendChild(lb);
  crops.forEach(cr=>{const can=coins>=cr.cost;
   const b=el('button','',cr.name+' $'+cr.cost+' \u00b7 '+cr.grow_days+'d \u2192 $'+cr.sell);
   b.setAttribute('data-testid','frm-plant-'+cr.name);
   b.style.cssText='padding:6px 10px;border-radius:10px;border:1px solid '+(can?GLOW:'#444')+';background:'+(can?GLOW+'1a':'#ffffff05')+';color:'+T.text+';cursor:pointer;font-size:11px;opacity:'+(can?1:.5);
   b.onclick=()=>{if(coins<cr.cost){sfx('wrong');return}const p=pickPlot;coins-=cr.cost;
    p.state='planted';p.crop=cr;p.water=false;p.left=cr.grow_days;pickPlot=null;sfx('click');paintAll()};
   picker.appendChild(b)});
  const cx=el('button','','\u2715');cx.setAttribute('data-testid','frm-plant-cancel');
  cx.style.cssText='padding:6px 9px;border-radius:10px;border:1px solid #556;background:#ffffff0a;color:'+T.text+';cursor:pointer;font-size:11px';
  cx.onclick=()=>{pickPlot=null;sfx('click');paintAll()};picker.appendChild(cx)}
 function paintInv(){invR.innerHTML='';Object.keys(invC).forEach(k=>{if(!invC[k])return;const b=el('button','',k+' \u00d7'+invC[k]+' \u2192 sell');b.setAttribute('data-testid','frm-sell-'+k);
   b.style.cssText='padding:5px 8px;border-radius:8px;border:1px solid #FFD34D66;background:#FFD34D1a;color:'+T.text+';cursor:pointer;font-size:10px';
   const cr=crops.find(c=>c.name===k);b.onclick=()=>{coins+=cr?cr.sell:5;invC[k]--;addScore(cr?cr.sell:5);sfx('collect');paintAll();checkWin()};invR.appendChild(b)});
  recipes.forEach((r,i)=>{const can=Object.keys(r.needs||{}).every(k=>(invC[k]||0)>=r.needs[k]);
   const b=el('button','','\uD83C\uDF5E Craft '+r.name+' ($'+r.sell+')');b.setAttribute('data-testid','frm-craft-'+i);
   b.style.cssText='padding:5px 8px;border-radius:8px;border:1px solid '+(can?GLOW:'#444')+';background:'+(can?GLOW+'1a':'#ffffff05')+';color:'+T.text+';cursor:pointer;font-size:10px;opacity:'+(can?1:.5);
   b.onclick=()=>{if(!can){sfx('wrong');return}Object.keys(r.needs).forEach(k=>invC[k]-=r.needs[k]);coins+=r.sell;addScore(r.sell);sfx('combo');paintAll();checkWin()};invR.appendChild(b)})}
 function paintGrid(){grid.innerHTML='';plots.forEach((p,i)=>{let ico='\uD83D\uDFEB',lbl='plant';
   if(p.state==='planted'){ico='\uD83C\uDF31';lbl=p.water?'growing':'water me'}
   if(p.state==='ready'){ico='\uD83C\uDF3E';lbl='harvest!'}
   const d=el('div','','<div style="font-size:22px">'+ico+'</div><div style="font-size:8.5px;opacity:.7">'+lbl+'</div>');
   d.setAttribute('data-testid','frm-plot-'+i);
   d.style.cssText='aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;background:'+(p.state==='ready'?'#10E67015':'#ffffff06')+';border:1px solid '+(p===pickPlot?GLOW:p.water&&p.state==='planted'?'#2EE6FF66':'#ffffff12');
   d.onpointerdown=()=>tapPlot(p);grid.appendChild(d)})}
 function tapPlot(p){if(doneFlag)return;
  if(p.state==='empty'){pickPlot=(pickPlot===p?null:p);sfx('click')}
  else if(p.state==='planted'&&!p.water){p.water=true;sfx('collect')}
  else if(p.state==='ready'){invC[p.crop.name]=(invC[p.crop.name]||0)+1;p.state='empty';p.crop=null;addScore(4);sfx('achievement')}
  paintAll()}
 function endDay(){if(doneFlag)return;plots.forEach(p=>{if(p.state==='planted'&&p.water){p.left--;p.water=false;if(p.left<=0)p.state='ready'}});
  day++;pickPlot=null;sfx('click');SAVE_X.coins=coins;
  if(day>DAYS){doneFlag=true;if(coins>=GOAL)fb(true,'Season goal reached!',next);else gameOver();return}
  paintAll()}
 function checkWin(){if(!doneFlag&&coins>=GOAL){doneFlag=true;SAVE_X.coins=coins;fb(true,'Coin goal reached!',next)}}
 function paintAll(){paintTop();paintShop();paintPicker();paintGrid();paintInv()}
 paintAll()}

/* ── City Builder runtime (tpl_city_builder_v1) — economy/production ─── */
function cbl(st){const GW=st.grid_w||6,GH=st.grid_h||5,TARGET=st.pop_target||24;
 const defs=st.buildings||[{name:'House',cost:18,pop:4,food_upkeep:2},{name:'Farm',cost:14,food:5}];
 const ICO={House:'\uD83C\uDFE0',Farm:'\uD83C\uDF3E',Mine:'\u26CF\uFE0F',Market:'\uD83C\uDFEA'};
 let gold=st.start_gold!==undefined?st.start_gold:60,food=6,pop=0,sel=0,tick=0,doneFlag=false;
 const grid=[];for(let i=0;i<GW*GH;i++)grid.push(null);
 const top=el('div',''),bar=el('div',''),board=el('div',''),note=el('div','');
 top.style.cssText='display:flex;justify-content:center;gap:12px;font-size:12px;padding:4px;flex-wrap:wrap';
 bar.style.cssText='display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px';
 board.style.cssText='display:grid;grid-template-columns:repeat('+GW+',1fr);gap:5px;max-width:'+Math.min(430,GW*62)+'px;margin:6px auto';
 note.style.cssText='text-align:center;font-size:10.5px;opacity:.75;min-height:14px';
 root.appendChild(top);root.appendChild(bar);root.appendChild(board);root.appendChild(note);
 function paintTop(){top.innerHTML='<span data-testid="cbl-gold" style="color:#FFD34D">\uD83D\uDCB0 '+gold+'</span><span data-testid="cbl-food" style="color:#10E670">\uD83C\uDF3E '+food+'</span><span data-testid="cbl-pop" style="color:'+GLOW+'">\uD83D\uDC65 '+pop+'/'+TARGET+'</span>'}
 function paintBar(){bar.innerHTML='';defs.forEach((d,i)=>{const b=el('button','',(ICO[d.name]||'\uD83C\uDFD7')+' '+d.name+' $'+d.cost);b.setAttribute('data-testid','cbl-building-'+i);
   b.style.cssText='padding:6px 10px;border-radius:10px;border:1px solid '+(i===sel?GLOW:'#556')+';background:'+(i===sel?GLOW+'33':'#ffffff0a')+';color:'+T.text+';cursor:pointer;font-size:11px';
   b.onclick=()=>{sel=i;paintBar()};bar.appendChild(b)})}
 function paintBoard(){board.innerHTML='';grid.forEach((g,i)=>{const d=el('div','',g?(ICO[g.name]||'\uD83C\uDFD7'):'');
   d.setAttribute('data-testid','cbl-tile-'+i);
   d.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:20px;border-radius:10px;cursor:pointer;background:'+(g?GLOW+'12':'#ffffff05')+';border:1px solid '+(g?GLOW+'44':'#ffffff10');
   d.onpointerdown=()=>{if(doneFlag||grid[i])return;const def=defs[sel];
    if(gold<def.cost){sfx('wrong');note.textContent='Not enough gold.';return}
    if(def.pop_req&&pop<def.pop_req){sfx('wrong');note.textContent=def.name+' needs '+def.pop_req+' population.';return}
    gold-=def.cost;grid[i]={...def};sfx('collect');addScore(6);paintAll()};
   board.appendChild(d)})}
 function economy(){let f=0,g=0,mult=1,housePop=0;
  grid.forEach(b=>{if(!b)return;if(b.food)f+=b.food;if(b.gold)g+=b.gold;if(b.gold_mult)mult=Math.max(mult,b.gold_mult);if(b.pop)housePop+=b.pop});
  food+=f;const upkeep=grid.filter(b=>b&&b.pop).reduce((s,b)=>s+(b.food_upkeep||0),0);
  if(food>=upkeep){food-=upkeep;pop=Math.min(housePop,pop+2);if(pop>0)addScore(2)}else{pop=Math.max(0,pop-1);note.textContent='\u26A0 Food shortage \u2014 population shrinking!'}
  g=Math.round(g*mult);const canMine=grid.filter(b=>b&&b.gold).length===0||pop>0;if(canMine)gold+=g;
  paintTop();
  if(pop>=TARGET&&!doneFlag){doneFlag=true;SAVE_X.population=pop;fb(true,'The city thrives \u2014 '+pop+' citizens!',next);return}
  if(!doneFlag&&gold<Math.min(...defs.map(d=>d.cost))&&food<=0&&pop<=0&&grid.some(b=>b)){doneFlag=true;gameOver()}}
 function paintAll(){paintTop();paintBar();paintBoard()}
 const iv=setInterval(()=>{if(doneFlag){clearInterval(iv);return}if(!PAUSED)economy()},2200);
 paintAll();note.textContent='Build farms to feed houses; mines need citizens.'}

/* ── Roguelike runtime (tpl_roguelike_v1) — procedural floors, permadeath ─ */
function rgl(st){const GW=st.grid_w||9,GH=st.grid_h||7;
 if(stageIdx===0||!window.__RGL__)window.__RGL__={hp:st.player_hp||20,mx:st.player_hp||20,atk:4,pot:1};
 const R=window.__RGL__;let busy=false;
 const key=(x,y)=>x+','+y;const walls=new Set();
 const NW=st.walls!==undefined?st.walls:10;let guard=0;
 while(walls.size<NW&&guard++<200){const x=Math.floor(Math.random()*GW),y=Math.floor(Math.random()*GH);
  if((x<2&&y<2)||(x>GW-3&&y>GH-3))continue;walls.add(key(x,y))}
 function freeSpot(){let x,y,g2=0;do{x=Math.floor(Math.random()*GW);y=Math.floor(Math.random()*GH);g2++}
  while(g2<120&&(walls.has(key(x,y))||(x<2&&y<2)||(x===GW-1&&y===GH-1)));return{x:x,y:y}}
 const mons=[];for(let i=0;i<(st.monsters||3);i++){const p=freeSpot();
  mons.push({x:p.x,y:p.y,name:['Ghoul','Cave Bat','Skeleton','Wraith'][i%4],hp:(st.monster_hp||8)+stageIdx*2,mx:(st.monster_hp||8)+stageIdx*2,attack:(st.monster_attack||3)+Math.floor(stageIdx/2)})}
 const loots=[];for(let i=0;i<(st.loot!==undefined?st.loot:2);i++){const p=freeSpot();loots.push({x:p.x,y:p.y,kind:Math.random()<0.5?'potion':'gem',got:false})}
 let px=0,py=0;const ex={x:GW-1,y:GH-1};
 const top=el('div',''),board=el('div',''),log=el('div','');
 top.style.cssText='display:flex;justify-content:center;gap:12px;font-size:12px;padding:4px;flex-wrap:wrap';
 board.style.cssText='display:grid;grid-template-columns:repeat('+GW+',1fr);gap:3px;max-width:'+Math.min(480,GW*50)+'px;margin:4px auto;padding:8px;border:1px solid '+GLOW+'33;border-radius:14px;background:#00000045';
 log.style.cssText='text-align:center;font-size:11px;min-height:16px;color:'+ACC;
 root.appendChild(top);root.appendChild(board);root.appendChild(log);
 function say(m){log.textContent=m}
 function paintTop(){top.innerHTML='<span data-testid="rgl-hp" style="color:#10E670">\u2764 '+R.hp+'/'+R.mx+'</span><span data-testid="rgl-atk" style="color:'+HAZC+'">\u2694 '+R.atk+'</span><span data-testid="rgl-floor" style="color:'+ACC+'">Floor '+(stageIdx+1)+'/'+S.stages.length+'</span>';
  const pb=el('button','','\uD83E\uDDEA \u00d7'+R.pot);pb.setAttribute('data-testid','rgl-potion');
  pb.style.cssText='padding:2px 8px;border-radius:8px;border:1px solid #10E67066;background:#10E6701a;color:'+T.text+';cursor:pointer;font-size:11px';
  pb.onclick=()=>{if(R.pot>0&&R.hp<R.mx){R.pot--;R.hp=Math.min(R.mx,R.hp+8);sfx('collect');paintTop()}else sfx('wrong')};top.appendChild(pb)}
 function tileAt(x,y){if(px===x&&py===y)return sprHtml('player_sprite',26,'\uD83E\uDDDD');if(walls.has(key(x,y)))return '\uD83E\uDEA8';
  const m=mons.find(m=>m.hp>0&&m.x===x&&m.y===y);if(m)return sprHtml('enemy_sprite',26,'\uD83D\uDC7B');
  const l=loots.find(l=>!l.got&&l.x===x&&l.y===y);if(l)return l.kind==='potion'?'\uD83E\uDDEA':'\uD83D\uDC8E';
  if(ex.x===x&&ex.y===y)return '\uD83E\uDE9C';return ''}
 function paint(){board.innerHTML='';for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const d=el('div','',tileAt(x,y));
  d.setAttribute('data-testid','rgl-tile-'+x+'-'+y);
  d.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:7px;cursor:pointer;background:'+(walls.has(key(x,y))?'#ffffff14':(x+y)%2?'#ffffff07':'#ffffff03')+';border:1px solid #ffffff0a';
  d.onpointerdown=()=>step(x,y);board.appendChild(d)}paintTop()}
 function monsTurn(){mons.forEach(m=>{if(m.hp<=0)return;const dist=Math.abs(m.x-px)+Math.abs(m.y-py);
  if(dist===1){R.hp-=m.attack;vib(50);sfx('hit');say(m.name+' hits you for '+m.attack+'!');
   if(R.hp<=0){window.__RGL__=null;busy=true;say('You died\u2026 the run is over.');setTimeout(gameOver,450)}return}
  if(dist<=5){const dx=Math.sign(px-m.x),dy=Math.sign(py-m.y);
   const tries=Math.abs(px-m.x)>=Math.abs(py-m.y)?[[dx,0],[0,dy]]:[[0,dy],[dx,0]];
   for(let i=0;i<tries.length;i++){const ax=tries[i][0],ay=tries[i][1];if(!ax&&!ay)continue;
    const nx=m.x+ax,ny=m.y+ay;
    if(nx>=0&&ny>=0&&nx<GW&&ny<GH&&!walls.has(key(nx,ny))&&!(nx===px&&ny===py)&&!mons.find(o=>o!==m&&o.hp>0&&o.x===nx&&o.y===ny)){m.x=nx;m.y=ny;break}}}})}
 function boonPick(){sfx('stage');const ov=el('div','');ov.style.cssText='position:fixed;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;z-index:50';
  const box=el('div','','<b style="color:'+GLOW+';letter-spacing:2px">FLOOR CLEARED \u2014 PICK A BOON</b>');
  box.style.cssText='background:'+T.bg+';border:1px solid '+GLOW+'66;border-radius:16px;padding:18px;text-align:center;display:flex;flex-direction:column;gap:8px;max-width:300px';
  [['\u2694 +2 Attack',()=>R.atk+=2],['\u2764 +6 Max HP',()=>{R.mx+=6;R.hp+=6}],['\u2728 Full heal +1 potion',()=>{R.hp=R.mx;R.pot++}]].forEach((o,i)=>{
   const b=el('button','',o[0]);b.setAttribute('data-testid','rgl-upgrade-'+i);
   b.style.cssText='padding:11px 16px;border-radius:12px;border:1px solid '+GLOW+'66;background:'+GLOW+'1a;color:'+T.text+';cursor:pointer;font-weight:700';
   b.onclick=()=>{o[1]();sfx('achievement');ov.remove();fb(true,'Floor '+(stageIdx+1)+' cleared!'+unlockMsg(),next)};box.appendChild(b)});
  ov.appendChild(box);root.appendChild(ov)}
 function step(tx,ty){if(busy||R.hp<=0)return;const dx=Math.sign(tx-px),dy=Math.sign(ty-py);
  const nx=px+(Math.abs(tx-px)>=Math.abs(ty-py)?dx:0),ny=py+(Math.abs(ty-py)>Math.abs(tx-px)?dy:0);
  if(nx===px&&ny===py)return;
  if(nx<0||ny<0||nx>=GW||ny>=GH||walls.has(key(nx,ny))){sfx('wrong');return}
  const m=mons.find(m=>m.hp>0&&m.x===nx&&m.y===ny);
  if(m){m.hp-=R.atk;sfx('hit');
   if(m.hp<=0){const p=addScore(12);say(m.name+' slain! +'+p);sfx('achievement')}else say(m.name+': '+m.hp+'/'+m.mx+' HP')}
  else{px=nx;py=ny;sfx('click');
   const l=loots.find(l=>!l.got&&l.x===px&&l.y===py);
   if(l){l.got=true;if(l.kind==='potion'){R.pot++;say('Found a potion!')}else{addScore(8);say('Found a gem! +8')}sfx('collect')}}
  monsTurn();
  if(!busy&&R.hp>0&&px===ex.x&&py===ex.y){busy=true;addScore(20);boonPick();return}
  paint()}
 paint();say('Reach the stairs \uD83E\uDE9C \u2014 permadeath is real.')}

/* ── Tactics runtime (tpl_tactics_v1) — turn-based grid squad combat ──── */
function tac(st){const GW=st.grid_w||8,GH=st.grid_h||6;let turn=1,sel=null,doneFlag=false;
 const key=(x,y)=>x+','+y;const walls=new Set();
 (st.walls||[]).forEach(w=>walls.add(key(w.x,w.y)));
 if(!walls.size)for(let i=0;i<5;i++){const x=2+Math.floor(Math.random()*(GW-4)),y=Math.floor(Math.random()*GH);walls.add(key(x,y))}
 const units=(st.units||[{name:'Knight',hp:14,attack:5,range:1,move:3},{name:'Archer',hp:9,attack:4,range:3,move:2}]).map((u,i)=>({...u,mx:u.hp,x:0,y:Math.min(GH-1,i+1),moved:false,acted:false}));
 const foes=(st.enemies||[{name:'Raider',x:GW-1,y:1,hp:10,attack:4,move:2},{name:'Brute',x:GW-1,y:GH-2,hp:16,attack:6,move:1}]).map(f=>({...f,mx:f.hp,range:f.range||1,x:Math.min(GW-1,f.x!==undefined?f.x:GW-1),y:Math.min(GH-1,f.y!==undefined?f.y:0)}));
 units.concat(foes).forEach(u=>walls.delete(key(u.x,u.y)));
 const top=el('div',''),board=el('div',''),log=el('div',''),ctl=el('div','');
 top.style.cssText='display:flex;justify-content:center;gap:8px;font-size:11px;padding:4px;flex-wrap:wrap';
 board.style.cssText='display:grid;grid-template-columns:repeat('+GW+',1fr);gap:3px;max-width:'+Math.min(480,GW*54)+'px;margin:4px auto;padding:8px;border:1px solid '+GLOW+'33;border-radius:14px;background:#ffffff05';
 log.style.cssText='text-align:center;font-size:11px;min-height:16px;color:'+ACC;
 ctl.style.cssText='text-align:center;padding:4px';
 root.appendChild(top);root.appendChild(board);root.appendChild(log);root.appendChild(ctl);
 function say(m){log.textContent=m}
 function occ(x,y){return units.find(u=>u.hp>0&&u.x===x&&u.y===y)||foes.find(f=>f.hp>0&&f.x===x&&f.y===y)}
 function dist(a,b,x,y){return Math.abs(a-x)+Math.abs(b-y)}
 function cover(x,y){return [[1,0],[-1,0],[0,1],[0,-1]].some(d=>walls.has(key(x+d[0],y+d[1])))}
 function inMove(u,x,y){return !u.moved&&dist(u.x,u.y,x,y)>0&&dist(u.x,u.y,x,y)<=u.move&&!walls.has(key(x,y))&&!occ(x,y)}
 function paintTop(){top.innerHTML='<span data-testid="tac-turn" style="color:'+ACC+'">Turn '+turn+'</span>';
  units.forEach((u,i)=>{const s=el('span','','\uD83D\uDEE1 '+u.name+' '+Math.max(0,u.hp)+'/'+u.mx+(u.acted?' \u2713':''));
   s.setAttribute('data-testid','tac-unit-'+i);
   s.style.cssText='padding:3px 8px;border-radius:8px;border:1px solid '+(sel===u?GLOW:'#556')+';background:'+(sel===u?GLOW+'22':'#ffffff06')+';opacity:'+(u.hp<=0?.35:1);
   top.appendChild(s)});
  const es=el('span','','\uD83D\uDC79 \u00d7'+foes.filter(f=>f.hp>0).length);es.setAttribute('data-testid','tac-enemies');es.style.cssText='color:'+HAZC;top.appendChild(es)}
 function paint(){board.innerHTML='';for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
  const u=units.find(u=>u.hp>0&&u.x===x&&u.y===y),f=foes.find(f=>f.hp>0&&f.x===x&&f.y===y);
  const mv=sel&&!sel.acted&&inMove(sel,x,y),atk2=sel&&!sel.acted&&f&&dist(sel.x,sel.y,f.x,f.y)<=(sel.range||1);
  const d=el('div','',u?sprHtml('player_sprite',26,'\uD83E\uDD3A'):f?sprHtml('enemy_sprite',26,'\uD83D\uDC79'):walls.has(key(x,y))?'\uD83E\uDEA8':'');
  d.setAttribute('data-testid','tac-tile-'+x+'-'+y);
  d.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:7px;cursor:pointer;background:'+(atk2?HAZC+'33':mv?GLOW+'1e':walls.has(key(x,y))?'#ffffff12':(x+y)%2?'#ffffff07':'#ffffff03')+';border:1px solid '+(sel&&sel.x===x&&sel.y===y?GLOW:'#ffffff0a');
  d.onpointerdown=()=>tap(x,y);board.appendChild(d)}
  paintTop();
  ctl.innerHTML='';const e2=el('button','','END TURN \u23F5');e2.setAttribute('data-testid','tac-end-turn');
  e2.style.cssText='padding:10px 22px;border-radius:12px;border:1px solid '+ACC+'88;background:'+ACC+'22;color:'+T.text+';font-weight:700;cursor:pointer';
  e2.onclick=endTurn;ctl.appendChild(e2)}
 function winCheck(){if(!doneFlag&&!foes.some(f=>f.hp>0)){doneFlag=true;addScore(30);fb(true,'Enemy squad defeated!'+unlockMsg(),next);return true}return false}
 function tap(x,y){if(doneFlag)return;
  const u=units.find(u=>u.hp>0&&u.x===x&&u.y===y);
  if(u){sel=(u.acted?sel:u);sfx('click');paint();return}
  if(!sel||sel.acted)return;
  const f=foes.find(f=>f.hp>0&&f.x===x&&f.y===y);
  if(f&&dist(sel.x,sel.y,f.x,f.y)<=(sel.range||1)){const dmg=Math.max(1,sel.attack-(cover(f.x,f.y)?1:0));
   f.hp-=dmg;addScore(dmg);sfx('hit');say(sel.name+' hits '+f.name+' for '+dmg+(cover(f.x,f.y)?' (cover)':''));
   sel.acted=true;sel.moved=true;sel=null;if(winCheck())return;paint();return}
  if(inMove(sel,x,y)){sel.x=x;sel.y=y;sel.moved=true;sfx('click');paint()}}
 function endTurn(){if(doneFlag)return;sel=null;
  foes.forEach(f=>{if(f.hp<=0)return;
   let tg=null,bd=1e9;units.forEach(u=>{if(u.hp>0){const d2=dist(f.x,f.y,u.x,u.y);if(d2<bd){bd=d2;tg=u}}});
   if(!tg)return;
   for(let s2=0;s2<(f.move||2);s2++){if(dist(f.x,f.y,tg.x,tg.y)<=f.range)break;
    const dx=Math.sign(tg.x-f.x),dy=Math.sign(tg.y-f.y);
    const tries=Math.abs(tg.x-f.x)>=Math.abs(tg.y-f.y)?[[dx,0],[0,dy]]:[[0,dy],[dx,0]];
    let mv=false;for(let i=0;i<tries.length;i++){const ax=tries[i][0],ay=tries[i][1];if(!ax&&!ay)continue;
     const nx=f.x+ax,ny=f.y+ay;
     if(nx>=0&&ny>=0&&nx<GW&&ny<GH&&!walls.has(key(nx,ny))&&!occ(nx,ny)){f.x=nx;f.y=ny;mv=true;break}}
    if(!mv)break}
   if(dist(f.x,f.y,tg.x,tg.y)<=f.range){const dmg=Math.max(1,f.attack-(cover(tg.x,tg.y)?1:0));
    tg.hp-=dmg;sfx('hit');say(f.name+' hits '+tg.name+' for '+dmg+(cover(tg.x,tg.y)?' (cover)':''));
    if(tg.hp<=0)say(tg.name+' has fallen!')}});
  if(!units.some(u=>u.hp>0)){doneFlag=true;paint();gameOver();return}
  units.forEach(u=>{u.moved=false;u.acted=false});turn++;comboBreak();paint()}
 paint();say('Select a unit, move to a glowing tile, strike enemies in range.')}

/* ── Idle runtime (tpl_idle_v1) — tap/generators/upgrades/prestige ────── */
function idl(st){const GOAL=st.goal||1000;
 let n=0,rate=0,clickP=st.click_power||1,doneFlag=false;
 let prest=SAVE_X.prestige||0,mult=1+prest*0.5;
 const gens=(st.generators||[{name:'Miner',cost:15,rate:1},{name:'Drill',cost:80,rate:6}]).map(g=>({...g,owned:0,c:g.cost}));
 const ups=(st.upgrades||[{name:'Sharper Pick',cost:60,mult:2}]).map(u=>({...u,bought:false}));
 const top=el('div',''),tapB=el('button',''),rows=el('div',''),note=el('div','');
 top.style.cssText='text-align:center;padding:6px';
 tapB.setAttribute('data-testid','idl-tap');
 tapB.style.cssText='display:block;margin:8px auto;width:150px;height:150px;border-radius:50%;border:2px solid '+GLOW+'88;background:radial-gradient(circle at 35% 30%,'+GLOW+'44,'+GLOW+'11);color:'+T.text+';font-size:38px;cursor:pointer;box-shadow:0 0 34px '+GLOW+'33;transition:transform .08s';
 tapB.innerHTML='\u26CF';
 rows.style.cssText='display:flex;flex-direction:column;gap:6px;max-width:420px;margin:0 auto;padding:0 12px';
 note.style.cssText='text-align:center;font-size:10.5px;opacity:.75;min-height:14px;padding:4px';
 root.appendChild(top);root.appendChild(tapB);root.appendChild(rows);root.appendChild(note);
 function fmt(v){return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':Math.floor(v)}
 function paintTop(){const pct=Math.min(100,Math.round(n/GOAL*100));
  top.innerHTML='<div data-testid="idl-count" style="font-size:30px;font-weight:800;color:'+GLOW+'">\u2699 '+fmt(n)+'</div>'+
  '<div style="font-size:11px;opacity:.85"><span data-testid="idl-rate" style="color:'+ACC+'">+'+fmt(rate*mult)+'/s</span> \u00b7 click +'+fmt(clickP*mult)+(prest?' \u00b7 \u2b50 prestige \u00d7'+mult.toFixed(1):'')+'</div>'+
  '<div style="max-width:300px;margin:6px auto;height:8px;border-radius:5px;background:#ffffff12;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+GLOW+';transition:width .4s"></div></div>'+
  '<div style="font-size:10px;opacity:.7">Goal: '+fmt(GOAL)+' ('+pct+'%)</div>'}
 function paintRows(){rows.innerHTML='';
  gens.forEach((g,i)=>{const can=n>=g.c;
   const b=el('button','','<span>\uD83C\uDFED '+g.name+' \u00d7'+g.owned+' <small style="opacity:.7">+'+g.rate+'/s</small></span><b>'+fmt(g.c)+'</b>');
   b.setAttribute('data-testid','idl-gen-'+i);
   b.style.cssText='display:flex;justify-content:space-between;padding:10px 14px;border-radius:12px;border:1px solid '+(can?GLOW:'#444')+'66;background:'+(can?GLOW+'12':'#ffffff05')+';color:'+T.text+';cursor:pointer;font-size:12px;opacity:'+(can?1:.55);
   b.onclick=()=>{if(n<g.c){sfx('wrong');return}n-=g.c;g.owned++;rate+=g.rate;g.c=Math.ceil(g.c*1.6);addScore(3);sfx('collect');paintAll()};
   rows.appendChild(b)});
  ups.forEach((u,i)=>{if(u.bought)return;const can=n>=u.cost;
   const b=el('button','','<span>\u2B06 '+u.name+' <small style="opacity:.7">click \u00d7'+u.mult+'</small></span><b>'+fmt(u.cost)+'</b>');
   b.setAttribute('data-testid','idl-up-'+i);
   b.style.cssText='display:flex;justify-content:space-between;padding:10px 14px;border-radius:12px;border:1px solid '+(can?ACC:'#444')+'66;background:'+(can?ACC+'12':'#ffffff05')+';color:'+T.text+';cursor:pointer;font-size:12px;opacity:'+(can?1:.55);
   b.onclick=()=>{if(n<u.cost){sfx('wrong');return}n-=u.cost;u.bought=true;clickP*=u.mult;addScore(5);sfx('combo');paintAll()};
   rows.appendChild(b)});
  const canP=n>=GOAL*0.5;
  const pB=el('button','','\u2B50 PRESTIGE \u2014 reset for \u00d7'+(1+(prest+1)*0.5).toFixed(1)+' production'+(canP?'':' (needs '+fmt(GOAL*0.5)+')'));
  pB.setAttribute('data-testid','idl-prestige');
  pB.style.cssText='padding:10px 14px;border-radius:12px;border:1px solid '+(canP?'#FFD34D':'#444')+'88;background:'+(canP?'#FFD34D1a':'#ffffff05')+';color:'+T.text+';cursor:pointer;font-size:11px;font-weight:700;opacity:'+(canP?1:.55);
  pB.onclick=()=>{if(!canP){sfx('wrong');return}prest++;SAVE_X.prestige=prest;mult=1+prest*0.5;
   n=0;rate=0;gens.forEach(g=>{g.owned=0;g.c=g.cost});addScore(15);sfx('victory');note.textContent='Prestige! Production \u00d7'+mult.toFixed(1);paintAll()};
  rows.appendChild(pB)}
 function check(){if(!doneFlag&&n>=GOAL){doneFlag=true;clearInterval(iv);addScore(40);fb(true,'Production goal reached!'+unlockMsg(),next)}}
 function paintAll(){paintTop();paintRows();check()}
 tapB.onpointerdown=()=>{if(doneFlag)return;tapB.style.transform='scale(0.93)';n+=clickP*mult;sfx('click');paintTop();check()};
 tapB.onpointerup=()=>tapB.style.transform='';
 const iv=setInterval(()=>{if(doneFlag){clearInterval(iv);return}if(!PAUSED){n+=rate*mult;paintTop();check();paintRows()}},1000);
 paintAll();note.textContent='Tap the core, then automate with generators.'}

/* ── Visual Novel runtime (tpl_visual_novel_v1) — branching story ─────── */
function vn(st){const scenes=st.scenes||[];let cur=(scenes[0]||{}).id,tw=null;
 const wrap=el('div','');wrap.style.cssText='max-width:560px;margin:0 auto;padding:0 12px';
 root.appendChild(wrap);
 function show(){if(tw){clearInterval(tw);tw=null}
  const s=scenes.find(x=>x.id===cur);
  if(!s){fb(true,'Chapter complete!',next);return}
  wrap.innerHTML='';let shown=false;
  const port=el('div','',aurl('character_portrait')?'<img src="'+aurl('character_portrait')+'" style="width:96px;height:96px;object-fit:cover;border-radius:16px;border:1px solid '+GLOW+'55" alt=""/>':(s.portrait||'\uD83D\uDE4B'));port.style.cssText='font-size:52px;text-align:center;padding:6px;animation:orpop .5s';
  const nm=el('div','',s.speaker||'');nm.setAttribute('data-testid','vn-speaker');
  nm.style.cssText='text-align:center;font-size:12px;letter-spacing:2px;color:'+ACC+';font-weight:700;text-transform:uppercase';
  const tx=el('div','');tx.setAttribute('data-testid','vn-text');
  tx.style.cssText='min-height:64px;padding:12px 14px;margin:8px 0;border:1px solid '+GLOW+'33;border-radius:14px;background:#ffffff06;font-size:14px;line-height:1.55;cursor:pointer';
  wrap.appendChild(port);wrap.appendChild(nm);wrap.appendChild(tx);
  function choices(){if(shown)return;shown=true;
   if(s.ending){const good=s.good!==false;
    const ban=el('div','',(good?'\u2728 GOOD ENDING':'\uD83C\uDF19 ENDING')+(s.ending_label?' \u2014 '+s.ending_label:''));
    ban.setAttribute('data-testid','vn-ending');
    ban.style.cssText='text-align:center;color:'+(good?'#10E670':ACC)+';font-weight:800;letter-spacing:2px;padding:8px;animation:orpop .5s';
    wrap.appendChild(ban);addScore(good?30:10);sfx(good?'victory':'stage');
    const b=el('button','','Continue \u25B6');b.setAttribute('data-testid','vn-continue');
    b.style.cssText='display:block;margin:8px auto;padding:12px 24px;border-radius:12px;border:1px solid '+GLOW+'66;background:'+GLOW+'1c;color:'+T.text+';cursor:pointer;font-weight:700';
    b.onclick=()=>next();wrap.appendChild(b);return}
   const cs=s.choices||[];
   cs.forEach((ch,i)=>{const b=el('button','',ch.label);b.setAttribute('data-testid','vn-choice-'+i);
    b.style.cssText='display:block;width:100%;margin:6px 0;padding:12px 14px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'10;color:'+T.text+';cursor:pointer;font-size:13px;text-align:left;animation:orfade .4s '+(i*0.12)+'s backwards';
    b.onclick=()=>{addScore(ch.points!==undefined?ch.points:5);sfx('click');cur=ch.next;show()};wrap.appendChild(b)});
   if(!cs.length){const b=el('button','','\u25B6');b.style.cssText='display:block;margin:8px auto;padding:10px 22px;border-radius:12px;border:1px solid '+GLOW+'55;background:'+GLOW+'15;color:'+T.text+';cursor:pointer';
    b.onclick=()=>{cur=s.next;show()};wrap.appendChild(b)}}
  const full=s.text||'';let i2=0;
  tw=setInterval(()=>{i2+=2;tx.textContent=full.slice(0,i2);if(i2>=full.length){clearInterval(tw);tw=null;choices()}},22);
  tx.onclick=()=>{if(tw){clearInterval(tw);tw=null}tx.textContent=full;choices()}}
 show()}

/* ── Fishing runtime (tpl_fishing_v1) — cast/timing hook/rarity/collection */
function fsh(st){let casts=st.casts||8,caught=0,selBait=0,doneFlag=false,phase='idle',pos=0.5,raf=null,biteT=null;
 const NEED=st.goal_fish||5;
 const fish=st.fish||[{name:'Minnow',rarity:'common',points:5},{name:'Bass',rarity:'uncommon',points:12},{name:'Golden Koi',rarity:'rare',points:30}];
 const baits=st.baits||[{name:'Worm',cost:0,rare_bonus:0},{name:'Glow Shrimp',cost:15,rare_bonus:0.2}];
 const logC={};
 const top=el('div',''),baitR=el('div',''),water=el('div',''),barW=el('div',''),ctl=el('div',''),coll=el('div','');
 top.style.cssText='display:flex;justify-content:center;gap:14px;font-size:12px;padding:4px;flex-wrap:wrap';
 baitR.style.cssText='display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px';
 water.style.cssText='max-width:420px;margin:6px auto;padding:22px 14px;border-radius:16px;border:1px solid '+GLOW+'33;background:linear-gradient(180deg,'+GLOW+'0a,#03203344);text-align:center;font-size:15px;min-height:56px';
 barW.style.cssText='position:relative;max-width:340px;height:20px;margin:8px auto;border-radius:10px;background:#ffffff10;border:1px solid '+GLOW+'33;overflow:hidden;display:none';
 barW.innerHTML='<div style="position:absolute;left:36%;width:28%;top:0;bottom:0;background:#10E67033;border-left:1px solid #10E67088;border-right:1px solid #10E67088"></div><div id="fmk" style="position:absolute;top:1px;bottom:1px;width:5px;border-radius:3px;background:'+ACC+';box-shadow:0 0 8px '+ACC+'"></div>';
 ctl.style.cssText='text-align:center;padding:4px';
 coll.setAttribute('data-testid','fsh-collection');
 coll.style.cssText='display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:4px;font-size:10.5px';
 root.appendChild(top);root.appendChild(baitR);root.appendChild(water);root.appendChild(barW);root.appendChild(ctl);root.appendChild(coll);
 const RC={common:'#EAF2FF',uncommon:'#2EE6FF',rare:'#FFD34D',legendary:'#C26BFF'};
 function paintTop(){top.innerHTML='<span data-testid="fsh-casts" style="color:'+ACC+'">\uD83C\uDFA3 Casts '+casts+'</span><span data-testid="fsh-caught" style="color:'+GLOW+'">\uD83D\uDC1F '+caught+'/'+NEED+'</span>'}
 function paintBaits(){baitR.innerHTML='';baits.forEach((b2,i)=>{const btn2=el('button','','\uD83E\uDEB1 '+b2.name+(b2.cost?' (-'+b2.cost+' pts)':'')+(b2.rare_bonus?' \u00b7 rare +'+Math.round(b2.rare_bonus*100)+'%':''));
   btn2.setAttribute('data-testid','fsh-bait-'+i);
   btn2.style.cssText='padding:5px 10px;border-radius:10px;border:1px solid '+(i===selBait?GLOW:'#556')+';background:'+(i===selBait?GLOW+'2a':'#ffffff08')+';color:'+T.text+';cursor:pointer;font-size:10.5px';
   btn2.onclick=()=>{selBait=i;sfx('click');paintBaits()};baitR.appendChild(btn2)})}
 function paintColl(){coll.innerHTML='';Object.keys(logC).forEach(k=>{const f2=fish.find(f=>f.name===k)||{};
   const s2=el('span','',k+' \u00d7'+logC[k]);
   s2.style.cssText='padding:3px 8px;border-radius:8px;border:1px solid '+(RC[f2.rarity]||'#556')+'55;color:'+(RC[f2.rarity]||T.text);
   coll.appendChild(s2)})}
 function paintCtl(){ctl.innerHTML='';
  const cB=el('button','','CAST \uD83C\uDFA3');cB.setAttribute('data-testid','fsh-cast');
  cB.style.cssText='margin:3px;padding:12px 26px;border-radius:12px;border:1px solid '+GLOW+'88;background:'+GLOW+'22;color:'+T.text+';font-weight:700;cursor:pointer;opacity:'+(phase==='idle'&&casts>0?1:.45);
  cB.onclick=cast;ctl.appendChild(cB);
  const hB=el('button','','HOOK \u2757');hB.setAttribute('data-testid','fsh-hook');
  hB.style.cssText='margin:3px;padding:12px 26px;border-radius:12px;border:1px solid '+ACC+'88;background:'+ACC+'22;color:'+T.text+';font-weight:700;cursor:pointer;opacity:'+(phase==='bite'?1:.45);
  hB.onclick=hook;ctl.appendChild(hB)}
 function endCheck(){if(doneFlag)return;
  if(caught>=NEED){doneFlag=true;addScore(25);fb(true,'Collection goal reached!'+unlockMsg(),next);return}
  if(casts<=0&&phase==='idle'){doneFlag=true;gameOver()}}
 function cast(){if(doneFlag||phase!=='idle'||casts<=0){sfx('wrong');return}
  const b2=baits[selBait];if(b2.cost){score=Math.max(0,score-b2.cost);post(false);refreshHud()}
  casts--;phase='waiting';water.textContent='\uD83C\uDFA3 Line out\u2026 waiting for a bite\u2026';sfx('click');paintTop();paintCtl();
  biteT=setTimeout(()=>{if(doneFlag)return;phase='bite';sfx('combo');vib(80);
   water.innerHTML='<b style="color:'+ACC+'">\u203C BITE! HOOK IT!</b>';barW.style.display='block';
   const t0=performance.now();const mk=barW.querySelector('#fmk');
   function anim(now){if(phase!=='bite')return;pos=(Math.sin((now-t0)/240)+1)/2;
    mk.style.left='calc('+(pos*100)+'% - 2px)';raf=requestAnimationFrame(anim)}
   raf=requestAnimationFrame(anim);
   setTimeout(()=>{if(phase==='bite')miss('It got away\u2026 too slow!')},2200)},600+Math.random()*1600)}
 function miss(msg){phase='idle';cancelAnimationFrame(raf);barW.style.display='none';
  water.textContent=msg;sfx('wrong');comboBreak();paintCtl();endCheck()}
 function hook(){if(phase!=='bite'){sfx('wrong');return}
  cancelAnimationFrame(raf);barW.style.display='none';
  const off=Math.abs(pos-0.5);
  if(off>0.14){miss('Missed the window \u2014 the fish escaped!');return}
  phase='idle';const acc=1-off/0.14;
  const roll=Math.random()-acc*0.2-(baits[selBait].rare_bonus||0);
  const rare=fish.filter(f=>f.rarity==='rare'||f.rarity==='legendary'),unc=fish.filter(f=>f.rarity==='uncommon'),com=fish.filter(f=>f.rarity==='common');
  const pool=(roll<0.12&&rare.length)?rare:(roll<0.42&&unc.length)?unc:(com.length?com:fish);
  const f2=pool[Math.floor(Math.random()*pool.length)];
  caught++;logC[f2.name]=(logC[f2.name]||0)+1;const p=addScore(f2.points||5);
  water.innerHTML='\uD83C\uDF89 Caught a <b style="color:'+(RC[f2.rarity]||GLOW)+'">'+f2.name+'</b> ('+(f2.rarity||'common')+') +'+p;
  sfx('achievement');refreshHud();paintTop();paintColl();paintCtl();endCheck()}
 paintTop();paintBaits();paintCtl();paintColl();
 water.textContent='Pick a bait and cast your line.'}

titleScreen();
`;

function buildSrcdoc(spec, save, audio, controls) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="g"></div><script>window.__SPEC__=${JSON.stringify(spec).replace(/</g, "\\u003c")};window.__SAVE__=${JSON.stringify(save || {}).replace(/</g, "\\u003c")};window.__AUDIO__=${JSON.stringify(audio || {}).replace(/</g, "\\u003c")};window.__CTRL__=${JSON.stringify(controls || {}).replace(/</g, "\\u003c")};<\/script>
<script>${RUNTIME_JS}<\/script></body></html>`;
}

export default function GameRuntime({ spec, onScore, height = 460, gameId, controls, guest }) {
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
      if (e?.data?.type === "game_key" && gameId && !guest) {
        apiClient.post("/fire/keys/collect", { game_id: gameId, stage: e.data.stage,
          key_id: `${gameId}-${e.data.key_id}` }).catch(() => {});
      }
      if (e?.data?.type === "game_save" && gameId && !guest) {
        try { localStorage.setItem(`or-game-save-${gameId}`, JSON.stringify(e.data.save || {})); } catch { /* full */ }
      }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [onScore, gameId, guest]);
  if (!spec) return null;
  return (
    <iframe ref={ref} title={spec.title || "game"} srcDoc={srcdoc} sandbox="allow-scripts"
      className="w-full rounded-xl" style={{ height, border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}
      data-testid="game-runtime-iframe" />
  );
}
