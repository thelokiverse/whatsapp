const express = require('express');
const { verifyCredentials, generateToken } = require('../services/caregiverAuth');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  res.json({ token, email: user.email });
});

module.exports = router;
