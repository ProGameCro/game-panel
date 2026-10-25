import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../../../../config.js';
import { logInfo, logWarn } from '../../../../utils/logger.js';
import { applyLinuxGsmConfigPatches } from '../linuxGsmConfig.js';
import { runGenericBeforeContainerCreate } from '../generic/index.js';
import type {
    AfterContainerStartContext,
    BeforeContainerCreateContext,
    GameAdapter,
} from '../types.js';

// Call of Duty 4: new servers start from a local copy of the game files (made from an existing server with
// gp-cod4-template.sh) instead of downloading them. The LinuxGSM image only installs when serverfiles is empty.
export function cod4TemplateDir(): string {
    return path.join(getConfig().gamepanelDataDir, 'templates', 'cod4', 'serverfiles');
}

async function isEmptyDir(dir: string): Promise<boolean> {
    const entries = await fs.readdir(dir).catch(() => null);
    return entries === null || entries.length === 0;
}

export async function copyCod4Template(dataDir: string): Promise<boolean> {
    const template = cod4TemplateDir();
    if (await isEmptyDir(template)) return false;
    const target = path.join(dataDir, 'serverfiles');
    if (!(await isEmptyDir(target))) return false;
    // FICLONE makes a copy-on-write clone where the filesystem supports it and a normal copy elsewhere
    await fs.cp(template, target, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    return true;
}

// slots chosen in the install form (COD4_MAXPLAYERS), written as LinuxGSM's maxplayers (+set sv_maxclients)
export function cod4MaxPlayers(env: string[] | undefined): number | null {
    const raw = (env ?? []).find((entry) => entry.startsWith('COD4_MAXPLAYERS='))?.slice('COD4_MAXPLAYERS='.length).trim() ?? '';
    const value = Number(raw);
    return /^\d+$/.test(raw) && value >= 1 && value <= 64 ? value : null;
}

export const cod4Adapter: GameAdapter = {
    async beforeContainerCreate(ctx: BeforeContainerCreateContext): Promise<void> {
        await runGenericBeforeContainerCreate(ctx);
        const slots = cod4MaxPlayers(ctx.env);
        if (slots !== null) {
            await applyLinuxGsmConfigPatches({ dataDir: ctx.dataDir, gameServerName: ctx.gameServerName }, [
                { fileName: `${ctx.gameServerName}.cfg`, values: { maxplayers: String(slots) } },
            ]);
        }
        try {
            if (await copyCod4Template(ctx.dataDir)) {
                logInfo('LINUXGSM:COD4', 'Game files copied from the local template, no download needed', { serverId: ctx.serverId });
            }
        } catch (error) {
            // a failed copy must not block the install: LinuxGSM then downloads the files as usual
            logWarn('LINUXGSM:COD4', `Could not copy the CoD4 template: ${error instanceof Error ? error.message : String(error)}`, {
                serverId: ctx.serverId,
            });
            await fs.rm(path.join(ctx.dataDir, 'serverfiles'), { recursive: true, force: true }).catch(() => undefined);
        }
    },
    async afterContainerStart(_ctx: AfterContainerStartContext): Promise<void> {
        return;
    },
};
