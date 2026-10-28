// Creates and pushes the tag of a release, and refuses when it would be the wrong commit:
//
//   pnpm release:tag
//
// A release is the tag v<version of package.json> on the squash commit of the release pull request
// on main. A tag on the branch of the pull request points to a commit that main never gets (the squash
// makes a new one), and the release workflow refuses it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`release:tag: ${message}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;

if (git('branch', '--show-current') !== 'main') {
  fail('switch to main first (git switch main && git pull)');
}
if (git('status', '--porcelain') !== '') {
  fail('there are uncommitted changes');
}
git('fetch', '--tags', 'origin');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  fail('main is not the same as origin/main (git pull, or you have local commits)');
}
if (git('tag', '--list', tag) !== '' || git('ls-remote', '--tags', 'origin', tag) !== '') {
  fail(
    `the tag ${tag} exists already (to move it: git push origin :refs/tags/${tag} && git tag -d ${tag})`,
  );
}

console.log(`Tagging ${git('log', '-1', '--oneline')} as ${tag}`);
git('tag', tag);
git('push', 'origin', tag);
console.log(`Pushed ${tag}. The Release workflow starts now.`);
