import type { GameAdapter } from './types.js';
import { genericAdapter } from './generic/index.js';
import { vhAdapter } from './vh/index.js';
import { cod4Adapter } from './cod4/index.js';

const registry: Record<string, GameAdapter> = {
    vh: vhAdapter,
    cod4: cod4Adapter,
};

export function getGameAdapter(shortname: string): GameAdapter {
    return registry[shortname] ?? genericAdapter;
}
