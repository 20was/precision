// Original Precision mark. PNG is required for Chromium manifest icons.
import { PNG } from "pngjs";
import { writeFile } from "node:fs/promises";
for (const size of [16, 32, 48, 128]) {
  const image = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) * 128) / size,
        py = ((y + 0.5) * 128) / size;
      const rounded =
        Math.hypot(
          Math.max(28 - px, px - 100, 0),
          Math.max(28 - py, py - 100, 0),
        ) <= 28;
      const edge =
        (px >= 25 &&
          px < 35 &&
          ((py >= 25 && py < 48) || (py >= 80 && py < 103))) ||
        (px >= 93 &&
          px < 103 &&
          ((py >= 25 && py < 48) || (py >= 80 && py < 103))) ||
        (py >= 25 &&
          py < 35 &&
          ((px >= 25 && px < 48) || (px >= 80 && px < 103))) ||
        (py >= 93 &&
          py < 103 &&
          ((px >= 25 && px < 48) || (px >= 80 && px < 103)));
      const center = px >= 52 && px < 76 && py >= 52 && py < 76;
      const color = center
        ? [255, 255, 255]
        : edge
          ? [239, 238, 232]
          : [36, 36, 33];
      const index = (y * size + x) * 4;
      image.data.set([...color, rounded ? 255 : 0], index);
    }
  await writeFile(`public/icons/precision-${size}.png`, PNG.sync.write(image));
}
