// One-off: generate GearOps app icons + in-app logo from the source square logo.
// Run from repo root:  node scripts/gen-gearops-icons.js [sourcePath]
const path = require('path');
const Jimp = require('jimp-compact');

const SRC = process.argv[2] || path.resolve(__dirname, '..', 'assets', 'images', 'gearops-logo-source.jpeg');
const OUT = path.resolve(__dirname, '..', 'assets', 'images');

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

(async () => {
  const src = await Jimp.read(SRC);
  const W = src.bitmap.width;
  const H = src.bitmap.height;

  // Detect the navy background by averaging mid-dark, low-saturation pixels
  // (excludes white gear, orange G, and the pure-black outer margin).
  let nr = 0, ng = 0, nb = 0, n = 0;
  src.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
    const l = lum(r, g, b);
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    if (l > 25 && l < 95 && maxc - minc < 45) { nr += r; ng += g; nb += b; n++; }
  });
  const navy = n
    ? { r: Math.round(nr / n), g: Math.round(ng / n), b: Math.round(nb / n) }
    : { r: 0x23, g: 0x2b, b: 0x36 };
  const navyInt = Jimp.rgbaToInt(navy.r, navy.g, navy.b, 255);
  const navyHex = '#' + [navy.r, navy.g, navy.b].map((x) => x.toString(16).padStart(2, '0')).join('');
  console.log('detected navy:', navyHex);

  // Flattened variant: recolor the near-black outer margin / rounded corners to
  // navy so the logo reads as a clean navy square (used for Android adaptive +
  // splash, where the masked/contained image would otherwise show black edges).
  const flat = src.clone();
  flat.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
    if (lum(r, g, b) < 28) {
      this.bitmap.data[idx] = navy.r;
      this.bitmap.data[idx + 1] = navy.g;
      this.bitmap.data[idx + 2] = navy.b;
      this.bitmap.data[idx + 3] = 255;
    }
  });

  // 1. iOS + Android base icon — original rounded logo, 1024 (device masks corners).
  await src.clone().resize(1024, 1024).writeAsync(path.join(OUT, 'icon.png'));

  // 2. Android adaptive foreground — flattened logo scaled into the ~66% safe
  //    zone, centered on the matching navy background.
  const ADAPT = 1024;
  const FG = Math.round(ADAPT * 0.66);
  const bg = new Jimp(ADAPT, ADAPT, navyInt);
  bg.composite(flat.clone().resize(FG, FG), Math.round((ADAPT - FG) / 2), Math.round((ADAPT - FG) / 2));
  await bg.writeAsync(path.join(OUT, 'adaptive-icon.png'));

  // 3. Splash icon — flattened navy logo (blends on the navy splash background).
  await flat.clone().resize(512, 512).writeAsync(path.join(OUT, 'splash-icon.png'));

  // 4. Web favicon — original rounded logo.
  await src.clone().resize(64, 64).writeAsync(path.join(OUT, 'favicon.png'));

  // 5. In-app square logo for headers — original rounded logo.
  await src.clone().resize(512, 512).writeAsync(path.join(OUT, 'gearops-logo.png'));

  // 6. Transparent mark (gear + G only, dark background removed) for placing on
  //    dark surfaces like the login hero, where the boxed logo would blend in.
  const mark = src.clone();
  mark.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
    const l = lum(r, g, b);
    const isWhite = l > 150;
    const isOrange = r > 130 && r - b > 55 && g > 40;
    if (isWhite || isOrange) {
      this.bitmap.data[idx + 3] = 255; // keep content
    } else {
      // Background → transparent. Set RGB to white so edge interpolation gives a
      // soft light edge rather than a dark halo on the navy hero.
      this.bitmap.data[idx] = 255;
      this.bitmap.data[idx + 1] = 255;
      this.bitmap.data[idx + 2] = 255;
      this.bitmap.data[idx + 3] = 0;
    }
  });
  mark.autocrop(); // trim the now-transparent margin
  const mw = mark.bitmap.width, mh = mark.bitmap.height;
  const side = Math.round(Math.max(mw, mh) * 1.08); // small even padding → square
  const canvas = new Jimp(side, side, 0x00000000);
  canvas.composite(mark, Math.round((side - mw) / 2), Math.round((side - mh) / 2));
  await canvas.resize(512, 512).writeAsync(path.join(OUT, 'gearops-mark.png'));

  console.log('Wrote: icon.png, adaptive-icon.png, splash-icon.png, favicon.png, gearops-logo.png');
  console.log('Set Android adaptive backgroundColor + splash backgroundColor to', navyHex);
  console.log('Left untouched: notification-icon.png (must stay a white silhouette).');
})().catch((e) => { console.error(e); process.exit(1); });
