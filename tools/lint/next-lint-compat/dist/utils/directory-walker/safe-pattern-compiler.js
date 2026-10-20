'use strict';
const picomatch = require('picomatch');
const boundedBraces = require('./bounded-braces');

// These are precisely the three micromatch APIs used by fast-glob3.3.1.
// scan/makeRe retain the same picomatch version as the original lockfile.
exports.scan = (...args) => picomatch.scan(...args);
exports.makeRe = (...args) => picomatch.makeRe(...args);
exports.braces = (pattern, options) => {
  if (typeof pattern !== 'string') throw new TypeError('Expected a string');
  if (options?.expand !== true || options?.nodupes !== true || Object.keys(options).some(key => !['expand', 'nodupes'].includes(key))) {
    throw new Error('Unsupported Next lint brace-expansion contract');
  }
  return boundedBraces(pattern, options);
};
