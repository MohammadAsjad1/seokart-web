const express = require("express");
const { body } = require("express-validator");
const { 
  register, 
  login, 
  googleAuth, 
  profile, 
  logout,
  completeSetup 
} = require("../controllers/authController");
const { auth } = require("../middleware/authMiddleware");

const router = express.Router();

// Traditional auth routes
// router.post("/signup", [
//   body("username")
//     .trim()
//     .notEmpty().withMessage("Name is required")
//     .isLength({ min: 2 }).withMessage("Name too short"),
//   body("email")
//     .trim()
//     .isEmail().withMessage("Invalid email format")
//     .normalizeEmail(),
//   body("password")
//     .isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
// ], register);

// router.post("/login", [
//   body("email")
//     .trim()
//     .isEmail().withMessage("Invalid email format")
//     .normalizeEmail(),
//   body("password")
//     .notEmpty().withMessage("Password is required"),
// ], login);

// Google OAuth route
// router.post("/google", googleAuth);

// Protected routes
// router.post("/logout", auth, logout);
router.get("/profile", auth, profile);
router.post('/complete-setup', auth, completeSetup);


module.exports = router;