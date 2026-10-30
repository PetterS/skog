(function(root) {
  'use strict';

  // Recorded woodland, close foley and rare positional details share a restrained
  // outdoor mix. Sample data is local JS so file:// needs no fetch or CORS policy.
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const decoded = new Map();
  function seeded(seed) {
    return () => {
      seed |= 0;seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  class ForestSound {
    constructor(context = null, seed = 80319) {
      this.context = context;
      this.ownsContext = !context;
      this.enabled = true;
      this.master = null;
      this.nodes = new Set();
      this.sources = new Set();
      this.voices = new Set();
      this.samples = {};
      this.layers = {};
      this.random = seeded(seed);
      this.generation = 0;
      this.lastStep = -1;
      this.lastGait = null;
      this.stepSide = 0;
      this.lastVariant = {track: -1, undergrowth: -1};
      this.position = {x: 0, z: 7};
      this.yaw = 0;
      this.eventCounts = {steps: 0, owl: 0, creak: 0, branch: 0, water: 0};
      this.ready = Promise.resolve();
      if (context) this.build();
    }

    session(type) {
      if (!this.ownsContext) return;
      try { if (root.navigator?.audioSession) root.navigator.audioSession.type = type; } catch (_) {}
    }

    unlock() {
      if (!this.enabled) return;
      this.session('playback');
      try {
        if (this.context?.state === 'closed') this.release();
        if (!this.context) {
          const Audio = root.AudioContext || root.webkitAudioContext;
          if (!Audio) return;
          this.context = new Audio({latencyHint: 'interactive'});
          // Prime in the gesture, before asynchronous decoding. Safari may
          // otherwise report a running context which produces no audible output.
          const prime = this.context.createBufferSource();
          prime.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
          prime.connect(this.context.destination);prime.start();prime.onended = () => prime.disconnect();
          this.build();
        }
        if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
          this.context.resume().catch(() => {});
        }
      } catch (_) { /* The forest remains playable without audio. */ }
    }

    node(type) {
      const n = this.context['create' + type]();
      this.nodes.add(n);
      return n;
    }

    build() {
      const c = this.context, now = c.currentTime, generation = ++this.generation;
      this.master = this.node('Gain');this.master.gain.value = this.enabled ? .82 : 0;
      const highpass = this.node('BiquadFilter');highpass.type = 'highpass';highpass.frequency.value = 38;highpass.Q.value = .6;
      const limiter = this.node('DynamicsCompressor');limiter.threshold.value = -10;limiter.knee.value = 12;limiter.ratio.value = 5;limiter.attack.value = .006;limiter.release.value = .25;
      this.master.connect(highpass).connect(limiter).connect(c.destination);
      this.ambient = this.node('Gain');this.ambient.gain.value = .9;this.ambient.connect(this.master);
      this.effects = this.node('Gain');this.effects.gain.value = .8;this.effects.connect(this.master);
      this.wet = this.node('Gain');this.wet.gain.value = .13;
      const reverb = this.node('Convolver');reverb.buffer = this.makeImpulse();this.wet.connect(reverb).connect(this.master);
      this.noise = this.makeNoise(2.8, false);
      this.brown = this.makeNoise(9.7, true, 2);
      this.addLoop('air', this.brown, .10, {lowpass: 360, rate: .79, pan: -.2});
      this.addLoop('treetops', this.brown, .065, {highpass: 220, lowpass: 1400, rate: 1.07, pan: .32});
      this.nextOwl = now + 8 + this.random() * 9;
      this.nextCreak = now + 5 + this.random() * 7;
      this.nextBranch = now + 17 + this.random() * 13;
      this.nextWater = now + 3;
      this.lastStep = -1;this.lastGait = null;
      this.ready = this.loadSamples(c, generation).then(() => {
        if (this.context !== c || generation !== this.generation || !this.master) return;
        if (this.samples.canopy) this.addLoop('canopy', this.seamless(this.samples.canopy, 2.7), .58, {highpass: 90, lowpass: 5200});
        if (this.samples.leaves) this.addLoop('leaves', this.seamless(this.samples.leaves, 3.2), .33, {highpass: 650, lowpass: 7000, rate: .97});
      });
    }

    async loadSamples(context, generation) {
      for (const [name, asset] of Object.entries(root.SkogAudioData || {})) {
        try {
          const key = name + ':' + context.sampleRate;
          let buffer = decoded.get(key);
          if (!buffer) {
            const binary = root.atob(asset.base64), bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            buffer = await context.decodeAudioData(bytes.buffer);
            decoded.set(key, buffer);
          }
          if (this.context !== context || this.generation !== generation) return;
          this.samples[name] = buffer;
        } catch (_) { /* Original synthesized foley remains as a fallback. */ }
      }
    }

    makeNoise(duration, brown = false, channels = 1) {
      const c = this.context, buffer = c.createBuffer(channels, Math.ceil(c.sampleRate * duration), c.sampleRate);
      const rng = seeded(brown ? 3167 : 6731);
      for (let channel = 0; channel < channels; channel++) {
        const data = buffer.getChannelData(channel);let state = 0;
        for (let i = 0; i < data.length; i++) {
          const white = rng() * 2 - 1;
          state = .985 * state + white * .1;
          data[i] = brown ? state : white;
        }
      }
      return this.seamless(buffer, .12);
    }

    seamless(buffer, seconds) {
      const cross = Math.min(Math.floor(seconds * buffer.sampleRate), Math.floor(buffer.length / 3));
      const length = buffer.length - cross;
      const result = this.context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const from = buffer.getChannelData(channel), to = result.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          if (i < cross) {
            const t = i / cross;
            to[i] = from[length + i] * Math.cos(t * Math.PI / 2) + from[i] * Math.sin(t * Math.PI / 2);
          } else to[i] = from[i];
        }
      }
      return result;
    }

    makeImpulse() {
      const c = this.context, duration = 1.45, rng = seeded(1971);
      const b = c.createBuffer(2, Math.ceil(c.sampleRate * duration), c.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = b.getChannelData(channel);let s = 0;
        for (let i = 0; i < data.length; i++) {
          const t = i / c.sampleRate;
          s = s * .68 + (rng() * 2 - 1) * .32;
          data[i] = t < .035 ? 0 : s * Math.exp(-t * 6) * .12;
        }
        for (const [delay, level] of [[.071, .38], [.127, .22], [.213, .15], [.341, .07]]) {
          data[Math.floor((delay + channel * .011) * c.sampleRate)] += level;
        }
      }
      return b;
    }

    addLoop(name, buffer, level, options = {}) {
      const c = this.context, source = this.node('BufferSource'), gain = this.node('Gain');
      const low = this.node('BiquadFilter'), high = this.node('BiquadFilter');
      low.type = 'lowpass';low.frequency.value = options.lowpass || 16000;
      high.type = 'highpass';high.frequency.value = options.highpass || 30;
      source.buffer = buffer;source.loop = true;source.playbackRate.value = options.rate || 1;
      gain.gain.setValueAtTime(0, c.currentTime);gain.gain.linearRampToValueAtTime(level, c.currentTime + 2.4);
      source.connect(high).connect(low).connect(gain);
      let pan = null;
      if (c.createStereoPanner) {pan = this.node('StereoPanner');pan.pan.value = options.pan || 0;gain.connect(pan).connect(this.ambient);}
      else gain.connect(this.ambient);
      source.start(c.currentTime, this.random() * buffer.duration * .6);
      this.sources.add(source);this.layers[name] = {source, gain, low, pan, level};
    }

    // Every one-shot disconnects its graph on completion. Pending decoders and
    // onended callbacks cannot resurrect the soundscape after pause or mute.
    play(buffer, when, level, options = {}) {
      if (!this.enabled || !this.context || !this.master || !buffer) return;
      const c = this.context, source = this.node('BufferSource'), gain = this.node('Gain'), low = this.node('BiquadFilter');
      const rate = options.rate || 1, offset = options.offset || 0;
      const duration = Math.min(options.duration || buffer.duration - offset, buffer.duration - offset) / rate;
      source.buffer = buffer;source.playbackRate.value = rate;
      low.type = 'lowpass';low.frequency.value = options.lowpass || 8000;low.Q.value = .5;
      const attack = Math.min(options.attack || .008, duration / 4), release = Math.min(options.release || .06, duration / 3);
      gain.gain.setValueAtTime(0, when);gain.gain.linearRampToValueAtTime(level, when + attack);
      gain.gain.setValueAtTime(level, when + Math.max(attack, duration - release));gain.gain.linearRampToValueAtTime(0, when + duration);
      source.connect(low).connect(gain);
      const owned = [source, low, gain];let spatial = null;
      if (options.position && c.createPanner) {
        spatial = this.node('Panner');spatial.panningModel = 'HRTF';spatial.distanceModel = 'inverse';
        spatial.refDistance = options.near || 5;spatial.rolloffFactor = 1.2;spatial.maxDistance = 100;
        const p = options.position;
        if (spatial.positionX) {spatial.positionX.value = p.x;spatial.positionY.value = p.y || 2;spatial.positionZ.value = p.z;}
        else spatial.setPosition(p.x, p.y || 2, p.z);
        gain.connect(spatial);owned.push(spatial);
      } else if (c.createStereoPanner) {
        spatial = this.node('StereoPanner');spatial.pan.value = options.pan || 0;gain.connect(spatial);owned.push(spatial);
      }
      const output = spatial || gain;
      output.connect(this.effects);
      const send = this.node('Gain');send.gain.value = options.wet ?? .28;output.connect(send).connect(this.wet);owned.push(send);
      const voice = {source, low, position: options.position};this.voices.add(voice);this.sources.add(source);
      source.onended = () => {
        this.voices.delete(voice);this.sources.delete(source);
        for (const node of owned) {node.disconnect();this.nodes.delete(node);}
      };
      source.start(when, offset, duration * rate);source.stop(when + duration + .015);
      return voice;
    }

    noiseBurst(when, duration, level, options = {}) {
      return this.play(this.noise, when, level, {...options, duration, offset: this.random() * Math.max(0, this.noise.duration - duration)});
    }

    resonantBuffer(kind, seed) {
      const c = this.context, rng = seeded(seed), duration = kind === 'creak' ? 2.6 : kind === 'water' ? .8 : .5;
      const b = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate), data = b.getChannelData(0);
      const base = kind === 'creak' ? 70 + rng() * 55 : kind === 'water' ? 660 + rng() * 700 : 350 + rng() * 280;
      let phase = 0, filtered = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / c.sampleRate, n = rng() * 2 - 1;filtered = filtered * .8 + n * .2;
        if (kind === 'creak') {
          const rub = Math.pow(Math.max(0, Math.sin(t * (17 + seed % 9) + Math.sin(t * 5.1) * 3)), 9);
          phase += TAU * base * (1 + Math.sin(t * 2.3) * .13 + filtered * .025) / c.sampleRate;
          const envelope = Math.sin(Math.PI * t / duration) ** 2;
          data[i] = envelope * (Math.sin(phase) * .12 + Math.sin(phase * 2.37) * .045 + filtered * rub * .32);
        } else if (kind === 'water') {
          phase += TAU * base * (1 + t * 1.5) / c.sampleRate;
          data[i] = Math.sin(phase) * Math.exp(-t * 13) * .21 + filtered * Math.exp(-t * 35) * .18;
        } else {
          const crack = Math.exp(-t * 100) + .5 * Math.exp(-Math.abs(t - .055) * 170) + .22 * Math.exp(-Math.abs(t - .14) * 110);
          data[i] = filtered * crack * .8 + Math.sin(TAU * base * t) * Math.exp(-t * 45) * .12;
        }
        data[i] *= Math.min(1, t / .004);
      }
      return b;
    }

    footstep(speed, player = null, gait = player?.walk ?? null) {
      const c = this.context;
      if (!this.enabled || !c || !this.master || (!this.ownsContext && c.state === 'closed') || speed < .15) return;
      const now = c.currentTime;
      if (gait !== null) {
        const step = Math.floor(gait / Math.PI);
        if (this.lastGait === null) {this.lastGait = step;return;}
        if (step === this.lastGait) return;
        this.lastGait = step;
        if (now - this.lastStep < .12) return;
      } else if (now - this.lastStep < (speed > 2.8 ? .27 : .38)) return;
      this.lastStep = now;
      this.scheduleFootstep(now, speed, player);
    }

    scheduleFootstep(when, speed = 1.85, player = this.position) {
      if (!this.context || !this.master) return;
      const pd = player && root.SkogWorld ? root.SkogWorld.pathDistance(player.x, player.z) : 0;
      const kind = pd > 1.65 ? 'undergrowth' : 'track';
      let variant = Math.floor(this.random() * 6);
      if (variant === this.lastVariant[kind]) variant = (variant + 1) % 6;
      this.lastVariant[kind] = variant;
      const sample = this.samples[kind + variant];
      const pace = clamp(speed / 3.5, .2, 1), side = (this.stepSide++ % 2 ? 1 : -1);
      const level = (.28 + pace * .16) * (.86 + this.random() * .23);
      if (sample) this.play(sample, when, level, {rate: 1.02 + this.random() * .15 + pace * .07, pan: side * .13, wet: .07, lowpass: kind === 'track' ? 5100 : 6700});
      else this.noiseBurst(when, .17, level * .25, {lowpass: 1300, pan: side * .12, wet: .08});
      // The coat follows each impact. Tiny strap/lantern ticks are infrequent,
      // so a long walk never becomes a repetitive metal chime.
      this.noiseBurst(when + .065, .12, .014 + pace * .01, {lowpass: 2400, pan: side * -.07, wet: .04, attack: .025});
      if (this.stepSide % 4 === 0) this.play(this.resonantBuffer('branch', 310 + this.stepSide), when + .08, .022, {rate: 2.3, pan: -.2, lowpass: 3600, wet: .04});
      this.eventCounts.steps++;
    }

    event(kind, when, position = null) {
      if (!this.context || !this.master) return;
      const rng = this.random;
      const p = position || {x: this.position.x + Math.cos(rng() * TAU) * (10 + rng() * 18), z: this.position.z + Math.sin(rng() * TAU) * (10 + rng() * 18), y: 3};
      if (kind === 'owl') {
        const buffer = this.samples.owl;
        if (buffer) this.play(buffer, when, 1.05, {position: p, rate: .94 + rng() * .1, offset: rng() * 4, duration: 8 + rng() * 4, lowpass: 1600, attack: .3, release: .8, wet: .65, near: 8});
      } else {
        const buffer = this.resonantBuffer(kind, Math.floor(rng() * 1e6));
        this.play(buffer, when, kind === 'water' ? .9 : kind === 'creak' ? .85 : .48, {position: p, lowpass: kind === 'creak' ? 2100 : 4800, near: kind === 'water' ? 2.4 : 5, wet: kind === 'water' ? 1.1 : .5, attack: kind === 'creak' ? .14 : .004});
      }
      this.eventCounts[kind]++;
    }

    update(t, player = this.position, camera = null) {
      const c = this.context;if (!c || !this.master || !this.enabled) return;
      if (player) this.position = {x: player.x, z: player.z};
      if (camera) this.yaw = camera.yaw;
      const p = this.position, y = (root.SkogWorld?.height(p.x, p.z) || 0) + 1.35;
      const listener = c.listener, now = c.currentTime;
      if (listener.positionX) {
        for (const [axis, value] of [['X', p.x], ['Y', y], ['Z', p.z]]) listener['position' + axis].setTargetAtTime(value, now, .04);
        listener.forwardX.setTargetAtTime(-Math.sin(this.yaw), now, .04);listener.forwardY.setTargetAtTime(0, now, .04);listener.forwardZ.setTargetAtTime(-Math.cos(this.yaw), now, .04);
        listener.upX.value = 0;listener.upY.value = 1;listener.upZ.value = 0;
      } else {listener.setPosition(p.x, y, p.z);listener.setOrientation(-Math.sin(this.yaw), 0, -Math.cos(this.yaw), 0, 1, 0);}
      const gust = .75 + Math.sin(t * .071) * .18 + Math.sin(t * .193 + 2.1) * .09;
      const ruin = clamp(1 - Math.hypot(p.x - 24, p.z + 24) / 9, 0, 1);
      for (const [name, layer] of Object.entries(this.layers)) {
        const detail = name === 'leaves' ? .65 + Math.sin(t * .14 + 1.4) * .22 : 1;
        layer.gain.gain.setTargetAtTime(layer.level * gust * detail * (1 - ruin * .25), now, .8);
        if (layer.pan) layer.pan.pan.setTargetAtTime(Math.sin(this.yaw + t * .012) * (name === 'leaves' ? .3 : .12), now, .5);
      }
      this.wet.gain.setTargetAtTime(.13 + ruin * .17, now, .6);
      for (const voice of this.voices) if (voice.position) {
        const distance = Math.hypot(p.x - voice.position.x, p.z - voice.position.z);
        voice.low.frequency.setTargetAtTime(clamp(7000 / (1 + distance * .07), 750, 6500), now, .3);
      }
      if (now > this.nextOwl) {this.event('owl', now + .04);this.nextOwl = now + 27 + this.random() * 23;}
      if (now > this.nextCreak) {this.event('creak', now + .02);this.nextCreak = now + 14 + this.random() * 19;}
      if (now > this.nextBranch) {this.event('branch', now + .02);this.nextBranch = now + 24 + this.random() * 28;}
      if (now > this.nextWater) {
        if (Math.hypot(p.x + 27, p.z + 39) < 15) this.event('water', now + .02, {x: -27, z: -39, y: (root.SkogWorld?.height(-27, -39) || 0) - 1});
        this.nextWater = now + 2.5 + this.random() * 4;
      }
    }

    setEnabled(value) {
      this.enabled = !!value;
      if (this.enabled) this.unlock();else this.release();
    }

    release() {
      this.generation++;
      const old = this.context;
      for (const source of this.sources) {try {source.stop();} catch (_) {}}
      for (const node of this.nodes) {try {node.disconnect();} catch (_) {}}
      this.nodes.clear();this.sources.clear();this.voices.clear();this.layers = {};this.samples = {};
      this.context = null;this.master = null;this.ambient = null;this.effects = null;this.wet = null;
      this.lastGait = null;this.lastStep = -1;
      if (this.ownsContext && old && old.state !== 'closed') {try {old.close().catch(() => {});} catch (_) {}}
      this.session('auto');
    }
  }
  root.SkogSound = ForestSound;
})(globalThis);
