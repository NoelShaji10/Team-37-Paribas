"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const resolutionController_1 = require("../controllers/resolutionController");
const router = (0, express_1.Router)();
router.get('/pending', resolutionController_1.getPendingRejections);
router.post('/:id/resolve', resolutionController_1.resolveRejection);
exports.default = router;
