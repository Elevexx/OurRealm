import React, { useEffect, useMemo, useRef } from "react";

// Sandboxed game runtime: the ORAi-generated spec runs inside an isolated
// iframe (sandbox="allow-scripts", separate origin — no cookies, no auth,
// no production APIs, no parent DOM). Scores come back via postMessage only.
const RUNTIME_JS = String.raw`
const S=window.__SPEC__;const root=document.getElementById('g');let score=0,stageIdx=0,correctTotal=0,answered=0;
const T=S.theme||{bg:'#0b1220',accent:'#2EE6FF',text:'#EAF2FF'};
document.body.style.cssText='margin:0;font-family:system-ui,sans-serif;background:'+T.bg+';color:'+T.text+';min-height:100vh';
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!==undefined)e.innerHTML=h;return e}
function post(completed){parent.postMessage({type:'game_score',score:score,completed:!!completed,title:S.title},'*')}
function hud(){const h=el('div','',''); h.style.cssText='display:flex;justify-content:space-between;padding:10px 14px;font-size:12px;opacity:.9';
 h.innerHTML='<b>'+S.title+'</b><span>Stage '+(stageIdx+1)+'/'+S.stages.length+' · Score <b style="color:'+T.accent+'">'+score+'</b></span>';return h}
function btn(label,fn){const b=el('button','',label);b.style.cssText='margin:6px;padding:12px 18px;border-radius:12px;border:1px solid '+T.accent+'55;background:'+T.accent+'22;color:'+T.text+';font-size:15px;cursor:pointer;min-height:44px';b.onclick=fn;return b}
function fb(ok,msg,then){const f=el('div','',(ok?'✓ ':'✗ ')+(msg||''));f.style.cssText='padding:10px 14px;font-size:13px;color:'+(ok?'#10E670':'#FF6B6B');root.appendChild(f);setTimeout(()=>{f.remove();then()},900)}
function done(){root.innerHTML='';root.appendChild(hud());const pct=answered?Math.round(correctTotal/answered*100):100;
 const pass=pct>=((S.scoring||{}).pass_pct||70);
 const d=el('div','','<h2 style="color:'+T.accent+'">'+(pass?'🏆 Well done!':'Keep practicing!')+'</h2><p>Final score: <b>'+score+'</b> · Accuracy '+pct+'%</p>'+
  ((S.achievements||[]).length&&pct===100?'<p style="color:#F4A73B">★ Achievement: '+S.achievements[0].label+'</p>':''));
 d.style.cssText='text-align:center;padding:30px 16px';root.appendChild(d);
 root.appendChild(btn('Play again',()=>{score=0;stageIdx=0;correctTotal=0;answered=0;stage()}));post(true)}
function next(){stageIdx++;if(stageIdx>=S.stages.length)done();else stage()}
function mark(ok,pts){answered++;if(ok){score+=pts!==undefined?pts:((S.scoring||{}).points_per_correct||10);correctTotal++}post(false)}
function stage(){root.innerHTML='';root.appendChild(hud());const st=S.stages[stageIdx];
 const h=el('div','','<h3 style="margin:8px 14px;color:'+T.accent+'">'+(st.title||'')+'</h3>');root.appendChild(h);
 ({quiz_adventure:qa,matching:ma,sorting:so,memory:me,rhythm:rh})[S.runtime](st)}
function qa(st){if(st.story){const p=el('div','',st.story);p.style.cssText='padding:0 14px 8px;font-size:14px;opacity:.85';root.appendChild(p)}
 let qi=0;function ask(){const q=st.questions[qi];if(!q){next();return}
  const box=el('div','');box.style.cssText='padding:0 10px';box.appendChild(el('div','','<p style="padding:0 6px;font-size:15px"><b>'+q.q+'</b></p>'));
  q.options.forEach((o,i)=>box.appendChild(btn(o,()=>{const ok=i===q.answer_index;mark(ok);
   box.remove();fb(ok,q.explanation||'',()=>{qi++;root.lastChild&&root.lastChild.remove&&null;ask()})})));
  root.appendChild(box)}ask()}
function ma(st){let sel=null,left=el('div',''),right=el('div',''),wrap=el('div','');wrap.style.cssText='display:flex;gap:8px;padding:0 10px';
 left.style.flex=right.style.flex='1';let remaining=st.pairs.length;
 const R=st.pairs.map(p=>p.right).sort(()=>Math.random()-.5);
 st.pairs.forEach(p=>{const b=btn(p.left,()=>{sel=p;[...left.children].forEach(c=>c.style.outline='');b.style.outline='2px solid '+T.accent});left.appendChild(b)});
 R.forEach(r=>{const b=btn(r,()=>{if(!sel)return;const ok=sel.right===r;mark(ok);if(ok){b.disabled=true;b.style.opacity=.4;
  [...left.children].find(c=>c.textContent===sel.left).style.cssText+=';opacity:.4;pointer-events:none';remaining--;sel=null;if(!remaining)fb(true,'Stage complete!',next)}else fb(false,'Not a match — try again',()=>{})});right.appendChild(b)});
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
 const disp=el('div','','Get ready…');disp.style.cssText='text-align:center;font-size:34px;padding:26px;min-height:60px';root.appendChild(disp);
 if(st.lesson_tip)root.appendChild(el('div','','<p style="text-align:center;font-size:12px;opacity:.7;padding:0 14px">'+st.lesson_tip+'</p>'));
 let window_open=false,tapped=false;
 const tap=btn('TAP 🥁',()=>{if(window_open&&!tapped){tapped=true;hits++;mark(true);disp.style.color='#10E670'}else{mark(false);disp.style.color='#FF6B6B'}});
 tap.style.cssText+=';display:block;margin:10px auto;font-size:22px;padding:18px 44px';root.appendChild(tap);
 const timer=setInterval(()=>{if(i>=st.pattern.length){clearInterval(timer);fb(hits>=Math.ceil(taps*.6),'You hit '+hits+'/'+taps+' beats',next);return}
  const on=st.pattern[i]===1;window_open=on;tapped=false;disp.textContent=on?'TAP!':'…';disp.style.color=on?T.accent:T.text;i++},beatMs)}
stage();
`;

function buildSrcdoc(spec) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="g"></div><script>window.__SPEC__=${JSON.stringify(spec).replace(/</g, "\\u003c")};<\/script>
<script>${RUNTIME_JS}<\/script></body></html>`;
}

export default function GameRuntime({ spec, onScore, height = 460 }) {
  const ref = useRef(null);
  const srcdoc = useMemo(() => (spec ? buildSrcdoc(spec) : ""), [spec]);
  useEffect(() => {
    const h = (e) => {
      if (e?.data?.type === "game_score" && onScore) onScore(e.data);
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [onScore]);
  if (!spec) return null;
  return (
    <iframe ref={ref} title={spec.title || "game"} srcDoc={srcdoc} sandbox="allow-scripts"
      className="w-full rounded-xl" style={{ height, border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}
      data-testid="game-runtime-iframe" />
  );
}
