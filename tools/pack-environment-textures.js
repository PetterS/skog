// Repack the unmodified 1K Poly Haven JPEGs as classic-script data URIs.
// This deliberately avoids fetch and file-origin WebGL/CORS differences.
// Usage: bun tools/pack-environment-textures.js /path/to/downloaded-jpegs
const directory = Bun.argv[2];
if (!directory) throw new Error('Pass a directory containing the six named JPEGs.');
const names = ['rock-color', 'rock-normal', 'bark-color', 'bark-normal', 'ground-color', 'ground-normal'];
const sources = {};
for (const name of names) {
  const bytes = await Bun.file(`${directory}/${name}.jpg`).arrayBuffer();
  sources[name] = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}
await Bun.write('assets/environment-textures.js', '// Poly Haven CC0 textures. See environment-textures.LICENSE.txt.\nwindow.SkogTextureSources=' + JSON.stringify(sources) + ';\n');
console.log('Packed six original CC0 texture maps for offline file loading.');
