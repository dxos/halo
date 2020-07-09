//
// Copyright 2019 DXOS.org
//

module.exports = {
  presets: [
    '@babel/preset-env'
  ],
  plugins: [
    'add-module-exports',
    '@babel/plugin-proposal-class-properties',
    '@babel/plugin-proposal-export-default-from',
    '@babel/plugin-transform-runtime'
  ]
};
