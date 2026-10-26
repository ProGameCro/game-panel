import { Router, type Response } from 'express';
import { authMiddleware, requireServerPermission, type AuthenticatedRequest } from '../middleware/auth.js';
import { PERMISSIONS } from '../permissions.js';
import { serverRepository } from '../database/index.js';
import { parsePositiveIntId } from '../utils/ids.js';
import { deleteFtpAccount, ensureFtpAccount, ftpInfo } from '../services/ftp.js';

// FTP / FTPS / SFTP access to one server's files (gp-ftp.sh): the address, the account and its password.
// Seeing it needs the server's file read permission, opening / resetting / closing it the file write permission.
const router = Router();

function fail(res: Response, error: unknown, fallback: string) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || 500;
    return res.status(statusCode).json({ error: error instanceof Error ? error.message : fallback });
}

async function serverId(req: AuthenticatedRequest): Promise<number> {
    const id = parsePositiveIntId(req.params.id);
    if (!id || !(await serverRepository.findById(id))) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    return id;
}

router.get('/:id', authMiddleware, requireServerPermission(PERMISSIONS.fs.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        return res.json(await ftpInfo(await serverId(req)));
    } catch (error) {
        return fail(res, error, 'Could not read the FTP account');
    }
});

// open the account, or { reset: true } for a new password
router.post('/:id', authMiddleware, requireServerPermission(PERMISSIONS.fs.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const id = await serverId(req);
        const account = await ensureFtpAccount(id, Boolean(req.body?.reset));
        res.locals.activityDetail = req.body?.reset ? `FTP password reset (${account.username})` : `FTP account ${account.username}`;
        return res.json(await ftpInfo(id));
    } catch (error) {
        return fail(res, error, 'Could not open the FTP account');
    }
});

router.delete('/:id', authMiddleware, requireServerPermission(PERMISSIONS.fs.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const id = await serverId(req);
        await deleteFtpAccount(id);
        res.locals.activityDetail = 'FTP account closed';
        return res.json(await ftpInfo(id));
    } catch (error) {
        return fail(res, error, 'Could not close the FTP account');
    }
});

export default router;
