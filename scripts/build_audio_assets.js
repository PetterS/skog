// Rebuild the offline sample bank with Bun + ffmpeg. No build step is needed to play.
// The upstream public-domain recordings and selected edits are documented below.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const output = new URL('../assets/audio/', import.meta.url).pathname;
const cache = '/tmp/skog-audio-sources';
mkdirSync(output, {recursive: true});
mkdirSync(cache, {recursive: true});
const sources = {
  canopy: {id: 523390, author: 'Anya_Media', user: 2010973, title: 'Forest, white noise / distant roar of high tree tops swaying in the wind.wav'},
  leaves: {id: 523389, author: 'Anya_Media', user: 2010973, title: 'Forest, close up of trees rustling in the wind.wav'},
  track: {id: 523384, author: 'Anya_Media', user: 2010973, title: 'Single pair of footsteps walking down a forest track'},
  undergrowth: {id: 523385, author: 'Anya_Media', user: 2010973, title: "One person's footsteps walking through the forest undergrowth.wav"},
  owl: {id: 457749, author: 'PianoFarm', user: 9556718, title: 'Great horned owls dialog 09/20/2017'},
};
function run(args) {
  const result = Bun.spawnSync(args, {stdout: 'pipe', stderr: 'pipe'});
  if (result.exitCode) throw Error(Buffer.from(result.stderr).toString());
  return result.stdout;
}
for (const [name, source] of Object.entries(sources)) {
  source.path = join(cache, name + '.mp3');
  source.url = `https://freesound.org/people/${source.author}/sounds/${source.id}/`;
  source.download = `https://cdn.freesound.org/previews/${Math.floor(source.id / 1000)}/${source.id}_${source.user}-hq.mp3`;
  if (!(await Bun.file(source.path).exists())) {
    const temporary = `/tmp/skog-${name}.mp3`;
    if (await Bun.file(temporary).exists()) await Bun.write(source.path, Bun.file(temporary));
    else run(['curl', '-fsSL', source.download, '-o', source.path]);
  }
}

const assets = {};
function encode(name, sourceName, start, duration, filters, channels = 2, rate = 96) {
  const filename = join(cache, name + '-edit.mp3');
  run(['ffmpeg', '-v', 'error', '-y', '-ss', String(start), '-t', String(duration), '-i', sources[sourceName].path,
    '-af', filters, '-ar', '32000', '-ac', String(channels), '-c:a', 'libmp3lame', '-b:a', rate + 'k', filename]);
  assets[name] = {base64: Buffer.from(run(['cat', filename])).toString('base64'), source: sourceName, start, duration};
}
encode('canopy', 'canopy', 1, 26, 'highpass=f=65,lowpass=f=5800,loudnorm=I=-24:TP=-5:LRA=12');
encode('leaves', 'leaves', 24, 31, 'highpass=f=240,lowpass=f=7800,loudnorm=I=-26:TP=-5:LRA=14');
encode('owl', 'owl', 6, 19, 'highpass=f=180,lowpass=f=1700,loudnorm=I=-25:TP=-7:LRA=14,afade=t=in:d=0.2,afade=t=out:st=18.4:d=0.6', 1, 64);

// Choose strong, separated footfalls, with a short lead-in and a soft tail.
// The normalized recordings retain their gravel/leaf detail; runtime pitch,
// gain and alternating feet vary them without a repeating walking loop.
for (const name of ['track', 'undergrowth']) {
  const bytes = run(['ffmpeg', '-v', 'error', '-i', sources[name].path, '-t', '45', '-ac', '1', '-ar', '16000',
    '-af', 'highpass=f=160,lowpass=f=5000', '-f', 'f32le', '-']);
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const bins = [];
  for (let i = 0; i < floats.length - 480; i += 160) {
    let energy = 0;for (let j = 0; j < 480; j++) energy += floats[i + j] ** 2;
    bins.push({t: i / 16000, rms: Math.sqrt(energy / 480)});
  }
  bins.sort((a, b) => b.rms - a.rms);
  const chosen = [];
  for (const bin of bins) {
    if (bin.t < 2 || chosen.some(c => Math.abs(c.t - bin.t) < .8)) continue;
    chosen.push(bin);if (chosen.length === 6) break;
  }
  chosen.sort((a,b)=>a.t-b.t).forEach((bin, i) => {
    const start = Math.max(0, bin.t - .065);
    encode(`${name}${i}`, name, start, .34, 'highpass=f=100,lowpass=f=6500,loudnorm=I=-20:TP=-5:LRA=11,afade=t=in:d=0.009,afade=t=out:st=0.25:d=0.09', 1, 64);
  });
  console.log(name, chosen.map(c => ({time: c.t.toFixed(2), rms: c.rms.toFixed(4)})));
}
await Bun.write(join(output, 'forest-audio.js'), '// CC0 field recordings; source URLs, authors and edits in SOURCES.txt. Rebuild with bun scripts/build_audio_assets.js.\n' +
  'globalThis.SkogAudioData=' + JSON.stringify(assets) + ';\n');
const credits = [
  'Skog woodland sound recordings',
  'All source recordings are CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/',
  'License and authors verified on the original Freesound sound pages on 2026-10-30.',
  'The publicly served HQ MP3 previews were downloaded, trimmed, filtered and levelled.',
  'Local MP3 data is embedded in forest-audio.js for offline file:// playback.',
  'No network requests occur while playing. The original recordings are not needed at runtime.',
  '',
  ...Object.entries(sources).flatMap(([name, s]) => [`${name}: ${s.title}`, `Author: ${s.author}`, `Source: ${s.url}`, `Download: ${s.download}`, 'License: CC0 1.0', '']),
  'Edits (seconds in the source):',
  ...Object.entries(assets).map(([name, s]) => `${name}: ${s.source}, start ${s.start.toFixed(3)}, duration ${s.duration.toFixed(3)}`),
  '',
  'Skog sound.js adds its own restrained wind body, creaking timber, branch snaps,',
  'lantern/clothing foley, positional attenuation, surface-aware footfall selection,',
  'early reflections and stereo diffusion. The owl recording is a great horned owl,',
  'used as fictional forest ambience; this is not a Swedish species simulation.',
];
await Bun.write(join(output, 'SOURCES.txt'), credits.join('\n') + '\n');
console.log(`Built ${Object.keys(assets).length} clips, ${(await Bun.file(join(output, 'forest-audio.js')).size / 1024).toFixed(0)} KiB.`);
