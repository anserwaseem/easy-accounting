// Check if the renderer and main bundles are built
import path from 'path';
import chalk from 'chalk';
import fs from 'fs';
import webpackPaths from '../configs/webpack.paths';

// unit tests compile sources via ts-jest. this file is a local-dev
// guard so `npm test` on a clean clone fails loudly. CI never webpack-
// builds the electron app before jest.
if (process.env.CI) {
  // eslint-disable-next-line no-console
  console.log('Skipping webpack dist check on CI.');
} else {
  const mainPath = path.join(webpackPaths.distMainPath, 'main.js');
  const rendererPath = path.join(webpackPaths.distRendererPath, 'renderer.js');

  if (!fs.existsSync(mainPath)) {
    throw new Error(
      chalk.whiteBright.bgRed.bold(
        'The main process is not built yet. Build it by running "npm run build:main"',
      ),
    );
  }

  if (!fs.existsSync(rendererPath)) {
    throw new Error(
      chalk.whiteBright.bgRed.bold(
        'The renderer process is not built yet. Build it by running "npm run build:renderer"',
      ),
    );
  }
}
