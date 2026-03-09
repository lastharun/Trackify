import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const sourcePng = path.join(rootDir, 'extension', 'icon.png');
const buildDir = path.join(rootDir, 'desktop', 'build');
const iconsetDir = path.join(buildDir, 'Trackify.iconset');
const icnsPath = path.join(buildDir, 'icon.icns');
const icoPath = path.join(buildDir, 'icon.ico');

const sizes = [16, 32, 64, 128, 256, 512];

fs.mkdirSync(buildDir, { recursive: true });

const pngBuffers = await Promise.all(
    [16, 24, 32, 48, 64, 128, 256].map((size) => {
        const output = path.join(os.tmpdir(), `trackify-${size}.png`);
        if (process.platform === 'darwin') {
            execFileSync('sips', ['-z', String(size), String(size), sourcePng, '--out', output], { stdio: 'ignore' });
            return fs.promises.readFile(output);
        }
        return fs.promises.readFile(sourcePng);
    })
);

const icoBuffer = await pngToIco(pngBuffers);
await fs.promises.writeFile(icoPath, icoBuffer);

if (process.platform === 'darwin') {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
    fs.mkdirSync(iconsetDir, { recursive: true });

    for (const size of sizes) {
        const oneX = path.join(iconsetDir, `icon_${size}x${size}.png`);
        const twoX = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);

        execFileSync('sips', ['-z', String(size), String(size), sourcePng, '--out', oneX], { stdio: 'ignore' });
        execFileSync('sips', ['-z', String(size * 2), String(size * 2), sourcePng, '--out', twoX], { stdio: 'ignore' });
    }

    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'ignore' });
}

console.log(`Desktop assets generated:
- ${icoPath}`);
