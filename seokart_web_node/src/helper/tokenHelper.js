function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      storeHash: user.store_hash,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function getSessionExpiresAt() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

module.exports = { generateToken, getSessionExpiresAt };
