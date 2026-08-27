const fs = require("fs");
let sharp;
try { sharp = require("sharp"); } catch (e) { console.log("require-fail", e.code, e.message); process.exit(2); }
sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .png()
  .toBuffer()
  .then((b) => { console.log("sharp-ok", b.length); return sharp(Buffer.from(fs.readFileSync("src/app/../public/icons/zeroemit.svg"))).resize(196).png().toBuffer(); })
  .then((b) => { fs.writeFileSync("__io_test.png", b); console.log("svg-rasterize-ok", b.length); })
  .catch((e) => console.log("sharp-err", e.message));