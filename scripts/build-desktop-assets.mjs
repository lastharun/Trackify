import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const sourcePng = path.join(rootDir, 'extension', 'icon.png');
const buildDir = path.join(rootDir, 'desktop', 'build');
const buildMetaPath = path.join(rootDir, 'desktop', 'build-meta.json');
const iconsetDir = path.join(buildDir, 'Trackify.iconset');
const icnsPath = path.join(buildDir, 'icon.icns');
const icoPath = path.join(buildDir, 'icon.ico');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const sizes = [16, 32, 64, 128, 256, 512];

fs.mkdirSync(buildDir, { recursive: true });

function resolveGitCommit() {
    try {
        return String(process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' })).trim();
    } catch {
        return 'unknown';
    }
}

const pngBuffers = await Promise.all(
    [16, 24, 32, 48, 64, 128, 256].map((size) =>
        sharp(sourcePng)
            .resize(size, size, { fit: 'contain' })
            .png()
            .toBuffer()
    )
);

const icoBuffer = await pngToIco(pngBuffers);
await fs.promises.writeFile(icoPath, icoBuffer);

const buildMeta = {
    product: 'trackify-desktop',
    version: String(packageJson.version || '0.0.0'),
    build_id: resolveGitCommit(),
    built_at: new Date().toISOString()
};

await fs.promises.writeFile(buildMetaPath, JSON.stringify(buildMeta, null, 2));

if (process.platform === 'darwin') {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
    fs.mkdirSync(iconsetDir, { recursive: true });

    for (const size of sizes) {
        const oneX = path.join(iconsetDir, `icon_${size}x${size}.png`);
        const twoX = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);

        await sharp(sourcePng).resize(size, size, { fit: 'contain' }).png().toFile(oneX);
        await sharp(sourcePng).resize(size * 2, size * 2, { fit: 'contain' }).png().toFile(twoX);
    }

    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'ignore' });
}

console.log(
    `Desktop assets generated:\n` +
    `${process.platform === 'darwin' ? `- ${icnsPath}\n` : ''}` +
    `- ${icoPath}\n` +
    `- ${buildMetaPath}`
);
