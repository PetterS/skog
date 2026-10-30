(function(root){
  'use strict';
  class ForestSound {
    constructor(){this.context=null;this.master=null;this.enabled=true;this.lastStep=0;this.nextCall=12;}
    session(type){try{if(navigator.audioSession)navigator.audioSession.type=type;}catch(_){}}
    unlock(){
      if(!this.enabled)return;
      this.session('playback');
      try{
        if(this.context?.state==='closed')this.context=null;
        if(!this.context){
          const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)return;
          const c=this.context=new Audio({latencyHint:'interactive'});this.master=c.createGain();this.master.gain.value=.48;
          const limiter=c.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=5;this.master.connect(limiter).connect(c.destination);
          const prime=c.createBufferSource();prime.buffer=c.createBuffer(1,1,c.sampleRate);prime.connect(c.destination);prime.start();prime.onended=()=>prime.disconnect();
          this.noise=c.createBuffer(1,c.sampleRate*5,c.sampleRate);const data=this.noise.getChannelData(0);const rng=SkogWorld.random(78);let v=0;
          for(let i=0;i<data.length;i++){v=(v+(rng()*2-1)*.035)/1.018;data[i]=v*3;}
          const wind=c.createBufferSource();wind.buffer=this.noise;wind.loop=true;
          const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=450;
          this.windGain=c.createGain();this.windGain.gain.value=.26;wind.connect(filter).connect(this.windGain).connect(this.master);wind.start();
          const rustle=c.createBufferSource();rustle.buffer=this.noise;rustle.loop=true;rustle.playbackRate.value=1.7;
          const high=c.createBiquadFilter();high.type='highpass';high.frequency.value=1800;
          const gain=c.createGain();gain.gain.value=.055;rustle.connect(high).connect(gain).connect(this.master);rustle.start();
          this.lastStep=0;this.nextCall=c.currentTime+9;
        }
        if(this.context.state!=='running')this.context.resume().catch(()=>{});
      }catch(_){/* Silent play still works. */}
    }
    release(){const old=this.context;this.context=null;this.master=null;this.windGain=null;if(old&&old.state!=='closed')try{old.close().catch(()=>{});}catch(_){}this.session('auto');}
    setEnabled(value){this.enabled=value;if(value)this.unlock();else this.release();}
    footstep(speed){
      const c=this.context;if(!this.enabled||!c||!this.master||c.state!=='running')return;
      const now=c.currentTime;if(now-this.lastStep<(speed>3.6?.25:.38))return;this.lastStep=now;
      const source=c.createBufferSource();source.buffer=this.noise;source.playbackRate.value=1.4+Math.random()*.6;
      const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=750+Math.random()*700;
      const env=c.createGain();env.gain.setValueAtTime(0,now);env.gain.linearRampToValueAtTime(.3,now+.012);env.gain.exponentialRampToValueAtTime(.001,now+.16);
      source.connect(filter).connect(env).connect(this.master);source.start(now,Math.random()*3,.2);source.onended=()=>{source.disconnect();filter.disconnect();env.disconnect();};
    }
    owl(){
      const c=this.context;if(!c||!this.master)return;
      const bus=c.createGain(),pan=c.createStereoPanner?.();bus.gain.value=.055;
      if(pan){pan.pan.value=Math.sin(c.currentTime)*.8;bus.connect(pan).connect(this.master);}else bus.connect(this.master);
      for(let i=0;i<3;i++){
        const start=c.currentTime+i*.42,osc=c.createOscillator(),env=c.createGain();osc.type='sine';osc.frequency.setValueAtTime(i===0?390:330,start);osc.frequency.exponentialRampToValueAtTime(i===0?330:290,start+.28);
        env.gain.setValueAtTime(.001,start);env.gain.linearRampToValueAtTime(.7,start+.07);env.gain.exponentialRampToValueAtTime(.001,start+.33);
        osc.connect(env).connect(bus);osc.start(start);osc.stop(start+.35);osc.onended=()=>{osc.disconnect();env.disconnect();if(i===2){bus.disconnect();pan?.disconnect();}};
      }
    }
    update(t){if(!this.context||!this.windGain)return;this.windGain.gain.setTargetAtTime(.23+Math.sin(t*.13)*.08,this.context.currentTime,.4);if(this.context.currentTime>this.nextCall){this.owl();this.nextCall=this.context.currentTime+18+Math.random()*19;}}
  }
  root.SkogSound=ForestSound;
})(globalThis);
