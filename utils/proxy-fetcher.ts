import axios from 'axios';
import fs from 'fs';
import path from 'path';

const PROXY_LIST_URL = 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt';
const CACHE_FILE = path.join(process.cwd(), 'logs', 'proxies.txt');
const CACHE_TTL = 3600 * 1000; // 1 hour

export async function getPublicProxies(): Promise<string[]> {
    try {
        // Check cache
        if (fs.existsSync(CACHE_FILE)) {
            const stats = fs.statSync(CACHE_FILE);
            if (Date.now() - stats.mtimeMs < CACHE_TTL) {
                const data = fs.readFileSync(CACHE_FILE, 'utf-8');
                return data.split('\n').filter(p => p.trim());
            }
        }

        console.log('Fetching fresh proxy list...');
        const response = await axios.get(PROXY_LIST_URL);
        const proxies = response.data.split('\n').filter((p: string) => p.trim());

        // Ensure logs dir exists
        const logsDir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        fs.writeFileSync(CACHE_FILE, proxies.join('\n'));
        return proxies;
    } catch (err) {
        console.error('Failed to fetch proxies:', err);
        return [];
    }
}

export async function getRandomProxy() {
    const proxies = await getPublicProxies();
    if (proxies.length === 0) return null;
    const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
    return {
        server: `socks5://${randomProxy.trim()}`
    };
}
