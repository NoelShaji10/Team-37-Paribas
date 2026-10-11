import { Router } from 'express';
import { getDashboardSummary,getDashboardSummarySSE } from '../controllers/dashboardController';


const router = Router();

router.get('/summary', getDashboardSummary);
router.get('/summarySSE', getDashboardSummarySSE);

export default router;
