'use strict';
const walker = require('./directory-walker');
exports.globSync = function globSync(pattern, options) {
  if (typeof pattern !== 'string' || options?.onlyDirectories !== true || Object.keys(options).some(key => key !== 'onlyDirectories')) throw new Error('Unsupported Next lint directory-glob contract');
  return walker.globSync(pattern, options);
};
