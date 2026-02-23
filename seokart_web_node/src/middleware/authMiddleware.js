const jwt = require("jsonwebtoken");

exports.auth = (req, res, next) => {


  let token = null;

  // Check all possible places for the token
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token') {
        token = value;
        break;
      }
    }
  }
  else if (req.header("Authorization")) {
    token = req.header("Authorization").replace("Bearer ", "");
  }

  if (!token) {

    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};

exports.adminAuth = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Access denied" });
  next();
};