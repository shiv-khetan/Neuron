const packageJson = require('../package.json');

const env = process.env.NEURON_BUILD_ENV === 'test' ? 'test' : 'prod';
const isTest = env === 'test';
const productName = isTest ? 'Neuron Test' : 'Neuron';
const appId = isTest ? 'io.github.neuron.notes.test' : 'io.github.neuron.notes';
const version = isTest ? `${packageJson.version}-beta.0` : packageJson.version;
const output = isTest ? 'release/test' : 'release/prod';
const artifactProduct = productName.replace(/\s+/g, '-');

module.exports = {
  appId,
  productName,
  artifactName: `${artifactProduct}-${version}-${'${os}'}-${'${arch}'}.${'${ext}'}`,
  asar: true,
  asarUnpack: [
    '**/node_modules/node-pty/**',
  ],
  npmRebuild: false,
  directories: {
    output,
  },
  files: [
    'dist/**/*',
    'package.json',
  ],
  extraMetadata: {
    name: isTest ? 'neuron-test' : packageJson.name,
    version,
  },
  extraResources: [
    {
      from: 'examples',
      to: 'examples',
      filter: [
        '**/*',
      ],
    },
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
  ],
  win: {
    icon: 'build/icon.png',
    signAndEditExecutable: !isTest,
    target: [
      'nsis',
      'portable',
      'appx',
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    differentialPackage: !isTest,
    shortcutName: productName,
    uninstallDisplayName: productName,
  },
  appx: {
    applicationId: isTest ? 'NeuronTest' : 'Neuron',
    displayName: productName,
    identityName: isTest ? 'REPLACE.WITH.PartnerCenter.IdentityName.Test' : 'REPLACE.WITH.PartnerCenter.IdentityName',
    publisher: 'CN=REPLACE-WITH-PARTNER-CENTER-PUBLISHER-ID',
    publisherDisplayName: 'REPLACE_WITH_PUBLISHER_DISPLAY_NAME',
    backgroundColor: '#1a1a1a',
    languages: [
      'en-US',
    ],
  },
  portable: {
    artifactName: `${artifactProduct}-${version}-${'${os}'}-${'${arch}'}-portable.${'${ext}'}`,
  },
  mac: {
    icon: 'build/icon.png',
    category: 'public.app-category.productivity',
    target: [
      'dmg',
      'zip',
    ],
  },
  linux: {
    icon: 'build/icon.png',
    category: 'Office',
    target: [
      'AppImage',
      'deb',
    ],
  },
  publish: isTest ? null : {
    provider: 'github',
    releaseType: 'release',
  },
};
