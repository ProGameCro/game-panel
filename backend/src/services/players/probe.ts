import type { GameServerRow } from '../../types/gameServer.js';
import { getOvhcloudServerAdapter } from '../../providers/ovhcloud/adapters/registry.js';
import type { OvhcloudPlayersSupport } from '../../providers/ovhcloud/adapters/types.js';
import { buildServerNetworkAlias } from '../../utils/docker.js';
import type { PlayersSample } from './types.js';
import { getStatus } from '../cod4/tools.js';

// Call of Duty 4 (LinuxGSM): the server's own getstatus answer
const isCod4 = (server: GameServerRow) => server.provider === 'linuxgsm' && server.catalog_id === 'cod4';

function getPlayersSupport(server: GameServerRow): OvhcloudPlayersSupport | null {
    if (server.provider !== 'ovhcloud') return null;

    try {
        return getOvhcloudServerAdapter(server).players ?? null;
    } catch {
        return null;
    }
}

export function supportsPlayerQuery(server: GameServerRow): boolean {
    return isCod4(server) || getPlayersSupport(server) !== null;
}

export function getPlayersQueryIntervalMs(server: GameServerRow): number {
    return getPlayersSupport(server)?.minIntervalMs ?? 0;
}

export async function probeServerPlayers(server: GameServerRow): Promise<PlayersSample | null> {
    if (isCod4(server)) {
        const status = await getStatus(server, 1500);
        return status ? { online: status.players.length, max: status.maxPlayers, names: status.players.map((p) => p.name) } : null;
    }
    const support = getPlayersSupport(server);
    if (!support) return null;

    const port = support.resolvePort(server);
    if (!port) return null;

    const sample = await support.query(server, { host: buildServerNetworkAlias(server.id), port });
    const value = support.sanitize ? support.sanitize(server, sample) : sample;
    if (!value) return null;

    if (value.online === null && value.max === null && value.names === null) return null;

    return value;
}
