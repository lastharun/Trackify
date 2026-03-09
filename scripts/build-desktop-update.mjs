import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const releaseDir = path.join(rootDir, 'release');
const registryPublicDir = path.join(rootDir, 'registry', 'public');
const downloadsDir = path.join(registryPublicDir, 'downloads');
const updatesDir = path.join(registryPublicDir, 'updates');
const buildMetaPath = path.join(rootDir, 'desktop', 'build-meta.json');
const packageJsonPath = path.join(rootDir, 'package.json');

function ensureFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Gerekli dosya bulunamadi: ${filePath}`);
    }
    return filePath;
}

function normalizeName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function parseLatestYml(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const versionMatch = raw.match(/^version:\s*(.+)$/m);
    const pathMatch = raw.match(/^\s*path:\s*(.+)$/m);
    const shaMatch = raw.match(/^\s*sha512:\s*(.+)$/m);
    return {
        version: versionMatch ? String(versionMatch[1]).trim() : null,
        path: pathMatch ? String(pathMatch[1]).trim() : null,
        sha512: shaMatch ? String(shaMatch[1]).trim() : null
    };
}

const buildMeta = fs.existsSync(buildMetaPath)
    ? JSON.parse(fs.readFileSync(buildMetaPath, 'utf8'))
    : {};
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const latestYmlPath = ensureFile(path.join(releaseDir, 'latest.yml'));
const latest = parseLatestYml(latestYmlPath);
const releaseFiles = fs.readdirSync(releaseDir);
const installerSourceName =
    releaseFiles.find((name) => name === latest.path) ||
    releaseFiles.find((name) => normalizeName(name) === normalizeName(latest.path)) ||
    latest.path ||
    releaseFiles.find((name) => name.toLowerCase().endsWith('.exe'));

if (!installerSourceName) {
    throw new Error('Release klasorunde Windows installer bulunamadi.');
}

const installerSourcePath = ensureFile(path.join(releaseDir, installerSourceName));
const version = String(latest.version || buildMeta.version || packageJson.version || '0.0.0');
const buildId = String(buildMeta.build_id || 'unknown').trim();
const fileName = `Trackify-Desktop-Setup-v${version}.exe`;
const latestFileName = 'Trackify-Desktop-Setup-latest.exe';
const latestYmlTargetName = 'Trackify-Desktop-latest.yml';
const installerTargetPath = path.join(downloadsDir, fileName);
const latestInstallerTargetPath = path.join(downloadsDir, latestFileName);
const latestYmlTargetPath = path.join(downloadsDir, latestYmlTargetName);
const updateManifestPath = path.join(updatesDir, 'desktop.json');

fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(updatesDir, { recursive: true });

fs.copyFileSync(installerSourcePath, installerTargetPath);
fs.copyFileSync(installerTargetPath, latestInstallerTargetPath);
fs.copyFileSync(latestYmlPath, latestYmlTargetPath);

const metadata = {
    product: 'trackify-desktop',
    version,
    build_id: buildId,
    released_at: new Date().toISOString(),
    file_name: fileName,
    download_url: `/downloads/${fileName}`,
    latest_download_url: `/downloads/${latestFileName}`,
    latest_manifest_url: `/downloads/${latestYmlTargetName}`,
    sha512: latest.sha512 || null,
    notes: 'Masaustu guncelleme paketi hazir. Indirildikten sonra kurulum dosyasi calistirilabilir.'
};

fs.writeFileSync(updateManifestPath, JSON.stringify(metadata, null, 2));
console.log(`Desktop update package created:
- ${installerTargetPath}
- ${updateManifestPath}`);
