import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import babel from '@rollup/plugin-babel';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json'));
const external = Object.keys(pkg.dependencies || {}).concat(['fs/promises', 'child_process', 'path']);

const extensions = ['.js', '.ts'];

export default {
  input: 'src/main.ts',
  output: [
    {
      file: './bin/cli.mjs',
      format: 'esm',
      banner: '#!/usr/bin/env node',
    },
  ],
  external,
  plugins: [
    nodeResolve({
      extensions,
      modulesOnly: true,
    }),
    json(),
    typescript(),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
      extensions,
    }),
  ],
};
