/**
 * Base webpack config used across other specific configs
 */

import webpack from 'webpack';
import TsconfigPathsPlugins from 'tsconfig-paths-webpack-plugin';
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
import webpackPaths from './webpack.paths';
import { dependencies as externals } from '../../release/app/package.json';

const configuration: webpack.Configuration = {
  externals: [...Object.keys(externals || {})],

  stats: 'errors-only',

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
      {
        // You may need a more specific glob if you have other YAML files unrelated to Ensemble
        test: /\.yaml$/i,
        type: 'asset/source',
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: {
      type: 'commonjs2',
    },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
    fallback: {
      fs: false,
      path: false,
      zlib: false,
      stream: false,
      http: false,
      https: false,
      tty: false,
      os: false,
    },
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
    }),

    new NodePolyfillPlugin({
      excludeAliases: ['console'],
    }),

    new webpack.DefinePlugin({
      'process.env': Object.keys(process.env).reduce<Record<string, string>>(
        (env, key) => {
          env[key] = JSON.stringify(process.env[key]);
          return env;
        },
        {},
      ),
    }),
  ],
};

export default configuration;
