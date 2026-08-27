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

(async () => {
  for (const [file, svg, size] of jobs) {
    await sharp(svg).resize(size, size).png().toFile(path.join(iconsDir, file));
    console.log("wrote", file, size);
  }
})().catch((e) => { console.error(e); process.exit(1); });