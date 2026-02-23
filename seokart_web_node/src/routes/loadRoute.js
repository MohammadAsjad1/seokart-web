const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const signed = req.query.signed_payload_jwt;

    if (!signed) return res.status(400).json({ success: false });

    const payload = jwt.verify(signed, process.env.BIG_COMMERCE_CLIENT_SECRET, {
      algorithms: ["HS256"],
    });


    if(!payload) return res.status(401).json({ success: false, message:"Invalid request" });

    const user = await User.findOne({
      store_hash: payload.sub.replace("stores/", ""),
    }).select("-access_token");

    if (!user) return res.status(401).json({ success: false });

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      {
        id: user._id,
        storeHash: user.store_hash,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      expires: sessionExpiresAt,
    });
    res.cookie("sessionExpiresAt", sessionExpiresAt, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      expires: sessionExpiresAt,
    });


    return res.json({
      success: true,
      data: {
        user: { ...user.toObject(), needsSetup: user.needsSetup() },
        token,
        sessionExpiresAt,
      },
    });
  } catch(err) {
    res.status(401).json({ success: false });
  }
});

module.exports = router;
