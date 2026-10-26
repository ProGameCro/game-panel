import { Router, type Response } from 'express';
import { checkCod4Files } from '../providers/linuxgsm/adapters/cod4/index.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

// Call of Duty 4: are the game files (cod4-linux folder) and the local image ready? Shown in the install form.
const router = Router();

router.get('/files', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        res.json(await checkCod4Files());
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Could not check the CoD4 files' });
    }
});

export default router;
