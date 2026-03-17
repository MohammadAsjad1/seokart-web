const fs = require('fs');
const path = require('path');

const appDir = __dirname;

function requireAllFromDir(dirPath) {
 const modules = {};
 const files = fs.readdirSync(dirPath);


 files.forEach(file => {
  const fullPath = path.join(dirPath, file);
  const stats = fs.statSync(fullPath);

  if (stats.isDirectory()) {
   modules[file] = requireAllFromDir(fullPath); // recurse into subfolders
  } else if (stats.isFile() && file.endsWith('.js') && file !== 'index.js') {
   const key = path.basename(file, '.js');
   modules[key] = require(fullPath);
  }
 });

 return modules;
}

module.exports = requireAllFromDir(appDir);