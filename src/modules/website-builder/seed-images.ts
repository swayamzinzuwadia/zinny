/**
 * Placeholder pictures for the demo site, drawn as SVG in the site's colours and turned into
 * PNG with sharp. Nothing is downloaded. Simple geometric scenes, no text and no faces.
 */
import sharp from "sharp";

const C = {
  navy: "#17365d",
  navyDeep: "#0e2340",
  navySoft: "#dfe6f0",
  cream: "#faf6ea",
  paper: "#fffdf7",
  gold: "#d4a72a",
  goldSoft: "#f7eccb",
  green: "#0b5e4c",
  greenMid: "#2f7d66",
  greenSoft: "#e3eee8",
  ink: "#14261f",
  line: "#e8e0cc",
  clay: "#c9b48a",
};

/** A small deterministic random generator, so the seed draws the same pictures every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

export async function toPng(markup: string): Promise<Buffer> {
  return sharp(Buffer.from(markup), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
}

function trees(r: () => number, xs: number[], baseY: number, scale = 1) {
  return xs
    .map((x) => {
      const s = (0.8 + r() * 0.5) * scale;
      const tone = [C.green, C.greenMid, "#245f4e"][Math.floor(r() * 3)];
      return `<rect x="${x - 8 * s}" y="${baseY - 70 * s}" width="${16 * s}" height="${80 * s}" fill="#5b4a33"/>
        <circle cx="${x}" cy="${baseY - 130 * s}" r="${85 * s}" fill="${tone}"/>
        <circle cx="${x - 55 * s}" cy="${baseY - 95 * s}" r="${55 * s}" fill="${tone}"/>
        <circle cx="${x + 55 * s}" cy="${baseY - 100 * s}" r="${60 * s}" fill="${tone}"/>`;
    })
    .join("");
}

/** The campus: a main hall with a clock tower, lawns and trees. Used as the cover. */
export function campusSvg() {
  const r = rng(7);
  const windows: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      const x = 760 + col * 112;
      const y = 720 + row * 160;
      const lit = r() > 0.72;
      windows.push(`<path d="M${x} ${y + 90} V${y + 30} a32 32 0 0 1 64 0 V${y + 90} Z" fill="${lit ? C.goldSoft : C.navySoft}"/>`);
    }
  }
  return svg(
    2400,
    1500,
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe7f1"/><stop offset="1" stop-color="${C.cream}"/></linearGradient></defs>
    <rect width="2400" height="1500" fill="url(#sky)"/>
    <circle cx="1980" cy="330" r="150" fill="${C.gold}" opacity="0.85"/>
    <ellipse cx="420" cy="1520" rx="1200" ry="330" fill="${C.greenMid}"/>
    <ellipse cx="2050" cy="1560" rx="1150" ry="330" fill="${C.green}"/>
    <rect x="1110" y="260" width="180" height="420" fill="${C.navyDeep}"/>
    <path d="M1090 270 L1200 150 L1310 270 Z" fill="${C.navy}"/>
    <circle cx="1200" cy="380" r="58" fill="${C.cream}"/>
    <path d="M1200 380 V340 M1200 380 L1228 396" stroke="${C.navyDeep}" stroke-width="10" stroke-linecap="round"/>
    <rect x="700" y="620" width="1000" height="620" fill="${C.navy}"/>
    <path d="M660 640 L1200 470 L1740 640 Z" fill="${C.navyDeep}"/>
    ${windows.join("")}
    <path d="M1130 1240 V1110 a70 70 0 0 1 140 0 V1240 Z" fill="${C.navyDeep}"/>
    <path d="M1150 1240 L1250 1240 L1420 1500 L980 1500 Z" fill="${C.clay}" opacity="0.9"/>
    ${trees(r, [230, 470, 560], 1300, 1.3)}
    ${trees(r, [1900, 2130, 2290], 1320, 1.25)}`,
  );
}

/** A crest: shield, open book and the gold dot. */
export function crestSvg() {
  return svg(
    512,
    512,
    `<path d="M256 28 L444 92 V250 C444 370 360 446 256 486 C152 446 68 370 68 250 V92 Z" fill="${C.navy}"/>
     <path d="M256 60 L414 114 V250 C414 352 344 418 256 452 C168 418 98 352 98 250 V114 Z" fill="none" stroke="${C.cream}" stroke-opacity="0.35" stroke-width="6"/>
     <path d="M140 210 C190 190 230 198 256 222 C282 198 322 190 372 210 V348 C322 330 282 336 256 356 C230 336 190 330 140 348 Z" fill="${C.cream}"/>
     <path d="M256 222 V356" stroke="${C.navy}" stroke-width="8"/>
     <circle cx="256" cy="150" r="26" fill="${C.gold}"/>`,
  );
}

type Scene = "library" | "lab" | "convocation" | "lawn" | "seminar" | "hackathon";

export function sceneSvg(scene: Scene, w = 1600, h = 1200) {
  const r = rng(scene.length * 97 + w);
  switch (scene) {
    case "library": {
      const shelves: string[] = [];
      for (let s = 0; s < 4; s++) {
        const y = 140 + s * 250;
        shelves.push(`<rect x="80" y="${y + 200}" width="${w - 160}" height="22" fill="#5b4a33"/>`);
        let x = 110;
        while (x < w - 140) {
          const bw = 28 + r() * 36;
          const bh = 120 + r() * 70;
          const tone = [C.navy, C.green, C.clay, C.navyDeep, C.greenMid, "#8c5a3c", C.gold][Math.floor(r() * 7)];
          shelves.push(`<rect x="${x}" y="${y + 200 - bh}" width="${bw}" height="${bh}" rx="4" fill="${tone}"/>`);
          x += bw + 6;
        }
      }
      return svg(w, h, `<rect width="${w}" height="${h}" fill="#f1e8d4"/>${shelves.join("")}<rect y="${h - 90}" width="${w}" height="90" fill="#d9c9a3"/>`);
    }
    case "lab": {
      const desks: string[] = [];
      for (let row = 0; row < 3; row++) {
        const y = 300 + row * 280;
        const scale = 0.8 + row * 0.18;
        for (let i = 0; i < 5; i++) {
          const x = 110 + i * 300 + (row % 2) * 60;
          const sw = 200 * scale;
          const sh = 130 * scale;
          const lit = r() > 0.5 ? C.greenSoft : C.navySoft;
          desks.push(`<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="12" fill="${C.ink}"/>
            <rect x="${x + 10 * scale}" y="${y + 10 * scale}" width="${sw - 20 * scale}" height="${sh - 26 * scale}" rx="6" fill="${lit}"/>
            <rect x="${x + 20 * scale}" y="${y + 30 * scale}" width="${(sw - 40 * scale) * (0.3 + r() * 0.6)}" height="${10 * scale}" rx="5" fill="${C.green}"/>
            <rect x="${x + 20 * scale}" y="${y + 52 * scale}" width="${(sw - 40 * scale) * (0.2 + r() * 0.6)}" height="${10 * scale}" rx="5" fill="${C.navy}"/>
            <rect x="${x + sw / 2 - 10}" y="${y + sh}" width="20" height="${30 * scale}" fill="${C.ink}"/>`);
        }
        desks.push(`<rect x="0" y="${y + 160 * scale}" width="${w}" height="${26 * scale}" fill="#b9a57b"/>`);
      }
      return svg(w, h, `<rect width="${w}" height="${h}" fill="${C.cream}"/><rect width="${w}" height="${h * 0.22}" fill="${C.navySoft}"/>${desks.join("")}`);
    }
    case "convocation": {
      const caps: string[] = [];
      for (let i = 0; i < 16; i++) {
        const x = 120 + r() * (w - 240);
        const y = 120 + r() * (h * 0.55);
        const s = 0.6 + r() * 0.9;
        const rot = -30 + r() * 60;
        caps.push(`<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
          <path d="M-90 0 L0 -40 L90 0 L0 40 Z" fill="${C.navyDeep}"/>
          <rect x="-40" y="10" width="80" height="45" rx="8" fill="${C.navy}"/>
          <path d="M60 4 V60" stroke="${C.gold}" stroke-width="6"/><circle cx="60" cy="66" r="9" fill="${C.gold}"/></g>`);
      }
      return svg(
        w,
        h,
        `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfdcee"/><stop offset="1" stop-color="${C.cream}"/></linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#s)"/>${caps.join("")}
        <rect y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="${C.navy}"/>
        <path d="M0 ${h * 0.8} Q ${w / 2} ${h * 0.72} ${w} ${h * 0.8}" fill="${C.navyDeep}"/>`,
      );
    }
    case "lawn": {
      return svg(
        w,
        h,
        `<rect width="${w}" height="${h}" fill="#e6edf3"/>
        <circle cx="${w * 0.2}" cy="${h * 0.22}" r="90" fill="${C.goldSoft}"/>
        <ellipse cx="${w * 0.3}" cy="${h * 1.05}" rx="${w * 0.8}" ry="${h * 0.48}" fill="${C.greenMid}"/>
        <ellipse cx="${w * 0.85}" cy="${h * 1.1}" rx="${w * 0.7}" ry="${h * 0.45}" fill="${C.green}"/>
        <path d="M${w * 0.46} ${h} C ${w * 0.5} ${h * 0.8}, ${w * 0.62} ${h * 0.72}, ${w * 0.7} ${h * 0.62} L ${w * 0.74} ${h * 0.62} C ${w * 0.7} ${h * 0.75}, ${w * 0.68} ${h * 0.86}, ${w * 0.72} ${h} Z" fill="${C.clay}"/>
        <rect x="${w * 0.62}" y="${h * 0.3}" width="${w * 0.3}" height="${h * 0.32}" fill="${C.navy}"/>
        <path d="M${w * 0.6} ${h * 0.32} L${w * 0.77} ${h * 0.2} L${w * 0.94} ${h * 0.32} Z" fill="${C.navyDeep}"/>
        ${trees(r, [w * 0.12, w * 0.3, w * 0.52], h * 0.78, 1.4)}
        ${trees(r, [w * 0.95], h * 0.72, 1.1)}`,
      );
    }
    case "seminar": {
      const rows: string[] = [];
      for (let i = 0; i < 6; i++) {
        const y = h * 0.52 + i * 95;
        const inset = 60 - i * 40;
        rows.push(`<path d="M${inset} ${y} Q ${w / 2} ${y - 70} ${w - inset} ${y}" stroke="${i % 2 ? C.navy : C.navyDeep}" stroke-width="54" fill="none" stroke-linecap="round"/>`);
        for (let k = 0; k < 9; k++) {
          const x = inset + 80 + k * ((w - 2 * inset - 160) / 8);
          const tone = [C.gold, C.green, C.clay, C.navySoft][Math.floor(r() * 4)];
          rows.push(`<circle cx="${x}" cy="${y - 64 + Math.abs(x - w / 2) * 0.06}" r="22" fill="${tone}"/>`);
        }
      }
      return svg(
        w,
        h,
        `<rect width="${w}" height="${h}" fill="#e9e2d0"/>
        <rect x="${w * 0.22}" y="${h * 0.08}" width="${w * 0.56}" height="${h * 0.3}" rx="16" fill="${C.paper}" stroke="${C.ink}" stroke-width="10"/>
        <path d="M${w * 0.3} ${h * 0.3} L${w * 0.4} ${h * 0.22} L${w * 0.5} ${h * 0.26} L${w * 0.62} ${h * 0.14} L${w * 0.7} ${h * 0.18}" fill="none" stroke="${C.green}" stroke-width="14" stroke-linejoin="round"/>
        ${rows.join("")}`,
      );
    }
    case "hackathon": {
      const items: string[] = [];
      for (let i = 0; i < 4; i++) {
        const x = 120 + (i % 2) * 720;
        const y = 220 + Math.floor(i / 2) * 470;
        items.push(`<rect x="${x}" y="${y + 200}" width="640" height="26" rx="8" fill="#8c6a43"/>
          <rect x="${x + 70}" y="${y + 40}" width="230" height="150" rx="10" fill="${C.ink}"/><rect x="${x + 82}" y="${y + 52}" width="206" height="122" rx="6" fill="${C.navySoft}"/>
          <rect x="${x + 50}" y="${y + 186}" width="270" height="18" rx="6" fill="#3c4a45"/>
          <rect x="${x + 360}" y="${y + 40}" width="230" height="150" rx="10" fill="${C.ink}"/><rect x="${x + 372}" y="${y + 52}" width="206" height="122" rx="6" fill="${C.greenSoft}"/>
          <rect x="${x + 340}" y="${y + 186}" width="270" height="18" rx="6" fill="#3c4a45"/>`);
      }
      const notes: string[] = [];
      for (let i = 0; i < 14; i++) {
        const tone = [C.goldSoft, C.greenSoft, C.navySoft, "#f3d9c9"][i % 4];
        notes.push(`<rect x="${80 + (i % 7) * 210}" y="${40 + Math.floor(i / 7) * 80}" width="70" height="60" rx="4" fill="${tone}" transform="rotate(${-6 + r() * 12} ${115 + (i % 7) * 210} ${70 + Math.floor(i / 7) * 80})"/>`);
      }
      return svg(w, h, `<rect width="${w}" height="${h}" fill="${C.cream}"/><rect width="${w}" height="200" fill="#eee5cf"/>${notes.join("")}${items.join("")}`);
    }
  }
}

type Cover = "placements" | "sql" | "weekend";

export function coverSvg(kind: Cover, w = 1800, h = 1100) {
  const r = rng(kind.length * 31);
  switch (kind) {
    case "placements": {
      const bars = [0.32, 0.45, 0.41, 0.58, 0.66, 0.79, 0.92]
        .map((v, i) => `<rect x="${200 + i * 200}" y="${h - 160 - v * (h - 360)}" width="120" height="${v * (h - 360)}" rx="14" fill="${i === 6 ? C.gold : i % 2 ? C.navy : "#2c5384"}"/>`)
        .join("");
      return svg(w, h, `<rect width="${w}" height="${h}" fill="${C.navySoft}"/><rect y="${h - 160}" width="${w}" height="4" fill="${C.navy}"/>${bars}<path d="M220 ${h - 360} L${w - 260} 220" stroke="${C.green}" stroke-width="12" stroke-dasharray="2 26" stroke-linecap="round"/>`);
    }
    case "sql": {
      const cells: string[] = [];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          const x = 180 + col * 230;
          const y = 200 + row * 105;
          const head = row === 0;
          cells.push(`<rect x="${x}" y="${y}" width="210" height="85" rx="10" fill="${head ? C.green : col === 2 && row === 4 ? C.goldSoft : C.paper}" stroke="${C.line}" stroke-width="3"/>`);
          if (!head) cells.push(`<rect x="${x + 22}" y="${y + 34}" width="${60 + r() * 110}" height="16" rx="8" fill="${C.greenSoft}"/>`);
        }
      }
      return svg(w, h, `<rect width="${w}" height="${h}" fill="${C.greenSoft}"/>${cells.join("")}<circle cx="${w - 230}" cy="${h / 2}" r="150" fill="none" stroke="${C.green}" stroke-width="22"/><path d="M${w - 125} ${h / 2 + 105} L${w - 40} ${h / 2 + 190}" stroke="${C.green}" stroke-width="30" stroke-linecap="round"/>`);
    }
    case "weekend": {
      const days: string[] = [];
      for (let i = 0; i < 28; i++) {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const x = 260 + col * 185;
        const y = 300 + row * 175;
        const weekend = col >= 5;
        days.push(`<rect x="${x}" y="${y}" width="160" height="150" rx="18" fill="${weekend ? C.navy : C.paper}" stroke="${C.line}" stroke-width="3"/>`);
        if (weekend) days.push(`<circle cx="${x + 120}" cy="${y + 36}" r="12" fill="${C.gold}"/>`);
      }
      return svg(w, h, `<rect width="${w}" height="${h}" fill="#efe6d1"/><rect x="220" y="180" width="${w - 440}" height="${h - 280}" rx="34" fill="${C.cream}"/><rect x="220" y="180" width="${w - 440}" height="90" rx="34" fill="${C.navyDeep}"/>${days.join("")}`);
    }
  }
}

/** A head-and-shoulders silhouette on a tinted ground (no face), for people's photos. */
export function portraitSvg(seed: number, size = 800) {
  const r = rng(seed);
  const grounds = [C.navySoft, C.greenSoft, C.goldSoft, "#efe6d1", "#e9e2f0"];
  const clothes = [C.navy, C.green, "#6b3f2a", C.navyDeep, "#3c4a45", "#7a3d66"];
  const skin = ["#8d5a3b", "#a86b45", "#c48a5c", "#6e4430", "#b97b52"][Math.floor(r() * 5)];
  const hair = ["#1d1611", "#2b1d14", "#3a2a1e", "#121212"][Math.floor(r() * 4)];
  const long = r() > 0.5;
  const s = size / 800;
  return svg(
    size,
    size,
    `<rect width="${size}" height="${size}" fill="${grounds[seed % grounds.length]}"/>
    <g transform="scale(${s})">
      ${long ? `<path d="M270 330 C250 470 280 560 300 600 L500 600 C520 560 550 470 530 330 Z" fill="${hair}"/>` : ""}
      <path d="M140 800 C150 640 260 580 400 580 C540 580 650 640 660 800 Z" fill="${clothes[Math.floor(r() * clothes.length)]}"/>
      <rect x="360" y="470" width="80" height="130" rx="30" fill="${skin}"/>
      <ellipse cx="400" cy="380" rx="128" ry="150" fill="${skin}"/>
      <path d="M268 360 C262 250 330 205 405 205 C490 205 545 260 532 360 C510 300 460 280 400 282 C340 284 292 305 268 360 Z" fill="${hair}"/>
    </g>`,
  );
}
