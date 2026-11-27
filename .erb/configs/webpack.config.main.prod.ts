/**
 * Webpack config for production electron main process
 */

import path from "path";
import webpack from "webpack";
import { merge } from "webpack-merge";
import TerserPlugin from "terser-webpack-plugin";
import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";
import baseConfig from "./webpack.config.base";
import webpackPaths from "./webpack.paths";
import checkNodeEnv from "../scripts/check-node-env";
import deleteSourceMaps from "../scripts/delete-source-maps";
import { sentryWebpackPlugin } from "@sentry/webpack-plugin";

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

checkNodeEnv("production");
deleteSourceMaps();

export default merge(baseConfig, {
  devtool: 'source-map',

  mode: "production",

  target: "electron-main",

  entry: {
    main: path.join(webpackPaths.srcMainPath, "main.ts"),
    preload: path.join(webpackPaths.srcMainPath, "preload.js"),
  },

  output: {
    path: webpackPaths.distMainPath,
    filename: "[name].js",
  },

  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
        // Newer terser-webpack-plugin versions derive ES2020 from the Electron target; 5.3.x used ES2015.
        // Pin ES2015 so the update doesn't re-minify all shipped code (RQ-9421 B1).
        terserOptions: { ecma: 2015, compress: { ecma: 2015 } },
      }),
    ],
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode:
        process.env.OPEN_ANALYZER === "true" ? "server" : "disabled",
      openAnalyzer: process.env.OPEN_ANALYZER === "true",
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: "production",
      DEBUG_PROD: false,
      START_MINIMIZED: false,
      IS_SETAPP_BUILD: false,
    }),

    sentryWebpackPlugin({
      org: "requestly",
      project: "desktop-app",
      authToken: process.env.SENTRY_AUTH_TOKEN,

      sourcemaps: {
        filesToDeleteAfterUpload: ["**/*.js.map"]
      },
      debug: true    
    }),
  ],

  /**
   * Disables webpack processing of __dirname and __filename.
   * If you run the bundle in node.js it falls back to these values of node.js.
   * https://github.com/webpack/webpack/issues/2010
   */
  node: {
    __dirname: false,
    __filename: false,
  },
});
