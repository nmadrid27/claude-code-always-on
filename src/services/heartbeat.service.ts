/**
 * Heartbeat Service
 *
 * This service maintains a heartbeat file that launchd monitors to ensure
 * the bot is still running. The heartbeat is updated every 5 minutes.
 *
 * launchd ExitTimeOut is set to 1800 seconds (30 minutes), so as long as
 * we update the heartbeat file more frequently than that, launchd will
 * consider the service healthy.
 */

import fs from 'fs/promises';
import path from 'path';

const HEARTBEAT_FILE = path.join(process.cwd(), 'logs', 'heartbeat.timestamp');
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Update the heartbeat timestamp file
 */
async function updateHeartbeat(): Promise<void> {
    try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        await fs.writeFile(HEARTBEAT_FILE, timestamp, 'utf-8');
    } catch (error) {
        console.error('[Heartbeat] Failed to update heartbeat file:', error);
    }
}

/**
 * Start the heartbeat service
 */
export function startHeartbeat(): void {
    // Update immediately
    updateHeartbeat().catch(console.error);

    // Set up interval
    heartbeatTimer = setInterval(() => {
        updateHeartbeat().catch(console.error);
    }, HEARTBEAT_INTERVAL);

    console.log('[Heartbeat] Service started (updating every 5 minutes)');
}

/**
 * Stop the heartbeat service
 */
export function stopHeartbeat(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        console.log('[Heartbeat] Service stopped');
    }
}

/**
 * Get the last heartbeat timestamp
 */
export async function getLastHeartbeat(): Promise<number | null> {
    try {
        const content = await fs.readFile(HEARTBEAT_FILE, 'utf-8');
        return parseInt(content.trim(), 10);
    } catch {
        return null;
    }
}

/**
 * Check if the heartbeat is stale (older than a given threshold)
 */
export async function isHeartbeatStale(maxAgeSeconds: number): Promise<boolean> {
    const lastHeartbeat = await getLastHeartbeat();
    if (!lastHeartbeat) return true;

    const now = Math.floor(Date.now() / 1000);
    const age = now - lastHeartbeat;
    return age > maxAgeSeconds;
}
