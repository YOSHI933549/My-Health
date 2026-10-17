import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Meal commits now in use look like 「昼食を暗号化受け取り箱に追加」.
// Any commit that touches the inbox or its public keys must be exactly one line
// from this list. Extra words, including dish names, are rejected.
// The checker prints the commit id and a fixed reason, never the message text.

export const ALLOWED_INBOX_COMMIT_MESSAGES = [
  "朝食を暗号化受け取り箱に追加",
  "昼食を暗号化受け取り箱に追加",
  "夕食を暗号化受け取り箱に追加",
  "間食を暗号化受け取り箱に追加",
  "暗号化受け取り箱の公開鍵を追加",
  "暗号化受け取り箱の公開鍵を更新",
  "暗号化受け取り箱を接続",
];

const ALLOWED = new Set(ALLOWED_INBOX_COMMIT_MESSAGES);

export function isInboxPath(filePath) {
  return filePath === "codex-inbox" || filePath.startsWith("codex-inbox/") || filePath === "codex-devices" || filePath.startsWith("codex-devices/");
}

export function inboxCommitProblem(message, files) {
  if (!files.some(isInboxPath)) return null;
  const normalized = String(message ?? "").replace(/\r\n/g, "\n").trim();
  if (ALLOWED.has(normalized)) return null;
  return "コミットメッセージが受け取り箱用の決まった文言ではありません";
}

function git(repo, args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function commitExists(repo, sha) {
  try {
    git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function ensureCommit(repo, sha) {
  if (commitExists(repo, sha)) return;
  git(repo, ["fetch", "--no-tags", "origin", sha]);
}

export function checkInboxCommitRange(repo, from, to) {
  ensureCommit(repo, from);
  ensureCommit(repo, to);
  const listed = git(repo, ["rev-list", "--reverse", `${from}..${to}`]).trim();
  if (!listed) return [];
  const problems = [];
  for (const sha of listed.split("\n")) {
    const message = git(repo, ["log", "-1", "--format=%B", sha]);
    const files = git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", sha])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const problem = inboxCommitProblem(message, files);
    if (problem) problems.push(`${sha}: ${problem}`);
  }
  return problems;
}

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

function rangeFromEnv() {
  const event = process.env.EVENT_NAME || "";
  if (event === "pull_request") {
    return { from: process.env.BASE_SHA || "", to: process.env.PR_HEAD_SHA || "" };
  }
  if (event === "push") {
    const before = process.env.BEFORE_SHA || "";
    if (!before || /^0+$/.test(before)) return null;
    return { from: before, to: process.env.HEAD_SHA || "" };
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const message = argValue(args, "--message");
  const pathArg = argValue(args, "--path");
  if (message || pathArg) {
    const problem = inboxCommitProblem(message, pathArg ? [pathArg] : []);
    if (problem) {
      process.stderr.write(`${problem}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Inbox commit message passed.\n");
    return;
  }

  const fromArg = argValue(args, "--from");
  const toArg = argValue(args, "--to");
  const range = fromArg || toArg ? { from: fromArg, to: toArg } : rangeFromEnv();
  if (!range) {
    process.stdout.write("No inbox commit range. Skipping commit message check.\n");
    return;
  }
  if (!range.from || !range.to) {
    process.stderr.write("commit range is missing\n");
    process.exitCode = 1;
    return;
  }

  const repo = argValue(args, "--repo") || process.cwd();
  let problems;
  try {
    problems = checkInboxCommitRange(repo, range.from, range.to);
  } catch {
    process.stderr.write("commit range is unavailable\n");
    process.exitCode = 1;
    return;
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Inbox commit messages passed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
