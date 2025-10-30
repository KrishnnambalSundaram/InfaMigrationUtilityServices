const path = require('path');

function isPathInside(parent, child) {
  const parentPath = path.resolve(parent) + path.sep;
  const childPath = path.resolve(child) + path.sep;
  return childPath.startsWith(parentPath);
}

function assertPathUnder(allowedRoots, candidatePath, errorMessage = 'Path not allowed') {
  const roots = Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots];
  const ok = roots.some(root => isPathInside(root, candidatePath));
  if (!ok) {
    const err = new Error(`${errorMessage}: ${candidatePath}`);
    err.code = 'PATH_OUTSIDE_ALLOWED_ROOTS';
    throw err;
  }
  return path.resolve(candidatePath);
}

module.exports = {
  isPathInside,
  assertPathUnder
};


