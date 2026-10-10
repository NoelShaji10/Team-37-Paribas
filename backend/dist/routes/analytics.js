"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get('/throughput', (_req, res) => {
    res.json({
        success: true,
        data: {
            metrics: [
                { time: '10:00', rowsPerSec: 1200 },
                { time: '10:15', rowsPerSec: 1450 },
                { time: '10:30', rowsPerSec: 1380 },
                { time: '10:45', rowsPerSec: 1600 }
            ]
        }
    });
});
exports.default = router;
