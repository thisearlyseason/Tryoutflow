'use strict';
// Delegate parser functions and metadata to the pinned Next runtime (verified 16.4.1).
const parser = require('next/dist/compiled/babel/eslint-parser');
const { version } = require('next/package.json');
module.exports = { parse: parser.parse, parseForESLint: parser.parseForESLint, meta: { name: 'eslint-config-next/parser', version } };
