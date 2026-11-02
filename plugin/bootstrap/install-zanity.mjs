import assert from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pins = JSON.parse(readFileSync(new URL("./pins.json", import.meta.url), "utf8"));
const UNVERIFIED_MARKER = "unverified";
const INSTALL_FILE_MODE = 0o755;
const DEFAULT_INSTALL_DIR = join(homedir(), ".local", "bin");

export const installPlan = (version = pins.zanityVersion, repository = pins.zanityRepository) => {
  assert(/^\d+\.\d+\.\d+$/.test(version), `zanity version must be a pinned x.y.z release, got "${version}"; set zanityVersion in pins.json`);
  const scriptUrl = `https://raw.githubusercontent.com/${repository}/v${version}/install.sh`;
  return { scriptUrl, env: { ZANITY_VERSION: version }, version };
};

export const isVerifiedInstall = (installerOutput) => {
  assert(installerOutput.includes("Installed"), `installer must report an install, got "${installerOutput.slice(0, 80)}"`);
  const verified = !installerOutput.includes(UNVERIFIED_MARKER);
  return verified;
};

const run = async () => {
  const plan = installPlan();
  const scratch = mkdtempSync(join(tmpdir(), "zanity-install-"));
  const scriptPath = join(scratch, "install.sh");
  const response = await fetch(plan.scriptUrl);
  if (!response.ok) throw new Error(`could not download ${plan.scriptUrl} (HTTP ${response.status}). Check the network and that release v${plan.version} exists.`);
  const script = Buffer.from(await response.arrayBuffer());
  assert(script.length > 0, `${plan.scriptUrl} returned an empty install script; retry or check the release`);
  writeFileSync(scriptPath, script, { mode: INSTALL_FILE_MODE });
  console.error(`install.sh sha256 ${createHash("sha256").update(script).digest("hex")} from ${plan.scriptUrl}`);
  const stagingDir = join(scratch, "bin");
  const installer = spawnSync("sh", [scriptPath], { env: { ...process.env, ...plan.env, ZANITY_INSTALL_DIR: stagingDir }, encoding: "utf8" });
  const output = `${installer.stdout}${installer.stderr}`;
  console.error(output);
  if (installer.status !== 0) throw new Error(`the zanity installer failed (exit ${installer.status}); read its output above and retry.`);
  if (!isVerifiedInstall(output)) throw new Error(`zanity ${plan.version} could not be checksum-verified against its release. Nothing was installed; retry later or set GITHUB_TOKEN.`);
  mkdirSync(DEFAULT_INSTALL_DIR, { recursive: true });
  copyFileSync(join(stagingDir, "zanity"), join(DEFAULT_INSTALL_DIR, "zanity"));
  assert(output.includes(plan.version), `installer output must name ${plan.version}, got "${output.slice(0, 80)}"`);
  console.error(`installed zanity ${plan.version} to ${DEFAULT_INSTALL_DIR}`);
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes("--run")) await run();
else if (isMain) console.log(JSON.stringify(installPlan(), null, 2));
