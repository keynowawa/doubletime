import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

const filesToConvert = [
  'public/assets/cover.png' // Wait, cover.png is in the root directory from earlier prompts.
];

async function optimizeImages() {
  const rootCover = 'cover.png';
  try {
    await fs.access(rootCover);
    filesToConvert.push(rootCover);
  } catch (e) {
    // try public/assets/cover.png
  }

  for (const file of filesToConvert) {
    try {
      const inputPath = file;
      const basename = path.basename(file, '.png');
      const outputPath = path.join('public/assets', `${basename}.webp`);

      console.log(`Converting ${file} to ${outputPath}...`);
      await sharp(inputPath)
        .webp({ quality: 80 })
        .toFile(outputPath);
      console.log(`Successfully converted ${file}`);
    } catch (e) {
      console.error(`Failed to convert ${file}:`, e);
    }
  }
}

optimizeImages();
