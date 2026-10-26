import { serverMemberRepository, userRepository } from '../database/index.js';
import { ASSIGNABLE_SERVER_PERMISSIONS, PERMISSIONS } from '../permissions.js';
import { hashPassword } from '../utils/auth.js';

// The owner of a new server (install form): an existing user, or a new one made right before the server. The owner
// gets the server with the permissions below; a Super Admin can change them later in User Administration.
// Not given: deleting the server, its environment (ports, secrets), a shell in its container and the hard wipe.
const NOT_FOR_OWNERS = new Set<string>([
    PERMISSIONS.server.delete,
    PERMISSIONS.server.env,
    PERMISSIONS.container.terminal,
    PERMISSIONS.server.wipe.hard,
]);

export const OWNER_PERMISSIONS: string[] = [...ASSIGNABLE_SERVER_PERMISSIONS].filter((p) => !NOT_FOR_OWNERS.has(p)).sort();

export type OwnerChoice = { kind: 'existing'; userId: number } | { kind: 'new'; username: string; password: string };

function bad(message: string, statusCode = 400): Error {
    return Object.assign(new Error(message), { statusCode });
}

// checks the form's owner fields (nothing is created yet); null when no owner was given
export async function parseOwnerChoice(body: Record<string, unknown>): Promise<OwnerChoice | null> {
    if (body.ownerUserId !== undefined && body.ownerUserId !== null && body.ownerUserId !== '') {
        const userId = Number(body.ownerUserId);
        const user = Number.isInteger(userId) ? await userRepository.findById(userId) : undefined;
        if (!user) throw bad('The chosen owner does not exist');
        return { kind: 'existing', userId };
    }
    const raw = body.newOwner as { username?: unknown; password?: unknown } | undefined;
    if (raw && typeof raw === 'object') {
        const username = typeof raw.username === 'string' ? raw.username.trim() : '';
        const password = typeof raw.password === 'string' ? raw.password : '';
        if (!username || username.length > 12) throw bad('Owner username: 1 to 12 characters');
        if (password.length < 8) throw bad('Owner password: at least 8 characters');
        if (await userRepository.findByUsername(username)) throw bad(`The user ${username} already exists: choose them from the list`, 409);
        return { kind: 'new', username, password };
    }
    return null;
}

// makes the new user (when asked for); returns the owner's id
export async function createOwnerIfNeeded(choice: OwnerChoice): Promise<number> {
    if (choice.kind === 'existing') return choice.userId;
    // the name may have been taken since the check
    if (await userRepository.findByUsername(choice.username)) throw bad(`The user ${choice.username} already exists`, 409);
    const id = await userRepository.create(choice.username, await hashPassword(choice.password), { globalPermissions: [] });
    if (!id) throw new Error('The owner could not be created');
    return id;
}

export async function giveServerToOwner(serverId: number, ownerId: number): Promise<void> {
    const owner = await userRepository.findById(ownerId);
    // a Super Admin sees every server anyway
    if (!owner || owner.is_root) return;
    if (await serverMemberRepository.find(serverId, ownerId)) await serverMemberRepository.update(serverId, ownerId, OWNER_PERMISSIONS);
    else await serverMemberRepository.create(serverId, ownerId, OWNER_PERMISSIONS);
}
