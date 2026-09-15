const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const iconsDir = path.join(__dirname, "public", "icons");
const master = fs.readFileSync(path.join(iconsDir, "zeroemit.svg"));
const maskable = fs.readFileSync(path.join(iconsDir, "zeroemit-maskable.svg"));

const jobs = [
  ["icon-192.png", master, 192],
  ["icon-512.png", master, 512],
  ["icon-maskable-512.png", maskable, 512],
  ["apple-touch-icon-180.png", master, 180],
];

// Next.js's `favicon.ico` file convention always wins a <link rel="icon">
// slot in <head>, regardless of what app/layout.tsx's metadata.icons says —
// so it needs to be the real brand icon, not the create-next-app default.
// Modern browsers/OS accept PNG-in-ICO (no BMP encoding needed); this packs
// a couple of rasterized sizes into a minimal ICONDIR container by hand
// since sharp has no native .ico writer.
async function buildFavicon() {
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) => sharp(master).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const dirEntries = [];
  for (let i = 0; i < images.length; i += 1) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // width
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // height
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // offset from file start
    dirEntries.push(entry);
    offset += images[i].length;
  }
  fs.writeFileSync(path.join(__dirname, "src", "app", "favicon.ico"), Buffer.concat([header, ...dirEntries, ...images]));
  console.log("wrote favicon.ico", sizes.join("/"));
}

(async () => {
  for (const [file, svg, size] of jobs) {
    await sharp(svg).resize(size, size).png().toFile(path.join(iconsDir, file));
    console.log("wrote", file, size);
  }
  await buildFavicon();
})().catch((e) => { console.error(e); process.exit(1); });