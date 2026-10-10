import { Router } from 'express';
import { getPendingRejections, resolveRejection } from '../controllers/resolutionController';

const router = Router();

router.get('/pending', getPendingRejections);
router.post('/:id/resolve', resolveRejection);
router.get('/test',(req,res) =>{
    res.send("okay")
})

export default router;