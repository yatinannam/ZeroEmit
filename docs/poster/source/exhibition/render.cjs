// Prints poster.html to A1-A4 PDFs (vector, scaled from the A1 canvas) and
// 150 dpi PNGs into docs/poster/.
//   NODE_PATH=<dir containing playwright-core> node render.cjs
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");

const CANVAS = { width: 2245, height: 3178 }; // A1 at 96 px/in
const CANVAS_MM = { width: (CANVAS.width * 25.4) / 96, height: (CANVAS.height * 25.4) / 96 };
const SIZES = { A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
const OUT = path.resolve(__dirname, "..", "..");

(async () => {
  const browser = await chromium.launch();
  const url = pathToFileURL(path.join(__dirname, "poster.html")).href;
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    // A-sizes share one aspect ratio; the tiny shortfall keeps it on one page.
    const scale = Math.min(w / CANVAS_MM.width, h / CANVAS_MM.height) * 0.9995;
    const page = await browser.newPage({ viewport: CANVAS });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: path.join(OUT, `ZeroEmit-poster-${name}.pdf`), width: `${w}mm`, height: `${h}mm`, scale, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: "1" });
    await page.close();

    const png = await browser.newPage({ viewport: CANVAS, deviceScaleFactor: ((w / 25.4) * 150) / CANVAS.width });
    await png.goto(url, { waitUntil: "networkidle" });
    await png.evaluate(() => document.fonts.ready);
    await png.screenshot({ path: path.join(OUT, `ZeroEmit-poster-${name}.png`) });
    await png.close();
    console.log(name, "done");
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
