import fs from 'fs';
import path from 'path';

type BumpType = 'major' | 'minor' | 'patch';

// get bump type from command line args
const bumpType = (process.argv[2] as BumpType) || 'patch';

// paths to package.json files
const rootPackageJsonPath = path.join(__dirname, '../package.json');
const releasePackageJsonPath = path.join(
  __dirname,
  '../release/app/package.json',
);

// read package.json files
const rootPackageJson = JSON.parse(
  fs.readFileSync(rootPackageJsonPath, 'utf8'),
);
const releasePackageJson = JSON.parse(
  fs.readFileSync(releasePackageJsonPath, 'utf8'),
);

// parse current version
const [major, minor, patch] = rootPackageJson.version.split('.').map(Number);

// calculate new version
let newVersion: string;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

// update versions in both package.json files
rootPackageJson.version = newVersion;
releasePackageJson.version = newVersion;

// write updated package.json files
fs.writeFileSync(
  rootPackageJsonPath,
  `${JSON.stringify(rootPackageJson, null, 2)}\n`,
);
fs.writeFileSync(
  releasePackageJsonPath,
  `${JSON.stringify(releasePackageJson, null, 2)}\n`,
);

console.log(`Version bumped to ${newVersion}`);
