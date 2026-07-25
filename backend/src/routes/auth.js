const express = require('express');
const { verifyCredentials, generateToken } = require('../services/caregiverAuth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await verifyCredentials(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    return res.json({ token, email: user.email });
  })
);

module.exports = router;
