import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

// Content fingerprint works in both a Git checkout and Docker's .git-free context.
export async function writeBuildInfo(root = process.cwd()) {
  const paths = [];
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) paths.push(name);
    }
  }
  await walk('web'); await walk('sims');
  paths.push('package.json', 'package-lock.json', 'Dockerfile', '4yi-app.json', 'SKILL.md');
  const hash = createHash('sha256');
  for (const name of paths.sort()) {
    const content = await readFile(path.join(root, name));
    hash.update(`${name}\0${content.length}\0`); hash.update(content);
  }
  const record = {application: '3D simulator', sourceFingerprint: hash.digest('hex')};
  await writeFile(path.join(root, 'web-dist/build-info.json'), JSON.stringify(record) + '\n');
  return record;
}
