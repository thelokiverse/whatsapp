const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const TOKEN_EXPIRY = '7d';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function findByEmail(email) {
  const { rows } = await pool.query('select * from caregiver_users where email = $1', [email]);
  return rows[0] || null;
}

async function verifyCredentials(email, password) {
  const user = await findByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? user : null;
}

function generateToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { hashPassword, findByEmail, verifyCredentials, generateToken, verifyToken };
