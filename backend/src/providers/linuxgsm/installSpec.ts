import { getLinuxGsmGameForInstall } from '../../services/linuxGsmManifest.js';
import { normalizeMountsPayload } from '../../utils/mounts.js';
import { asOptionalString, normalizeEnvPayload } from '../installPayload.js';
import type { ProviderInstallContext, ResolvedInstallSpec } from '../installTypes.js';
import { getProviderRuntimeIdentity, runtimeConfigForIdentity } from '../runtimeIdentity.js';
import { assertCod4FilesReady, COD4_LOCAL_IMAGE } from './adapters/cod4/index.js';

function normalizeLinuxGsmEnv(payload: unknown): string[] {
    let env = normalizeEnvPayload(payload);

    if (!env.some((entry) => /^UPDATE_CHECK=.+/.test(entry))) {
        env = env.filter((entry) => !entry.startsWith('UPDATE_CHECK='));
        env.push('UPDATE_CHECK=0');
    }

    return env;
}

// Call of Duty 4: no LinuxGSM update (a GitHub check) on every container start, so the server comes online quickly.
// UPDATE_ON_START can still be set in the server's environment variables.
function withCod4Defaults(shortname: string, env: string[]): string[] {
    if (shortname !== 'cod4' || env.some((entry) => entry.startsWith('UPDATE_ON_START='))) return env;
    return [...env, 'UPDATE_ON_START=false'];
}

export async function resolveLinuxGsmInstallSpec(
    ctx: ProviderInstallContext
): Promise<ResolvedInstallSpec> {
    const shortname = asOptionalString(ctx.body.shortname)?.trim() || '';
    if (!shortname) {
        throw Object.assign(new Error('Missing LinuxGSM shortname'), { statusCode: 400 });
    }

    const game = await getLinuxGsmGameForInstall(shortname);
    // Call of Duty 4 installs only from the local cod4-linux folder and image: refuse before anything starts
    if (game.shortname === 'cod4') await assertCod4FilesReady();
    const mounts = normalizeMountsPayload(ctx.body.mounts) ?? [];
    const runtimeIdentity = getProviderRuntimeIdentity('linuxgsm');

    return {
        provider: 'linuxgsm',
        catalogId: game.shortname,
        dockerImage: game.shortname === 'cod4' ? COD4_LOCAL_IMAGE : game.docker_image,
        ports: ctx.ports,
        healthcheck: ctx.healthcheck,
        resourceLimits: ctx.resourceLimits,
        mounts,
        env: withCod4Defaults(game.shortname, normalizeLinuxGsmEnv(ctx.body.env)),
        runtimeIdentity,
        runtimeConfig: runtimeConfigForIdentity(runtimeIdentity, '/data', '/app'),
        providerMetadata: {
            shortname: game.shortname,
            gameservername: game.gameservername,
            gamename: game.gamename,
            os: game.os,
        },
        steamCredentials: ctx.steamCredentials,
    };
}
