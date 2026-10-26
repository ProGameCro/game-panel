import { serverMemberRepository } from '../database/index.js';

// Which servers a user may see at all: Super Admins every server, everybody else only the servers they were given
// (User Administration, or the owner chosen when the server was made). Lists, live updates, metrics and log streams
// use this, so a user never learns about other people's servers.
export async function buildServerMemberVisibility(
    user: { userId?: number; isRoot?: boolean } | undefined
): Promise<(serverId: number) => boolean> {
    if (user?.isRoot) return () => true;
    if (!user?.userId) return () => false;
    const memberships = (await serverMemberRepository.listByUser(user.userId)) as Array<{ server_id: number }>;
    const allowed = new Set(memberships.map((m) => Number(m.server_id)));
    return (serverId: number) => allowed.has(Number(serverId));
}

export async function canSeeServer(user: { userId?: number; isRoot?: boolean } | undefined, serverId: number): Promise<boolean> {
    return (await buildServerMemberVisibility(user))(serverId);
}
