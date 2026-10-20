'use strict';
// Preserve the existing parser functions and metadata with unchanged Next16.3.8.
const parser = require('next/dist/compiled/babel/eslint-parser');
const { version } = require('next/package.json');
module.exports = { parse: parser.parse, parseForESLint: parser.parseForESLint, meta: { name: 'eslint-config-next/parser', version } };
