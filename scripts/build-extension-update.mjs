import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const extensionDir = path.join(rootDir, 'extension');
const registryPublicDir = path.join(rootDir, 'registry', 'public');
const downloadsDir = path.join(registryPublicDir, 'downloads');
const updatesDir = path.join(registryPublicDir, 'updates');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

const version = String(manifest.version || '0.0.0');
const fileName = `Trackify-Extension-v${version}.zip`;
const zipPath = path.join(downloadsDir, fileName);
const latestZipPath = path.join(downloadsDir, 'Trackify-Extension-latest.zip');
const updateManifestPath = path.join(updatesDir, 'extension.json');

fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(updatesDir, { recursive: true });

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.glob('**/*', {
        cwd: extensionDir,
        ignore: ['**/.DS_Store']
    });
    archive.finalize();
});

fs.copyFileSync(zipPath, latestZipPath);

const metadata = {
    product: 'trackify-extension',
    version,
    released_at: new Date().toISOString(),
    file_name: fileName,
    download_url: `/downloads/${fileName}`,
    latest_download_url: '/downloads/Trackify-Extension-latest.zip',
    install_hint: 'Windows tarafinda store disi Chrome uzantisi otomatik kurulmaz. Kullanici chrome://extensions ekraninda Gelistirici modu ile ZIP icindeki klasoru yuklemeli veya mevcut uzanti klasorunu guncelleyip Yenile butonuna basmalidir.',
    notes: 'Yeni uzanti paketi manuel yukleme icin hazirlandi.'
};

fs.writeFileSync(updateManifestPath, JSON.stringify(metadata, null, 2));
console.log(`Extension update package created:
- ${zipPath}
- ${updateManifestPath}`);
