(function(){
  'use strict';
  const $=s=>document.querySelector(s),canvas=$('#forest'),W=SkogWorld;
  const player={x:0,z:7,heading:Math.PI,speed:0,motionSpeed:0,walk:0};
  const camera={yaw:.08,pitch:.27,distance:6.6};
  const state={started:false,paused:false,time:0,frames:0,quality:Math.min(devicePixelRatio,1.6)};
  const keys=new Set(),pointers=new Map(),move={x:0,y:0};let forest,world,runHeld=false,touchMode=matchMedia('(pointer:coarse)').matches;
  const sound=new SkogSound();try{sound.enabled=localStorage.getItem('skog.sound')!=='off';}catch(_){}
  function soundUI(){$('#sound').setAttribute('aria-pressed',String(sound.enabled));$('#sound').setAttribute('aria-label',sound.enabled?'Stäng av ljud':'Slå på ljud');}
  function setTouch(value){touchMode=value;document.body.classList.toggle('touch',value);$('#touch-controls').setAttribute('aria-hidden',String(!value));$('#title-controls').textContent=value?'Dra till vänster för att gå · dra till höger för att se dig omkring':'WASD / piltangenter · dra för att se dig omkring';}
  setTouch(touchMode);soundUI();
  function resetInput(){keys.clear();pointers.clear();move.x=move.y=0;runHeld=false;$('#run').classList.remove('held');$('#joystick').classList.remove('active');$('#joystick').removeAttribute('style');$('#stick').style.transform='';}
  function pause(){if(!state.started||state.paused)return;state.paused=true;resetInput();sound.release();$('#pause-dialog').showModal();}
  function resume(){if(!state.started)return;state.paused=false;resetInput();$('#pause-dialog').close();sound.unlock();canvas.focus({preventScroll:true});}
  function toggleSound(){sound.setEnabled(!sound.enabled);soundUI();try{localStorage.setItem('skog.sound',sound.enabled?'on':'off');}catch(_){}}
  function start(){if(!forest)return;state.started=true;state.paused=false;$('#title-screen').hidden=true;$('#hud').hidden=false;sound.unlock();canvas.tabIndex=0;canvas.focus({preventScroll:true});setTimeout(()=>$('#hint').classList.add('faded'),8500);}
  $('#enter').addEventListener('click',start);$('#enter').addEventListener('touchend',()=>sound.unlock(),{passive:true});
  $('#pause').addEventListener('click',pause);$('#resume').addEventListener('click',resume);
  $('#pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});
  $('#sound').addEventListener('click',toggleSound);
  $('#restart').addEventListener('click',()=>{Object.assign(player,{x:0,z:7,heading:Math.PI,speed:0,motionSpeed:0,walk:0});Object.assign(camera,{yaw:.08,pitch:.27,distance:6.6,actualDistance:6.6});resume();});
  function live(){return state.started&&!state.paused&&!document.hidden;}
  window.addEventListener('keydown',e=>{
    if(e.code==='Escape'){e.preventDefault();if(state.paused)resume();else pause();return;}
    if(!live())return;
    if(e.target instanceof HTMLButtonElement&&(e.code==='Space'||e.code==='Enter'))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyQ','KeyE','KeyM','Space'].includes(e.code)){
      e.preventDefault();keys.add(e.code);if(e.code==='KeyM'&&!e.repeat)toggleSound();else sound.unlock();
    }
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{resetInput();if(state.started)pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){resetInput();sound.release();if(state.started)pause();}});
  function pointDown(e){
    if(!live()||e.button>0)return;e.preventDefault();sound.unlock();
    if(e.pointerType==='touch')setTouch(true);
    const role=e.pointerType==='touch'&&e.clientX<innerWidth*.48&&!Array.from(pointers.values()).some(p=>p.role==='move')?'move':'look';
    if(Array.from(pointers.values()).some(p=>p.role===role))return;
    pointers.set(e.pointerId,{role,x:e.clientX,y:e.clientY,originX:e.clientX,originY:e.clientY});canvas.setPointerCapture(e.pointerId);
    if(role==='move'){$('#joystick').style.left=(e.clientX-53)+'px';$('#joystick').style.top=(e.clientY-53)+'px';$('#joystick').style.bottom='auto';$('#joystick').style.width='106px';$('#joystick').style.height='106px';$('#joystick').classList.add('active');}
  }
  function pointMove(e){
    const p=pointers.get(e.pointerId);if(!p||!live())return;
    if(p.role==='move'){
      const dx=e.clientX-p.originX,dy=e.clientY-p.originY,length=Math.hypot(dx,dy),limit=43;
      const strength=W.clamp((length-5)/(limit-5),0,1);move.x=length?dx/length*strength:0;move.y=length?dy/length*strength:0;
      $('#stick').style.transform=`translate(${move.x*34}px,${move.y*34}px)`;
    }else{camera.yaw-=(e.clientX-p.x)*.005;camera.pitch=W.clamp(camera.pitch+(e.clientY-p.y)*.003,-.10,.85);}
    p.x=e.clientX;p.y=e.clientY;
  }
  function pointEnd(e){
    const p=pointers.get(e.pointerId);if(!p)return;pointers.delete(e.pointerId);
    if(p.role==='move'){move.x=move.y=0;$('#joystick').classList.remove('active');$('#joystick').removeAttribute('style');$('#stick').style.transform='';}
    if(e.type==='pointerup'&&live())sound.unlock();
  }
  canvas.addEventListener('pointerdown',pointDown);canvas.addEventListener('pointermove',pointMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,pointEnd);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{if(!live())return;e.preventDefault();camera.distance=W.clamp(camera.distance+e.deltaY*.006,3.2,9);},{passive:false});
  $('#run').addEventListener('pointerdown',e=>{if(!live())return;e.preventDefault();runHeld=true;$('#run').classList.add('held');$('#run').setPointerCapture(e.pointerId);sound.unlock();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])$('#run').addEventListener(type,()=>{runHeld=false;$('#run').classList.remove('held');});
  window.addEventListener('resize',()=>{resetInput();if(forest)forest.resize();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();$('#error-text').textContent='Grafiken tappade kontakten med skogen. Vänta en stund eller försök igen.';$('#error').hidden=false;});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  let last=0,slowFrames=0,frameCount=0,frameSum=0;
  function frame(now){
    requestAnimationFrame(frame);if(!forest||document.hidden)return;
    const elapsed=last?(now-last)/1000:1/60,dt=Math.min(elapsed,.05);last=now;
    if(state.paused)return;
    state.time+=dt;state.frames++;
    if(live()){
      let x=move.x+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
      let z=move.y+(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
      const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
      const running=runHeld||keys.has('ShiftLeft')||keys.has('ShiftRight');const desiredSpeed=(running?3.5:1.85)*Math.min(length,1);
      player.speed+=(desiredSpeed-player.speed)*(1-Math.exp(-dt*12));if(length<.01&&player.speed<.02)player.speed=0;
      if(keys.has('KeyQ'))camera.yaw+=dt*1.6;if(keys.has('KeyE'))camera.yaw-=dt*1.6;
      player.motionSpeed=0;
      if(length>.01){const vx=x*Math.cos(camera.yaw)+z*Math.sin(camera.yaw),vz=-x*Math.sin(camera.yaw)+z*Math.cos(camera.yaw);
        const angle=Math.atan2(vx,vz),delta=Math.atan2(Math.sin(angle-player.heading),Math.cos(angle-player.heading));player.heading+=delta*(1-Math.exp(-dt*12));
        const p=world.move(player.x,player.z,vx/Math.min(length,1)*player.speed*dt,vz/Math.min(length,1)*player.speed*dt);
        const moved=Math.hypot(p.x-player.x,p.z-player.z);player.x=p.x;player.z=p.z;player.motionSpeed=moved/Math.max(dt,.001);player.walk+=moved*3.5;if(moved>.001)sound.footstep(player.motionSpeed,player);
      }
    }else{player.speed=0;player.motionSpeed=0;}
    sound.update(state.time,player,camera);forest.update(state.time,dt,player,camera);
    // Render resolution adapts, while controls and world geometry stay stable.
    if(state.frames>90&&elapsed<.2){frameCount++;frameSum+=elapsed;if(frameCount===90){const average=frameSum/frameCount;if(average>.031)slowFrames++;else slowFrames=0;if(slowFrames>=2&&state.quality>.8){state.quality=Math.max(.8,state.quality-.2);forest.setQuality(state.quality);slowFrames=0;}frameCount=0;frameSum=0;}}
  }
  try{
    world=new W.World();forest=new SkogForest(canvas,world);forest.resize();
    rootExpose();$('#enter').disabled=false;$('#enter').textContent='Gå in i skogen';requestAnimationFrame(frame);
  }catch(error){console.error(error);$('#error').hidden=false;$('#title-screen').hidden=true;}
  function rootExpose(){window.Skog={player,camera,state,world,forest,sound,pause,resume,get input(){return {x:move.x,y:move.y,pointers:pointers.size,keys:[...keys],running:runHeld};}};}
})();
