// src/adapters/fs/env-files.ts
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
function createNodeEnvFiles() {
  return {
    homeDirectory() {
      try {
        const home = homedir();
        return home.length > 0 ? home : void 0;
      } catch {
        return void 0;
      }
    },
    async isFile(path) {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    }
  };
}

// src/adapters/fs/snapshot-store.ts
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readdir, readFile, rename, rm, stat as stat2, writeFile } from "node:fs/promises";
import { homedir as homedir2, tmpdir } from "node:os";
import { join } from "node:path";

// src/core/repository-scope.ts
var WORKTREE_PREFIX = "worktree ";
function parseWorktreeRoots(stdout) {
  const roots = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.startsWith(WORKTREE_PREFIX)) continue;
    const root = line.slice(WORKTREE_PREFIX.length);
    if (root.length === 0 || roots.includes(root)) continue;
    roots.push(root);
  }
  return roots;
}
async function pickExistingRoot(roots, exists) {
  for (const root of roots) {
    if (await exists(root)) return root;
  }
  return void 0;
}
function scopedKeysOf(scopeRoot, workspaceRoot) {
  return scopeRoot === workspaceRoot ? [scopeRoot] : [scopeRoot, workspaceRoot];
}
function storeKeyOf(kind, scopeRoot, workspaceRoot) {
  return kind === "markdown" ? workspaceRoot : scopeRoot;
}

// src/core/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/snapshot-store.ts
var SNAPSHOT_STORE_VERSION = 3;
var BACKENDS = ["github", "gitlab", "gitea", "markdown"];
var HIERARCHIES = ["native", "convention", "none"];
function serializeSnapshotStoreEntry(entry) {
  return JSON.stringify({
    version: entry.version,
    scopeRoot: entry.scopeRoot,
    workspaceRoot: entry.workspaceRoot,
    backend: entry.backend,
    repository: entry.repository,
    repositoryKey: entry.repositoryKey,
    repositoryHost: entry.repositoryHost,
    fetchedAt: entry.fetchedAt,
    viewer: entry.viewer,
    loaded: entry.loaded,
    total: entry.total,
    ...entry.nextCursor === void 0 ? {} : { nextCursor: entry.nextCursor },
    tickets: entry.tickets,
    hierarchy: entry.hierarchy
  });
}
function parseSnapshotStoreEntry(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return void 0;
  }
  return readEntry(payload);
}
function readEntry(value) {
  if (!isRecord(value)) return void 0;
  if (value.version !== SNAPSHOT_STORE_VERSION) return void 0;
  const workspaceRoot = readString(value.workspaceRoot);
  const scopeRoot = readString(value.scopeRoot);
  const repository = readString(value.repository);
  const repositoryKey2 = readString(value.repositoryKey);
  const fetchedAt = readNumber(value.fetchedAt);
  const loaded = readNumber(value.loaded);
  const total = readNumber(value.total);
  if (workspaceRoot === void 0 || scopeRoot === void 0 || repository === void 0 || repositoryKey2 === void 0 || fetchedAt === void 0 || loaded === void 0 || total === void 0) {
    return void 0;
  }
  const backend = value.backend;
  if (typeof backend !== "string" || !BACKENDS.includes(backend)) return void 0;
  const repositoryHost = value.repositoryHost;
  if (repositoryHost !== null && typeof repositoryHost !== "string") return void 0;
  const viewer = value.viewer;
  if (viewer !== null && typeof viewer !== "string") return void 0;
  if (typeof viewer === "string" && viewer.length === 0) return void 0;
  const nextCursor = value.nextCursor;
  if (nextCursor !== void 0 && (typeof nextCursor !== "string" || nextCursor.length === 0)) {
    return void 0;
  }
  const tickets = readTickets(value.tickets);
  if (tickets === void 0) return void 0;
  const hierarchy = value.hierarchy;
  if (typeof hierarchy !== "string" || !HIERARCHIES.includes(hierarchy)) {
    return void 0;
  }
  return {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot,
    workspaceRoot,
    backend,
    repository,
    repositoryKey: repositoryKey2,
    repositoryHost: repositoryHost ?? null,
    fetchedAt,
    viewer,
    loaded,
    total,
    ...nextCursor === void 0 ? {} : { nextCursor },
    tickets,
    hierarchy
  };
}
function readTickets(value) {
  if (!Array.isArray(value)) return void 0;
  const tickets = [];
  for (const item of value) {
    const ticket = readTicket(item);
    if (ticket === void 0) return void 0;
    tickets.push(ticket);
  }
  return tickets;
}
function readTicket(value) {
  if (!isRecord(value)) return void 0;
  const ref = readString(value.ref);
  const title = readString(value.title);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const state = readState(value.state);
  const openBlockers = readNumber(value.openBlockers);
  if (ref === void 0 || title === void 0 || createdAt === void 0 || updatedAt === void 0 || state === void 0 || openBlockers === void 0) {
    return void 0;
  }
  const number = value.number;
  if (number !== null && (typeof number !== "number" || !Number.isInteger(number))) return void 0;
  const labels = readStringArray(value.labels);
  if (labels === void 0) return void 0;
  const author = readAuthor(value.author);
  if (author === void 0) return void 0;
  const assignees = readStringArray(value.assignees);
  if (assignees === void 0) return void 0;
  const closedAt = value.closedAt;
  if (closedAt !== void 0 && typeof closedAt !== "string") return void 0;
  const parent = value.parent;
  if (parent !== void 0 && (typeof parent !== "string" || parent.length === 0)) return void 0;
  const blockedBy = value.blockedBy;
  if (blockedBy !== void 0) {
    const refs = readStringArray(blockedBy);
    if (refs === void 0) return void 0;
    return {
      ref,
      number: number ?? null,
      title,
      state,
      labels,
      author,
      assignees,
      createdAt,
      updatedAt,
      openBlockers,
      ...closedAt === void 0 ? {} : { closedAt },
      blockedBy: refs,
      ...parent === void 0 ? {} : { parent }
    };
  }
  return {
    ref,
    number: number ?? null,
    title,
    state,
    labels,
    author,
    assignees,
    createdAt,
    updatedAt,
    openBlockers,
    ...closedAt === void 0 ? {} : { closedAt },
    ...parent === void 0 ? {} : { parent }
  };
}
function readAuthor(value) {
  if (value === null || value === void 0) return null;
  if (!isRecord(value)) return void 0;
  const login = readString(value.login);
  if (login === void 0) return void 0;
  const displayName = value.displayName;
  if (displayName !== null && typeof displayName !== "string") return void 0;
  const avatarUrl = value.avatarUrl;
  if (avatarUrl !== null && avatarUrl !== void 0 && typeof avatarUrl !== "string") {
    return void 0;
  }
  return {
    login,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null
  };
}
function readState(value) {
  if (value === "open" || value === "closed") return value;
  return void 0;
}
function readString(value) {
  if (typeof value !== "string" || value.length === 0) return void 0;
  return value;
}
function readNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return value;
}
function readStringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const items = [];
  for (const item of value) {
    if (typeof item !== "string") return void 0;
    items.push(item);
  }
  return items;
}

// src/adapters/fs/snapshot-store.ts
var SNAPSHOT_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var SNAPSHOT_STORE_MAX_ENTRIES = 20;
var DIRECTORY_NAME = "orca-mattpocock-workflow";
function createNodeSnapshotStore(deps = {}) {
  const home = resolveHome(deps);
  const fallbackRoot = join(resolveTmp(deps), `${DIRECTORY_NAME}-cache`);
  const preferredRoot = deps.root ?? (home === void 0 ? fallbackRoot : join(home, `.${DIRECTORY_NAME}`, "cache"));
  const preferredDisplay = deps.root ?? (home === void 0 ? "\u7CFB\u7EDF\u4E34\u65F6\u76EE\u5F55" : `~/.${DIRECTORY_NAME}/cache`);
  let root = preferredRoot;
  let display = preferredDisplay;
  let checked = false;
  const resolveRoot = async () => {
    if (checked) return root;
    checked = true;
    if (await isWritable(preferredRoot)) {
      root = preferredRoot;
      display = preferredDisplay;
      return root;
    }
    root = fallbackRoot;
    display = "\u7CFB\u7EDF\u4E34\u65F6\u76EE\u5F55";
    return root;
  };
  return {
    ...entryOperations(resolveRoot),
    ...ticketOperations(resolveRoot),
    location: () => display
  };
}
function entryOperations(resolveRoot) {
  const list = async () => {
    const root = await resolveRoot();
    return (await scanEntries(root)).flatMap(
      (scanned) => scanned.entry === void 0 ? [] : [scanned.entry]
    );
  };
  return {
    read: (key) => readEntryAt(resolveRoot, key),
    async write(entry) {
      await writeEntryAt(await resolveRoot(), entry);
    },
    async remove(key) {
      const root = await resolveRoot();
      await rm(fileFor(root, key), { force: true });
    },
    list,
    async clear() {
      const root = await resolveRoot();
      let names;
      try {
        names = await readdir(root);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        await rm(join(root, name), { force: true });
        removed += 1;
      }
      return removed;
    },
    async prune(now) {
      const root = await resolveRoot();
      const kept = [];
      let removed = 0;
      for (const scanned of await scanEntries(root)) {
        if (scanned.entry === void 0) {
          await rm(join(root, scanned.name), { force: true });
          removed += 1;
          continue;
        }
        const entry = scanned.entry;
        const key = storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot);
        const gone = await isDirectoryGone(key);
        if (gone === true || gone === void 0 && now - entry.fetchedAt > SNAPSHOT_STORE_TTL_MS) {
          await rm(join(root, scanned.name), { force: true });
          removed += 1;
          continue;
        }
        kept.push(entry);
      }
      if (kept.length > SNAPSHOT_STORE_MAX_ENTRIES) {
        kept.sort((left, right) => left.fetchedAt - right.fetchedAt);
        for (const entry of kept.slice(0, kept.length - SNAPSHOT_STORE_MAX_ENTRIES)) {
          await rm(fileFor(root, storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot)), {
            force: true
          });
          removed += 1;
        }
      }
      return removed;
    }
  };
}
function ticketOperations(resolveRoot) {
  return {
    async patchTicket(key, ref, patch) {
      const root = await resolveRoot();
      const entry = await readEntryAt(resolveRoot, key);
      if (entry === void 0) return false;
      const index = entry.tickets.findIndex((ticket) => ticket.ref === ref);
      if (index < 0) return false;
      const current = entry.tickets[index];
      if (current === void 0) return false;
      const updated = {
        ...current,
        ...patch.labels === void 0 ? {} : { labels: patch.labels },
        ...patch.state === void 0 ? {} : { state: patch.state }
      };
      const tickets = [...entry.tickets];
      tickets[index] = updated;
      await writeEntryAt(root, { ...entry, tickets });
      return true;
    },
    async removeTicket(key, ref) {
      const root = await resolveRoot();
      const entry = await readEntryAt(resolveRoot, key);
      if (entry === void 0) return false;
      const tickets = entry.tickets.filter((ticket) => ticket.ref !== ref);
      if (tickets.length === entry.tickets.length) return false;
      await writeEntryAt(root, { ...entry, tickets });
      return true;
    }
  };
}
function fileFor(root, key) {
  return join(root, `${hashOf(key)}.json`);
}
async function scanEntries(root) {
  let names;
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const scanned = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      scanned.push({
        name,
        entry: parseSnapshotStoreEntry(await readFile(join(root, name), "utf8"))
      });
    } catch {
    }
  }
  return scanned;
}
async function readEntryAt(resolveRoot, key) {
  try {
    const root = await resolveRoot();
    const raw = await readFile(fileFor(root, key), "utf8");
    return parseSnapshotStoreEntry(raw);
  } catch {
    return void 0;
  }
}
async function writeEntryAt(root, entry) {
  await mkdir(root, { recursive: true, mode: 448 });
  const target = fileFor(root, storeKeyOf(entry.backend, entry.scopeRoot, entry.workspaceRoot));
  const temporary = `${target}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temporary, serializeSnapshotStoreEntry(entry), { mode: 384 });
    await rename(temporary, target);
    await chmod(target, 384);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => void 0);
    throw error;
  }
}
async function isDirectoryGone(key) {
  try {
    await stat2(key);
    return void 0;
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT") return true;
    return false;
  }
}
function hashOf(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
async function isWritable(path) {
  try {
    await mkdir(path, { recursive: true, mode: 448 });
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function resolveHome(deps) {
  if (deps.home !== void 0) return deps.home.length > 0 ? deps.home : void 0;
  try {
    const home = homedir2();
    return home.length > 0 ? home : void 0;
  } catch {
    return void 0;
  }
}
function resolveTmp(deps) {
  if (deps.tmp !== void 0 && deps.tmp.length > 0) return deps.tmp;
  try {
    return tmpdir();
  } catch {
    return ".";
  }
}

// src/core/remote.ts
var REMOTE_LINE = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/;
var SCP_LIKE = /^[^@\s/]+@([^:/\s]+):(.+)$/;
var SCHEME = /^(?:ssh|git|https?):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+)$/;
var HOST = /^[A-Za-z0-9.-]+$/;
var REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;
function parseRemotes(output) {
  const seen = /* @__PURE__ */ new Set();
  const remotes = [];
  for (const rawLine of output.split("\n")) {
    const match = REMOTE_LINE.exec(rawLine.trim());
    if (match === null) continue;
    const name = match[1];
    const url = match[2];
    if (name === void 0 || url === void 0) continue;
    const key = `${name}\0${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name, url });
  }
  return remotes;
}
function pickRemote(remotes) {
  return remotes.find((remote) => remote.name === "origin") ?? remotes[0];
}
function parseRemoteUrl(url) {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const scp = SCP_LIKE.exec(cleaned);
  if (scp !== null) return buildAddress(scp[1], scp[2]);
  const scheme = SCHEME.exec(cleaned);
  if (scheme !== null) return buildAddress(scheme[1], scheme[2]);
  return void 0;
}
function pickRemoteAddress(remotes) {
  const remote = pickRemote(remotes);
  return remote === void 0 ? void 0 : parseRemoteUrl(remote.url);
}
function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}
function repositorySlug(remote) {
  if (remote === void 0) return void 0;
  const segments = remote.path.split("/");
  if (segments.length !== 2) return void 0;
  const [owner, name] = segments;
  if (owner === void 0 || name === void 0) return void 0;
  if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(name)) return void 0;
  return `${owner}/${name}`;
}
function buildAddress(host, path) {
  if (host === void 0 || path === void 0) return void 0;
  const normalizedHost = normalizeHost(host);
  if (normalizedHost.length === 0 || !HOST.test(normalizedHost)) return void 0;
  const segments = path.split("/");
  if (segments.length === 0) return void 0;
  for (const segment of segments) {
    if (segment.length === 0) return void 0;
  }
  return { host: normalizedHost, path: segments.join("/") };
}

// src/core/backend.ts
var LOGGED_IN = /^\s*[✓✔]\s+Logged in to\s+(\S+)/i;
var GITHUB_HOST = "github.com";
var GITLAB_HOST = "gitlab.com";
function parseLoggedInHosts(output) {
  const hosts = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of output.split("\n")) {
    const match = LOGGED_IN.exec(line);
    if (match === null) continue;
    const host = match[1];
    if (host === void 0) continue;
    const normalized = normalizeHost(host);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    hosts.push(normalized);
  }
  return hosts;
}
function parseTeaLoginHosts(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  const hosts = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of payload) {
    if (!isRecord(value)) continue;
    const host = loginHost(value);
    if (host === void 0 || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}
function loginHost(login) {
  const url = "url" in login ? login.url : void 0;
  if (typeof url === "string" && url.length > 0) {
    const host = hostnameOf(url);
    if (host !== void 0) return host;
  }
  const sshHost = "ssh_host" in login ? login.ssh_host : void 0;
  if (typeof sshHost === "string" && sshHost.length > 0) {
    const host = normalizeHost(sshHost);
    if (host.length > 0) return host;
  }
  return void 0;
}
function hostnameOf(url) {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return host.length > 0 ? host : void 0;
  } catch {
    return void 0;
  }
}
function chooseBackend(address, glabHosts, teaHosts = []) {
  if (address === void 0) return { kind: "markdown", source: "no-remote" };
  const host = normalizeHost(address.host);
  if (host === GITHUB_HOST) return { kind: "github", source: "remote" };
  if (host === GITLAB_HOST) return { kind: "gitlab", source: "remote" };
  if (glabHosts.some((candidate) => normalizeHost(candidate) === host)) {
    return { kind: "gitlab", source: "glab-auth" };
  }
  if (teaHosts.some((candidate) => normalizeHost(candidate) === host)) {
    return { kind: "gitea", source: "tea-auth" };
  }
  return { kind: "markdown", source: "unsupported-remote" };
}

// src/core/tracker-error.ts
var TrackerError = class extends Error {
  code;
  /**
   * @param code - 客户端可据以给出操作提示的错误码。
   * @param message - 面向用户的失败原因。
   * @param options - 原始错误，保留调用链。
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "TrackerError";
    this.code = code;
  }
};
var NETWORK_FAILURE = /dial tcp|no such host|i\/o timeout|timeout|network is unreachable|connection refused|connection reset|TLS handshake|proxyconnect|unexpected EOF/i;
var CommandError = class extends Error {
  kind;
  stderr;
  stdout;
  exitCode;
  /**
   * @param kind - 找不到可执行文件、超时或进程非零退出。
   * @param message - 诊断信息。
   * @param stderr - 进程的标准错误；`not-found` 时为空串。
   * @param exitCode - 退出码；被信号终止或未启动时为 null。
   * @param stdout - 进程的标准输出；带 `--json` 的 CLI 会把错误信封写在这里。
   */
  constructor(kind, message, stderr = "", exitCode = null, stdout = "") {
    super(message);
    this.name = "CommandError";
    this.kind = kind;
    this.stderr = stderr;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
};
function isNetworkFailure(stderr) {
  return NETWORK_FAILURE.test(stderr);
}
function isCommandNotFound(error) {
  return error instanceof CommandError && error.kind === "not-found";
}
function commandFailureDetail(error) {
  const text = error.stderr.trim() || error.message;
  const firstLine = text.split("\n")[0] ?? text;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}\u2026` : firstLine;
}

// src/core/author.ts
function readLogin(value, field) {
  if (!isRecord(value)) return null;
  return readText(value[field]);
}
function readAuthor2(value, fields, avatarBaseUrl2) {
  if (!isRecord(value)) return null;
  const login = readLogin(value, fields.login);
  if (login === null) return null;
  return {
    login,
    displayName: readText(value[fields.displayName]),
    avatarUrl: normalizeAvatarUrl(value[fields.avatarUrl], avatarBaseUrl2)
  };
}
function readAuthors(value, fields, avatarBaseUrl2) {
  if (!Array.isArray(value)) return [];
  const authors = [];
  for (const entry of value) {
    const author = readAuthor2(entry, fields, avatarBaseUrl2);
    if (author !== null) authors.push(author);
  }
  return authors;
}
function readLogins(value, fields) {
  if (!Array.isArray(value)) return [];
  const logins = [];
  for (const entry of value) {
    const login = readLogin(entry, fields.login);
    if (login !== null) logins.push(login);
  }
  return logins;
}
function normalizeAvatarUrl(value, baseUrl) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url;
  try {
    url = baseUrl === void 0 ? new URL(trimmed) : new URL(trimmed, baseUrl);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}
function readText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length === 0 ? null : text;
}

// src/adapters/gitea/parse.ts
var GITEA_AUTHOR_FIELDS = {
  login: "login",
  displayName: "full_name",
  avatarUrl: "avatar_url"
};
var STATUS_LINE = /^HTTP\/\S+\s+(\d{3})/m;
var TOTAL_LINE = /^x-total-count:\s*(\d+)\s*$/im;
function parseApiResponse(stdout, stderr) {
  return { status: readStatus(stderr), total: readTotal(stderr), body: stdout };
}
function parseIssuesPage(body, avatarBaseUrl2) {
  const payload = parseJson(body);
  if (!Array.isArray(payload)) throw invalid("\u5DE5\u5355\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const issues = [];
  for (const [index, value] of payload.entries()) {
    if (isRecord(value) && isRecord(value.pull_request)) continue;
    issues.push(parseIssue(value, index, avatarBaseUrl2));
  }
  return issues;
}
function parseDependencies(body) {
  const payload = parseJson(body);
  if (!Array.isArray(payload)) throw invalid("\u5DE5\u5355\u4F9D\u8D56\u4E0D\u662F\u6570\u7EC4");
  let open = 0;
  const refs = [];
  for (const dependency of payload) {
    if (!isRecord(dependency)) continue;
    const number = dependency.number;
    if (typeof number === "number" && Number.isInteger(number) && number > 0) refs.push(number);
    if (dependency.state === "closed") continue;
    open += 1;
  }
  return { received: payload.length, open, refs };
}
function readStatus(stderr) {
  const match = STATUS_LINE.exec(stderr);
  if (match === null) return 200;
  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(status) ? status : 200;
}
function readTotal(stderr) {
  const match = TOTAL_LINE.exec(stderr);
  if (match === null) return void 0;
  const total = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(total) ? total : void 0;
}
function parseIssue(value, index, avatarBaseUrl2) {
  if (!isRecord(value)) throw invalid(`\u7B2C ${String(index + 1)} \u5F20\u7968\u4E0D\u662F\u5BF9\u8C61`);
  const number = value.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    throw invalid(`\u7B2C ${String(index + 1)} \u5F20\u7968\u7684\u7F16\u53F7\u4E0D\u5408\u6CD5`);
  }
  const title = readString2(value.title, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u6807\u9898`);
  const state = readState2(value.state, number);
  const closedAt = readClosedAt(value.closed_at, number);
  return {
    ticket: {
      ref: `#${String(number)}`,
      number,
      title,
      state,
      labels: readLabels(value.labels),
      author: readAuthor2(value.user, GITEA_AUTHOR_FIELDS, avatarBaseUrl2),
      assignees: readLogins(value.assignees, GITEA_AUTHOR_FIELDS),
      createdAt: readString2(value.created_at, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u521B\u5EFA\u65F6\u95F4`),
      updatedAt: readString2(value.updated_at, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u66F4\u65B0\u65F6\u95F4`),
      openBlockers: 0,
      blockedBy: [],
      ...closedAt === void 0 ? {} : { closedAt }
    },
    body: typeof value.body === "string" ? value.body : ""
  };
}
function readState2(value, number) {
  if (value === "open") return "open";
  if (value === "closed") return "closed";
  throw invalid(`\u7B2C ${String(number)} \u5F20\u7968\u7684\u72B6\u6001\u4E0D\u5408\u6CD5`);
}
function readLabels(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (typeof label === "string" && label.length > 0) return [label];
    if (isRecord(label) && typeof label.name === "string" && label.name.length > 0) {
      return [label.name];
    }
    return [];
  });
}
function readString2(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${field} \u4E0D\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  }
  return value;
}
function readClosedAt(value, number) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`\u7B2C ${String(number)} \u5F20\u7968\u7684\u5173\u95ED\u65F6\u95F4\u4E0D\u5408\u6CD5`);
  }
  return value;
}
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", "Gitea \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON\u3002", { cause: error });
  }
}
function parseCurrentLogin(body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  return readLogin(payload, "login");
}
function invalid(message) {
  return new TrackerError("fetch-failed", `\u5DE5\u5355\u6570\u636E\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitea/env.ts
var NOT_FOUND = /HTTP 404|404 Not Found|Not Found|repository not found/i;
var FORBIDDEN = /HTTP 403|403 Forbidden|Forbidden|permission denied/i;
var TEA_MISSING = "\u672A\u627E\u5230 tea \u53EF\u6267\u884C\u6587\u4EF6";
var AUTH_FAILURE = /tea login add|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|Unauthorized/i;
function createGiteaEnvProbe(deps) {
  return {
    kind: "gitea",
    async cli(workspaceRoot) {
      try {
        const output = await deps.run("tea", ["--version"], { cwd: workspaceRoot });
        return { status: "pass", detail: output.executable ?? "tea" };
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: TEA_MISSING, reason: "cli-missing" };
        }
        return { status: "pass", detail: "tea" };
      }
    },
    async auth(workspaceRoot, remote) {
      if (remote === void 0) {
        return { status: "fail", detail: "\u6CA1\u6709\u53EF\u6838\u5BF9\u7684 Gitea \u8FDC\u7AEF", reason: "cli-unauthenticated" };
      }
      const host = normalizeHost(remote.host);
      let output;
      try {
        const result = await deps.run("tea", ["logins", "list", "--output", "json"], {
          cwd: workspaceRoot
        });
        output = result.stdout;
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: TEA_MISSING, reason: "cli-missing" };
        }
        return { status: "fail", detail: `\u672A\u767B\u5F55 ${host}`, reason: "cli-unauthenticated" };
      }
      if (!parseTeaLoginHosts(output).includes(host)) {
        return { status: "fail", detail: `\u672A\u767B\u5F55 ${host}`, reason: "cli-unauthenticated" };
      }
      return { status: "pass", detail: `\u5DF2\u767B\u5F55 ${host}` };
    },
    async repository(workspaceRoot, remote) {
      const repository = repositorySlug(remote);
      if (repository === void 0) {
        return {
          status: "fail",
          detail: "\u5F53\u524D\u8FDC\u7AEF\u4E0D\u662F Gitea \u4ED3\u5E93\uFF08\u9700\u8981 owner/repo \u4E24\u6BB5\u8DEF\u5F84\uFF09",
          reason: "repository-forbidden"
        };
      }
      try {
        const output = await deps.run("tea", ["api", "--include", `/repos/${repository}`], {
          cwd: workspaceRoot
        });
        return repositoryResponse(parseApiResponse(output.stdout, output.stderr), repository);
      } catch (error) {
        return repositoryFailure(error);
      }
    }
  };
}
function repositoryResponse(response, repository) {
  if (response.status < 400) return { status: "pass", detail: `\u53EF\u8BBF\u95EE ${repository}` };
  if (response.status === 401) {
    return { status: "fail", detail: "\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55", reason: "cli-unauthenticated" };
  }
  if (response.status === 403) {
    return { status: "fail", detail: `\u65E0\u6743\u8BBF\u95EE ${repository}`, reason: "repository-forbidden" };
  }
  if (response.status === 404) {
    return { status: "fail", detail: `\u4ED3\u5E93\u4E0D\u5B58\u5728\uFF1A${repository}`, reason: "repository-not-found" };
  }
  return {
    status: "fail",
    detail: `Gitea \u8FD4\u56DE HTTP ${String(response.status)}`,
    reason: "repository-forbidden"
  };
}
function repositoryFailure(error) {
  if (isCommandNotFound(error)) {
    return { status: "fail", detail: TEA_MISSING, reason: "cli-missing" };
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: "fail", detail: "\u7F51\u7EDC\u4E0D\u53EF\u8FBE\u6216\u8BF7\u6C42\u8D85\u65F6", reason: "repository-network" };
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return { status: "fail", detail: "\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55", reason: "cli-unauthenticated" };
    }
    if (NOT_FOUND.test(error.stderr)) {
      return {
        status: "fail",
        detail: "\u4ED3\u5E93\u4E0D\u5B58\u5728\uFF0C\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u8BBF\u95EE",
        reason: "repository-not-found"
      };
    }
    if (FORBIDDEN.test(error.stderr)) {
      return { status: "fail", detail: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650", reason: "repository-forbidden" };
    }
  }
  return { status: "fail", detail: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\u6216\u4ED3\u5E93\u4E0D\u5B58\u5728", reason: "repository-forbidden" };
}

// src/adapters/github/env.ts
var AUTH_FAILURE2 = /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|requires authentication|token.*(?:expired|invalid)/i;
var NOT_FOUND2 = /HTTP 404|Not Found|could not resolve to a repository|repository not found/i;
function createGithubEnvProbe(deps) {
  return {
    kind: "github",
    async cli(workspaceRoot) {
      try {
        const output = await deps.run("gh", ["--version"], { cwd: workspaceRoot });
        return { status: "pass", detail: output.executable ?? "gh" };
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: "\u672A\u627E\u5230 gh \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
        }
        return { status: "pass", detail: "gh" };
      }
    },
    async auth(workspaceRoot, remote) {
      const host = normalizeHost(remote?.host ?? GITHUB_HOST);
      try {
        const output = await deps.run("gh", ["auth", "status"], { cwd: workspaceRoot });
        const hosts = parseLoggedInHosts(`${output.stdout}
${output.stderr}`);
        if (hosts.length === 0 || hosts.includes(host)) {
          return { status: "pass", detail: "\u5DF2\u767B\u5F55" };
        }
        return { status: "fail", detail: `\u672A\u767B\u5F55 ${host}`, reason: "cli-unauthenticated" };
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: "\u672A\u627E\u5230 gh \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
        }
        const hosts = error instanceof CommandError ? parseLoggedInHosts(error.stderr) : [];
        if (hosts.includes(host)) return { status: "pass", detail: "\u5DF2\u767B\u5F55" };
        if (error instanceof CommandError && AUTH_FAILURE2.test(error.stderr)) {
          return { status: "fail", detail: "\u672A\u767B\u5F55\u6216\u4EE4\u724C\u5DF2\u5931\u6548", reason: "cli-unauthenticated" };
        }
        return { status: "fail", detail: "\u65E0\u6CD5\u786E\u8BA4\u767B\u5F55\u72B6\u6001", reason: "cli-unauthenticated" };
      }
    },
    async repository(workspaceRoot, remote) {
      const repository = repositorySlug(remote);
      if (repository === void 0) {
        return {
          status: "fail",
          detail: "\u5F53\u524D\u8FDC\u7AEF\u4E0D\u662F GitHub \u4ED3\u5E93",
          reason: "repository-forbidden"
        };
      }
      try {
        await deps.run("gh", ["api", `repos/${repository}`], { cwd: workspaceRoot });
        return { status: "pass", detail: `\u53EF\u8BBF\u95EE ${repository}` };
      } catch (error) {
        return repositoryFailure2(error);
      }
    }
  };
}
function repositoryFailure2(error) {
  if (isCommandNotFound(error)) {
    return { status: "fail", detail: "\u672A\u627E\u5230 gh \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: "fail", detail: "\u7F51\u7EDC\u4E0D\u53EF\u8FBE\u6216\u8BF7\u6C42\u8D85\u65F6", reason: "repository-network" };
    }
    if (NOT_FOUND2.test(error.stderr)) {
      return {
        status: "fail",
        detail: "\u4ED3\u5E93\u4E0D\u5B58\u5728\uFF0C\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u8BBF\u95EE",
        reason: "repository-not-found"
      };
    }
    if (AUTH_FAILURE2.test(error.stderr)) {
      return { status: "fail", detail: "\u4EE4\u724C\u5DF2\u5931\u6548", reason: "cli-unauthenticated" };
    }
  }
  return { status: "fail", detail: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\u6216\u4ED3\u5E93\u4E0D\u5B58\u5728", reason: "repository-forbidden" };
}

// src/adapters/gitlab/parse.ts
var GITLAB_AUTHOR_FIELDS = {
  login: "username",
  displayName: "name",
  avatarUrl: "avatar_url"
};
function parseIssuesPage2(output) {
  const payload = parseJson2(output);
  if (!Array.isArray(payload)) throw invalid2("\u5DE5\u5355\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  return payload.map((value, index) => parseIssue2(value, index));
}
function hasNativeBlockingLinks(output) {
  const payload = parseJson2(output);
  if (!Array.isArray(payload)) throw invalid2("\u5DE5\u5355\u94FE\u63A5\u4E0D\u662F\u6570\u7EC4");
  return payload.some(
    (link) => isRecord(link) && typeof link.link_type === "string" && (link.link_type === "is_blocked_by" || link.link_type === "blocks")
  );
}
function parseNativeBlockers(output) {
  const payload = parseJson2(output);
  const links = Array.isArray(payload) ? payload : readLinksField(payload);
  if (links === void 0) throw invalid2("\u5DE5\u5355\u94FE\u63A5\u4E0D\u662F\u6570\u7EC4");
  let open = 0;
  const refs = [];
  for (const link of links) {
    if (!isRecord(link)) continue;
    if (link.link_type !== "is_blocked_by") continue;
    const iid = link.iid;
    if (typeof iid === "number" && Number.isInteger(iid) && iid > 0) refs.push(iid);
    if (link.state === "closed") continue;
    open += 1;
  }
  return { open, refs };
}
function parseBlockedByCounts(output) {
  const payload = parseJson2(output);
  if (!isRecord(payload)) throw invalid2("\u963B\u585E\u8BA1\u6570\u54CD\u5E94\u4E0D\u662F\u5BF9\u8C61");
  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    const message = isRecord(first) && typeof first.message === "string" ? first.message : "\u672A\u77E5 GraphQL \u9519\u8BEF";
    throw invalid2(`\u963B\u585E\u8BA1\u6570\u67E5\u8BE2\u5931\u8D25\uFF1A${message}`);
  }
  const data = payload.data;
  if (!isRecord(data)) throw invalid2("\u963B\u585E\u8BA1\u6570\u54CD\u5E94\u7F3A\u5C11 data");
  const project = data.project;
  if (!isRecord(project)) throw invalid2("\u963B\u585E\u8BA1\u6570\u54CD\u5E94\u7F3A\u5C11 project");
  const issues = project.issues;
  if (!isRecord(issues)) throw invalid2("\u963B\u585E\u8BA1\u6570\u54CD\u5E94\u7F3A\u5C11 project.issues");
  const nodes = issues.nodes;
  if (!Array.isArray(nodes)) throw invalid2("\u963B\u585E\u8BA1\u6570\u54CD\u5E94\u7684 nodes \u4E0D\u662F\u6570\u7EC4");
  const counts = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!isRecord(node)) throw invalid2("\u963B\u585E\u8BA1\u6570\u8282\u70B9\u4E0D\u662F\u5BF9\u8C61");
    const iid = readIid(node.iid);
    const count = node.blockedByCount;
    if (count === void 0 || count === null) continue;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw invalid2(`\u7B2C ${String(iid)} \u5F20\u7968\u7684 blockedByCount \u4E0D\u662F\u975E\u8D1F\u6574\u6570`);
    }
    counts.set(iid, count);
  }
  return counts;
}
function parseWorkItemHierarchy(output) {
  const payload = parseJson2(output);
  if (!isRecord(payload)) throw invalid2("\u5DE5\u4F5C\u9879\u5C42\u7EA7\u54CD\u5E94\u4E0D\u662F\u5BF9\u8C61");
  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    const message = isRecord(first) && typeof first.message === "string" ? first.message : "\u672A\u77E5 GraphQL \u9519\u8BEF";
    throw invalid2(`\u5DE5\u4F5C\u9879\u5C42\u7EA7\u67E5\u8BE2\u5931\u8D25\uFF1A${message}`);
  }
  const data = payload.data;
  if (!isRecord(data)) throw invalid2("\u5DE5\u4F5C\u9879\u5C42\u7EA7\u54CD\u5E94\u7F3A\u5C11 data");
  const project = data.project;
  if (!isRecord(project)) throw invalid2("\u5DE5\u4F5C\u9879\u5C42\u7EA7\u54CD\u5E94\u7F3A\u5C11 project");
  const workItems = project.workItems;
  if (!isRecord(workItems)) throw invalid2("\u5DE5\u4F5C\u9879\u5C42\u7EA7\u54CD\u5E94\u7F3A\u5C11 project.workItems");
  const nodes = workItems.nodes;
  if (!Array.isArray(nodes)) throw invalid2("\u5DE5\u4F5C\u9879\u5C42\u7EA7\u54CD\u5E94\u7684 nodes \u4E0D\u662F\u6570\u7EC4");
  const parents = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const iid = lenientIid(node.iid);
    if (iid === void 0) continue;
    const parent = readParentNode(node.widgets);
    if (parent === void 0) continue;
    const parentIid = lenientIid(parent.iid);
    if (parentIid === void 0) continue;
    const type = parent.workItemType;
    const typeName = isRecord(type) && typeof type.name === "string" ? type.name.toLowerCase() : "";
    if (typeName === "issue" || typeName === "task") {
      parents.set(iid, `#${String(parentIid)}`);
    } else if (typeName === "epic") {
      parents.set(iid, `&${String(parentIid)}`);
    }
  }
  return parents;
}
function readParentNode(value) {
  if (!Array.isArray(value)) return void 0;
  for (const widget of value) {
    if (!isRecord(widget) || !Object.hasOwn(widget, "parent")) continue;
    const parent = widget.parent;
    if (isRecord(parent)) return parent;
  }
  return void 0;
}
function lenientIid(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const iid = Number.parseInt(value, 10);
    if (Number.isInteger(iid) && iid > 0) return iid;
  }
  return void 0;
}
function encodeProjectPath(path) {
  return encodeURIComponent(path);
}
function parseIssue2(value, index) {
  if (!isRecord(value)) throw invalid2(`\u7B2C ${String(index + 1)} \u5F20\u7968\u4E0D\u662F\u5BF9\u8C61`);
  const iid = value.iid;
  if (typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0) {
    throw invalid2(`\u7B2C ${String(index + 1)} \u5F20\u7968\u7684\u7F16\u53F7\u4E0D\u5408\u6CD5`);
  }
  const title = readString3(value.title, `\u7B2C ${String(iid)} \u5F20\u7968\u7684\u6807\u9898`);
  const state = readState3(value.state, iid);
  const closedAt = readClosedAt2(value.closed_at, iid);
  return {
    ticket: {
      ref: `#${String(iid)}`,
      number: iid,
      title,
      state,
      labels: readLabels2(value.labels),
      author: readAuthor2(value.author, GITLAB_AUTHOR_FIELDS),
      assignees: readLogins(value.assignees, GITLAB_AUTHOR_FIELDS),
      createdAt: readString3(value.created_at, `\u7B2C ${String(iid)} \u5F20\u7968\u7684\u521B\u5EFA\u65F6\u95F4`),
      updatedAt: readString3(value.updated_at, `\u7B2C ${String(iid)} \u5F20\u7968\u7684\u66F4\u65B0\u65F6\u95F4`),
      openBlockers: 0,
      blockedBy: [],
      ...closedAt === void 0 ? {} : { closedAt }
    },
    description: typeof value.description === "string" ? value.description : "",
    hasBlockingIssuesCount: Object.hasOwn(value, "blocking_issues_count")
  };
}
function readState3(value, iid) {
  if (value === "opened") return "open";
  if (value === "closed") return "closed";
  throw invalid2(`\u7B2C ${String(iid)} \u5F20\u7968\u7684\u72B6\u6001\u4E0D\u5408\u6CD5`);
}
function readLabels2(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (typeof label === "string" && label.length > 0) return [label];
    if (isRecord(label) && typeof label.name === "string" && label.name.length > 0) {
      return [label.name];
    }
    return [];
  });
}
function readIid(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const iid = Number.parseInt(value, 10);
    if (Number.isInteger(iid) && iid > 0) return iid;
  }
  throw invalid2("\u963B\u585E\u8BA1\u6570\u91CC\u7684\u5DE5\u5355\u7F16\u53F7\u4E0D\u5408\u6CD5");
}
function readString3(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid2(`${field} \u4E0D\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  }
  return value;
}
function readClosedAt2(value, iid) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || value.length === 0) {
    throw invalid2(`\u7B2C ${String(iid)} \u5F20\u7968\u7684\u5173\u95ED\u65F6\u95F4\u4E0D\u5408\u6CD5`);
  }
  return value;
}
function parseJson2(output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new TrackerError("fetch-failed", "GitLab \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON\u3002", { cause: error });
  }
}
function parseCurrentUsername(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    return null;
  }
  return readLogin(payload, "username");
}
function readLinksField(payload) {
  if (!isRecord(payload)) return void 0;
  return Array.isArray(payload.links) ? payload.links : void 0;
}
function invalid2(message) {
  return new TrackerError("fetch-failed", `\u5DE5\u5355\u6570\u636E\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitlab/env.ts
var AUTH_FAILURE3 = /glab auth login|not logged in|no token|token.*(?:expired|invalid)|HTTP 401/i;
var NOT_FOUND3 = /HTTP 404|404 Not Found|Project Not Found|project not found/i;
function createGitlabEnvProbe(deps) {
  return {
    kind: "gitlab",
    async cli(workspaceRoot) {
      try {
        const output = await deps.run("glab", ["--version"], { cwd: workspaceRoot });
        return { status: "pass", detail: output.executable ?? "glab" };
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: "\u672A\u627E\u5230 glab \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
        }
        return { status: "pass", detail: "glab" };
      }
    },
    async auth(workspaceRoot, remote) {
      if (remote === void 0) {
        return { status: "fail", detail: "\u6CA1\u6709\u53EF\u6838\u5BF9\u7684 GitLab \u8FDC\u7AEF", reason: "cli-unauthenticated" };
      }
      const host = normalizeHost(remote.host);
      let output;
      try {
        const result = await deps.run("glab", ["auth", "status"], { cwd: workspaceRoot });
        output = `${result.stdout}
${result.stderr}`;
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: "fail", detail: "\u672A\u627E\u5230 glab \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
        }
        output = error instanceof CommandError ? error.stderr : "";
      }
      const hosts = parseLoggedInHosts(output);
      if (!hosts.includes(host)) {
        return { status: "fail", detail: `\u672A\u767B\u5F55 ${host}`, reason: "cli-unauthenticated" };
      }
      return { status: "pass", detail: `\u5DF2\u767B\u5F55 ${host}` };
    },
    async repository(workspaceRoot, remote) {
      if (remote === void 0) {
        return {
          status: "fail",
          detail: "\u5F53\u524D\u8FDC\u7AEF\u4E0D\u662F GitLab \u9879\u76EE",
          reason: "repository-forbidden"
        };
      }
      try {
        const endpoint = `projects/${encodeProjectPath(remote.path)}`;
        await deps.run("glab", ["api", endpoint], { cwd: workspaceRoot });
        return { status: "pass", detail: `\u53EF\u8BBF\u95EE ${remote.path}` };
      } catch (error) {
        return repositoryFailure3(error);
      }
    }
  };
}
function repositoryFailure3(error) {
  if (isCommandNotFound(error)) {
    return { status: "fail", detail: "\u672A\u627E\u5230 glab \u53EF\u6267\u884C\u6587\u4EF6", reason: "cli-missing" };
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: "fail", detail: "\u7F51\u7EDC\u4E0D\u53EF\u8FBE\u6216\u8BF7\u6C42\u8D85\u65F6", reason: "repository-network" };
    }
    if (NOT_FOUND3.test(error.stderr)) {
      return {
        status: "fail",
        detail: "\u9879\u76EE\u4E0D\u5B58\u5728\uFF0C\u6216\u5F53\u524D\u8D26\u53F7\u65E0\u6743\u8BBF\u95EE",
        reason: "repository-not-found"
      };
    }
    if (AUTH_FAILURE3.test(error.stderr)) {
      return { status: "fail", detail: "\u4EE4\u724C\u5DF2\u5931\u6548", reason: "cli-unauthenticated" };
    }
  }
  return { status: "fail", detail: "\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\u6216\u4ED3\u5E93\u4E0D\u5B58\u5728", reason: "repository-forbidden" };
}

// src/core/markdown.ts
var HEADING = /^#\s+(.+?)\s*$/;
var COMMENTS_HEADING = /^##\s+Comments\b/i;
var STATUS = /^\s*Status:\s*(.+?)\s*$/i;
var BLOCKED_BY = /^\s*Blocked by:\s*(.*?)\s*$/i;
var PARENT = /^\s*Parent:\s*(.*?)\s*$/i;
var FILE_NUMBER = /^(\d+)(?:-|\.md$)/;
var REFERENCE = /\d+/g;
function parseMarkdownTickets(files) {
  const byFeature = /* @__PURE__ */ new Map();
  for (const file of files) {
    const number = fileNumber(file.name);
    if (number === void 0) continue;
    const numbers = byFeature.get(file.feature) ?? /* @__PURE__ */ new Map();
    numbers.set(number, file);
    byFeature.set(file.feature, numbers);
  }
  return files.map((file) => {
    const siblings = byFeature.get(file.feature);
    const blockers = blockersOf(file, siblings);
    const parent = parentOf(file, siblings);
    return {
      ref: file.path,
      number: null,
      title: titleOf(file),
      state: markdownState(file.content),
      labels: markdownLabels(file.content),
      author: null,
      assignees: [],
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      openBlockers: blockers.openBlockers,
      blockedBy: blockers.blockedBy,
      ...parent === void 0 ? {} : { parent }
    };
  });
}
function workspaceName(workspaceRoot) {
  const trimmed = workspaceRoot.replace(/[\\/]+$/, "");
  if (trimmed.length === 0) return workspaceRoot;
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separator === -1) return trimmed;
  return trimmed.slice(separator + 1);
}
function titleFromFileName(name) {
  const withoutExtension = name.replace(/\.md$/i, "");
  const withoutNumber = withoutExtension.replace(/^\d+-/, "");
  return withoutNumber.length > 0 ? withoutNumber : withoutExtension;
}
function markdownLabels(content) {
  const status = parseTicketStatus(content);
  return status === void 0 ? [] : [status];
}
function markdownState(content) {
  return parseTicketStatus(content) === "resolved" ? "closed" : "open";
}
function titleOf(file) {
  const heading = firstHeading(file.content);
  return heading ?? titleFromFileName(file.name);
}
function firstHeading(content) {
  for (const line of content.split("\n")) {
    const match = HEADING.exec(line.trimEnd());
    if (match !== null) return match[1];
  }
  return void 0;
}
function parseTicketStatus(content) {
  for (const line of preambleOf(content).split("\n")) {
    const match = STATUS.exec(line);
    if (match === null) continue;
    const value = match[1]?.trim().split(/\s+/)[0]?.toLowerCase();
    if (value !== void 0 && value.length > 0) return value;
  }
  return void 0;
}
function blockersOf(file, siblings) {
  const empty = { openBlockers: 0, blockedBy: [] };
  if (siblings === void 0) return empty;
  const line = blockedByLine(file.content);
  if (line === void 0) return empty;
  let openBlockers = 0;
  const blockedBy = [];
  const seen = /* @__PURE__ */ new Set();
  for (const reference of referencedNumbers(line)) {
    if (seen.has(reference)) continue;
    seen.add(reference);
    const blocker = siblings.get(reference);
    if (blocker === void 0 || parseTicketStatus(blocker.content) !== "resolved")
      openBlockers += 1;
    if (blocker !== void 0) blockedBy.push(blocker.path);
  }
  return { openBlockers, blockedBy };
}
function blockedByLine(content) {
  for (const line of preambleOf(content).split("\n")) {
    const match = BLOCKED_BY.exec(line);
    if (match !== null) return match[1] ?? "";
  }
  return void 0;
}
function parentOf(file, siblings) {
  if (siblings === void 0) return void 0;
  const line = parentLine(file.content);
  if (line === void 0) return void 0;
  const [reference] = referencedNumbers(line);
  if (reference === void 0 || reference === fileNumber(file.name)) return void 0;
  return siblings.get(reference)?.path;
}
function parentLine(content) {
  for (const line of preambleOf(content).split("\n")) {
    const match = PARENT.exec(line);
    if (match !== null) return match[1] ?? "";
  }
  return void 0;
}
function preambleOf(content) {
  const heading = /^##\s+Comments\b/im.exec(content);
  return heading === null ? content : content.slice(0, heading.index);
}
function referencedNumbers(line) {
  const numbers = [];
  for (const match of line.matchAll(REFERENCE)) {
    const value = Number.parseInt(match[0], 10);
    if (Number.isInteger(value)) numbers.push(value);
  }
  return numbers;
}
function fileNumber(name) {
  const match = FILE_NUMBER.exec(name);
  if (match === null) return void 0;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(value) ? value : void 0;
}
function parseMarkdownDetail(content, fallbackTitle) {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => HEADING.test(line.trimEnd()));
  const commentsIndex = lines.findIndex((line) => COMMENTS_HEADING.test(line.trimEnd()));
  const heading = headingIndex === -1 ? void 0 : HEADING.exec(lines[headingIndex]?.trimEnd() ?? "");
  const bodyStart = headingIndex === -1 ? 0 : headingIndex + 1;
  const bodyEnd = commentsIndex === -1 ? lines.length : commentsIndex;
  return {
    title: heading?.[1] ?? fallbackTitle,
    body: lines.slice(bodyStart, bodyEnd).join("\n").trim(),
    comments: commentsIndex === -1 ? [] : lines.slice(commentsIndex + 1).join("\n").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0)
  };
}

// src/adapters/markdown/files.ts
import { readFile as readFile2, readdir as readdir2, stat as stat3 } from "node:fs/promises";
function joinPath(base, ...segments) {
  return [base.replace(/[\\/]+$/, ""), ...segments].join("/");
}
function createNodeWorkspaceFiles() {
  return {
    async listDirectory(path) {
      try {
        const entries = await readdir2(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file"
        }));
      } catch (error) {
        if (isMissingFile(error)) return void 0;
        throw error;
      }
    },
    async readTextFile(path) {
      return readFile2(path, "utf8");
    },
    async statFile(path) {
      const info = await stat3(path);
      return {
        // 部分文件系统拿不到 birthtime，退回 mtime 比显示 1970 年更诚实。
        createdAt: info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs,
        updatedAt: info.mtimeMs
      };
    }
  };
}
async function readLocalTicketFiles(files, workspaceRoot) {
  const scratch = joinPath(workspaceRoot, ".scratch");
  const features = await files.listDirectory(scratch);
  if (features === void 0) return void 0;
  const tickets = [];
  for (const feature of sortEntries(features)) {
    if (feature.kind !== "directory") continue;
    const issuesDirectory = joinPath(scratch, feature.name, "issues");
    const entries = await files.listDirectory(issuesDirectory);
    if (entries === void 0) continue;
    for (const entry of sortEntries(entries)) {
      if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue;
      const path = joinPath(issuesDirectory, entry.name);
      const [content, timestamps] = await Promise.all([
        files.readTextFile(path),
        files.statFile(path)
      ]);
      tickets.push({
        path: `.scratch/${feature.name}/issues/${entry.name}`,
        feature: feature.name,
        name: entry.name,
        content,
        createdAt: new Date(timestamps.createdAt).toISOString(),
        updatedAt: new Date(timestamps.updatedAt).toISOString()
      });
    }
  }
  return tickets;
}
function sortEntries(entries) {
  return [...entries].sort(
    (left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
}
async function readChangedTicketFiles(files, workspaceRoot, since) {
  const scratch = joinPath(workspaceRoot, ".scratch");
  const features = await files.listDirectory(scratch);
  if (features === void 0) return void 0;
  const changed = [];
  const context = [];
  for (const feature of sortEntries(features)) {
    if (feature.kind !== "directory") continue;
    const issuesDirectory = joinPath(scratch, feature.name, "issues");
    const entries = await files.listDirectory(issuesDirectory);
    if (entries === void 0) continue;
    const candidates = sortEntries(entries).filter(
      (entry) => entry.kind === "file" && entry.name.endsWith(".md")
    );
    if (candidates.length === 0) continue;
    const moved = [];
    const untouched = [];
    for (const entry of candidates) {
      const path = joinPath(issuesDirectory, entry.name);
      const timestamps = await files.statFile(path);
      if (timestamps.updatedAt > since) {
        moved.push(await readTicketFile(files, feature.name, entry.name, path, timestamps));
      } else {
        untouched.push({ entry, timestamps });
      }
    }
    if (moved.length === 0) continue;
    changed.push(...moved);
    for (const sibling of referencedSiblings(moved, untouched, feature.name)) {
      const path = joinPath(issuesDirectory, sibling.entry.name);
      context.push(
        await readTicketFile(files, feature.name, sibling.entry.name, path, sibling.timestamps)
      );
    }
  }
  return { changed, context };
}
function referencedSiblings(moved, untouched, feature) {
  const movedPaths = new Set(moved.map((file) => file.path));
  const placeholders = untouched.map(({ entry }) => ({
    path: `.scratch/${feature}/issues/${entry.name}`,
    feature,
    name: entry.name,
    content: "",
    createdAt: "",
    updatedAt: ""
  }));
  const probe = parseMarkdownTickets([...moved, ...placeholders]);
  const referenced = /* @__PURE__ */ new Set();
  for (const ticket of probe) {
    if (!movedPaths.has(ticket.ref)) continue;
    for (const ref of ticket.blockedBy ?? []) referenced.add(ref);
    if (ticket.parent !== void 0) referenced.add(ticket.parent);
  }
  return untouched.filter(({ entry }) => referenced.has(`.scratch/${feature}/issues/${entry.name}`));
}
async function readTicketFile(files, feature, name, path, timestamps) {
  const content = await files.readTextFile(path);
  return {
    path: `.scratch/${feature}/issues/${name}`,
    feature,
    name,
    content,
    createdAt: new Date(timestamps.createdAt).toISOString(),
    updatedAt: new Date(timestamps.updatedAt).toISOString()
  };
}
function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

// src/adapters/markdown/env.ts
function createLocalIssuesProbe(deps) {
  return async (workspaceRoot) => {
    const tickets = await readLocalTicketFiles(deps.files, workspaceRoot);
    if (tickets === void 0) return { status: "no-scratch" };
    if (tickets.length === 0) return { status: "no-files" };
    const unparsable = tickets.filter((ticket) => parseTicketStatus(ticket.content) === void 0).map((ticket) => ticket.path);
    if (unparsable.length > 0) return { status: "unparsable", files: unparsable };
    return { status: "found", files: tickets.map((ticket) => ticket.path) };
  };
}

// src/protocol/labels.ts
var TRACKER_LABELS = {
  /** 规格完整、可以直接交给 agent 的票。 */
  readyForAgent: "ready-for-agent",
  /** 还没定性，需要维护者先评估。 */
  needsTriage: "needs-triage",
  /** 还在等报告人补信息。 */
  needsInfo: "needs-info",
  /** 需要人工实现，不交给 agent。 */
  readyForHuman: "ready-for-human",
  /** 已经决定不做。 */
  wontfix: "wontfix",
  /** 缺陷分类。 */
  bug: "bug",
  /** 需求分类。 */
  enhancement: "enhancement"
};
var TRIAGE_LABELS = [
  TRACKER_LABELS.needsTriage,
  TRACKER_LABELS.needsInfo,
  TRACKER_LABELS.readyForAgent,
  TRACKER_LABELS.readyForHuman,
  TRACKER_LABELS.wontfix
];

// src/protocol/log-events.ts
var LOG_EVENTS = {
  /** 一次工单拉取或阻塞补齐；`stage` 区分列表与补齐两段耗时。 */
  snapshot: "tracker.snapshot",
  /** 一次工单详情读取或变更提交。 */
  ticket: "tracker.ticket",
  /** 一次环境检查。 */
  envCheck: "env.check"
};
var SNAPSHOT_STAGES = {
  list: "list",
  blockers: "blockers"
};
var TICKET_ACTIONS = {
  get: "get",
  update: "update",
  options: "options",
  delete: "delete",
  worktree: "worktree"
};

// src/protocol/tracker.ts
var RPC_METHODS = {
  /** 读缓存；没有缓存时拉取一次。阻塞信息可能尚未定稿。 */
  snapshotGet: "snapshot.get",
  /** 忽略缓存，强制拉取。 */
  snapshotRefresh: "snapshot.refresh",
  /** 按快照给出的游标取下一段工单，追加到已加载的列表；没有更多时原样返回。 */
  snapshotLoadMore: "snapshot.loadMore",
  /** 补齐原生阻塞信息；快照已定稿时直接返回缓存。同一工作区的进行中请求会复用。 */
  snapshotResolveBlockers: "snapshot.resolveBlockers",
  /** 读取本地快照库的信息；带确认词时可以清空它。 */
  snapshotCache: "snapshot.cache",
  /** 重新跑一次环境检查；同一工作区的进行中请求会复用。 */
  envCheck: "env.check",
  /** 读取单张工单详情；只在打开详情时请求，不进入列表快照。 */
  ticketGet: "ticket.get",
  /** 应用一次工单变更；成功后界面重新读取详情并刷新列表快照。 */
  ticketUpdate: "ticket.update",
  /** 读取仓库的标签与可分配用户，供详情里添加标签、分配人时补全。 */
  ticketOptions: "ticket.options",
  /** 永久删除一张工单；必须带 `confirm: 'delete'`，宿主再按权限拒绝或执行。 */
  ticketDelete: "ticket.delete",
  /** 为一张能开工的远端工单创建 Orca 托管的 worktree；同分支已存在时返回既有工作区。 */
  ticketWorktree: "ticket.worktree"
};
var AVATAR_READ_METHOD = "avatar.read";
var SNAPSHOT_CLEAR_CONFIRMATION = "clear-cache";
var TICKET_DELETE_CONFIRMATION = "delete";
var ERROR_CODES = {
  ghMissing: "gh-missing",
  ghUnauthenticated: "gh-unauthenticated",
  glabMissing: "glab-missing",
  glabUnauthenticated: "glab-unauthenticated",
  teaMissing: "tea-missing",
  teaUnauthenticated: "tea-unauthenticated",
  markdownReadFailed: "markdown-read-failed",
  fetchFailed: "fetch-failed",
  /** 编号不存在或工单已被删除。 */
  ticketNotFound: "ticket-not-found",
  /** 当前后端不提供所请求的详情或写能力。 */
  capabilityUnsupported: "capability-unsupported",
  /** 机器上找不到可用的 Orca 命令行；环境检查里能定位到具体解决方式。 */
  orcaMissing: "orca-missing",
  /** Orca 命令行存在，但创建 worktree 失败；消息里带命令行的诊断。 */
  worktreeCreateFailed: "worktree-create-failed",
  invalidParams: "invalid-params",
  unknownMethod: "unknown-method",
  invalidRequest: "invalid-request",
  internal: "internal"
};
var ERROR_BACKENDS = {
  [ERROR_CODES.ghMissing]: "github",
  [ERROR_CODES.ghUnauthenticated]: "github",
  [ERROR_CODES.glabMissing]: "gitlab",
  [ERROR_CODES.glabUnauthenticated]: "gitlab",
  [ERROR_CODES.teaMissing]: "gitea",
  [ERROR_CODES.teaUnauthenticated]: "gitea"
};
var ENV_ISSUE_ERROR_CODES = [
  ...Object.keys(ERROR_BACKENDS),
  ERROR_CODES.orcaMissing
];

// src/worker/avatar-service.ts
var DEFAULT_TIMEOUT_MS = 8e3;
var DEFAULT_MAX_BYTES = 1024 * 1024;
function createAvatarService(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  return {
    async read(params, signal) {
      const url = readAvatarUrl(params);
      if (url === null) {
        return failure(ERROR_CODES.invalidParams, "\u5934\u50CF\u5730\u5740\u4E0D\u662F http(s) \u7EDD\u5BF9\u5730\u5740\u3002");
      }
      return await loadAvatar(fetchImpl, url, timeoutMs, maxBytes, signal);
    }
  };
}
function readAvatarUrl(params) {
  if (!isRecord(params)) return null;
  const value = params["url"];
  if (typeof value !== "string") return null;
  const normalized = normalizeAvatarUrl(value);
  if (normalized === null) return null;
  const url = new URL(normalized);
  if (url.username.length > 0 || url.password.length > 0) return null;
  return url.toString();
}
async function loadAvatar(fetchImpl, url, timeoutMs, maxBytes, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const abort = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/*" }
    });
    if (!response.ok) return failure(ERROR_CODES.fetchFailed, `\u8BFB\u53D6\u5934\u50CF\u5931\u8D25\uFF1AHTTP ${response.status}`);
    const mime = readImageMime(response.headers.get("content-type"));
    if (mime === null) return failure(ERROR_CODES.fetchFailed, "\u8FDC\u7AEF\u8FD4\u56DE\u7684\u4E0D\u662F\u56FE\u7247\u3002");
    const bytes = await readBody(response, maxBytes);
    if (bytes === null) return failure(ERROR_CODES.fetchFailed, "\u5934\u50CF\u6587\u4EF6\u8FC7\u5927\u6216\u8BFB\u53D6\u5931\u8D25\u3002");
    return {
      ok: true,
      result: { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
    };
  } catch {
    return failure(ERROR_CODES.fetchFailed, "\u8BFB\u53D6\u5934\u50CF\u5931\u8D25\u3002");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function readImageMime(header) {
  if (header === null) return null;
  const mime = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : null;
}
async function readBody(response, maxBytes) {
  const body = response.body;
  if (body === null) return null;
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === void 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

// src/core/blocked-by.ts
var BLOCKED_BY2 = /^\s*Blocked by:\s*(.*)$/im;
var REFERENCE2 = /#?(\d+)/g;
function descriptionBlockerNumbers(description) {
  const line = BLOCKED_BY2.exec(preambleOf2(description));
  if (line === null) return [];
  const seen = /* @__PURE__ */ new Set();
  const numbers = [];
  for (const match of (line[1] ?? "").matchAll(REFERENCE2)) {
    const number = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isInteger(number) || seen.has(number)) continue;
    seen.add(number);
    numbers.push(number);
  }
  return numbers;
}
function countOpenBlockers(numbers, states) {
  let count = 0;
  for (const number of numbers) {
    if (states.get(number) !== "closed") count += 1;
  }
  return count;
}
function hasDescriptionBlockers(description) {
  return BLOCKED_BY2.test(preambleOf2(description));
}
function countDescriptionBlockers(description, states) {
  return countOpenBlockers(descriptionBlockerNumbers(description), states);
}
function remoteBlockerRefs(numbers) {
  return numbers.map((number) => `#${String(number)}`);
}
function resolveOpenBlockers(input) {
  if (input.ticket.state !== "open" || input.ticket.number === null) {
    return { openBlockers: 0, blockedBy: [] };
  }
  const native = input.nativeBlockers;
  if (native !== void 0 && (native.open > 0 || native.refs.length > 0)) {
    return {
      openBlockers: native.open > 0 ? native.open : countDescriptionBlockers(input.text, input.states),
      blockedBy: remoteBlockerRefs(native.refs)
    };
  }
  const numbers = descriptionBlockerNumbers(input.text);
  return {
    openBlockers: countOpenBlockers(numbers, input.states),
    blockedBy: remoteBlockerRefs(numbers)
  };
}
function preambleOf2(description) {
  const heading = /^##\s+Comments\b/im.exec(description);
  return heading === null ? description : description.slice(0, heading.index);
}

// src/core/concurrency.ts
async function mapWithConcurrency(items, limit, worker) {
  const runners = Math.min(Math.max(1, Math.trunc(limit)), items.length);
  const results = /* @__PURE__ */ new Map();
  const errors = [];
  let next = 0;
  const run = async () => {
    while (errors.length === 0) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === void 0) return;
      try {
        results.set(index, await worker(item));
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
  await Promise.all(Array.from({ length: runners }, run));
  const failure6 = errors[0];
  if (failure6 !== void 0) throw failure6;
  return items.map((_, index) => {
    const result = results.get(index);
    if (result === void 0) throw new Error("\u5E76\u53D1\u6620\u5C04\u6CA1\u6709\u8FD4\u56DE\u7ED3\u679C");
    return result;
  });
}

// src/core/ticket-detail.ts
function diffSets(current, target) {
  const currentSet = new Set(current);
  const targetSet = new Set(target);
  return {
    add: target.filter((value) => !currentSet.has(value)),
    remove: current.filter((value) => !targetSet.has(value))
  };
}
function resolveTargetSet(current, requested, self = null) {
  const target = requested === void 0 ? [...current] : [...requested];
  if (self !== null && !target.includes(self)) target.push(self);
  return target;
}
function planSetChange(current, requested, self = null) {
  return diffSets(current, resolveTargetSet(current, requested, self));
}
function isEmptyDiff(diff) {
  return diff.add.length === 0 && diff.remove.length === 0;
}
function normalizeLabelColor(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}
function dedupeBy(items, key) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(item);
  }
  return unique;
}
function readOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function readRequiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) throw invalidDetail(`${field}\u4E0D\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  return value;
}
function readNameList(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.length > 0) return [entry];
    if (isRecord(entry)) {
      const name = readOptionalString(entry.name);
      if (name !== null) return [name];
    }
    return [];
  });
}
function requireTicketNumber(reference) {
  if (reference.number === null) {
    throw new TrackerError("ticket-not-found", "\u5DE5\u5355\u7F3A\u5C11\u6570\u5B57\u7F16\u53F7\uFF0C\u65E0\u6CD5\u5B9A\u4F4D\u3002");
  }
  return reference.number;
}
function invalidDetail(message) {
  return new TrackerError("fetch-failed", `\u5DE5\u5355\u8BE6\u60C5\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}
function sortCommentsByTime(comments) {
  return [...comments].sort(
    (left, right) => (left.createdAt ?? "") < (right.createdAt ?? "") ? -1 : (left.createdAt ?? "") > (right.createdAt ?? "") ? 1 : 0
  );
}

// src/adapters/gitea/shared.ts
var SEGMENT = /^[A-Za-z0-9_.-]+$/;
var AUTH_FAILURE4 = /tea login add|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|HTTP 403|Unauthorized|Forbidden/i;
async function readRepository(run, workspaceRoot) {
  let output;
  try {
    output = (await run("git", ["remote", "-v"], { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw new TrackerError("fetch-failed", "\u8BFB\u53D6 git \u8FDC\u7AEF\u5931\u8D25\uFF0C\u65E0\u6CD5\u8BC6\u522B Gitea \u4ED3\u5E93\u3002", {
      cause: error
    });
  }
  const remotes = parseRemotes(output);
  const address = pickRemoteAddress(remotes);
  if (address === void 0) {
    throw new TrackerError("fetch-failed", "\u5F53\u524D\u4ED3\u5E93\u7684 origin \u4E0D\u662F\u53EF\u8BC6\u522B\u7684 Gitea \u8FDC\u7AEF\u3002");
  }
  const segments = address.path.split("/");
  const owner = segments[0];
  const name = segments[1];
  if (segments.length !== 2 || owner === void 0 || name === void 0) {
    throw new TrackerError("fetch-failed", "Gitea \u8FDC\u7AEF\u5730\u5740\u65E0\u6CD5\u8BC6\u522B owner/name\u3002");
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new TrackerError("fetch-failed", "Gitea \u8FDC\u7AEF\u5730\u5740\u65E0\u6CD5\u8BC6\u522B owner/name\u3002");
  }
  return {
    owner,
    name,
    avatarBaseUrl: avatarBaseUrl(pickRemote(remotes)?.url, address.host)
  };
}
function avatarBaseUrl(remoteUrl, host) {
  if (remoteUrl !== void 0) {
    try {
      const url = new URL(remoteUrl.trim());
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
    }
  }
  return `https://${host}`;
}
async function callGiteaApi(run, workspaceRoot, endpoint, method) {
  try {
    const args = method === void 0 ? ["api", "--include", endpoint] : ["api", "--include", "--method", method, endpoint];
    const output = await run("tea", args, { cwd: workspaceRoot });
    return parseApiResponse(output.stdout, output.stderr);
  } catch (error) {
    throw mapTeaError(error);
  }
}
function ensureSuccess(response, action) {
  if (response.status < 400) return;
  if (response.status === 401 || response.status === 403) {
    throw new TrackerError(
      "tea-unauthenticated",
      "tea \u672A\u767B\u5F55\u8BE5\u5B9E\u4F8B\u6216\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u8FD0\u884C tea login add\u3002"
    );
  }
  throw new TrackerError(
    "fetch-failed",
    `${action}\u5931\u8D25\uFF1AGitea \u8FD4\u56DE HTTP ${String(response.status)}\u3002`
  );
}
async function callTea(run, workspaceRoot, args) {
  try {
    return (await run("tea", args, { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw mapTeaError(error);
  }
}
function mapTeaError(error) {
  if (error instanceof CommandError) {
    if (error.kind === "not-found") {
      return new TrackerError(
        "tea-missing",
        "\u672A\u627E\u5230 tea \u547D\u4EE4\uFF0C\u8BF7\u5148\u5B89\u88C5 Gitea CLI\uFF08https://gitea.com/gitea/tea\uFF09\u3002",
        { cause: error }
      );
    }
    if (AUTH_FAILURE4.test(error.stderr)) {
      return new TrackerError(
        "tea-unauthenticated",
        "tea \u672A\u767B\u5F55\u8BE5\u5B9E\u4F8B\u6216\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u8FD0\u884C tea login add\u3002",
        { cause: error }
      );
    }
    return new TrackerError("fetch-failed", `\u8BFB\u53D6 Gitea \u5DE5\u5355\u5931\u8D25\uFF1A${commandFailureDetail(error)}`, {
      cause: error
    });
  }
  return new TrackerError("fetch-failed", "\u8BFB\u53D6 Gitea \u5DE5\u5355\u5931\u8D25\u3002", { cause: error });
}

// src/adapters/gitea/delete.ts
async function readGiteaDeletePermission(deps, workspaceRoot) {
  const repository = await readRepository(deps.run, workspaceRoot);
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}`
  );
  ensureSuccess(response, "\u8BFB\u53D6 Gitea \u4ED3\u5E93\u6743\u9650");
  const payload = parseJson3(response.body, "\u4ED3\u5E93\u6743\u9650");
  if (!isRecord(payload)) throw invalidPermission("\u4ED3\u5E93\u6743\u9650\u4E0D\u662F\u5BF9\u8C61");
  return isRecord(payload.permissions) && payload.permissions.admin === true;
}
async function deleteGiteaTicket(deps, workspaceRoot, reference) {
  const number = requireTicketNumber(reference);
  const repository = await readRepository(deps.run, workspaceRoot);
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/issues/${String(number)}`,
    "DELETE"
  );
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 404) {
    throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002");
  }
  if (response.status === 403) {
    throw new TrackerError("fetch-failed", "\u6CA1\u6709\u5220\u9664\u8FD9\u5F20\u5DE5\u5355\u7684\u6743\u9650\uFF1A\u9700\u8981 Gitea \u4ED3\u5E93\u7BA1\u7406\u5458\u3002");
  }
  ensureSuccess(response, "\u5220\u9664 Gitea \u5DE5\u5355");
}
function parseJson3(body, field) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", `Gitea \u8FD4\u56DE\u7684${field}\u4E0D\u662F\u6709\u6548 JSON\u3002`, {
      cause: error
    });
  }
}
function invalidPermission(message) {
  return new TrackerError("fetch-failed", `\u5220\u9664\u6743\u9650\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitea/detail.ts
async function readGiteaDetail(deps, workspaceRoot, reference) {
  const number = requireTicketNumber(reference);
  const repository = await readRepository(deps.run, workspaceRoot);
  const issue = await readIssue(deps, workspaceRoot, repository, number);
  const comments = await readComments(deps, workspaceRoot, repository, number);
  return {
    ref: reference.ref,
    number,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    body: issue.body,
    labels: issue.labels,
    assignees: issue.assignees,
    comments,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt
  };
}
async function applyGiteaChanges(deps, workspaceRoot, reference, patch) {
  const number = requireTicketNumber(reference);
  const repository = await readRepository(deps.run, workspaceRoot);
  const current = await readIssue(deps, workspaceRoot, repository, number);
  if (patch.labels !== void 0) {
    const diff = planSetChange(current.labels, patch.labels);
    if (!isEmptyDiff(diff)) {
      await callTea(deps.run, workspaceRoot, [
        "issues",
        "edit",
        String(number),
        ...diff.add.length === 0 ? [] : ["--add-labels", diff.add.join(",")],
        ...diff.remove.length === 0 ? [] : ["--remove-labels", diff.remove.join(",")]
      ]);
    }
  }
  if (patch.assignees !== void 0 || patch.assignSelf === true) {
    const self = patch.assignSelf === true ? await readCurrentLogin(deps.run, workspaceRoot) : null;
    const currentLogins = current.assignees.map((user) => user.login);
    const target = resolveTargetSet(currentLogins, patch.assignees, self);
    await callTea(deps.run, workspaceRoot, [
      "issues",
      "edit",
      String(number),
      "--set-assignees",
      target.join(",")
    ]);
  }
  if (patch.state !== void 0 && patch.state !== current.state) {
    await callTea(deps.run, workspaceRoot, [
      "issues",
      patch.state === "closed" ? "close" : "reopen",
      String(number)
    ]);
  }
}
async function readIssue(deps, workspaceRoot, repository, number) {
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/issues/${String(number)}`
  );
  ensureDetailSuccess(response, "\u8BFB\u53D6 Gitea \u5DE5\u5355\u8BE6\u60C5");
  return parseIssue3(response.body, repository.avatarBaseUrl);
}
async function readComments(deps, workspaceRoot, repository, number) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const endpoint = `/repos/${repository.owner}/${repository.name}/issues/${String(number)}/comments?page=${String(page)}&limit=${String(deps.pageSize)}`;
    const response = await callGiteaApi(deps.run, workspaceRoot, endpoint);
    ensureDetailSuccess(response, "\u8BFB\u53D6 Gitea \u5DE5\u5355\u8BC4\u8BBA");
    const parsed = parseCommentsPage(response.body, repository.avatarBaseUrl);
    comments.push(...parsed);
    if (parsed.length < deps.pageSize) break;
  }
  return sortCommentsByTime(comments);
}
async function readCurrentLogin(run, workspaceRoot) {
  const response = await callGiteaApi(run, workspaceRoot, "/user");
  ensureDetailSuccess(response, "\u8BFB\u53D6 Gitea \u5F53\u524D\u7528\u6237");
  const login = parseCurrentLogin(response.body);
  if (login === null) throw invalidDetail("\u5F53\u524D\u7528\u6237\u7F3A\u5C11 login");
  return login;
}
function ensureDetailSuccess(response, action) {
  if (response.status === 404) {
    throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002");
  }
  ensureSuccess(response, action);
}
function parseIssue3(body, avatarBaseUrl2) {
  const payload = parseJson4(body);
  if (!isRecord(payload)) throw invalidDetail("\u5DE5\u5355\u8BE6\u60C5\u4E0D\u662F\u5BF9\u8C61");
  return {
    title: readRequiredString(payload.title, "\u6807\u9898"),
    state: readState4(payload.state),
    author: readAuthor2(payload.user, GITEA_AUTHOR_FIELDS, avatarBaseUrl2),
    body: typeof payload.body === "string" ? payload.body : "",
    labels: readNameList(payload.labels),
    assignees: readAuthors(payload.assignees, GITEA_AUTHOR_FIELDS, avatarBaseUrl2),
    url: readOptionalString(payload.html_url),
    createdAt: readRequiredString(payload.created_at, "\u521B\u5EFA\u65F6\u95F4"),
    updatedAt: readRequiredString(payload.updated_at, "\u66F4\u65B0\u65F6\u95F4")
  };
}
function parseCommentsPage(body, avatarBaseUrl2) {
  const payload = parseJson4(body);
  if (!Array.isArray(payload)) throw invalidDetail("\u8BC4\u8BBA\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const comments = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const text = typeof entry.body === "string" ? entry.body : "";
    if (text.length === 0) continue;
    comments.push({
      author: readAuthor2(entry.user, GITEA_AUTHOR_FIELDS, avatarBaseUrl2),
      body: text,
      createdAt: readOptionalString(entry.created_at)
    });
  }
  return comments;
}
function readState4(value) {
  if (value === "open") return "open";
  if (value === "closed") return "closed";
  throw invalidDetail("\u72B6\u6001\u4E0D\u662F open \u6216 closed");
}
function parseJson4(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", "Gitea \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON\u3002", { cause: error });
  }
}

// src/adapters/gitea/options.ts
var LABEL_PAGE_SIZE = 50;
var MAX_PAGES = 200;
async function readGiteaOptions(deps, workspaceRoot) {
  const repository = await readRepository(deps.run, workspaceRoot);
  return {
    labels: await readLabels3(deps, workspaceRoot, repository),
    assignees: await readAssignees(deps, workspaceRoot, repository)
  };
}
async function readLabels3(deps, workspaceRoot, repository) {
  const labels = [];
  let total;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const endpoint = `/repos/${repository.owner}/${repository.name}/labels?limit=${String(LABEL_PAGE_SIZE)}&page=${String(page)}`;
    const response = await callGiteaApi(deps.run, workspaceRoot, endpoint);
    ensureSuccess(response, "\u8BFB\u53D6 Gitea \u6807\u7B7E");
    const parsed = parseLabels(response.body);
    labels.push(...parsed);
    total ??= response.total;
    if (total !== void 0) {
      if (labels.length >= total) break;
    } else if (parsed.length < LABEL_PAGE_SIZE) {
      break;
    }
    if (parsed.length === 0) break;
  }
  return dedupeBy(labels, (label) => label.name);
}
async function readAssignees(deps, workspaceRoot, repository) {
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/assignees`
  );
  ensureSuccess(response, "\u8BFB\u53D6 Gitea \u53EF\u5206\u914D\u7528\u6237");
  const payload = parseJson5(response.body, "\u53EF\u5206\u914D\u7528\u6237");
  if (!Array.isArray(payload)) throw invalidOptions("\u53EF\u5206\u914D\u7528\u6237\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const assignees = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const username = readOptionalString(entry.login);
    if (username === null) continue;
    assignees.push({ username, name: readOptionalString(entry.full_name) });
  }
  return dedupeBy(assignees, (assignee) => assignee.username);
}
function parseLabels(body) {
  const payload = parseJson5(body, "\u6807\u7B7E");
  if (!Array.isArray(payload)) throw invalidOptions("\u6807\u7B7E\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const labels = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const name = readOptionalString(entry.name);
    if (name === null) continue;
    labels.push({
      name,
      color: normalizeLabelColor(entry.color),
      description: readOptionalString(entry.description)
    });
  }
  return labels;
}
function parseJson5(body, field) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", `Gitea \u8FD4\u56DE\u7684${field}\u4E0D\u662F\u6709\u6548 JSON\u3002`, {
      cause: error
    });
  }
}
function invalidOptions(message) {
  return new TrackerError("fetch-failed", `\u8865\u5168\u5019\u9009\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitea/tracker.ts
var DEFAULT_PAGE_SIZE = 50;
var DEFAULT_CONCURRENCY = 4;
var MAX_PAGES2 = 200;
function createGiteaTracker(deps) {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const concurrency = normalizePositive(
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY
  );
  const detailDeps = { run: deps.run, pageSize };
  return {
    async fetchSnapshot(workspaceRoot) {
      const repository = await readRepository(deps.run, workspaceRoot);
      const viewer = readCurrentViewer(deps, workspaceRoot);
      const issues = await readIssues(deps, workspaceRoot, repository, pageSize);
      const states = /* @__PURE__ */ new Map();
      for (const issue of issues.items) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state);
      }
      const native = await readNativeBlockers(
        deps,
        workspaceRoot,
        repository,
        issues.items,
        pageSize,
        concurrency
      );
      const tickets = issues.items.map((issue) => ({
        ...issue.ticket,
        ...resolveOpenBlockers({
          ticket: issue.ticket,
          nativeBlockers: native?.get(issue.ticket.number ?? -1),
          text: issue.body,
          states
        })
      }));
      return {
        repository: `${repository.owner}/${repository.name}`,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: Math.max(issues.total ?? tickets.length, tickets.length),
        tickets,
        viewer: await viewer,
        // Gitea 没有原生子工单能力；不发明正文约定，父子布局禁用。
        hierarchy: "none"
      };
    },
    async fetchChanges(workspaceRoot, since) {
      return readGiteaChanges(deps, workspaceRoot, pageSize, since, concurrency);
    },
    fetchDetail: (workspaceRoot, reference) => readGiteaDetail(detailDeps, workspaceRoot, reference),
    updateTicket: (workspaceRoot, reference, patch) => applyGiteaChanges(detailDeps, workspaceRoot, reference, patch),
    fetchOptions: (workspaceRoot) => readGiteaOptions(deps, workspaceRoot),
    canDeleteTickets: (workspaceRoot) => readGiteaDeletePermission(deps, workspaceRoot),
    deleteTicket: (workspaceRoot, reference) => deleteGiteaTicket(deps, workspaceRoot, reference)
  };
}
async function readGiteaChanges(deps, workspaceRoot, pageSize, since, concurrency) {
  if (!Number.isFinite(since)) {
    throw new TrackerError("fetch-failed", "\u589E\u91CF\u7A97\u53E3\u7684\u8D77\u70B9\u4E0D\u662F\u6709\u6548\u65F6\u95F4\u6233\u3002");
  }
  const repository = await readRepository(deps.run, workspaceRoot);
  const viewer = readCurrentViewer(deps, workspaceRoot);
  const issues = await readIssues(deps, workspaceRoot, repository, pageSize, since);
  const states = /* @__PURE__ */ new Map();
  for (const issue of issues.items) {
    if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state);
  }
  const native = await readNativeBlockers(
    deps,
    workspaceRoot,
    repository,
    issues.items,
    pageSize,
    concurrency
  );
  const tickets = issues.items.map((issue) => ({
    ...issue.ticket,
    ...resolveOpenBlockers({
      ticket: issue.ticket,
      nativeBlockers: native?.get(issue.ticket.number ?? -1),
      text: issue.body,
      states
    })
  }));
  const login = await viewer;
  return {
    tickets,
    truncated: issues.truncated,
    // 身份查询失败时省略，宿主沿用基准数据里的身份。
    ...login === null ? {} : { viewer: login },
    hierarchy: "none"
  };
}
async function readCurrentViewer(deps, workspaceRoot) {
  try {
    const response = await callGiteaApi(deps.run, workspaceRoot, "/user");
    return parseCurrentLogin(response.body);
  } catch {
    return null;
  }
}
async function readIssues(deps, workspaceRoot, repository, pageSize, since) {
  const items = [];
  let total;
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES2; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      issuesEndpoint(repository, pageSize, page, since)
    );
    ensureSuccess(response, "\u8BFB\u53D6 Gitea \u5DE5\u5355");
    const parsed = parseIssuesPage(response.body, repository.avatarBaseUrl);
    items.push(...parsed);
    total ??= response.total;
    if (total !== void 0 && items.length >= total) break;
    if (parsed.length === 0) break;
    if (page === MAX_PAGES2) truncated = true;
  }
  return { items, total, truncated };
}
async function readNativeBlockers(deps, workspaceRoot, repository, issues, pageSize, concurrency) {
  const open = issues.filter(
    (issue) => issue.ticket.state === "open" && issue.ticket.number !== null
  );
  if (open.length === 0) return /* @__PURE__ */ new Map();
  try {
    const counts = await mapWithConcurrency(open, concurrency, async (issue) => ({
      number: issue.ticket.number,
      blockedBy: await readDependencies(
        deps,
        workspaceRoot,
        repository,
        issue.ticket.number,
        pageSize
      )
    }));
    return new Map(counts.map((entry) => [entry.number, entry.blockedBy]));
  } catch (error) {
    if (error instanceof DependenciesUnavailable) return void 0;
    throw error;
  }
}
async function readDependencies(deps, workspaceRoot, repository, index, pageSize) {
  let open = 0;
  let received = 0;
  let total;
  const refs = [];
  for (let page = 1; page <= MAX_PAGES2; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      dependenciesEndpoint(repository, index, pageSize, page)
    );
    if (response.status === 404) throw new DependenciesUnavailable();
    ensureSuccess(response, "\u8BFB\u53D6 Gitea \u5DE5\u5355\u4F9D\u8D56");
    const parsed = parseDependencies(response.body);
    open += parsed.open;
    received += parsed.received;
    refs.push(...parsed.refs);
    total ??= response.total;
    if (total !== void 0 && received >= total) break;
    if (parsed.received === 0) break;
  }
  return { open, refs };
}
var DependenciesUnavailable = class extends Error {
};
function issuesEndpoint(repository, pageSize, page, since) {
  const window = since === void 0 ? "" : `&since=${new Date(since).toISOString()}`;
  return `/repos/${repository.owner}/${repository.name}/issues?state=all&type=issues&page=${String(page)}&limit=${String(pageSize)}${window}`;
}
function dependenciesEndpoint(repository, index, pageSize, page) {
  return `/repos/${repository.owner}/${repository.name}/issues/${String(index)}/dependencies?page=${String(page)}&limit=${String(pageSize)}`;
}
function normalizePositive(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

// src/adapters/github/shared.ts
var SEGMENT2 = /^[A-Za-z0-9_.-]+$/;
async function readRepository2(run, workspaceRoot) {
  let output;
  try {
    output = (await run("git", ["remote", "-v"], { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw mapGitError(error);
  }
  const address = pickRemoteAddress(parseRemotes(output));
  if (address?.host !== GITHUB_HOST) {
    throw new TrackerError("fetch-failed", "\u5F53\u524D\u4ED3\u5E93\u7684 origin \u4E0D\u662F GitHub \u8FDC\u7AEF\u3002");
  }
  const segments = address.path.split("/");
  const owner = segments[0];
  const name = segments[1];
  if (segments.length !== 2 || owner === void 0 || name === void 0) {
    throw new TrackerError("fetch-failed", "GitHub \u8FDC\u7AEF\u5730\u5740\u65E0\u6CD5\u8BC6\u522B owner/name\u3002");
  }
  if (!SEGMENT2.test(owner) || !SEGMENT2.test(name)) {
    throw new TrackerError("fetch-failed", "GitHub \u8FDC\u7AEF\u5730\u5740\u65E0\u6CD5\u8BC6\u522B owner/name\u3002");
  }
  return { owner, name };
}
async function callGh(run, workspaceRoot, args) {
  try {
    return (await run("gh", args, { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw mapGhError(error);
  }
}
function repositoryLabel(repository) {
  return `${repository.owner}/${repository.name}`;
}
function mapGitError(error) {
  if (error instanceof CommandError) {
    if (error.kind === "not-found") {
      return new TrackerError("fetch-failed", "\u672A\u627E\u5230 git \u547D\u4EE4\uFF0C\u65E0\u6CD5\u8BC6\u522B\u4ED3\u5E93\u3002", { cause: error });
    }
    return new TrackerError("fetch-failed", `\u8BFB\u53D6 git \u8FDC\u7AEF\u5931\u8D25\uFF1A${commandFailureDetail(error)}`, {
      cause: error
    });
  }
  return new TrackerError("fetch-failed", "\u8BFB\u53D6 git \u8FDC\u7AEF\u5931\u8D25\u3002", { cause: error });
}
function mapGhError(error) {
  if (error instanceof CommandError) {
    if (error.kind === "not-found") {
      return new TrackerError(
        "gh-missing",
        "\u672A\u627E\u5230 gh \u547D\u4EE4\uFF0C\u8BF7\u5148\u5B89\u88C5 GitHub CLI\uFF08https://cli.github.com\uFF09\u3002",
        { cause: error }
      );
    }
    if (isAuthenticationFailure(error.stderr)) {
      return new TrackerError("gh-unauthenticated", "gh \u672A\u767B\u5F55\uFF0C\u8BF7\u8FD0\u884C gh auth login\u3002", {
        cause: error
      });
    }
    return new TrackerError("fetch-failed", `\u8BFB\u53D6\u5DE5\u5355\u5931\u8D25\uFF1A${commandFailureDetail(error)}`, {
      cause: error
    });
  }
  return new TrackerError("fetch-failed", "\u8BFB\u53D6\u5DE5\u5355\u5931\u8D25\u3002", { cause: error });
}
function isAuthenticationFailure(stderr) {
  return /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|requires authentication/i.test(
    stderr
  );
}

// src/adapters/github/delete.ts
var NOT_FOUND4 = /Could not resolve to an Issue|HTTP 404|404 Not Found|Not Found/i;
var NO_PERMISSION = /HTTP 403|Forbidden|Must have admin rights|permission denied/i;
async function readGithubDeletePermission(deps, workspaceRoot) {
  const repository = await readRepository2(deps.run, workspaceRoot);
  const output = await callGh(deps.run, workspaceRoot, [
    "repo",
    "view",
    repositoryLabel(repository),
    "--json",
    "viewerPermission"
  ]);
  let payload;
  try {
    payload = JSON.parse(output);
  } catch (error) {
    throw new TrackerError("fetch-failed", "GitHub \u8FD4\u56DE\u7684\u4ED3\u5E93\u6743\u9650\u4E0D\u662F\u6709\u6548 JSON\u3002", {
      cause: error
    });
  }
  if (!isRecord(payload)) throw new TrackerError("fetch-failed", "\u4ED3\u5E93\u6743\u9650\u4E0D\u662F\u5BF9\u8C61\u3002");
  return payload.viewerPermission === "ADMIN";
}
async function deleteGithubTicket(deps, workspaceRoot, reference) {
  const number = requireTicketNumber(reference);
  const repository = await readRepository2(deps.run, workspaceRoot);
  try {
    await callGh(deps.run, workspaceRoot, [
      "issue",
      "delete",
      String(number),
      "--repo",
      repositoryLabel(repository),
      "--yes"
    ]);
  } catch (error) {
    throw mapDeleteError(error);
  }
}
function mapDeleteError(error) {
  const stderr = commandStderr(error);
  if (NOT_FOUND4.test(stderr)) {
    return new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002", {
      cause: error
    });
  }
  if (NO_PERMISSION.test(stderr)) {
    return new TrackerError(
      "fetch-failed",
      "\u6CA1\u6709\u5220\u9664\u8FD9\u5F20\u5DE5\u5355\u7684\u6743\u9650\uFF1A\u9700\u8981 GitHub \u4ED3\u5E93\u7BA1\u7406\u5458\uFF08ADMIN\uFF09\u3002",
      { cause: error }
    );
  }
  return error;
}
function commandStderr(error) {
  return error instanceof TrackerError && error.cause instanceof CommandError ? error.cause.stderr : "";
}

// src/adapters/github/graphql.ts
var GITHUB_USER_FIELDS = "login avatarUrl ... on User { name }";
var AUTHOR_FIELDS = {
  login: "login",
  displayName: "name",
  avatarUrl: "avatarUrl"
};
function parseIssueGraphql(output) {
  const payload = parseJson6(output, "gh \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON");
  const repository = readRepository3(payload);
  const repositoryName = readRepositoryName(repository);
  const issues = readIssues2(repository);
  const nodes = issues.nodes;
  if (!Array.isArray(nodes)) throw invalid3("\u4ED3\u5E93\u7684 issues.nodes \u4E0D\u662F\u6570\u7EC4");
  const tickets = nodes.map((node, index) => parseIssueNode(node, index, repositoryName));
  const total = issues.totalCount;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw invalid3("\u4ED3\u5E93\u7684 issues.totalCount \u4E0D\u662F\u975E\u8D1F\u6574\u6570");
  }
  const nextCursor = readNextCursor(issues);
  const viewer = readViewer(payload);
  return nextCursor === void 0 ? { total, tickets, viewer } : { total, tickets, viewer, nextCursor };
}
function parseIssueChangesGraphql(output) {
  const payload = parseJson6(output, "gh \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON");
  const repository = readRepository3(payload);
  const repositoryName = readRepositoryName(repository);
  const issues = readIssues2(repository);
  const nodes = issues.nodes;
  if (!Array.isArray(nodes)) throw invalid3("\u4ED3\u5E93\u7684 issues.nodes \u4E0D\u662F\u6570\u7EC4");
  const tickets = nodes.map((node, index) => parseIssueNode(node, index, repositoryName));
  const total = readRepositoryTotal(repository);
  return {
    tickets,
    truncated: readHasNextPage(issues),
    viewer: readViewer(payload),
    ...total === void 0 ? {} : { total }
  };
}
function readNextCursor(issues) {
  const pageInfo = issues.pageInfo;
  if (!isRecord(pageInfo)) throw invalid3("\u4ED3\u5E93\u7684 issues.pageInfo \u7F3A\u5931");
  const hasNextPage = pageInfo.hasNextPage;
  if (typeof hasNextPage !== "boolean") {
    throw invalid3("\u4ED3\u5E93\u7684 issues.pageInfo.hasNextPage \u4E0D\u662F\u5E03\u5C14\u503C");
  }
  if (!hasNextPage) return void 0;
  const endCursor = pageInfo.endCursor;
  if (typeof endCursor !== "string" || endCursor.length === 0) {
    throw invalid3("\u4ED3\u5E93\u8FD8\u6709\u4E0B\u4E00\u9875\uFF0C\u4F46 issues.pageInfo.endCursor \u4E0D\u662F\u975E\u7A7A\u5B57\u7B26\u4E32");
  }
  return endCursor;
}
function readHasNextPage(issues) {
  const pageInfo = issues.pageInfo;
  if (!isRecord(pageInfo)) return true;
  const hasNextPage = pageInfo.hasNextPage;
  if (typeof hasNextPage !== "boolean") {
    throw invalid3("\u4ED3\u5E93\u7684 issues.pageInfo.hasNextPage \u4E0D\u662F\u5E03\u5C14\u503C");
  }
  return hasNextPage;
}
function readRepositoryTotal(repository) {
  const totals = repository.repositoryTotal;
  if (!isRecord(totals)) return void 0;
  const total = totals.totalCount;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return void 0;
  return total;
}
function parseIssueNode(value, index, repository) {
  if (!isRecord(value)) throw invalid3(`\u7B2C ${String(index + 1)} \u5F20\u7968\u4E0D\u662F\u5BF9\u8C61`);
  const number = value.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    throw invalid3(`\u7B2C ${String(index + 1)} \u5F20\u7968\u7684\u7F16\u53F7\u4E0D\u5408\u6CD5`);
  }
  const title = readString4(value.title, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u6807\u9898`);
  const state = readState5(value.state, number);
  const closedAt = readClosedAt3(value.closedAt, number);
  const parent = readParent(value.parent, repository);
  return {
    ref: `#${String(number)}`,
    number,
    title,
    state,
    labels: readLabels4(value.labels),
    author: readAuthor2(value.author, AUTHOR_FIELDS),
    assignees: readAssigneeLogins(value.assignees),
    createdAt: readString4(value.createdAt, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u521B\u5EFA\u65F6\u95F4`),
    updatedAt: readString4(value.updatedAt, `\u7B2C ${String(number)} \u5F20\u7968\u7684\u66F4\u65B0\u65F6\u95F4`),
    openBlockers: readOpenBlockers(value.issueDependenciesSummary),
    ...closedAt === void 0 ? {} : { closedAt },
    ...parent === void 0 ? {} : { parent }
  };
}
function readAssigneeLogins(value) {
  if (!isRecord(value)) return [];
  return readLogins(value.nodes, AUTHOR_FIELDS);
}
function readRepositoryName(repository) {
  const name = repository.nameWithOwner;
  return typeof name === "string" && name.length > 0 ? name : void 0;
}
function readParent(value, repository) {
  if (repository === void 0 || !isRecord(value)) return void 0;
  const number = value.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) return void 0;
  const parentRepository = value.repository;
  if (!isRecord(parentRepository)) return void 0;
  const nameWithOwner = parentRepository.nameWithOwner;
  if (typeof nameWithOwner !== "string" || nameWithOwner.length === 0) return void 0;
  return nameWithOwner === repository ? `#${String(number)}` : `${nameWithOwner}#${String(number)}`;
}
function readRepository3(payload) {
  if (!isRecord(payload)) throw invalid3("gh \u8F93\u51FA\u7684\u9876\u5C42\u4E0D\u662F\u5BF9\u8C61");
  const data = payload.data;
  if (!isRecord(data)) throw invalid3("gh \u8F93\u51FA\u7F3A\u5C11 data");
  const repository = data.repository;
  if (!isRecord(repository)) {
    throw new TrackerError("fetch-failed", "GitHub \u4E0A\u627E\u4E0D\u5230\u8FD9\u4E2A\u4ED3\u5E93\uFF0C\u6216\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\u3002");
  }
  return repository;
}
function readViewer(payload) {
  if (!isRecord(payload)) return null;
  const data = payload.data;
  if (!isRecord(data)) return null;
  return readLogin(data.viewer, "login");
}
function readIssues2(repository) {
  const issues = repository.issues;
  if (!isRecord(issues)) throw invalid3("\u4ED3\u5E93\u7F3A\u5C11 issues \u5B57\u6BB5");
  return issues;
}
function readState5(value, number) {
  const normalized = typeof value === "string" ? value.toLowerCase() : value;
  if (normalized === "open") return "open";
  if (normalized === "closed") return "closed";
  throw invalid3(`\u7B2C ${String(number)} \u5F20\u7968\u7684\u72B6\u6001\u4E0D\u5408\u6CD5`);
}
function readLabels4(value) {
  if (!isRecord(value)) return [];
  const nodes = value.nodes;
  if (!Array.isArray(nodes)) return [];
  const labels = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const name = node.name;
    if (typeof name === "string" && name.length > 0) labels.push(name);
  }
  return labels;
}
function readOpenBlockers(value) {
  if (value === void 0 || value === null) return 0;
  if (!isRecord(value)) throw invalid3("issueDependenciesSummary \u4E0D\u662F\u5BF9\u8C61");
  const blockedBy = value.blockedBy;
  if (blockedBy === void 0 || blockedBy === null) return 0;
  if (typeof blockedBy !== "number" || !Number.isFinite(blockedBy) || blockedBy < 0) {
    throw invalid3("issueDependenciesSummary.blockedBy \u4E0D\u662F\u975E\u8D1F\u6570");
  }
  return blockedBy;
}
function readString4(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid3(`${field} \u4E0D\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  }
  return value;
}
function readClosedAt3(value, number) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || value.length === 0) {
    throw invalid3(`\u7B2C ${String(number)} \u5F20\u7968\u7684\u5173\u95ED\u65F6\u95F4\u4E0D\u5408\u6CD5`);
  }
  return value;
}
function parseJson6(output, message) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new TrackerError("fetch-failed", message, { cause: error });
  }
}
function invalid3(message) {
  return new TrackerError("fetch-failed", `\u5DE5\u5355\u6570\u636E\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}
function parseIssueCore(output) {
  return readIssueCore(readIssuePayload(parseJson6(output, "gh \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON")));
}
function parseIssueDetailPage(output) {
  const issue = readIssuePayload(parseJson6(output, "gh \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON"));
  const pageInfo = readCommentPageInfo(issue.comments);
  return {
    ...readIssueCore(issue),
    comments: readCommentNodes(issue.comments),
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor
  };
}
function readIssuePayload(payload) {
  if (!isRecord(payload)) throw invalidDetail("gh \u8F93\u51FA\u7684\u9876\u5C42\u4E0D\u662F\u5BF9\u8C61");
  const data = payload.data;
  if (!isRecord(data)) throw invalidDetail("gh \u8F93\u51FA\u7F3A\u5C11 data");
  const repository = data.repository;
  if (!isRecord(repository)) {
    throw new TrackerError("fetch-failed", "GitHub \u4E0A\u627E\u4E0D\u5230\u8FD9\u4E2A\u4ED3\u5E93\uFF0C\u6216\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u8BBF\u95EE\u6743\u9650\u3002");
  }
  const issue = repository.issue;
  if (issue === null || issue === void 0) {
    throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002");
  }
  if (!isRecord(issue)) throw invalidDetail("issue \u4E0D\u662F\u5BF9\u8C61");
  return issue;
}
function readIssueCore(issue) {
  const number = readPositiveInteger(issue.number);
  return {
    number,
    title: readRequiredString(issue.title, "\u6807\u9898"),
    body: typeof issue.body === "string" ? issue.body : "",
    state: readState5(issue.state, number),
    labels: readLabels4(issue.labels),
    author: readAuthor2(issue.author, AUTHOR_FIELDS),
    assignees: readUserNodes(issue.assignees),
    url: readOptionalString(issue.url),
    createdAt: readRequiredString(issue.createdAt, "\u521B\u5EFA\u65F6\u95F4"),
    updatedAt: readRequiredString(issue.updatedAt, "\u66F4\u65B0\u65F6\u95F4")
  };
}
function readUserNodes(value) {
  if (!isRecord(value)) return [];
  return readAuthors(value.nodes, AUTHOR_FIELDS);
}
function readCommentNodes(value) {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
  const comments = [];
  for (const node of value.nodes) {
    if (!isRecord(node)) continue;
    const body = typeof node.body === "string" ? node.body : "";
    if (body.length === 0) continue;
    comments.push({
      author: readAuthor2(node.author, AUTHOR_FIELDS),
      body,
      createdAt: readOptionalString(node.createdAt)
    });
  }
  return sortCommentsByTime(comments);
}
function readCommentPageInfo(value) {
  if (!isRecord(value)) throw invalidDetail("\u7F3A\u5C11\u8BC4\u8BBA\u8FDE\u63A5");
  const pageInfo = value.pageInfo;
  if (!isRecord(pageInfo)) throw invalidDetail("\u8BC4\u8BBA\u7F3A\u5C11 pageInfo");
  const hasNextPage = pageInfo.hasNextPage;
  if (typeof hasNextPage !== "boolean") {
    throw invalidDetail("\u8BC4\u8BBA\u7684 pageInfo.hasNextPage \u4E0D\u662F\u5E03\u5C14\u503C");
  }
  return { hasNextPage, endCursor: readOptionalString(pageInfo.endCursor) };
}
function readPositiveInteger(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalidDetail("\u7F16\u53F7\u4E0D\u662F\u6B63\u6574\u6570");
  }
  return value;
}

// src/adapters/github/detail.ts
var COMMENT_PAGE_SIZE = 100;
var NOT_FOUND5 = /Could not resolve to an Issue/i;
var ISSUE_CORE_FIELDS = `number
        title
        body
        state
        url
        createdAt
        updatedAt
        labels(first: 50) { nodes { name } }
        author { ${GITHUB_USER_FIELDS} }
        assignees(first: 20) { nodes { ${GITHUB_USER_FIELDS} } }`;
var DETAIL_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $comments: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${ISSUE_CORE_FIELDS}
      comments(first: $comments, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { body createdAt author { ${GITHUB_USER_FIELDS} } }
      }
    }
  }
}`;
var CURRENT_QUERY = `query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${ISSUE_CORE_FIELDS}
    }
  }
}`;
async function readGithubDetail(deps, workspaceRoot, reference) {
  const repository = await readRepository2(deps.run, workspaceRoot);
  return readDetailWithRepository(deps, workspaceRoot, repository, reference);
}
async function readDetailWithRepository(deps, workspaceRoot, repository, reference) {
  const number = requireTicketNumber(reference);
  const first = parseIssueDetailPage(
    await callGhDetail(deps.run, workspaceRoot, detailArgs(repository, number, null))
  );
  const comments = [...first.comments];
  let cursor = first.endCursor;
  let hasNextPage = first.hasNextPage;
  while (hasNextPage) {
    if (cursor === null) {
      throw new TrackerError("fetch-failed", "GitHub \u8BC4\u8BBA\u5206\u9875\u7F3A\u5C11\u6E38\u6807\uFF0C\u5DF2\u505C\u6B62\u8BFB\u53D6\u3002");
    }
    const next = parseIssueDetailPage(
      await callGhDetail(deps.run, workspaceRoot, detailArgs(repository, number, cursor))
    );
    comments.push(...next.comments);
    if (next.hasNextPage && next.endCursor === cursor) {
      throw new TrackerError("fetch-failed", "GitHub \u8BC4\u8BBA\u5206\u9875\u6E38\u6807\u6CA1\u6709\u524D\u8FDB\uFF0C\u5DF2\u505C\u6B62\u8BFB\u53D6\u3002");
    }
    cursor = next.endCursor;
    hasNextPage = next.hasNextPage;
  }
  return { ...detailOf(first, reference), comments: sortCommentsByTime(comments) };
}
async function applyGithubChanges(deps, workspaceRoot, reference, patch) {
  const number = requireTicketNumber(reference);
  const repository = await readRepository2(deps.run, workspaceRoot);
  const repoArgs = ["--repo", repositoryLabel(repository)];
  const current = await readCurrentValues(deps, workspaceRoot, repository, reference);
  if (patch.labels !== void 0) {
    const diff = planSetChange(current.labels, patch.labels);
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...diff.add.flatMap((label) => ["--add-label", label]),
      ...diff.remove.flatMap((label) => ["--remove-label", label])
    ]);
  }
  const assignees = assigneeChange(
    current.assignees.map((user) => user.login),
    patch
  );
  if (!isEmptyDiff(assignees)) {
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...assignees.add.flatMap((login) => ["--add-assignee", login]),
      ...assignees.remove.flatMap((login) => ["--remove-assignee", login])
    ]);
  }
  if (patch.state !== void 0 && patch.state !== current.state) {
    const command = patch.state === "closed" ? "close" : "reopen";
    await callGhDetail(deps.run, workspaceRoot, ["issue", command, String(number), ...repoArgs]);
  }
}
async function readCurrentValues(deps, workspaceRoot, repository, reference) {
  const number = requireTicketNumber(reference);
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${CURRENT_QUERY}`,
    "-f",
    `owner=${repository.owner}`,
    "-f",
    `name=${repository.name}`,
    "-F",
    `number=${String(number)}`
  ];
  return parseIssueCore(await callGhDetail(deps.run, workspaceRoot, args));
}
function detailArgs(repository, number, cursor) {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${DETAIL_QUERY}`,
    "-f",
    `owner=${repository.owner}`,
    "-f",
    `name=${repository.name}`,
    "-F",
    `number=${String(number)}`,
    "-F",
    `comments=${String(COMMENT_PAGE_SIZE)}`
  ];
  return cursor === null ? args : [...args, "-f", `cursor=${cursor}`];
}
function detailOf(page, reference) {
  return {
    ref: reference.ref,
    number: page.number,
    title: page.title,
    state: page.state,
    author: page.author,
    body: page.body,
    labels: page.labels,
    assignees: page.assignees,
    comments: [],
    url: page.url,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
}
function assigneeChange(current, patch) {
  if (patch.assignees === void 0 && patch.assignSelf !== true) {
    return { add: [], remove: [] };
  }
  return planSetChange(current, patch.assignees, patch.assignSelf === true ? "@me" : null);
}
async function editIssue(run, workspaceRoot, number, repoArgs, flags) {
  if (flags.length === 0) return;
  await callGhDetail(run, workspaceRoot, ["issue", "edit", String(number), ...flags, ...repoArgs]);
}
async function callGhDetail(run, workspaceRoot, args) {
  try {
    return await callGh(run, workspaceRoot, args);
  } catch (error) {
    if (error instanceof TrackerError && error.cause instanceof CommandError && NOT_FOUND5.test(error.cause.stderr)) {
      throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002", {
        cause: error
      });
    }
    throw error;
  }
}

// src/adapters/github/options.ts
async function readGithubOptions(deps, workspaceRoot) {
  const repository = await readRepository2(deps.run, workspaceRoot);
  const repo = repositoryLabel(repository);
  const [labelsOutput, assigneesOutput] = await Promise.all([
    callGh(deps.run, workspaceRoot, [
      "label",
      "list",
      "--repo",
      repo,
      "--json",
      "name,color,description",
      "--limit",
      "1000"
    ]),
    callGh(deps.run, workspaceRoot, ["api", `repos/${repo}/assignees`, "--paginate", "--slurp"])
  ]);
  return {
    labels: parseLabels2(labelsOutput),
    assignees: parseAssignees(assigneesOutput)
  };
}
function parseLabels2(output) {
  const payload = parseJson7(output, "\u6807\u7B7E");
  if (!Array.isArray(payload)) throw invalidOptions2("\u6807\u7B7E\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const labels = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const name = readOptionalString(entry.name);
    if (name === null) continue;
    labels.push({
      name,
      color: normalizeLabelColor(entry.color),
      description: readOptionalString(entry.description)
    });
  }
  return dedupeBy(labels, (label) => label.name);
}
function parseAssignees(output) {
  const payload = parseJson7(output, "\u53EF\u5206\u914D\u7528\u6237");
  if (!Array.isArray(payload)) throw invalidOptions2("\u53EF\u5206\u914D\u7528\u6237\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const users = payload.flatMap(
    (page) => Array.isArray(page) ? page : []
  );
  const assignees = [];
  for (const entry of users) {
    if (!isRecord(entry)) continue;
    const username = readOptionalString(entry.login);
    if (username === null) continue;
    assignees.push({ username, name: null });
  }
  return dedupeBy(assignees, (assignee) => assignee.username);
}
function parseJson7(output, field) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new TrackerError("fetch-failed", `GitHub \u8FD4\u56DE\u7684${field}\u4E0D\u662F\u6709\u6548 JSON\u3002`, {
      cause: error
    });
  }
}
function invalidOptions2(message) {
  return new TrackerError("fetch-failed", `\u8865\u5168\u5019\u9009\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/github/tracker.ts
var DEFAULT_LIMIT = 100;
var ISSUE_NODES = `nodes {
        number
        title
        state
        createdAt
        updatedAt
        closedAt
        labels(first: 50) { nodes { name } }
        author { ${GITHUB_USER_FIELDS} }
        assignees(first: 10) { nodes { login } }
        issueDependenciesSummary { blockedBy }
        parent { number repository { nameWithOwner } }
      }`;
var ISSUE_QUERY = `query ($owner: String!, $name: String!, $limit: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    issues(first: $limit, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      ${ISSUE_NODES}
    }
  }
}`;
var CHANGES_QUERY = `query ($owner: String!, $name: String!, $limit: Int!, $since: DateTime!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    repositoryTotal: issues(first: 1) { totalCount }
    issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }, filterBy: { since: $since }) {
      pageInfo { hasNextPage }
      ${ISSUE_NODES}
    }
  }
}`;
function createGithubTracker(deps) {
  const limit = normalizeLimit(deps.limit ?? DEFAULT_LIMIT);
  return {
    async fetchSnapshot(workspaceRoot, page) {
      const repository = await readRepository2(deps.run, workspaceRoot);
      const tickets = await readTickets2(deps, workspaceRoot, repository, limit, page?.cursor);
      const nextCursor = tickets.nextCursor;
      return {
        repository: repositoryLabel(repository),
        fetchedAt: deps.now(),
        loaded: tickets.tickets.length,
        total: tickets.total,
        tickets: tickets.tickets,
        viewer: tickets.viewer,
        // GitHub 的子工单是原生父子关系。
        hierarchy: "native",
        // 还有下一页时给出游标；这份快照只覆盖到这一页。
        ...nextCursor === void 0 ? {} : { nextCursor }
      };
    },
    async fetchChanges(workspaceRoot, since) {
      const repository = await readRepository2(deps.run, workspaceRoot);
      const changes = await readChanges(deps, workspaceRoot, repository, limit, since);
      return {
        tickets: changes.tickets,
        truncated: changes.truncated,
        viewer: changes.viewer,
        hierarchy: "native",
        ...changes.total === void 0 ? {} : { total: changes.total }
      };
    },
    fetchDetail: (workspaceRoot, reference) => readGithubDetail(deps, workspaceRoot, reference),
    updateTicket: (workspaceRoot, reference, patch) => applyGithubChanges(deps, workspaceRoot, reference, patch),
    fetchOptions: (workspaceRoot) => readGithubOptions(deps, workspaceRoot),
    canDeleteTickets: (workspaceRoot) => readGithubDeletePermission(deps, workspaceRoot),
    deleteTicket: (workspaceRoot, reference) => deleteGithubTicket(deps, workspaceRoot, reference)
  };
}
async function readTickets2(deps, workspaceRoot, repository, limit, cursor) {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${ISSUE_QUERY}`,
    "-f",
    `owner=${repository.owner}`,
    "-f",
    `name=${repository.name}`,
    "-F",
    `limit=${String(limit)}`,
    ...cursor === void 0 ? [] : ["-f", `after=${cursor}`]
  ];
  return parseIssueGraphql(await callGh(deps.run, workspaceRoot, args));
}
async function readChanges(deps, workspaceRoot, repository, limit, since) {
  if (!Number.isFinite(since)) {
    throw new TrackerError("fetch-failed", "\u589E\u91CF\u7A97\u53E3\u7684\u8D77\u70B9\u4E0D\u662F\u6709\u6548\u65F6\u95F4\u6233\u3002");
  }
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${CHANGES_QUERY}`,
    "-f",
    `owner=${repository.owner}`,
    "-f",
    `name=${repository.name}`,
    "-F",
    `limit=${String(limit)}`,
    "-f",
    `since=${new Date(since).toISOString()}`
  ];
  return parseIssueChangesGraphql(await callGh(deps.run, workspaceRoot, args));
}
function normalizeLimit(limit) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), DEFAULT_LIMIT));
}

// src/adapters/gitlab/shared.ts
async function readProjectAddress(run, workspaceRoot) {
  let output;
  try {
    output = (await run("git", ["remote", "-v"], { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw new TrackerError("fetch-failed", "\u8BFB\u53D6 git \u8FDC\u7AEF\u5931\u8D25\uFF0C\u65E0\u6CD5\u8BC6\u522B GitLab \u9879\u76EE\u3002", {
      cause: error
    });
  }
  const address = pickRemoteAddress(parseRemotes(output));
  if (address === void 0) {
    throw new TrackerError("fetch-failed", "\u5F53\u524D\u4ED3\u5E93\u7684 origin \u4E0D\u662F\u53EF\u8BC6\u522B\u7684 GitLab \u8FDC\u7AEF\u3002");
  }
  return { path: address.path, host: address.host };
}
async function readProjectPath(run, workspaceRoot) {
  return (await readProjectAddress(run, workspaceRoot)).path;
}
async function callGlabApi(run, workspaceRoot, endpoint) {
  return callGlab(run, workspaceRoot, ["api", endpoint]);
}
async function callGlab(run, workspaceRoot, args) {
  try {
    return (await run("glab", args, { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw mapGlabError(error);
  }
}
function projectEndpoint(project) {
  return `projects/${encodeProjectPath(project)}`;
}
function mapGlabError(error) {
  if (error instanceof CommandError) {
    if (error.kind === "not-found") {
      return new TrackerError(
        "glab-missing",
        "\u672A\u627E\u5230 glab \u547D\u4EE4\uFF0C\u8BF7\u5148\u5B89\u88C5 GitLab CLI\uFF08https://gitlab.com/gitlab-org/cli\uFF09\u3002",
        { cause: error }
      );
    }
    if (isAuthenticationFailure2(error.stderr)) {
      return new TrackerError(
        "glab-unauthenticated",
        "glab \u672A\u767B\u5F55\u6216\u4EE4\u724C\u5DF2\u5931\u6548\uFF0C\u8BF7\u8FD0\u884C glab auth login\u3002",
        { cause: error }
      );
    }
    return new TrackerError(
      "fetch-failed",
      `\u8BFB\u53D6 GitLab \u5DE5\u5355\u5931\u8D25\uFF1A${commandFailureDetail(error)}`,
      {
        cause: error
      }
    );
  }
  return new TrackerError("fetch-failed", "\u8BFB\u53D6 GitLab \u5DE5\u5355\u5931\u8D25\u3002", { cause: error });
}
function isAuthenticationFailure2(stderr) {
  return /glab auth login|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|Unauthorized/i.test(
    stderr
  );
}

// src/adapters/gitlab/delete.ts
var OWNER_ACCESS_LEVEL = 50;
var NOT_FOUND6 = /404 Not Found|404 page not found|Not Found/i;
var NO_PERMISSION2 = /HTTP 403|403 Forbidden|Forbidden|permission|not allowed/i;
async function readGitlabDeletePermission(deps, workspaceRoot) {
  const project = await readProjectPath(deps.run, workspaceRoot);
  const payload = parseJson8(
    await callGlabApi(deps.run, workspaceRoot, projectEndpoint(project)),
    "\u9879\u76EE\u6743\u9650"
  );
  if (!isRecord(payload)) throw invalidPermission2("\u9879\u76EE\u6743\u9650\u4E0D\u662F\u5BF9\u8C61");
  const highest = highestAccessLevel(payload.permissions);
  if (highest !== null && highest >= OWNER_ACCESS_LEVEL) return true;
  const user = parseJson8(await callGlabApi(deps.run, workspaceRoot, "user"), "\u5F53\u524D\u7528\u6237");
  return isRecord(user) && user.is_admin === true;
}
async function deleteGitlabTicket(deps, workspaceRoot, reference) {
  const iid = requireTicketNumber(reference);
  const project = await readProjectPath(deps.run, workspaceRoot);
  const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}`;
  try {
    await callGlab(deps.run, workspaceRoot, ["api", "--method", "DELETE", endpoint]);
  } catch (error) {
    throw mapDeleteError2(error);
  }
}
function highestAccessLevel(permissions) {
  if (!isRecord(permissions)) return null;
  const project = accessLevel(permissions.project_access);
  const group = accessLevel(permissions.group_access);
  if (project === null) return group;
  if (group === null) return project;
  return Math.max(project, group);
}
function accessLevel(value) {
  if (!isRecord(value)) return null;
  const level = value.access_level;
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}
function mapDeleteError2(error) {
  const stderr = commandStderr2(error);
  if (NOT_FOUND6.test(stderr)) {
    return new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002", {
      cause: error
    });
  }
  if (NO_PERMISSION2.test(stderr)) {
    return new TrackerError(
      "fetch-failed",
      "\u6CA1\u6709\u5220\u9664\u8FD9\u5F20\u5DE5\u5355\u7684\u6743\u9650\uFF1A\u9700\u8981 GitLab \u9879\u76EE Owner \u6216\u5B9E\u4F8B\u7BA1\u7406\u5458\u3002",
      { cause: error }
    );
  }
  return error;
}
function commandStderr2(error) {
  return error instanceof TrackerError && error.cause instanceof CommandError ? error.cause.stderr : "";
}
function parseJson8(body, field) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", `GitLab \u8FD4\u56DE\u7684${field}\u4E0D\u662F\u6709\u6548 JSON\u3002`, {
      cause: error
    });
  }
}
function invalidPermission2(message) {
  return new TrackerError("fetch-failed", `\u5220\u9664\u6743\u9650\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitlab/uploads.ts
import { Buffer as Buffer2 } from "node:buffer";
var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
var MAX_TOTAL_UPLOAD_BYTES = 12 * 1024 * 1024;
var IMAGE_TOKEN = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;
function createUploadInliner(deps) {
  const maxBytes = deps.maxBytes ?? MAX_UPLOAD_BYTES;
  const maxTotalBytes = deps.maxTotalBytes ?? MAX_TOTAL_UPLOAD_BYTES;
  const outcomes = /* @__PURE__ */ new Map();
  const base = readInstanceBase(deps.instanceUrl);
  let usedBytes = 0;
  async function fetchOutcome(ref) {
    const fallbackUrl = uploadUrl(deps.instanceUrl, deps.project, ref);
    try {
      const output = await deps.run("glab", ["api", uploadEndpoint(deps.project, ref)], {
        cwd: deps.workspaceRoot
      });
      const bytes = output.stdout;
      if (bytes.byteLength > maxBytes) return { dataUrl: null, fallbackUrl };
      const mime = imageMime(bytes);
      if (mime === null) return { dataUrl: null, fallbackUrl };
      if (usedBytes + bytes.byteLength > maxTotalBytes) return { dataUrl: null, fallbackUrl };
      usedBytes += bytes.byteLength;
      return {
        dataUrl: `data:${mime};base64,${Buffer2.from(bytes).toString("base64")}`,
        fallbackUrl
      };
    } catch {
      return { dataUrl: null, fallbackUrl };
    }
  }
  async function replacementFor(token, alt, raw) {
    const ref = base === null ? null : resolveUpload(raw, base, deps.project);
    if (ref === null) return token;
    const key = `${ref.secret}\0${ref.filename}`;
    let outcome = outcomes.get(key);
    if (outcome === void 0) {
      outcome = await fetchOutcome(ref);
      outcomes.set(key, outcome);
    }
    if (outcome.dataUrl !== null) return `![${alt}](${outcome.dataUrl})`;
    const label = alt.trim().length === 0 ? ref.filename : alt;
    return `[${label}](${outcome.fallbackUrl})`;
  }
  async function inlineLine(line) {
    const matches = [...line.matchAll(IMAGE_TOKEN)];
    if (matches.length === 0) return line;
    const parts = [];
    let cursor = 0;
    for (const match of matches) {
      const index = match.index ?? 0;
      const token = match[0];
      const alt = match[1] ?? "";
      const raw = (match[2] ?? "").trim();
      parts.push(line.slice(cursor, index), await replacementFor(token, alt, raw));
      cursor = index + token.length;
    }
    parts.push(line.slice(cursor));
    return parts.join("");
  }
  return {
    async inline(markdown) {
      const lines = markdown.split("\n");
      const out = [];
      let inFence = false;
      for (const line of lines) {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          out.push(line);
          continue;
        }
        out.push(inFence ? line : await inlineLine(line));
      }
      return out.join("\n");
    }
  };
}
function readInstanceBase(instanceUrl) {
  let url;
  try {
    url = new URL(instanceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { origin: url.origin, path: url.pathname.replace(/\/+$/, "") };
}
function resolveUpload(raw, base, project) {
  const relative = /^\/uploads\/([^/?#]+)\/([^/?#]+)$/.exec(raw);
  if (relative !== null) return readRef(relative[1], relative[2]);
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.origin !== base.origin) return null;
  if (url.search !== "" || url.hash !== "") return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const prefix = `${base.path}/${project}/uploads/`;
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split("/");
  if (segments.length !== 2) return null;
  return readRef(segments[0], segments[1]);
}
function readRef(secret, filename) {
  if (!isSafeSegment(secret) || !isSafeSegment(filename)) return null;
  return { secret, filename };
}
function isSafeSegment(value) {
  if (value === void 0 || value.length === 0) return false;
  if (value === "." || value === "..") return false;
  return !/[/\\?#\s]/.test(value);
}
function uploadEndpoint(project, ref) {
  return `${projectEndpoint(project)}/uploads/${encodeURIComponent(ref.secret)}/${encodeURIComponent(ref.filename)}`;
}
function uploadUrl(instanceUrl, project, ref) {
  const base = instanceUrl.replace(/\/+$/, "");
  const path = project.split("/").map(encodeURIComponent).join("/");
  return `${base}/${path}/uploads/${encodeURIComponent(ref.secret)}/${encodeURIComponent(ref.filename)}`;
}
function imageMime(bytes) {
  if (hasSignature(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (hasSignature(bytes, [255, 216, 255])) return "image/jpeg";
  if (hasSignature(bytes, [71, 73, 70, 56])) return "image/gif";
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) return "image/webp";
  if (hasSignature(bytes, [66, 77])) return "image/bmp";
  return null;
}
function hasSignature(bytes, signature) {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}
function hasAscii(bytes, offset, text) {
  if (bytes.byteLength < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

// src/adapters/gitlab/detail.ts
var NOT_FOUND7 = /404 Not Found|404 page not found|Not Found/i;
async function readGitlabDetail(deps, workspaceRoot, reference) {
  const iid = requireTicketNumber(reference);
  const address = await readProjectAddress(deps.run, workspaceRoot);
  const issue = await readIssue2(deps, workspaceRoot, address.path, iid);
  const comments = await readNotes(deps, workspaceRoot, address.path, iid);
  const inliner = deps.runBinary === void 0 ? null : createUploadInliner({
    run: deps.runBinary,
    workspaceRoot,
    instanceUrl: instanceBaseUrl(issue.url, address.host, address.path),
    project: address.path
  });
  return {
    ref: reference.ref,
    number: iid,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    body: inliner === null ? issue.body : await inliner.inline(issue.body),
    labels: issue.labels,
    assignees: issue.assignees,
    comments: inliner === null ? comments : await inlineComments(inliner, comments),
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt
  };
}
async function inlineComments(inliner, comments) {
  const out = [];
  for (const comment of comments) {
    out.push({ ...comment, body: await inliner.inline(comment.body) });
  }
  return out;
}
function instanceBaseUrl(url, host, project) {
  if (url !== null) {
    try {
      const parsed = new URL(url);
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.username === "" && parsed.password === "") {
        const marker = `/${project}/`;
        const index = parsed.pathname.indexOf(marker);
        const prefix = index < 0 ? "" : parsed.pathname.slice(0, index);
        return `${parsed.origin}${prefix}`;
      }
    } catch {
    }
  }
  return `https://${host}`;
}
async function applyGitlabChanges(deps, workspaceRoot, reference, patch) {
  const iid = requireTicketNumber(reference);
  const project = await readProjectPath(deps.run, workspaceRoot);
  const current = await readIssue2(deps, workspaceRoot, project, iid);
  if (patch.labels !== void 0) {
    const diff = planSetChange(current.labels, patch.labels);
    if (!isEmptyDiff(diff)) {
      await callGlab(deps.run, workspaceRoot, [
        "issue",
        "update",
        String(iid),
        ...diff.add.length === 0 ? [] : ["--label", diff.add.join(",")],
        ...diff.remove.length === 0 ? [] : ["--unlabel", diff.remove.join(",")]
      ]);
    }
  }
  if (patch.assignees !== void 0 || patch.assignSelf === true) {
    const self = patch.assignSelf === true ? await readCurrentUsername(deps.run, workspaceRoot) : null;
    await updateAssignees(deps, workspaceRoot, iid, current.assignees, patch, self);
  }
  if (patch.state !== void 0 && patch.state !== current.state) {
    await callGlab(deps.run, workspaceRoot, [
      "issue",
      patch.state === "closed" ? "close" : "reopen",
      String(iid)
    ]);
  }
}
async function updateAssignees(deps, workspaceRoot, iid, currentUsers, patch, self) {
  const current = currentUsers.map((user) => user.login);
  const target = resolveTargetSet(current, patch.assignees, self);
  const assigneeArgs = target.length > 0 ? ["--assignee", target.join(",")] : current.flatMap((username) => ["--assignee", `!${username}`]);
  if (assigneeArgs.length === 0) return;
  await callGlab(deps.run, workspaceRoot, ["issue", "update", String(iid), ...assigneeArgs]);
}
async function readIssue2(deps, workspaceRoot, project, iid) {
  const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}`;
  return parseIssue4(await callGlabForDetail(deps.run, workspaceRoot, endpoint));
}
async function readNotes(deps, workspaceRoot, project, iid) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}/notes?per_page=${String(deps.pageSize)}&page=${String(page)}`;
    const parsed = parseNotesPage(await callGlabForDetail(deps.run, workspaceRoot, endpoint));
    comments.push(...parsed.comments);
    if (parsed.received < deps.pageSize) break;
  }
  return sortCommentsByTime(comments);
}
async function readCurrentUsername(run, workspaceRoot) {
  const username = parseCurrentUsername(await callGlabApi(run, workspaceRoot, "user"));
  if (username === null) throw invalidDetail("\u5F53\u524D\u7528\u6237\u7F3A\u5C11 username");
  return username;
}
async function callGlabForDetail(run, workspaceRoot, endpoint) {
  try {
    return await callGlabApi(run, workspaceRoot, endpoint);
  } catch (error) {
    if (error instanceof TrackerError && error.cause instanceof CommandError && NOT_FOUND7.test(error.cause.stderr)) {
      throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002", {
        cause: error
      });
    }
    throw error;
  }
}
function parseIssue4(output) {
  const payload = parseJson9(output);
  if (!isRecord(payload)) throw invalidDetail("\u5DE5\u5355\u8BE6\u60C5\u4E0D\u662F\u5BF9\u8C61");
  return {
    title: readRequiredString(payload.title, "\u6807\u9898"),
    state: readState6(payload.state),
    author: readAuthor2(payload.author, GITLAB_AUTHOR_FIELDS),
    body: typeof payload.description === "string" ? payload.description : "",
    labels: readNameList(payload.labels),
    assignees: readAuthors(payload.assignees, GITLAB_AUTHOR_FIELDS),
    url: readOptionalString(payload.web_url),
    createdAt: readRequiredString(payload.created_at, "\u521B\u5EFA\u65F6\u95F4"),
    updatedAt: readRequiredString(payload.updated_at, "\u66F4\u65B0\u65F6\u95F4")
  };
}
function parseNotesPage(output) {
  const payload = parseJson9(output);
  if (!Array.isArray(payload)) throw invalidDetail("\u8BC4\u8BBA\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const comments = [];
  for (const note of payload) {
    if (!isRecord(note)) continue;
    if (note.system === true) continue;
    const body = typeof note.body === "string" ? note.body : "";
    if (body.length === 0) continue;
    comments.push({
      author: readAuthor2(note.author, GITLAB_AUTHOR_FIELDS),
      body,
      createdAt: readOptionalString(note.created_at)
    });
  }
  return { comments, received: payload.length };
}
function readState6(value) {
  if (value === "opened") return "open";
  if (value === "closed") return "closed";
  throw invalidDetail("\u72B6\u6001\u4E0D\u662F opened \u6216 closed");
}
function parseJson9(output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new TrackerError("fetch-failed", "GitLab \u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON\u3002", { cause: error });
  }
}

// src/adapters/gitlab/options.ts
async function readGitlabOptions(deps, workspaceRoot) {
  const project = await readProjectPath(deps.run, workspaceRoot);
  const base = projectEndpoint(project);
  return {
    labels: await readPages(deps, workspaceRoot, `${base}/labels`, parseLabels3),
    assignees: await readPages(deps, workspaceRoot, `${base}/members/all`, parseMembers)
  };
}
async function readPages(deps, workspaceRoot, endpoint, parse) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const url = `${endpoint}?per_page=${String(deps.pageSize)}&page=${String(page)}`;
    const parsed = parse(await callGlabApi(deps.run, workspaceRoot, url));
    items.push(...parsed.items);
    if (parsed.received < deps.pageSize) return items;
  }
}
function parseLabels3(body) {
  const payload = parseJson10(body, "\u6807\u7B7E");
  if (!Array.isArray(payload)) throw invalidOptions3("\u6807\u7B7E\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const labels = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const name = readOptionalString(entry.name);
    if (name === null) continue;
    labels.push({
      name,
      color: normalizeLabelColor(entry.color),
      description: readOptionalString(entry.description)
    });
  }
  return { items: dedupeBy(labels, (label) => label.name), received: payload.length };
}
function parseMembers(body) {
  const payload = parseJson10(body, "\u53EF\u5206\u914D\u7528\u6237");
  if (!Array.isArray(payload)) throw invalidOptions3("\u53EF\u5206\u914D\u7528\u6237\u5217\u8868\u4E0D\u662F\u6570\u7EC4");
  const assignees = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    if (entry.state !== void 0 && entry.state !== "active") continue;
    const username = readOptionalString(entry.username);
    if (username === null) continue;
    assignees.push({ username, name: readOptionalString(entry.name) });
  }
  return { items: dedupeBy(assignees, (assignee) => assignee.username), received: payload.length };
}
function parseJson10(body, field) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TrackerError("fetch-failed", `GitLab \u8FD4\u56DE\u7684${field}\u4E0D\u662F\u6709\u6548 JSON\u3002`, {
      cause: error
    });
  }
}
function invalidOptions3(message) {
  return new TrackerError("fetch-failed", `\u8865\u5168\u5019\u9009\u683C\u5F0F\u4E0D\u6B63\u786E\uFF1A${message}`);
}

// src/adapters/gitlab/tracker.ts
var DEFAULT_PAGE_SIZE2 = 100;
var DEFAULT_INCREMENTAL_PAGE_LIMIT = 5;
var BLOCKER_COUNT_BATCH = 100;
var HIERARCHY_BATCH = 100;
var DEFAULT_CONCURRENCY2 = 8;
function createGitlabTracker(deps) {
  const pageSize = normalizePositive2(deps.pageSize ?? DEFAULT_PAGE_SIZE2, DEFAULT_PAGE_SIZE2);
  const incrementalPageLimit = normalizePositive2(
    deps.incrementalPageLimit ?? DEFAULT_INCREMENTAL_PAGE_LIMIT,
    DEFAULT_INCREMENTAL_PAGE_LIMIT
  );
  const concurrency = normalizePositive2(
    deps.concurrency ?? DEFAULT_CONCURRENCY2,
    DEFAULT_CONCURRENCY2
  );
  const blockerCapability = deps.blockerCapability ?? /* @__PURE__ */ new Map();
  const detailDeps = {
    run: deps.run,
    runBinary: deps.runBinary,
    pageSize
  };
  const hints = /* @__PURE__ */ new Map();
  return {
    async fetchSnapshot(workspaceRoot) {
      const project = await readProjectAddress(deps.run, workspaceRoot);
      const viewer = readCurrentViewer2(deps, workspaceRoot);
      const issues = await readIssues3(deps, workspaceRoot, project.path, pageSize);
      const states = /* @__PURE__ */ new Map();
      for (const issue of issues) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state);
      }
      hints.set(workspaceRoot, blockerHint(project, issues));
      const workItems = await readWorkItemHierarchy(deps, workspaceRoot, project.path, issues);
      const tickets = issues.map(
        (issue) => withParent(withOpenBlockers(issue, states), parentOf2(issue, workItems.parents))
      );
      return {
        repository: project.path,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: tickets.length,
        tickets,
        viewer: await viewer,
        hierarchy: workItems.hierarchy
      };
    },
    async fetchChanges(workspaceRoot, since) {
      if (!Number.isFinite(since)) {
        throw new TrackerError("fetch-failed", "\u589E\u91CF\u7A97\u53E3\u7684\u8D77\u70B9\u4E0D\u662F\u6709\u6548\u65F6\u95F4\u6233\u3002");
      }
      const project = await readProjectAddress(deps.run, workspaceRoot);
      const viewer = readCurrentViewer2(deps, workspaceRoot);
      const listing = { pageSize, pageLimit: incrementalPageLimit };
      const { issues, truncated } = await readChangedIssues(
        deps,
        workspaceRoot,
        project.path,
        listing,
        new Date(since).toISOString()
      );
      const workItems = await readWorkItemHierarchy(deps, workspaceRoot, project.path, issues);
      const login = await viewer;
      return {
        tickets: issues.map(
          (issue) => withParent(issue.ticket, parentOf2(issue, workItems.parents))
        ),
        truncated,
        // 身份查询失败时省略，宿主沿用基准数据里的身份。
        ...login === null ? {} : { viewer: login },
        hierarchy: workItems.hierarchy
      };
    },
    async resolveBlockers(workspaceRoot, targets) {
      const open = targets.filter(
        (target) => target.number !== null
      );
      if (open.length === 0) return emptyResolution();
      const hint = hints.get(workspaceRoot) ?? {
        project: await readProjectAddress(deps.run, workspaceRoot),
        listSupportsNative: false,
        probeTarget: null
      };
      const supported = await ensureNativeBlockingSupport(
        deps,
        blockerCapability,
        workspaceRoot,
        hint,
        open
      );
      if (!supported) return emptyResolution();
      const counts = await readBlockedByCounts(deps, workspaceRoot, hint.project.path, open);
      const native = /* @__PURE__ */ new Map();
      for (const target of open) {
        const count = counts.get(target.number);
        if (count !== void 0) native.set(target.ref, count);
      }
      const blockedBy = await readBlockedByRefs(
        deps,
        workspaceRoot,
        hint.project.path,
        open,
        native,
        concurrency
      );
      return { open: native, blockedBy };
    },
    fetchDetail: (workspaceRoot, reference) => readGitlabDetail(detailDeps, workspaceRoot, reference),
    updateTicket: (workspaceRoot, reference, patch) => applyGitlabChanges(detailDeps, workspaceRoot, reference, patch),
    fetchOptions: (workspaceRoot) => readGitlabOptions(detailDeps, workspaceRoot),
    canDeleteTickets: (workspaceRoot) => readGitlabDeletePermission(deps, workspaceRoot),
    deleteTicket: (workspaceRoot, reference) => deleteGitlabTicket(deps, workspaceRoot, reference)
  };
}
function emptyResolution() {
  return { open: /* @__PURE__ */ new Map(), blockedBy: /* @__PURE__ */ new Map() };
}
function blockerHint(project, issues) {
  const open = issues.filter(
    (issue) => issue.ticket.state === "open" && issue.ticket.number !== null
  );
  const described = open.find((issue) => hasDescriptionBlockers(issue.description));
  return {
    project,
    listSupportsNative: open.some((issue) => issue.hasBlockingIssuesCount),
    probeTarget: (described ?? open[0])?.ticket.number ?? null
  };
}
async function readWorkItemHierarchy(deps, workspaceRoot, project, issues) {
  const numbers = issues.flatMap(
    (issue) => issue.ticket.number === null ? [] : [issue.ticket.number]
  );
  if (numbers.length === 0) return { parents: /* @__PURE__ */ new Map(), hierarchy: "native" };
  const parents = /* @__PURE__ */ new Map();
  try {
    for (let start = 0; start < numbers.length; start += HIERARCHY_BATCH) {
      const batch = numbers.slice(start, start + HIERARCHY_BATCH);
      const iids = batch.map((number) => `"${String(number)}"`).join(", ");
      const query = `query ($project: ID!) { project(fullPath: $project) { workItems(iids: [${iids}], first: ${String(batch.length)}) { nodes { iid workItemType { name } widgets { ... on WorkItemWidgetHierarchy { parent { iid workItemType { name } } } } } } } }`;
      const output = (await deps.run(
        "glab",
        ["api", "graphql", "-f", `query=${query}`, "-f", `project=${project}`],
        { cwd: workspaceRoot }
      )).stdout;
      for (const [iid, parent] of parseWorkItemHierarchy(output)) parents.set(iid, parent);
    }
  } catch {
    return { parents: /* @__PURE__ */ new Map(), hierarchy: "none" };
  }
  return { parents, hierarchy: "native" };
}
async function readCurrentViewer2(deps, workspaceRoot) {
  try {
    return parseCurrentUsername(await callGlabApi(deps.run, workspaceRoot, "user"));
  } catch {
    return null;
  }
}
function parentOf2(issue, parents) {
  if (issue.ticket.number === null) return void 0;
  return parents.get(issue.ticket.number);
}
function withParent(ticket, parent) {
  return parent === void 0 ? ticket : { ...ticket, parent };
}
async function readIssues3(deps, workspaceRoot, project, pageSize) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const parsed = await readIssuesPage(deps, workspaceRoot, project, pageSize, page);
    issues.push(...parsed);
    if (parsed.length < pageSize) return issues;
  }
}
async function readChangedIssues(deps, workspaceRoot, project, listing, updatedAfter) {
  const issues = [];
  for (let page = 1; page <= listing.pageLimit; page += 1) {
    const parsed = await readIssuesPage(
      deps,
      workspaceRoot,
      project,
      listing.pageSize,
      page,
      updatedAfter
    );
    issues.push(...parsed);
    if (parsed.length < listing.pageSize) return { issues, truncated: false };
  }
  const probe = await readIssuesPage(
    deps,
    workspaceRoot,
    project,
    listing.pageSize,
    listing.pageLimit + 1,
    updatedAfter
  );
  return { issues, truncated: probe.length > 0 };
}
async function readIssuesPage(deps, workspaceRoot, project, pageSize, page, updatedAfter) {
  const endpoint = issuesEndpoint2(project, pageSize, page, updatedAfter);
  let output;
  try {
    output = (await deps.run("glab", ["api", endpoint], { cwd: workspaceRoot })).stdout;
  } catch (error) {
    throw mapGlabError(error);
  }
  return parseIssuesPage2(output);
}
async function ensureNativeBlockingSupport(deps, blockerCapability, workspaceRoot, hint, open) {
  const host = hint.project.host;
  const cached = blockerCapability.get(host);
  if (cached !== void 0) return cached;
  if (hint.listSupportsNative) {
    const supported = Promise.resolve(true);
    blockerCapability.set(host, supported);
    return supported;
  }
  const target = hint.probeTarget ?? open[0]?.number ?? null;
  const pending = probeNativeBlockingSupport(deps, workspaceRoot, hint.project.path, target);
  blockerCapability.set(host, pending);
  return pending;
}
async function probeNativeBlockingSupport(deps, workspaceRoot, project, target) {
  if (target === null) return false;
  try {
    const endpoint = `${projectEndpoint(project)}/issues/${String(target)}/links`;
    const output = (await deps.run("glab", ["api", endpoint], { cwd: workspaceRoot })).stdout;
    return hasNativeBlockingLinks(output);
  } catch {
    return false;
  }
}
async function readBlockedByCounts(deps, workspaceRoot, project, open) {
  const counts = /* @__PURE__ */ new Map();
  for (let start = 0; start < open.length; start += BLOCKER_COUNT_BATCH) {
    const batch = open.slice(start, start + BLOCKER_COUNT_BATCH);
    const iids = batch.map((target) => `"${String(target.number)}"`).join(", ");
    const query = `query ($project: ID!) { project(fullPath: $project) { issues(iids: [${iids}], first: ${String(batch.length)}) { nodes { iid blockedByCount } } } }`;
    const output = (await deps.run(
      "glab",
      ["api", "graphql", "-f", `query=${query}`, "-f", `project=${project}`],
      { cwd: workspaceRoot }
    )).stdout;
    for (const [iid, count] of parseBlockedByCounts(output)) counts.set(iid, count);
  }
  return counts;
}
async function readBlockedByRefs(deps, workspaceRoot, project, open, counts, concurrency) {
  const blocked2 = open.filter((target) => (counts.get(target.ref) ?? 0) > 0);
  if (blocked2.length === 0) return /* @__PURE__ */ new Map();
  const refs = await mapWithConcurrency(blocked2, concurrency, async (target) => {
    const endpoint = `${projectEndpoint(project)}/issues/${String(target.number)}/links`;
    try {
      const output = (await deps.run("glab", ["api", endpoint], { cwd: workspaceRoot })).stdout;
      return [target.ref, remoteBlockerRefs(parseNativeBlockers(output).refs)];
    } catch {
      return [target.ref, []];
    }
  });
  return new Map(refs.filter(([, value]) => value.length > 0));
}
function withOpenBlockers(issue, states) {
  const resolved2 = resolveOpenBlockers({
    ticket: issue.ticket,
    nativeBlockers: void 0,
    text: issue.description,
    states
  });
  return {
    ...issue.ticket,
    openBlockers: resolved2.openBlockers,
    blockedBy: resolved2.blockedBy
  };
}
function issuesEndpoint2(project, pageSize, page, updatedAfter) {
  const query = ["state=all"];
  if (updatedAfter !== void 0) {
    query.push("order_by=updated_at", "sort=asc", `updated_after=${updatedAfter}`);
  }
  query.push(`per_page=${String(pageSize)}`, `page=${String(page)}`);
  return `${projectEndpoint(project)}/issues?${query.join("&")}`;
}
function normalizePositive2(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

// src/adapters/markdown/detail.ts
var LOCAL_REF = /^\.scratch\/([^/]+)\/issues\/([^/]+\.md)$/i;
function isLocalRef(ref) {
  const match = LOCAL_REF.exec(ref);
  if (match === null) return false;
  const feature = match[1] ?? "";
  return feature !== "." && feature !== "..";
}
async function readMarkdownDetail(deps, workspaceRoot, reference) {
  const relative = reference.ref;
  if (!isLocalRef(relative)) {
    throw new TrackerError(
      "ticket-not-found",
      "\u627E\u4E0D\u5230\u8FD9\u5F20\u672C\u5730\u5DE5\u5355\uFF1A\u5F15\u7528\u4E0D\u662F .scratch \u4E0B\u7684\u5DE5\u5355\u8DEF\u5F84\u3002"
    );
  }
  const path = joinPath(workspaceRoot, relative);
  const { content, timestamps } = await readTicketFile2(deps.files, path);
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  const parsed = parseMarkdownDetail(content, titleFromFileName(name));
  return {
    ref: relative,
    number: null,
    title: parsed.title,
    state: markdownState(content),
    author: null,
    body: parsed.body,
    labels: markdownLabels(content),
    assignees: [],
    comments: parsed.comments.map((body) => ({
      author: null,
      body,
      createdAt: null
    })),
    url: null,
    createdAt: new Date(timestamps.createdAt).toISOString(),
    updatedAt: new Date(timestamps.updatedAt).toISOString()
  };
}
async function readTicketFile2(files, path) {
  try {
    const [content, timestamps] = await Promise.all([
      files.readTextFile(path),
      files.statFile(path)
    ]);
    return { content, timestamps };
  } catch (error) {
    if (isMissingFile(error)) {
      throw new TrackerError("ticket-not-found", "\u627E\u4E0D\u5230\u8FD9\u5F20\u672C\u5730\u5DE5\u5355\uFF0C\u5B83\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002", {
        cause: error
      });
    }
    throw new TrackerError("markdown-read-failed", "\u8BFB\u53D6\u672C\u5730\u5DE5\u5355\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u8BFB\u53D6\u6743\u9650\u3002", {
      cause: error
    });
  }
}

// src/adapters/markdown/tracker.ts
function createMarkdownTracker(deps) {
  return {
    async fetchSnapshot(workspaceRoot) {
      let tickets;
      try {
        tickets = await readLocalTicketFiles(deps.files, workspaceRoot) ?? [];
      } catch (error) {
        throw new TrackerError(
          "markdown-read-failed",
          "\u8BFB\u53D6 .scratch \u91CC\u7684\u5DE5\u5355\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u8BFB\u53D6\u6743\u9650\u3002",
          { cause: error }
        );
      }
      const parsed = parseMarkdownTickets(tickets);
      return {
        repository: workspaceName(workspaceRoot),
        fetchedAt: deps.now(),
        loaded: parsed.length,
        total: parsed.length,
        tickets: parsed,
        // 本地 Markdown 没有远端用户，人员筛选整行不出现。
        viewer: null,
        // 本地工单用 `Parent:` 行建立父子关系，属于正文约定。
        hierarchy: "convention"
      };
    },
    async fetchChanges(workspaceRoot, since) {
      let files;
      try {
        files = await readChangedTicketFiles(deps.files, workspaceRoot, since);
      } catch (error) {
        throw new TrackerError(
          "markdown-read-failed",
          "\u8BFB\u53D6 .scratch \u91CC\u7684\u5DE5\u5355\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u8BFB\u53D6\u6743\u9650\u3002",
          { cause: error }
        );
      }
      if (files === void 0) return { tickets: [], truncated: false, hierarchy: "convention" };
      const parsed = parseMarkdownTickets([...files.changed, ...files.context]);
      const moved = new Set(files.changed.map((file) => file.path));
      return {
        tickets: parsed.filter((ticket) => moved.has(ticket.ref)),
        // 本地目录扫描没有上限，一次就能看全。
        truncated: false,
        hierarchy: "convention"
      };
    },
    // 本地 Markdown 只提供只读详情：没有链接、分配人与任何写操作。
    fetchDetail: (workspaceRoot, reference) => readMarkdownDetail(deps, workspaceRoot, reference)
  };
}

// src/worker/backend-resolver.ts
function createBackendResolver(deps) {
  const files = deps.files ?? createNodeWorkspaceFiles();
  const blockerCapability = /* @__PURE__ */ new Map();
  if (deps.cache === false) {
    return (workspaceRoot) => resolveBackend(deps, files, blockerCapability, workspaceRoot);
  }
  const cache = /* @__PURE__ */ new Map();
  const scope = deps.scope;
  return async (workspaceRoot) => {
    const key = scope === void 0 ? workspaceRoot : await scope(workspaceRoot);
    const cached = cache.get(key);
    if (cached !== void 0) return cached;
    const pending = resolveBackend(deps, files, blockerCapability, workspaceRoot);
    cache.set(key, pending);
    void pending.catch(() => {
      cache.delete(key);
    });
    return pending;
  };
}
async function resolveBackend(deps, files, blockerCapability, workspaceRoot) {
  const address = await readAddress(deps.run, workspaceRoot);
  if (address !== void 0) {
    const glab = address.host === GITHUB_HOST ? void 0 : await readGlabAuth(deps.run, workspaceRoot);
    if (glab !== void 0 && !glab.installed && address.host === GITLAB_HOST) {
      throw new TrackerError(
        "glab-missing",
        "\u672A\u627E\u5230 glab \u547D\u4EE4\uFF0C\u8BF7\u5148\u5B89\u88C5 GitLab CLI\uFF08https://gitlab.com/gitlab-org/cli\uFF09\u3002"
      );
    }
    const glabHosts = glab?.hosts ?? [];
    const direct = chooseBackend(address, glabHosts);
    if (direct.kind !== "markdown") return resolved2(direct);
    const tea = await readTeaLogins(deps.run, workspaceRoot);
    const choice = chooseBackend(address, glabHosts, tea.hosts);
    if (choice.source === "unsupported-remote") {
      return resolved2(choice, giteaCandidate(address.host, tea));
    }
    return resolved2(choice);
  }
  return {
    kind: "markdown",
    tracker: createMarkdownTracker({ files, now: deps.now }),
    choice: { kind: "markdown", source: "no-remote" },
    address: void 0
  };
  function resolved2(choice, candidate) {
    const base = {
      kind: choice.kind,
      choice,
      address,
      tracker: createTracker(choice.kind, deps, files, blockerCapability)
    };
    return candidate === void 0 ? base : { ...base, candidate };
  }
}
function giteaCandidate(host, tea) {
  return tea.installed ? {
    kind: "gitea",
    reason: "cli-unauthenticated",
    detail: `tea \u672A\u767B\u5F55 ${host}`
  } : {
    kind: "gitea",
    reason: "cli-missing",
    detail: `\u672A\u627E\u5230 tea\uFF0C\u8FDC\u7AEF ${host} \u9700\u8981 tea \u624D\u80FD\u8BC6\u522B\u4E3A Gitea`
  };
}
function createTracker(kind, deps, files, blockerCapability) {
  switch (kind) {
    case "github":
      return createGithubTracker({ run: deps.run, now: deps.now });
    case "gitlab":
      return createGitlabTracker({
        run: deps.run,
        runBinary: deps.runBinary,
        now: deps.now,
        blockerCapability
      });
    case "gitea":
      return createGiteaTracker({ run: deps.run, now: deps.now });
    case "markdown":
      return createMarkdownTracker({ files, now: deps.now });
  }
}
async function readAddress(run, workspaceRoot) {
  try {
    const output = (await run("git", ["remote", "-v"], { cwd: workspaceRoot })).stdout;
    return pickRemoteAddress(parseRemotes(output));
  } catch {
    return void 0;
  }
}
async function readGlabAuth(run, workspaceRoot) {
  try {
    const output = await run("glab", ["auth", "status"], { cwd: workspaceRoot });
    return {
      installed: true,
      hosts: parseLoggedInHosts(`${output.stdout}
${output.stderr}`)
    };
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.kind === "not-found") return { installed: false, hosts: [] };
      return { installed: true, hosts: parseLoggedInHosts(error.stderr) };
    }
    return { installed: true, hosts: [] };
  }
}
async function readTeaLogins(run, workspaceRoot) {
  try {
    const output = await run("tea", ["logins", "list", "--output", "json"], {
      cwd: workspaceRoot
    });
    return { installed: true, hosts: parseTeaLoginHosts(output.stdout) };
  } catch (error) {
    if (isCommandNotFound(error)) return { installed: false, hosts: [] };
    return { installed: true, hosts: [] };
  }
}

// src/worker/env-check-service.ts
import { join as join3 } from "node:path";

// src/core/env-check.ts
function hostedBackend(backend) {
  return backend.status === "pass" && backend.choice.kind !== "markdown" ? backend.choice.kind : void 0;
}
function shouldCheckLocalIssues(backend) {
  return hostedBackend(backend) === void 0;
}
function buildEnvCheckItems(facts) {
  const items = [];
  const remedyFacts = {
    setupSkill: facts.setupSkill,
    setupMissing: facts.skills.find((skill) => skill.name === facts.setupSkill)?.outcome?.status === "fail"
  };
  const place = (id, subject, outcome, prereq) => {
    const placed = placeItem(id, subject, outcome, prereq, remedyFacts);
    items.push(placed.item);
    return placed;
  };
  const home = place("home", null, facts.home, null);
  const candidate = facts.backend.status === "fail" ? facts.backend.backend ?? null : null;
  const backend = place("backend", candidate, toProbeOutcome(facts.backend), null);
  place("orca", null, facts.orca, null);
  const hosted = hostedBackend(facts.backend);
  if (hosted !== void 0) {
    const cli = place("cli", hosted, facts.cli, backend);
    const auth = place("auth", hosted, facts.auth, cli);
    place("repository", hosted, facts.repository, auth);
  } else if (facts.backend.status !== "pass") {
    const cli = place("cli", candidate, void 0, backend);
    const auth = place("auth", candidate, void 0, cli);
    place("repository", candidate, void 0, auth);
  }
  place("workspace", null, facts.workspace, null);
  if (shouldCheckLocalIssues(facts.backend)) {
    const localIssues = facts.localIssues === void 0 ? void 0 : localIssuesOutcome(facts.localIssues);
    place("local-issues", null, localIssues, null);
  }
  for (const skill of facts.skills) {
    place("skill", skill.name, skill.outcome, home);
  }
  return items;
}
var LISTED_PATHS = 5;
function localIssuesOutcome(fact) {
  switch (fact.status) {
    case "found":
      return {
        status: "pass",
        detail: `\u627E\u5230 ${String(fact.files.length)} \u5F20\u672C\u5730\u5DE5\u5355\uFF1A${pathList(fact.files)}`
      };
    case "no-scratch":
      return {
        status: "fail",
        detail: "\u5DE5\u4F5C\u533A\u91CC\u6CA1\u6709 .scratch \u76EE\u5F55",
        reason: "local-issues-missing"
      };
    case "no-files":
      return {
        status: "fail",
        detail: ".scratch \u4E0B\u6CA1\u6709\u5DE5\u5355\u6587\u4EF6\uFF0C\u5DE5\u5355\u5E94\u653E\u5728 .scratch/<feature>/issues/ \u4E0B",
        reason: "local-issues-empty"
      };
    case "unparsable":
      return {
        status: "fail",
        detail: `\u5DE5\u5355\u6587\u4EF6\u7F3A\u5C11\u53EF\u89E3\u6790\u7684 Status: \u884C\uFF1A${pathList(fact.files)}`,
        reason: "local-issues-invalid"
      };
    case "probe-failed":
      return { status: "fail", detail: "\u672C\u5730\u5DE5\u5355\u76EE\u5F55\u63A2\u6D4B\u5931\u8D25", reason: "probe-failed" };
  }
}
function pathList(files) {
  const shown = files.slice(0, LISTED_PATHS).join("\u3001");
  return files.length > LISTED_PATHS ? `${shown} \u7B49 ${String(files.length)} \u4E2A` : shown;
}
function placeItem(id, subject, outcome, prereq, remedyFacts) {
  const self = { id, subject };
  if (prereq !== null && prereq.item.status !== "pass") {
    const blockedBy = prereq.rootCause ?? refOf(prereq.item);
    return {
      item: {
        ...self,
        status: "skipped",
        detail: "\u672A\u6267\u884C\u68C0\u67E5",
        remedy: null,
        blockedBy
      },
      rootCause: blockedBy
    };
  }
  if (outcome === void 0) {
    return {
      item: {
        ...self,
        status: "fail",
        detail: "\u63A2\u6D4B\u6CA1\u6709\u8FD4\u56DE\u7ED3\u679C",
        remedy: { code: "check-logs", subject: null },
        blockedBy: null
      },
      rootCause: self
    };
  }
  if (outcome.status === "pass") {
    return {
      item: {
        ...self,
        status: "pass",
        detail: outcome.detail,
        remedy: null,
        blockedBy: null
      },
      rootCause: null
    };
  }
  return {
    item: {
      ...self,
      status: "fail",
      detail: outcome.detail,
      remedy: remedyFor(self, outcome, remedyFacts),
      blockedBy: null
    },
    rootCause: self
  };
}
function remedyFor(item, outcome, remedyFacts) {
  const subject = outcome.backend ?? item.subject;
  switch (outcome.reason) {
    case "cli-missing":
      return { code: "install-cli", subject };
    case "orca-cli-missing":
      return { code: "install-orca", subject: null };
    case "cli-unauthenticated":
      return { code: "login-cli", subject };
    case "skill-missing":
      return { code: "install-skill", subject: item.subject };
    case "workspace-uninitialized":
      return remedyFacts.setupMissing ? { code: "install-skill", subject: remedyFacts.setupSkill } : { code: "init-workspace", subject: null };
    case "repository-forbidden":
      return { code: "check-repository-access", subject: null };
    case "repository-not-found":
      return { code: "check-remote-address", subject: null };
    case "repository-network":
      return { code: "check-network", subject: null };
    case "local-issues-missing":
    case "local-issues-empty":
    case "local-issues-invalid":
      return { code: "place-local-issues", subject: null };
    case "timeout":
    case "probe-failed":
      return { code: "retry", subject: null };
    case "home-unresolved":
      return { code: "check-home", subject: null };
    case "backend-unavailable":
      return { code: "fix-backend", subject: null };
  }
}
function toProbeOutcome(outcome) {
  return outcome.status === "pass" ? { status: "pass", detail: outcome.detail } : {
    status: "fail",
    detail: outcome.detail,
    reason: outcome.reason,
    ...outcome.backend === void 0 ? {} : { backend: outcome.backend }
  };
}
function refOf(item) {
  return { id: item.id, subject: item.subject };
}

// src/protocol/env-check.ts
var PANEL_SKILLS = {
  setup: "setup-matt-pocock-skills",
  grillWithDocs: "grill-with-docs",
  toSpec: "to-spec",
  toTickets: "to-tickets",
  triage: "triage",
  diagnosingBugs: "diagnosing-bugs",
  wayfinder: "wayfinder",
  implement: "implement",
  codeReview: "code-review",
  pr: "pr"
};
var REQUIRED_SKILLS = [
  PANEL_SKILLS.setup,
  PANEL_SKILLS.grillWithDocs,
  PANEL_SKILLS.toSpec,
  PANEL_SKILLS.toTickets,
  PANEL_SKILLS.triage,
  PANEL_SKILLS.diagnosingBugs,
  PANEL_SKILLS.implement,
  PANEL_SKILLS.codeReview
];
var SKILL_ACTION_SKILLS = {
  implement: PANEL_SKILLS.implement,
  diagnose: PANEL_SKILLS.diagnosingBugs,
  triage: PANEL_SKILLS.triage
};

// src/core/orca-cli.ts
var ORCA_VERSION_TIMEOUT_MS = 5e3;
function orcaCliCandidates(env, platform) {
  const candidates = [];
  const configured = env.ORCA_CLI_COMMAND?.trim();
  if (configured !== void 0 && configured.length > 0) candidates.push(configured);
  const devRepo = env.ORCA_DEV_REPO_ROOT?.trim();
  if (devRepo !== void 0 && devRepo.length > 0) {
    candidates.push("orca-dev");
  }
  const names = platform === "linux" ? ["orca-ide", "orca"] : ["orca"];
  candidates.push(...names);
  const fallbacks = platform === "linux" ? ["/opt/homebrew/bin/orca-ide", "/usr/local/bin/orca-ide"] : ["/opt/homebrew/bin/orca", "/usr/local/bin/orca"];
  candidates.push(...fallbacks);
  return [...new Set(candidates)];
}
function parseOrcaVersion(stdout) {
  const line = stdout.split("\n").map((entry) => entry.trim()).find((entry) => entry.length > 0);
  if (line === void 0) return void 0;
  return /\d+\.\d+\.\d+/.test(line) ? line : void 0;
}

// src/worker/orca-cli.ts
async function resolveOrcaCli(run, options = {}) {
  const candidates = options.candidates ?? orcaCliCandidates(process.env, process.platform);
  for (const command of candidates) {
    try {
      const output = await run(command, ["--version"], {
        ...options.cwd === void 0 ? {} : { cwd: options.cwd },
        timeoutMs: ORCA_VERSION_TIMEOUT_MS
      });
      const version = parseOrcaVersion(output.stdout);
      if (version === void 0) continue;
      return {
        command,
        ...output.executable === void 0 ? {} : { executable: output.executable },
        version
      };
    } catch {
    }
  }
  return void 0;
}

// src/worker/subprocess-runner.ts
import { spawn } from "node:child_process";
import { access as access2, stat as stat4 } from "node:fs/promises";
import { constants as constants2 } from "node:fs";
import { delimiter, join as join2 } from "node:path";
var STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
var STDERR_LIMIT_BYTES = 256 * 1024;
var COMMAND_TIMEOUT_MS = 3e4;
var TERMINATION_GRACE_MS = 5e3;
var EXECUTABLE_FALLBACKS = {
  gh: ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"],
  glab: ["/opt/homebrew/bin/glab", "/usr/local/bin/glab"],
  tea: ["/opt/homebrew/bin/tea", "/usr/local/bin/tea"]
};
var QUIET_CLI_ENV = {
  GLAB_SEND_TELEMETRY: "false",
  GLAB_CHECK_UPDATE: "false"
};
function createCommandRunner() {
  const run = createByteRunner();
  return async (command, args, options) => {
    const output = await run(command, args, options);
    return {
      stdout: output.stdout.toString("utf8"),
      stderr: output.stderr,
      ...output.executable === void 0 ? {} : { executable: output.executable }
    };
  };
}
function createBinaryCommandRunner() {
  const run = createByteRunner();
  return async (command, args, options) => {
    const output = await run(command, args, options);
    return {
      stdout: output.stdout,
      stderr: output.stderr,
      ...output.executable === void 0 ? {} : { executable: output.executable }
    };
  };
}
function createByteRunner() {
  return async (command, args, options) => {
    const executable = await resolveExecutable(command);
    const cwd = options?.cwd ?? process.cwd();
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS;
    return await runCommand(executable, command, args, cwd, timeoutMs);
  };
}
async function resolveExecutable(command) {
  for (const candidate of candidatesOf(command)) {
    const resolved2 = await lookup(candidate);
    if (resolved2 !== void 0) return resolved2;
  }
  throw new CommandError("not-found", `\u627E\u4E0D\u5230\u53EF\u6267\u884C\u6587\u4EF6\uFF1A${command}`, "", null);
}
function candidatesOf(command) {
  if (command.includes("/")) return [command];
  return [command, ...EXECUTABLE_FALLBACKS[command] ?? []];
}
async function lookup(candidate) {
  if (candidate.includes("/")) {
    return await isExecutable(candidate) ? candidate : void 0;
  }
  for (const directory of pathDirectories()) {
    const full = join2(directory, candidate);
    if (await isExecutable(full)) return full;
  }
  return void 0;
}
function pathDirectories() {
  const raw = process.env["PATH"] ?? "";
  return raw.split(delimiter).filter((entry) => entry.length > 0);
}
async function isExecutable(path) {
  try {
    if (!(await stat4(path)).isFile()) return false;
    await access2(path, constants2.X_OK);
    return true;
  } catch {
    return false;
  }
}
function runCommand(executable, command, args, cwd, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: { ...process.env, ...QUIET_CLI_ENV },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = new OutputCollector(STDOUT_LIMIT_BYTES);
    const stderr = new OutputCollector(STDERR_LIMIT_BYTES);
    let timedOut = false;
    child.stdout?.on("data", (chunk) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr.push(chunk);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new CommandError("not-found", `\u627E\u4E0D\u5230\u53EF\u6267\u884C\u6587\u4EF6\uFF1A${command}`, "", null));
        return;
      }
      reject(new CommandError("failed", `${command} \u542F\u52A8\u5931\u8D25`, error.message, null));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const collected = {
        stdout: stdout.bytes(),
        stderr: stderr.text(),
        exitCode: code
      };
      if (timedOut) {
        reject(
          new CommandError(
            "timeout",
            `${command} \u8D85\u65F6\uFF08${String(Math.round(timeoutMs / 1e3))} \u79D2\uFF09`,
            collected.stderr,
            collected.exitCode,
            collected.stdout.toString("utf8")
          )
        );
        return;
      }
      if (collected.exitCode !== 0) {
        const label = collected.exitCode === null ? "\u88AB\u4FE1\u53F7\u7EC8\u6B62" : `\u9000\u51FA\u7801 ${String(collected.exitCode)}`;
        reject(
          new CommandError(
            "failed",
            `${command} ${label}`,
            collected.stderr,
            collected.exitCode,
            collected.stdout.toString("utf8")
          )
        );
        return;
      }
      resolve2({
        stdout: collected.stdout,
        stderr: collected.stderr,
        executable
      });
    });
  });
}
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const grace = setTimeout(() => {
    child.kill("SIGKILL");
  }, TERMINATION_GRACE_MS);
  grace.unref();
  child.on("close", () => {
    clearTimeout(grace);
  });
}
var OutputCollector = class {
  chunks = [];
  limit;
  size = 0;
  constructor(limit) {
    this.limit = limit;
  }
  push(chunk) {
    if (this.size >= this.limit) return;
    const room = this.limit - this.size;
    const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(slice);
    this.size += slice.length;
  }
  text() {
    return this.bytes().toString("utf8");
  }
  bytes() {
    return Buffer.concat(this.chunks);
  }
};

// src/protocol/flow.ts
var FLOW_COMMANDS = {
  intakeBug: {
    name: "mattwf-bug",
    owner: "plugin",
    summaryKey: "flow.command.intakeBug.summary"
  },
  intakeFeature: {
    name: "mattwf-feature",
    owner: "plugin",
    summaryKey: "flow.command.intakeFeature.summary"
  },
  triage: { name: PANEL_SKILLS.triage, owner: "matt", summaryKey: "flow.command.triage.summary" },
  toSpec: { name: PANEL_SKILLS.toSpec, owner: "matt", summaryKey: "flow.command.toSpec.summary" },
  toTickets: {
    name: PANEL_SKILLS.toTickets,
    owner: "matt",
    summaryKey: "flow.command.toTickets.summary"
  },
  grillWithDocs: {
    name: PANEL_SKILLS.grillWithDocs,
    owner: "matt",
    summaryKey: "flow.command.grillWithDocs.summary"
  },
  wayfinder: {
    name: PANEL_SKILLS.wayfinder,
    owner: "matt",
    summaryKey: "flow.command.wayfinder.summary"
  },
  diagnosingBugs: {
    name: PANEL_SKILLS.diagnosingBugs,
    owner: "matt",
    summaryKey: "flow.command.diagnosingBugs.summary"
  },
  implement: {
    name: PANEL_SKILLS.implement,
    owner: "matt",
    summaryKey: "flow.command.implement.summary"
  },
  codeReview: {
    name: PANEL_SKILLS.codeReview,
    owner: "matt",
    summaryKey: "flow.command.codeReview.summary"
  },
  pr: {
    name: PANEL_SKILLS.pr,
    owner: "matt",
    summaryKey: "flow.command.pr.summary"
  }
};
var STOPPING_COMMAND_NODE = {
  command: null,
  state: null,
  noteKey: null,
  stops: true
};
var FLOW_DIAGRAMS = [
  {
    id: "intake-triage",
    titleKey: "flow.diagram.intake-triage.title",
    summaryKey: "flow.diagram.intake-triage.summary",
    rows: [
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: "intakeBug", noteKey: "flow.node.defect" },
          { ...STOPPING_COMMAND_NODE, command: "intakeFeature", noteKey: "flow.node.feature" }
        ]
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false
          }
        ]
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: "triage", noteKey: "flow.node.triage" }] },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.readyForAgent },
            noteKey: null,
            stops: false
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.readyForHuman },
            noteKey: null,
            stops: false
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.needsInfo },
            noteKey: null,
            stops: false
          },
          {
            command: null,
            state: { label: TRACKER_LABELS.wontfix },
            noteKey: null,
            stops: false
          }
        ]
      }
    ]
  },
  {
    id: "feature-chain",
    titleKey: "flow.diagram.feature-chain.title",
    summaryKey: "flow.diagram.feature-chain.summary",
    rows: [
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "intakeFeature",
            noteKey: "flow.node.feature-chain.intakeFeature"
          }
        ]
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false
          }
        ]
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "triage",
            noteKey: "flow.node.feature-chain.triage"
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: "toSpec",
            noteKey: "flow.node.feature-chain.toSpec"
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: "grillWithDocs",
            noteKey: "flow.node.feature-chain.grillWithDocs"
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: "wayfinder",
            noteKey: "flow.node.feature-chain.wayfinder"
          }
        ]
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "toSpec",
            noteKey: "flow.node.feature-chain.toSpecAfter"
          }
        ]
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: "toTickets", noteKey: null }] },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: "implement", noteKey: null, stops: false }
        ]
      }
    ]
  },
  {
    id: "bug-chain",
    titleKey: "flow.diagram.bug-chain.title",
    summaryKey: "flow.diagram.bug-chain.summary",
    rows: [
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "intakeBug",
            noteKey: "flow.node.bug-chain.intakeBug"
          }
        ]
      },
      {
        nodes: [
          {
            command: null,
            state: { label: TRACKER_LABELS.needsTriage },
            noteKey: null,
            stops: false
          }
        ]
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: "triage", noteKey: null }] },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "diagnosingBugs",
            noteKey: "flow.node.bug-chain.diagnose"
          },
          {
            command: "implement",
            state: null,
            noteKey: "flow.node.bug-chain.implement",
            stops: false
          }
        ]
      },
      {
        nodes: [
          {
            command: "implement",
            state: null,
            noteKey: "flow.node.bug-chain.implementAfter",
            stops: false
          }
        ]
      }
    ]
  },
  {
    id: "choose-interview",
    titleKey: "flow.diagram.choose-interview.title",
    summaryKey: "flow.diagram.choose-interview.summary",
    rows: [
      {
        nodes: [
          {
            command: null,
            state: { key: "flow.node.choose-interview.state" },
            noteKey: null,
            stops: false
          }
        ]
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "grillWithDocs",
            noteKey: "flow.node.choose-interview.grill"
          },
          {
            ...STOPPING_COMMAND_NODE,
            command: "wayfinder",
            noteKey: "flow.node.choose-interview.wayfinder"
          }
        ]
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: "toSpec", noteKey: null }] }
    ]
  },
  {
    id: "after-implement",
    titleKey: "flow.diagram.after-implement.title",
    summaryKey: "flow.diagram.after-implement.summary",
    rows: [
      {
        nodes: [
          {
            command: null,
            state: { key: "flow.node.after-implement.done" },
            noteKey: null,
            stops: false
          }
        ]
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "codeReview",
            noteKey: "flow.node.after-implement.codeReview"
          }
        ]
      },
      {
        nodes: [
          {
            command: null,
            state: { key: "flow.node.after-implement.reviewed" },
            noteKey: null,
            stops: false
          }
        ]
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: "pr",
            noteKey: "flow.node.after-implement.pr"
          }
        ]
      },
      {
        nodes: [
          {
            command: null,
            state: { key: "flow.node.after-implement.merged" },
            noteKey: null,
            stops: false
          }
        ]
      }
    ]
  }
];

// src/worker/env-check-service.ts
var TRACKER_DOC = "docs/agents/issue-tracker.md";
var ORCA_CAPABILITY_IDS = {
  /** gh 是否安装。 */
  cliGh: "cli.gh",
  /** gh 是否登录了某个实例。 */
  cliGhAuth: "cli.gh.auth",
  /** glab 是否安装。 */
  cliGlab: "cli.glab",
  /** glab 是否登录了某个实例。 */
  cliGlabAuth: "cli.glab.auth",
  /** tea 是否安装。 */
  cliTea: "cli.tea",
  /** tea 是否登录了某个实例。 */
  cliTeaAuth: "cli.tea.auth",
  /** 仓库有没有远端。 */
  remote: "remote",
  /** 工作区有没有初始化。 */
  workspace: "workspace",
  /** 本地工单目录能不能读。 */
  localIssues: "local-issues"
};
function createEnvCheckService(deps) {
  const pending = /* @__PURE__ */ new Map();
  return {
    handle(method, params) {
      if (method !== RPC_METHODS.envCheck) {
        return Promise.resolve(failure2(ERROR_CODES.unknownMethod, `\u672A\u77E5\u65B9\u6CD5\uFF1A${method}`));
      }
      const workspaceRoot = readWorkspaceRoot(params);
      if (workspaceRoot === void 0) {
        return Promise.resolve(
          failure2(ERROR_CODES.invalidParams, "\u7F3A\u5C11\u975E\u7A7A\u7684 workspaceRoot \u53C2\u6570\u3002")
        );
      }
      const running = pending.get(workspaceRoot);
      if (running !== void 0) return running;
      const task = runCheck(deps, workspaceRoot);
      pending.set(workspaceRoot, task);
      void task.then(
        () => {
          pending.delete(workspaceRoot);
        },
        () => {
          pending.delete(workspaceRoot);
        }
      );
      return task;
    }
  };
}
async function runCheck(deps, workspaceRoot) {
  const startedAt = deps.now();
  try {
    const collected = await collectFacts(deps, workspaceRoot);
    const items = buildEnvCheckItems(collected.facts);
    const report = {
      checkedAt: startedAt,
      backend: collected.facts.backend.status === "pass" ? collected.facts.backend.choice.kind : null,
      repository: collected.repository,
      items,
      capabilities: collected.capabilities
    };
    logSummary(deps, report, startedAt);
    return { ok: true, result: report };
  } catch {
    deps.log("warn", LOG_EVENTS.envCheck, {
      result: "error",
      durationMs: Math.max(0, deps.now() - startedAt)
    });
    return failure2(ERROR_CODES.internal, "\u73AF\u5883\u68C0\u67E5\u65F6\u53D1\u751F\u672A\u9884\u671F\u7684\u9519\u8BEF\u3002");
  }
}
async function collectFacts(deps, workspaceRoot) {
  const home = deps.files.homeDirectory();
  const homeOutcome = home === void 0 ? { status: "fail", detail: "\u65E0\u6CD5\u89E3\u6790\u7528\u6237\u4E3B\u76EE\u5F55", reason: "home-unresolved" } : { status: "pass", detail: home };
  const [backend, workspace, skills, tools, orca] = await Promise.all([
    probeBackend(deps, workspaceRoot),
    probeWorkspace(deps.files, workspaceRoot),
    home === void 0 ? Promise.resolve(unprobedSkills()) : probeSkills(deps, workspaceRoot),
    probeTools(deps),
    probeOrcaCli(deps)
  ]);
  const [commands, localIssues] = await Promise.all([
    probeCommands(deps, workspaceRoot, backend),
    shouldCheckLocalIssues(backend.outcome) ? probeLocalIssues(deps, workspaceRoot) : Promise.resolve(void 0)
  ]);
  const decided = backend.outcome.status === "pass" ? backend.outcome.choice.kind : null;
  const facts = {
    home: homeOutcome,
    backend: backend.outcome,
    workspace,
    localIssues,
    orca,
    cli: commands.cli,
    auth: commands.auth,
    repository: commands.repository,
    skills,
    setupSkill: PANEL_SKILLS.setup
  };
  return {
    facts,
    repository: decided === null || decided === "markdown" ? null : backend.remote?.path ?? null,
    capabilities: await buildCapabilities(
      deps,
      workspaceRoot,
      backend,
      tools,
      skills,
      localIssues,
      workspace
    )
  };
}
async function probeOrcaCli(deps) {
  try {
    const result = await deps.deadline(resolveOrcaCli(deps.run));
    if (!result.ok) {
      return { status: "fail", detail: "Orca \u547D\u4EE4\u884C\u63A2\u6D4B\u8D85\u65F6", reason: "timeout" };
    }
    if (result.value === void 0) {
      return { status: "fail", detail: "\u672A\u627E\u5230 Orca \u547D\u4EE4\u884C", reason: "orca-cli-missing" };
    }
    return { status: "pass", detail: result.value.executable ?? result.value.command };
  } catch {
    return { status: "fail", detail: "Orca \u547D\u4EE4\u884C\u63A2\u6D4B\u5931\u8D25", reason: "probe-failed" };
  }
}
async function probeLocalIssues(deps, workspaceRoot) {
  try {
    const result = await deps.deadline(deps.localIssues(workspaceRoot));
    return result.ok ? result.value : { status: "probe-failed" };
  } catch {
    return { status: "probe-failed" };
  }
}
async function probeBackend(deps, workspaceRoot) {
  try {
    const result = await deps.deadline(deps.resolve(workspaceRoot));
    if (!result.ok) {
      return {
        outcome: { status: "fail", detail: "\u540E\u7AEF\u5224\u5B9A\u8D85\u65F6", reason: "timeout" },
        remote: void 0
      };
    }
    const resolved2 = result.value;
    if (resolved2.choice.kind === "markdown" && resolved2.candidate !== void 0) {
      return {
        outcome: {
          status: "fail",
          detail: resolved2.candidate.detail,
          reason: resolved2.candidate.reason,
          backend: resolved2.candidate.kind
        },
        remote: resolved2.address
      };
    }
    return {
      outcome: {
        status: "pass",
        choice: resolved2.choice,
        detail: backendDetail(resolved2.choice, resolved2.address)
      },
      remote: resolved2.address
    };
  } catch (error) {
    if (error instanceof TrackerError) {
      const backend = ERROR_BACKENDS[error.code];
      if (backend !== void 0) {
        return {
          outcome: {
            status: "fail",
            detail: error.message,
            reason: error.code.endsWith("-unauthenticated") ? "cli-unauthenticated" : "cli-missing",
            backend
          },
          remote: void 0
        };
      }
    }
    return {
      outcome: { status: "fail", detail: "\u65E0\u6CD5\u5224\u5B9A\u5DE5\u5355\u540E\u7AEF", reason: "backend-unavailable" },
      remote: void 0
    };
  }
}
function backendDetail(choice, address) {
  const basis = `${choice.source}:${choice.kind}`;
  return address === void 0 ? basis : `${basis}\uFF08${address.host}\uFF09`;
}
async function probeWorkspace(files, workspaceRoot) {
  const exists = await files.isFile(join3(workspaceRoot, TRACKER_DOC));
  return exists ? { status: "pass", detail: `${TRACKER_DOC} \u5B58\u5728` } : { status: "fail", detail: `\u672A\u627E\u5230 ${TRACKER_DOC}`, reason: "workspace-uninitialized" };
}
async function probeCommands(deps, workspaceRoot, backend) {
  const none = { cli: void 0, auth: void 0, repository: void 0 };
  const outcome = backend.outcome;
  if (outcome.status !== "pass") return none;
  if (outcome.choice.kind === "markdown") return none;
  const probe = probeFor(deps, outcome.choice.kind);
  const remote = backend.remote;
  const cli = await guarded(deps, probe.cli(workspaceRoot), "\u547D\u4EE4\u884C\u68C0\u67E5\u5931\u8D25");
  if (cli.status !== "pass") return { cli, auth: void 0, repository: void 0 };
  const auth = await guarded(deps, probe.auth(workspaceRoot, remote), "\u767B\u5F55\u68C0\u67E5\u5931\u8D25");
  if (auth.status !== "pass") return { cli, auth, repository: void 0 };
  const repository = await guarded(deps, probe.repository(workspaceRoot, remote), "\u4ED3\u5E93\u68C0\u67E5\u5931\u8D25");
  return { cli, auth, repository };
}
function probeFor(deps, kind) {
  switch (kind) {
    case "github":
      return deps.github;
    case "gitlab":
      return deps.gitlab;
    case "gitea":
      return deps.gitea;
  }
}
async function guarded(deps, task, failureDetail) {
  try {
    const result = await deps.deadline(task);
    return result.ok ? result.value : { status: "fail", detail: "\u63A2\u6D4B\u8D85\u65F6", reason: "timeout" };
  } catch {
    return { status: "fail", detail: failureDetail, reason: "probe-failed" };
  }
}
function unprobedSkills() {
  return REQUIRED_SKILLS.map((name) => ({ name, outcome: void 0 }));
}
async function probeSkills(deps, workspaceRoot) {
  const installed = await deps.skills.names(workspaceRoot);
  return await Promise.all(
    REQUIRED_SKILLS.map(async (name) => {
      const found = await deps.skills.locate(workspaceRoot, name);
      if (found !== void 0) {
        return { name, outcome: { status: "pass", detail: found } };
      }
      const detail = installed.length === 0 ? "\u6280\u80FD\u76EE\u5F55\u4E3A\u7A7A\u6216\u4E0D\u53EF\u8BFB" : "\u6280\u80FD\u76EE\u5F55\u91CC\u6CA1\u6709\u627E\u5230";
      return {
        name,
        outcome: { status: "fail", detail, reason: "skill-missing" }
      };
    })
  );
}
async function probeTools(deps) {
  const [gh, glab, tea] = await Promise.all([
    probeTool(deps, "gh"),
    probeTool(deps, "glab"),
    probeTool(deps, "tea")
  ]);
  return [gh, glab, tea];
}
async function probeTool(deps, name) {
  try {
    await resolveExecutable(name);
  } catch {
    return { installed: false, loggedIn: false };
  }
  try {
    const hosts = await deps.deadline(readLoggedInHosts(deps.run, name));
    return { installed: true, loggedIn: hosts.ok && hosts.value.length > 0 };
  } catch {
    return { installed: true, loggedIn: false };
  }
}
async function readLoggedInHosts(run, name) {
  if (name === "tea") {
    const output2 = await run("tea", ["logins", "list", "--output", "json"]);
    return parseTeaLoginHosts(output2.stdout);
  }
  const output = await run(name, ["auth", "status"]);
  return parseLoggedInHosts(`${output.stdout}
${output.stderr}`);
}
async function buildCapabilities(deps, workspaceRoot, backend, tools, skills, localIssues, workspace) {
  const poolSkills = await Promise.all(
    [FLOW_COMMANDS.intakeBug.name, FLOW_COMMANDS.intakeFeature.name].map(
      async (name) => ({
        id: `skill.${name}`,
        category: "host-service",
        status: await deps.skills.locate(workspaceRoot, name) === void 0 ? "missing" : "present"
      })
    )
  );
  const mattSkills = skills.map(
    (skill) => ({
      id: `skill.${skill.name}`,
      category: "host-service",
      status: skill.outcome?.status === "pass" ? "present" : "missing"
    })
  );
  const cli = tools.map(
    (tool, index) => ({
      id: index === 0 ? ORCA_CAPABILITY_IDS.cliGh : index === 1 ? ORCA_CAPABILITY_IDS.cliGlab : ORCA_CAPABILITY_IDS.cliTea,
      category: "host-service",
      status: tool.installed ? "present" : "missing"
    })
  );
  const auth = tools.map(
    (tool, index) => ({
      id: index === 0 ? ORCA_CAPABILITY_IDS.cliGhAuth : index === 1 ? ORCA_CAPABILITY_IDS.cliGlabAuth : ORCA_CAPABILITY_IDS.cliTeaAuth,
      category: "host-service",
      status: tool.loggedIn ? "present" : "missing"
    })
  );
  return [
    ...cli,
    ...auth,
    {
      id: ORCA_CAPABILITY_IDS.remote,
      category: "host-service",
      status: backend.remote === void 0 ? "missing" : "present"
    },
    {
      id: ORCA_CAPABILITY_IDS.workspace,
      category: "host-service",
      status: workspace.status === "pass" ? "present" : "missing"
    },
    {
      id: ORCA_CAPABILITY_IDS.localIssues,
      category: "host-service",
      status: localIssues?.status === "found" ? "present" : "missing"
    },
    ...poolSkills,
    ...mattSkills
  ];
}
function logSummary(deps, report, startedAt) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of report.items) {
    if (item.status === "pass") passed += 1;
    else if (item.status === "fail") failed += 1;
    else skipped += 1;
  }
  deps.log("info", LOG_EVENTS.envCheck, {
    result: "ok",
    backend: report.backend,
    durationMs: Math.max(0, deps.now() - startedAt),
    passed,
    failed,
    skipped
  });
}
function readWorkspaceRoot(params) {
  if (typeof params !== "object" || params === null) return void 0;
  if (!("workspaceRoot" in params)) return void 0;
  const root = params.workspaceRoot;
  return typeof root === "string" && root.length > 0 ? root : void 0;
}
function failure2(code, message) {
  return { ok: false, error: { code, message } };
}

// src/worker/log.ts
function createLog(orca) {
  return (level, event, fields) => {
    try {
      orca.log(`[mattwf] ${level} ${event} ${JSON.stringify(fields)}`);
    } catch {
      console.error("[mattwf] \u65E5\u5FD7\u5199\u5165\u5931\u8D25", event);
    }
  };
}

// src/worker/probe-deadline.ts
var ENV_PROBE_TIMEOUT_MS = 1e4;
function createProbeDeadline(timer, timeoutMs) {
  return async (task) => {
    let settled = false;
    let dispose = () => void 0;
    const timeout = new Promise((resolve2) => {
      dispose = timer.timeout(() => {
        if (settled) return;
        settled = true;
        resolve2({ ok: false });
      }, timeoutMs);
    });
    const finished = task.then(
      (value) => ({ ok: true, value }),
      (error) => {
        throw error instanceof Error ? error : new Error(String(error));
      }
    );
    try {
      return await Promise.race([finished, timeout]);
    } finally {
      settled = true;
      dispose();
    }
  };
}

// src/worker/repository-scope.ts
import { stat as stat5 } from "node:fs/promises";
function createRepositoryScopeResolver(deps) {
  const exists = deps.exists ?? directoryExists;
  const cache = /* @__PURE__ */ new Map();
  return (workspaceRoot) => {
    const cached = cache.get(workspaceRoot);
    if (cached !== void 0) return cached;
    const resolving = resolveScope(deps, exists, workspaceRoot);
    const pending = resolving.then((root) => root ?? workspaceRoot);
    cache.set(workspaceRoot, pending);
    void resolving.then((root) => {
      if (root === void 0 && cache.get(workspaceRoot) === pending) {
        cache.delete(workspaceRoot);
      }
    });
    return pending;
  };
}
async function resolveScope(deps, exists, workspaceRoot) {
  try {
    const output = await deps.run("git", ["worktree", "list", "--porcelain"], {
      cwd: workspaceRoot
    });
    return await pickExistingRoot(parseWorktreeRoots(output.stdout), exists);
  } catch {
    return void 0;
  }
}
async function directoryExists(path) {
  try {
    await stat5(path);
    return true;
  } catch (error) {
    return error.code !== "ENOENT";
  }
}

// src/worker/rpc-params.ts
function readWorkspaceRoot2(params) {
  if (typeof params !== "object" || params === null) return void 0;
  if (!("workspaceRoot" in params)) return void 0;
  const root = params.workspaceRoot;
  return typeof root === "string" && root.length > 0 ? root : void 0;
}
function readTicketParams(params) {
  const workspaceRoot = readWorkspaceRoot2(params);
  if (workspaceRoot === void 0 || typeof params !== "object" || params === null) return void 0;
  if (!("ref" in params)) return void 0;
  const ref = params.ref;
  if (typeof ref !== "string" || ref.length === 0) return void 0;
  if (!("number" in params)) return void 0;
  const number = params.number;
  if (number !== null && !(typeof number === "number" && Number.isInteger(number) && number > 0)) {
    return void 0;
  }
  return { workspaceRoot, ref, number };
}

// src/worker/skill-installer.ts
import { copyFile, mkdir as mkdir2, stat as stat7 } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { dirname, join as join5, resolve } from "node:path";

// src/worker/skill-catalog.ts
import { readdir as readdir3, stat as stat6 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";
var PROVIDER_SKILL_DIRECTORIES = [
  ".claude/skills",
  ".codex/skills",
  ".agents/skills"
];
var REPO_SKILL_DIRECTORY = ".agents/skills";
function createSkillCatalog() {
  return {
    async names(workspaceRoot) {
      return await listSkillNames(skillDirectories(workspaceRoot));
    },
    async locate(workspaceRoot, name) {
      return await findSkillFile(skillDirectories(workspaceRoot), name);
    }
  };
}
function providerSkillDirectories(home) {
  return PROVIDER_SKILL_DIRECTORIES.map((directory) => join4(home, directory));
}
function skillDirectories(workspaceRoot) {
  const home = resolveHome2();
  const directories = home === void 0 ? [] : [...providerSkillDirectories(home)];
  return [...directories, join4(workspaceRoot, REPO_SKILL_DIRECTORY)];
}
async function listSkillNames(directories) {
  const names = /* @__PURE__ */ new Set();
  for (const directory of directories) {
    for (const name of await skillNamesIn(directory)) names.add(name);
  }
  return [...names];
}
async function findSkillFile(directories, name) {
  for (const directory of directories) {
    const path = join4(directory, name, "SKILL.md");
    if (await isFile(path)) return path;
  }
  return void 0;
}
async function skillNamesIn(directory) {
  let entries;
  try {
    entries = await readdir3(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await isFile(join4(directory, entry.name, "SKILL.md"))) names.push(entry.name);
  }
  return names;
}
async function isFile(path) {
  try {
    return (await stat6(path)).isFile();
  } catch {
    return false;
  }
}
function resolveHome2() {
  try {
    const home = homedir3();
    return home.length > 0 ? home : void 0;
  } catch {
    return void 0;
  }
}

// src/worker/skill-installer.ts
var POOL_SKILL_NAMES = [
  FLOW_COMMANDS.intakeBug.name,
  FLOW_COMMANDS.intakeFeature.name
];
async function installPoolSkills(options = {}) {
  const targets = options.targets === void 0 ? await existingProviderDirectories() : options.targets;
  const source = await locatePluginSkillsDirectory();
  const installed = [];
  const failed = [];
  if (source === void 0) {
    for (const directory of targets) {
      for (const skill of POOL_SKILL_NAMES) {
        failed.push({ skill, directory, reason: "\u63D2\u4EF6\u76EE\u5F55\u91CC\u627E\u4E0D\u5230 skills \u6E90\u6587\u4EF6" });
      }
    }
    return { targets, installed, failed };
  }
  for (const directory of targets) {
    for (const skill of POOL_SKILL_NAMES) {
      try {
        await installSkill(source, skill, directory);
        installed.push({ skill, directory });
      } catch (error) {
        failed.push({
          skill,
          directory,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return { targets, installed, failed };
}
async function installSkill(source, skill, target) {
  const from = join5(source, skill, "SKILL.md");
  const to = join5(target, skill, "SKILL.md");
  await mkdir2(dirname(to), { recursive: true });
  await copyFile(from, to);
}
async function existingProviderDirectories() {
  let home;
  try {
    home = homedir4();
  } catch {
    return [];
  }
  if (home.length === 0) return [];
  const existing = [];
  for (const directory of providerSkillDirectories(home)) {
    if (await isDirectory(directory)) existing.push(directory);
  }
  return existing;
}
async function isDirectory(path) {
  try {
    return (await stat7(path)).isDirectory();
  } catch {
    return false;
  }
}
async function isFile2(path) {
  try {
    return (await stat7(path)).isFile();
  } catch {
    return false;
  }
}
async function locatePluginSkillsDirectory() {
  let current = resolve(import.meta.dirname);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join5(current, "skills");
    if (await isFile2(join5(candidate, POOL_SKILL_NAMES[0], "SKILL.md"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return void 0;
}

// src/worker/rpc-bridge.ts
var WORKSPACE_CANDIDATES_EVENT = "workspace.candidates";
var reportedCandidates;
function resetWorkspaceCandidatesReport() {
  reportedCandidates = void 0;
}
var SNAPSHOT_REFRESHED_EVENT = "snapshot.refreshed";
var SKILL_INSTALL_REQUEST = "skills.install";
var OPEN_WORKSPACE_REQUEST = "workspace.open";
var WORKSPACE_CURRENT_REQUEST = "workspace.current";
function registerRpcHandlers(orca, deps) {
  for (const method of Object.values(RPC_METHODS)) {
    orca.panels.handle(method, async (input) => {
      const prepared = await prepareParams(deps, orca, method, input);
      if (!prepared.ok) return prepared.result;
      return dispatch(deps, method, prepared.params);
    });
  }
  orca.panels.handle(OPEN_WORKSPACE_REQUEST, async (input) => {
    const path = isRecord(input) && typeof input["path"] === "string" ? input["path"] : void 0;
    const target = await resolveWorkspaceTarget(orca, deps, path);
    if (target === void 0) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.invalidParams,
          message: path === void 0 ? "\u8BA4\u4E0D\u5230\u5F53\u524D\u5DE5\u4F5C\u533A\u3002" : `Orca \u91CC\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u533A\uFF1A${path}`
        }
      };
    }
    await orca.host.call("workspace.open", { workspaceId: target.id });
    await deps.workspace.prefer(target.path);
    return { ok: true, result: { opened: true, path: target.path } };
  });
  orca.panels.handle(SKILL_INSTALL_REQUEST, async () => {
    try {
      return { ok: true, result: await installPoolSkills() };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.internal,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  });
  orca.panels.handle(
    AVATAR_READ_METHOD,
    (input, context) => deps.avatar.read(input, context.signal)
  );
  orca.panels.handle(WORKSPACE_CURRENT_REQUEST, async () => {
    deps.workspace.invalidate();
    const resolution = await deps.workspace.resolve();
    if (resolution.status === "resolved") {
      return {
        ok: true,
        result: { root: resolution.root, contextKey: resolution.contextKey, candidates: [] }
      };
    }
    reportWorkspaceFailure(orca, resolution, deps.log);
    return {
      ok: true,
      result: {
        root: null,
        contextKey: resolution.contextKey,
        candidates: panelCandidates(resolution.candidates)
      }
    };
  });
}
function dispatch(deps, method, params) {
  if (method === RPC_METHODS.envCheck) return deps.envCheck.handle(method, params);
  if (method === RPC_METHODS.snapshotCache) return deps.snapshot.cache(params);
  if (method === RPC_METHODS.ticketWorktree) return deps.worktree.handle(method, params);
  if (method === RPC_METHODS.ticketGet || method === RPC_METHODS.ticketUpdate || method === RPC_METHODS.ticketOptions || method === RPC_METHODS.ticketDelete) {
    return deps.ticket.handle(method, params);
  }
  return deps.snapshot.handle(method, params);
}
async function prepareParams(deps, orca, method, input) {
  const explicit = readWorkspaceRoot2(input);
  if (explicit !== void 0) {
    await deps.workspace.prefer(explicit);
    resetWorkspaceCandidatesReport();
    return { ok: true, params: input };
  }
  if (method === RPC_METHODS.snapshotRefresh) deps.workspace.invalidate();
  const resolution = await deps.workspace.resolve();
  if (resolution.status === "resolved") {
    resetWorkspaceCandidatesReport();
    const base = isRecord(input) ? input : {};
    return { ok: true, params: { ...base, workspaceRoot: resolution.root } };
  }
  reportWorkspaceFailure(orca, resolution, deps.log);
  return {
    ok: false,
    result: {
      ok: false,
      error: {
        code: ERROR_CODES.invalidParams,
        message: workspaceFailureMessage(resolution)
      }
    }
  };
}
function reportWorkspaceFailure(orca, resolution, log) {
  const ids = resolution.candidates.map((candidate) => candidate.id).sort().join("");
  const key = `${resolution.contextKey}\0${resolution.status}\0${ids}`;
  if (key === reportedCandidates) return;
  reportedCandidates = key;
  postWorkspaceCandidates(orca, resolution);
  log("warn", LOG_EVENTS.snapshot, {
    result: "error",
    reason: resolution.status,
    candidates: resolution.candidates.length
  });
}
function workspaceFailureMessage(resolution) {
  if (resolution.candidates.length > 0) {
    return "\u65E0\u6CD5\u786E\u5B9A\u5F53\u524D\u5DE5\u4F5C\u533A\u3002\u8BF7\u5728\u9762\u677F\u9876\u90E8\u70B9\u300C\u4F7F\u7528\u300D\u9009\u62E9\u4E00\u4E2A\u5DE5\u4F5C\u533A\u540E\u91CD\u8BD5\u3002";
  }
  return "\u6CA1\u6709\u53EF\u7528\u7684\u5DE5\u4F5C\u533A\u3002\u8BF7\u5148\u5728 Orca \u91CC\u6253\u5F00\u4E00\u4E2A\u4ED3\u5E93\u540E\u91CD\u8BD5\u3002";
}
function panelCandidates(candidates) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    branch: candidate.branch ?? "",
    project: candidate.project ?? "",
    kind: candidate.kind
  }));
}
function postWorkspaceCandidates(orca, resolution) {
  const payload = {
    contextKey: resolution.contextKey,
    candidates: panelCandidates(resolution.candidates)
  };
  orca.panels.post(WORKSPACE_CANDIDATES_EVENT, payload);
}
async function resolveWorkspaceTarget(orca, deps, path) {
  if (path !== void 0) {
    const list = await orca.host.call("workspace.list").catch(() => null);
    if (!isRecord(list) || !Array.isArray(list["workspaces"])) return void 0;
    for (const entry of list["workspaces"]) {
      if (!isRecord(entry) || entry["path"] !== path) continue;
      const id = entry["id"];
      if (typeof id === "string") return { id, path };
    }
    return void 0;
  }
  const resolution = await deps.workspace.resolve();
  if (resolution.status !== "resolved") return void 0;
  return { id: resolution.candidate.id, path: resolution.root };
}

// src/core/blockers.ts
function mergeNativeBlockers(tickets, native) {
  return tickets.map((ticket) => {
    if (ticket.state !== "open") return ticket;
    const count = native.open.get(ticket.ref);
    const blockedBy = native.blockedBy.get(ticket.ref);
    if ((count === void 0 || count <= 0) && (blockedBy === void 0 || blockedBy.length === 0)) {
      return ticket;
    }
    return {
      ...ticket,
      ...count === void 0 || count <= 0 ? {} : { openBlockers: count },
      ...blockedBy === void 0 || blockedBy.length === 0 ? {} : { blockedBy }
    };
  });
}

// src/core/classify.ts
function categorize(labels, names) {
  if (labels.includes(names.bug)) return "bug";
  if (labels.includes(names.enhancement)) return "enhancement";
  return null;
}
function classify(ticket, names) {
  if (ticket.state === "closed") return "closed";
  if (ticket.openBlockers > 0) return "blocked";
  if (ticket.labels.includes(names.readyForAgent)) return "ready";
  return "open";
}
function classifyTickets(tickets, names) {
  return tickets.map((ticket) => ({
    ...ticket,
    category: categorize(ticket.labels, names),
    status: classify(ticket, names)
  }));
}

// src/core/merge.ts
function mergeTickets(base, changes) {
  const positions = /* @__PURE__ */ new Map();
  const merged = [];
  for (const ticket of base) {
    if (!positions.has(ticket.ref)) positions.set(ticket.ref, merged.length);
    merged.push(ticket);
  }
  for (const change of changes) {
    const at = positions.get(change.ref);
    if (at === void 0) {
      positions.set(change.ref, merged.length);
      merged.push(change);
      continue;
    }
    const existing = merged[at];
    if (existing !== void 0 && isNewer(change, existing)) merged[at] = change;
  }
  return merged;
}
function isNewer(candidate, current) {
  const left = timestamp(candidate.updatedAt);
  const right = timestamp(current.updatedAt);
  if (left === void 0 || right === void 0) return candidate.updatedAt >= current.updatedAt;
  return left >= right;
}
function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? void 0 : parsed;
}

// src/core/skill-action.ts
function decideSkillAction(ticket, names) {
  const status = classify(ticket, names);
  if (status === "closed") return blocked("closed");
  if (status === "blocked") return blocked("blocked");
  if (ticket.labels.includes(names.wontfix)) return blocked("wontfix");
  if (ticket.labels.includes(names.readyForHuman)) return blocked("ready-for-human");
  if (ticket.labels.includes(names.needsTriage)) {
    return { skillAction: "triage", skillActionReason: "needs-triage" };
  }
  if (ticket.labels.includes(names.needsInfo)) {
    return { skillAction: "triage", skillActionReason: "needs-info" };
  }
  if (status === "ready") {
    return categorize(ticket.labels, names) === "bug" ? { skillAction: "diagnose", skillActionReason: "bug" } : { skillAction: "implement", skillActionReason: "ready-for-agent" };
  }
  return { skillAction: "triage", skillActionReason: "untriaged" };
}
function withSkillActions(tickets, names) {
  return tickets.map((ticket) => ({ ...ticket, ...decideSkillAction(ticket, names) }));
}
function blocked(reason) {
  return { skillAction: "none", skillActionReason: reason };
}

// src/core/metrics.ts
var PRESSURE_THRESHOLDS = {
  /** 开放积压低于 10 张算轻松。 */
  backlogLightUnder: 10,
  /** 开放积压达到 30 张算吃紧。 */
  backlogTightFrom: 30,
  /** 近 30 天净流入 0 或更少算轻松。 */
  netFlowLightMax: 0,
  /** 近 30 天净流入达到 6 张算吃紧。 */
  netFlowTightFrom: 6,
  /** 阻塞占比低于 15% 算轻松。 */
  blockedRatioLightUnder: 0.15,
  /** 阻塞占比高于 35% 算吃紧。 */
  blockedRatioTightOver: 0.35,
  /** 陈旧率低于 20% 算轻松。 */
  staleRatioLightUnder: 0.2,
  /** 陈旧率高于 40% 算吃紧。 */
  staleRatioTightOver: 0.4,
  /** 停滞票 3 张及以下算轻松。 */
  stalledLightMax: 3,
  /** 停滞票达到 11 张算吃紧。 */
  stalledTightFrom: 11,
  /** 陈旧与流量指标的观察窗口（天），同时用于“陈旧票”的判定。 */
  windowDays: 30
};
var DAY_MS = 864e5;
var MAX_ATTENTION = 5;
function computeMetrics(input) {
  const { tickets, now } = input;
  const windowMs = PRESSURE_THRESHOLDS.windowDays * DAY_MS;
  const open = tickets.filter((ticket) => ticket.state === "open");
  const closed = tickets.filter((ticket) => ticket.state === "closed");
  const openBacklog = open.length;
  const readyCapacity = open.filter((ticket) => ticket.status === "ready").length;
  const blocked2 = open.filter((ticket) => ticket.status === "blocked").length;
  const blockedRatio = openBacklog === 0 ? 0 : blocked2 / openBacklog;
  const needsTriage = open.filter((ticket) => ticket.category === null).length;
  const stalled = open.filter((ticket) => ticket.status === "open").length;
  const staleTickets = input.timestamps ? open.filter((ticket) => olderThan(ticket.createdAt, now, windowMs)) : [];
  const staleCount = input.timestamps ? available(staleTickets.length) : unavailable("no-timestamps");
  const staleRatio = input.timestamps ? available(openBacklog === 0 ? 0 : staleTickets.length / openBacklog) : unavailable("no-timestamps");
  const oldestUpdateDays = input.timestamps ? available(oldestUpdateDaysOf(open, now)) : unavailable("no-timestamps");
  const openedLast30Days = input.timestamps ? available(countCreatedWithin(tickets, now, windowMs)) : unavailable("no-timestamps");
  const closedLast30Days = closedWithin(closed, input.timestamps, now, windowMs);
  const netFlow = flowOf(openedLast30Days, closedLast30Days);
  const longestBlockerChain = hasBlockerEdges(tickets) ? available(longestChain(open)) : unavailable("no-dependency-edges");
  const coverage = {
    // 已加载数与总数直接用快照字段，指标里只记样本是否被后端上限截断。
    truncated: input.total > tickets.length
  };
  const pressure = pressureOf({
    openBacklog,
    blockedRatio,
    netFlow,
    staleRatio,
    stalled,
    blockersFinalized: input.blockersFinalized
  });
  return {
    openBacklog,
    readyCapacity,
    blockedRatio,
    needsTriage,
    stalled,
    staleCount,
    staleRatio,
    oldestUpdateDays,
    longestBlockerChain,
    openedLast30Days,
    closedLast30Days,
    netFlow,
    coverage,
    pressure,
    attention: attentionOf(input, open, windowMs)
  };
}
function pressureOf(input) {
  const scale = scaleDimension(input.openBacklog, input.netFlow);
  const blocking = blockingDimension(input.blockedRatio, input.blockersFinalized);
  const freshness = freshnessDimension(input.staleRatio, input.stalled);
  const dimensions = [scale, blocking, freshness];
  const tiers = dimensions.flatMap((dimension) => dimension.tier === null ? [] : [dimension.tier]);
  return { tier: worstTier(tiers), dimensions };
}
function scaleDimension(openBacklog, netFlow) {
  const metrics = [
    { metric: "backlog", value: openBacklog, tier: tierByBacklog(openBacklog) }
  ];
  const gaps = [];
  if (netFlow.value === null) {
    gaps.push(netFlow.gap ?? "no-closed-time");
  } else {
    metrics.push({ metric: "netFlow", value: netFlow.value, tier: tierByNetFlow(netFlow.value) });
  }
  return dimensionReport("scale", metrics, gaps);
}
function blockingDimension(blockedRatio, blockersFinalized) {
  return dimensionReport(
    "blocking",
    [
      {
        metric: "blockedRatio",
        value: blockedRatio,
        tier: tierByRatio(
          blockedRatio,
          PRESSURE_THRESHOLDS.blockedRatioLightUnder,
          PRESSURE_THRESHOLDS.blockedRatioTightOver
        )
      }
    ],
    [],
    !blockersFinalized
  );
}
function freshnessDimension(staleRatio, stalled) {
  const stale = staleRatio.value;
  if (stale === null) {
    return {
      dimension: "freshness",
      tier: null,
      signals: [{ metric: "stalled", value: stalled }],
      triggers: [],
      gaps: [staleRatio.gap ?? "no-timestamps"],
      provisional: false
    };
  }
  return dimensionReport(
    "freshness",
    [
      {
        metric: "stalled",
        value: stalled,
        tier: tierByStalled(stalled)
      },
      {
        metric: "staleRatio",
        value: stale,
        tier: tierByRatio(
          stale,
          PRESSURE_THRESHOLDS.staleRatioLightUnder,
          PRESSURE_THRESHOLDS.staleRatioTightOver
        )
      }
    ],
    []
  );
}
function dimensionReport(dimension, metrics, gaps, provisional = false) {
  const tier = worstTier(metrics.map((metric) => metric.tier));
  return {
    dimension,
    tier,
    signals: metrics.map((metric) => ({ metric: metric.metric, value: metric.value })),
    // 轻松档意味着所有可用指标都在轻松范围，没有需要点名的触发项。
    triggers: tier === "light" ? [] : metrics.filter((metric) => metric.tier === tier).map((m) => m.metric),
    gaps,
    provisional
  };
}
function tierByBacklog(backlog) {
  if (backlog < PRESSURE_THRESHOLDS.backlogLightUnder) return "light";
  if (backlog < PRESSURE_THRESHOLDS.backlogTightFrom) return "normal";
  return "tight";
}
function tierByNetFlow(netFlow) {
  if (netFlow <= PRESSURE_THRESHOLDS.netFlowLightMax) return "light";
  if (netFlow < PRESSURE_THRESHOLDS.netFlowTightFrom) return "normal";
  return "tight";
}
function tierByRatio(value, lightUnder, tightOver) {
  if (value < lightUnder) return "light";
  if (value > tightOver) return "tight";
  return "normal";
}
function tierByStalled(stalled) {
  if (stalled <= PRESSURE_THRESHOLDS.stalledLightMax) return "light";
  if (stalled < PRESSURE_THRESHOLDS.stalledTightFrom) return "normal";
  return "tight";
}
var TIER_RANK = { light: 0, normal: 1, tight: 2 };
function worstTier(tiers) {
  let worst = "light";
  for (const tier of tiers) {
    if (TIER_RANK[tier] > TIER_RANK[worst]) worst = tier;
  }
  return worst;
}
function available(value) {
  return { value, gap: null };
}
function unavailable(gap) {
  return { value: null, gap };
}
function closedWithin(closed, timestamps, now, windowMs) {
  if (!timestamps) return unavailable("no-timestamps");
  let count = 0;
  for (const ticket of closed) {
    const closedAt = timestampOf(ticket.closedAt);
    if (closedAt === null) return unavailable("no-closed-time");
    if (now - closedAt <= windowMs) count += 1;
  }
  return available(count);
}
function flowOf(opened, closed) {
  if (opened.value !== null && closed.value !== null) {
    return available(opened.value - closed.value);
  }
  return unavailable(opened.gap ?? closed.gap ?? "no-closed-time");
}
function countCreatedWithin(tickets, now, windowMs) {
  let count = 0;
  for (const ticket of tickets) {
    const created = timestampOf(ticket.createdAt);
    if (created !== null && now - created <= windowMs) count += 1;
  }
  return count;
}
function oldestUpdateDaysOf(tickets, now) {
  let oldest = 0;
  for (const ticket of tickets) {
    const updated = timestampOf(ticket.updatedAt);
    if (updated !== null) oldest = Math.max(oldest, daysBetween(now, updated));
  }
  return oldest;
}
function daysBetween(now, timestamp2) {
  return Math.max(0, Math.floor((now - timestamp2) / DAY_MS));
}
function timestampOf(value) {
  if (value === void 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
function olderThan(value, now, windowMs) {
  const timestamp2 = timestampOf(value);
  return timestamp2 !== null && now - timestamp2 > windowMs;
}
function hasBlockerEdges(tickets) {
  return tickets.every((ticket) => ticket.blockedBy !== void 0);
}
function longestChain(open) {
  const byRef = new Map(open.map((ticket) => [ticket.ref, ticket]));
  const memo = /* @__PURE__ */ new Map();
  const depthOf = (ref, visiting) => {
    const cached = memo.get(ref);
    if (cached !== void 0) return cached;
    if (visiting.has(ref)) return 0;
    const ticket = byRef.get(ref);
    if (ticket === void 0) return 0;
    visiting.add(ref);
    let deepest = 0;
    for (const blockerRef of ticket.blockedBy ?? []) {
      if (!byRef.has(blockerRef)) continue;
      deepest = Math.max(deepest, depthOf(blockerRef, visiting));
    }
    visiting.delete(ref);
    const depth = deepest + 1;
    memo.set(ref, depth);
    return depth;
  };
  let longest = 0;
  for (const ticket of open) {
    const depth = depthOf(ticket.ref, /* @__PURE__ */ new Set());
    if (depth > 1) longest = Math.max(longest, depth);
  }
  return longest;
}
function attentionOf(input, open, windowMs) {
  const { now } = input;
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (ticket, reason, evidence) => {
    if (items.length >= MAX_ATTENTION || seen.has(ticket.ref)) return;
    seen.add(ticket.ref);
    items.push({ ref: ticket.ref, title: ticket.title, reason, evidence });
  };
  const untriagedBugs = open.filter(
    (ticket) => ticket.category === "bug" && !ticket.labels.includes(input.labels.readyForAgent)
  ).sort(compareCreatedAsc);
  for (const ticket of untriagedBugs) push(ticket, "untriaged-bug", null);
  if (input.timestamps) {
    const stale = open.filter((ticket) => olderThan(ticket.updatedAt, now, windowMs)).sort(byUpdatedAsc);
    for (const ticket of stale) {
      push(ticket, "stale", daysBetween(now, timestampOf(ticket.updatedAt) ?? now));
    }
  }
  const blocking = open.filter((ticket) => ticket.openBlockers > 0).sort((left, right) => right.openBlockers - left.openBlockers || compareCreatedAsc(left, right));
  for (const ticket of blocking) {
    push(ticket, "most-blocking", ticket.openBlockers);
  }
  if (input.timestamps) {
    const stalled = open.filter((ticket) => ticket.status === "open").sort(compareCreatedAsc);
    for (const ticket of stalled) {
      push(ticket, "oldest-stalled", daysBetween(now, timestampOf(ticket.createdAt) ?? now));
    }
  }
  return items;
}
function byUpdatedAsc(left, right) {
  return (timestampOf(left.updatedAt) ?? 0) - (timestampOf(right.updatedAt) ?? 0);
}
function compareCreatedAsc(left, right) {
  return (timestampOf(left.createdAt) ?? 0) - (timestampOf(right.createdAt) ?? 0);
}

// src/worker/snapshot-library.ts
async function readStored(deps, key) {
  if (deps.store === void 0) return void 0;
  try {
    return await deps.store.read(key);
  } catch {
    return void 0;
  }
}
async function readStoredFor(deps, scopeRoot, workspaceRoot) {
  const keys = scopedKeysOf(scopeRoot, workspaceRoot);
  for (const key of keys) {
    const entry = await readStored(deps, key);
    if (entry === void 0) continue;
    if (!belongsToWorkspace(entry.backend, entry.workspaceRoot, workspaceRoot)) continue;
    return { key, entry };
  }
  return void 0;
}
function belongsToWorkspace(backend, entryWorkspaceRoot, workspaceRoot) {
  return backend !== "markdown" || entryWorkspaceRoot === workspaceRoot;
}
async function removeStored(deps, key) {
  if (deps.store === void 0) return;
  try {
    await deps.store.remove(key);
  } catch {
  }
}
async function writeStored(deps, scopeRoot, workspaceRoot, resolved2, raw) {
  const store = deps.store;
  if (store === void 0) return;
  const entry = {
    version: SNAPSHOT_STORE_VERSION,
    scopeRoot,
    workspaceRoot,
    backend: resolved2.kind,
    repository: raw.repository,
    repositoryKey: repositoryKey(resolved2.kind, resolved2.address),
    repositoryHost: resolved2.kind === "markdown" ? null : resolved2.address?.host ?? null,
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    loaded: raw.tickets.length,
    total: raw.total,
    ...raw.nextCursor === void 0 ? {} : { nextCursor: raw.nextCursor },
    tickets: raw.tickets,
    hierarchy: raw.hierarchy
  };
  try {
    await store.write(entry);
  } catch (error) {
    deps.log("warn", LOG_EVENTS.snapshot, {
      result: "error",
      backend: resolved2.kind,
      stage: SNAPSHOT_STAGES.list,
      code: ERROR_CODES.internal,
      ...error instanceof Error ? { reason: error.message } : {}
    });
  }
}
function buildStoredSnapshot(deps, stored, state) {
  const raw = rawOf(stored);
  const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels);
  const metrics = metricsOf(deps, stored.backend, raw, tickets, false);
  return {
    backend: stored.backend,
    repository: raw.repository,
    repositoryHost: stored.repositoryHost,
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    loaded: tickets.length,
    total: raw.total,
    hasMore: raw.nextCursor !== void 0,
    hierarchy: stored.hierarchy,
    blockersFinalized: false,
    metrics,
    source: "cache",
    stale: state.stale,
    refreshError: state.refreshError,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      labels: ticket.labels,
      author: ticket.author,
      assignees: ticket.assignees,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...ticket.closedAt === void 0 ? {} : { closedAt: ticket.closedAt },
      ...ticket.blockedBy === void 0 ? {} : { blockedBy: ticket.blockedBy },
      ...ticket.parent === void 0 ? {} : { parent: ticket.parent }
    }))
  };
}
function storedEntry(stored, resolved2, snapshot) {
  return {
    kind: stored.backend,
    scopeRoot: stored.scopeRoot,
    workspaceRoot: stored.workspaceRoot,
    repositoryKey: stored.repositoryKey,
    repositoryHost: stored.repositoryHost,
    raw: rawOf(stored),
    snapshot,
    resolver: resolved2?.tracker.resolveBlockers ?? null,
    pending: null
  };
}
async function cacheInfo(deps, cache, params) {
  const store = deps.store;
  if (store === void 0) {
    return {
      ok: true,
      result: { location: "\u672A\u542F\u7528\u672C\u5730\u5FEB\u7167\u5E93", entries: 0, lastWrittenAt: null, cleared: 0 }
    };
  }
  if (!isClearRequest(params)) {
    const entries = await store.list();
    return {
      ok: true,
      result: {
        location: store.location(),
        entries: entries.length,
        lastWrittenAt: latestWrite(entries),
        cleared: 0
      }
    };
  }
  if (readConfirm(params) !== SNAPSHOT_CLEAR_CONFIRMATION) {
    return {
      ok: false,
      error: { code: ERROR_CODES.invalidParams, message: "\u6E05\u7A7A\u672C\u5730\u5FEB\u7167\u5E93\u9700\u8981\u786E\u8BA4\u8BCD\u3002" }
    };
  }
  const cleared = await store.clear();
  cache.clear();
  return {
    ok: true,
    result: { location: store.location(), entries: 0, lastWrittenAt: null, cleared }
  };
}
function metricsOf(deps, kind, raw, tickets, blockersFinalized) {
  return computeMetrics({
    tickets,
    total: raw.total,
    now: raw.fetchedAt,
    timestamps: kind !== "markdown",
    blockersFinalized,
    labels: deps.labels
  });
}
function repositoryKey(kind, address) {
  if (address === void 0) return kind;
  return `${kind}@${address.host}/${address.path}`;
}
function rawOf(stored) {
  return {
    repository: stored.repository,
    fetchedAt: stored.fetchedAt,
    loaded: stored.tickets.length,
    total: stored.total,
    tickets: stored.tickets,
    viewer: stored.viewer,
    hierarchy: stored.hierarchy,
    ...stored.nextCursor === void 0 ? {} : { nextCursor: stored.nextCursor }
  };
}
function isClearRequest(params) {
  return isRecord(params) && params.clear === true;
}
function readConfirm(params) {
  if (!isRecord(params)) return void 0;
  return typeof params.confirm === "string" ? params.confirm : void 0;
}
function latestWrite(entries) {
  let latest = null;
  for (const entry of entries) {
    if (latest === null || entry.fetchedAt > latest) latest = entry.fetchedAt;
  }
  return latest;
}

// src/worker/snapshot-service.ts
var INCREMENTAL_OVERLAP_MS = 6e4;
function createSnapshotService(deps) {
  const cache = /* @__PURE__ */ new Map();
  const loading = /* @__PURE__ */ new Map();
  const paging = /* @__PURE__ */ new Map();
  return {
    async handle(method, params) {
      if (!isSnapshotMethod(method)) {
        return failure3(ERROR_CODES.unknownMethod, `\u672A\u77E5\u65B9\u6CD5\uFF1A${method}`);
      }
      const workspaceRoot = readWorkspaceRoot2(params);
      if (workspaceRoot === void 0) {
        return failure3(ERROR_CODES.invalidParams, "\u7F3A\u5C11\u975E\u7A7A\u7684 workspaceRoot \u53C2\u6570\u3002");
      }
      const target = { scopeRoot: await scopeOf(deps, workspaceRoot), workspaceRoot };
      if (method === RPC_METHODS.snapshotGet) {
        return getSnapshot(deps, cache, loading, target);
      }
      if (method === RPC_METHODS.snapshotResolveBlockers) {
        return resolveBlockers(deps, cache, loading, target);
      }
      if (method === RPC_METHODS.snapshotLoadMore) {
        return loadMore(deps, cache, loading, paging, target);
      }
      return refreshSnapshot(deps, cache, target, readFullFlag(params));
    },
    cache(params) {
      if (readWorkspaceRoot2(params) === void 0) {
        return Promise.resolve({
          ok: false,
          error: { code: ERROR_CODES.invalidParams, message: "\u7F3A\u5C11\u975E\u7A7A\u7684 workspaceRoot \u53C2\u6570\u3002" }
        });
      }
      return cacheInfo(deps, cache, params);
    }
  };
}
function isSnapshotMethod(method) {
  return method === RPC_METHODS.snapshotGet || method === RPC_METHODS.snapshotRefresh || method === RPC_METHODS.snapshotLoadMore || method === RPC_METHODS.snapshotResolveBlockers;
}
function readFullFlag(params) {
  return isRecord(params) && params.full === true;
}
async function scopeOf(deps, workspaceRoot) {
  try {
    return await deps.scope(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}
function memoryKeyOf(target, kind) {
  return storeKeyOf(kind, target.scopeRoot, target.workspaceRoot);
}
function cachedWorkspace(cache, target) {
  for (const key of scopedKeysOf(target.scopeRoot, target.workspaceRoot)) {
    const entry = cache.get(key);
    if (entry === void 0) continue;
    if (!belongsToWorkspace(entry.kind, entry.workspaceRoot, target.workspaceRoot)) continue;
    return entry;
  }
  return void 0;
}
function getSnapshot(deps, cache, loading, target) {
  const cached = cachedWorkspace(cache, target);
  if (cached !== void 0) return Promise.resolve({ ok: true, result: cached.snapshot });
  return loadWorkspace(deps, cache, loading, target);
}
function loadWorkspace(deps, cache, loading, target) {
  const shared = singleFlight(loading, target.scopeRoot, () => readWorkspace(deps, cache, target));
  return shared.then(async (result) => {
    const cached = cachedWorkspace(cache, target);
    if (cached !== void 0) return { ok: true, result: cached.snapshot };
    if (result.ok && result.result.backend === "markdown") {
      return await readWorkspace(deps, cache, target);
    }
    return result;
  });
}
function singleFlight(flights, key, start) {
  const running = flights.get(key);
  if (running !== void 0) return running;
  const task = start();
  flights.set(key, task);
  void task.then(
    () => {
      flights.delete(key);
    },
    () => {
      flights.delete(key);
    }
  );
  return task;
}
async function readWorkspace(deps, cache, target) {
  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot);
  if (hit !== void 0) {
    const served = await serveStored(deps, cache, target, hit);
    if (served !== void 0) return served;
  }
  return fetchAndCache(deps, cache, target);
}
async function serveStored(deps, cache, target, hit) {
  const stored = hit.entry;
  let resolved2;
  try {
    resolved2 = await deps.resolve(target.workspaceRoot);
  } catch (error) {
    const mapped = mapError(error);
    const snapshot2 = buildStoredSnapshot(deps, stored, {
      stale: true,
      refreshError: { code: mapped.code, message: mapped.message }
    });
    cache.set(hit.key, storedEntry(stored, null, snapshot2));
    return { ok: true, result: snapshot2 };
  }
  if (repositoryKey(resolved2.kind, resolved2.address) !== stored.repositoryKey) {
    await removeStored(deps, hit.key);
    return void 0;
  }
  const snapshot = buildStoredSnapshot(deps, stored, { stale: true, refreshError: null });
  cache.set(hit.key, storedEntry(stored, resolved2, snapshot));
  return { ok: true, result: snapshot };
}
async function refreshSnapshot(deps, cache, target, full) {
  const startedAt = deps.now();
  let resolved2;
  try {
    resolved2 = await deps.resolve(target.workspaceRoot);
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt);
  }
  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot);
  const base = hit?.entry.repositoryKey === repositoryKey(resolved2.kind, resolved2.address) ? hit.entry : void 0;
  const tracker = resolved2.tracker;
  const extendable = base === void 0 || base.nextCursor !== void 0 || base.total <= base.tickets.length;
  if (base !== void 0 && !full && extendable && tracker.fetchChanges !== void 0) {
    const merged = await mergeIncremental(deps, cache, target, resolved2, base, startedAt);
    if (merged !== void 0) return merged;
  }
  try {
    const raw = await tracker.fetchSnapshot(target.workspaceRoot);
    return await publish(
      deps,
      cache,
      target,
      resolved2,
      withViewerFallback(raw, base?.viewer),
      startedAt,
      "full"
    );
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt);
  }
}
async function mergeIncremental(deps, cache, target, resolved2, base, startedAt) {
  const tracker = resolved2.tracker;
  if (tracker.fetchChanges === void 0) return void 0;
  let changes;
  try {
    changes = await tracker.fetchChanges(
      target.workspaceRoot,
      base.fetchedAt - INCREMENTAL_OVERLAP_MS
    );
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt);
  }
  if (changes.truncated) {
    deps.log("warn", LOG_EVENTS.snapshot, {
      result: "error",
      backend: resolved2.kind,
      stage: SNAPSHOT_STAGES.list,
      code: ERROR_CODES.fetchFailed,
      durationMs: Math.max(0, deps.now() - startedAt)
    });
    return void 0;
  }
  if (changes.hierarchy !== base.hierarchy) return void 0;
  const merged = mergeTickets(base.tickets, changes.tickets);
  const nextCursor = base.nextCursor;
  const raw = {
    repository: base.repository,
    fetchedAt: deps.now(),
    loaded: merged.length,
    total: changes.total ?? base.total,
    tickets: merged,
    // 增量没查身份时沿用基准数据里的；查了但没识别出来则按 null 记。
    viewer: changes.viewer === void 0 ? base.viewer : changes.viewer,
    hierarchy: changes.hierarchy,
    // 游标仍指向已加载窗口之后的第一张；窗口大小由已加载数表达。
    ...nextCursor === void 0 ? {} : { nextCursor }
  };
  return await publish(deps, cache, target, resolved2, raw, startedAt, "incremental");
}
function loadMore(deps, cache, loading, paging, target) {
  return singleFlight(
    paging,
    target.workspaceRoot,
    () => appendPage(deps, cache, loading, target)
  );
}
async function appendPage(deps, cache, loading, target) {
  const startedAt = deps.now();
  let entry = cachedWorkspace(cache, target);
  if (entry === void 0) {
    const loaded = await loadWorkspace(deps, cache, loading, target);
    if (!loaded.ok) return loaded;
    entry = cachedWorkspace(cache, target);
    if (entry === void 0) return loaded;
  }
  const cursor = entry.raw.nextCursor;
  if (cursor === void 0) return { ok: true, result: entry.snapshot };
  let resolved2;
  try {
    resolved2 = await deps.resolve(target.workspaceRoot);
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt);
  }
  if (repositoryKey(resolved2.kind, resolved2.address) !== entry.repositoryKey) {
    return await refreshSnapshot(deps, cache, target, false);
  }
  let page;
  try {
    page = await resolved2.tracker.fetchSnapshot(target.workspaceRoot, { cursor });
  } catch (error) {
    return await keepOldSnapshot(deps, cache, target, mapError(error), startedAt);
  }
  const key = storeKeyOf(entry.kind, entry.scopeRoot, entry.workspaceRoot);
  if (cache.get(key) !== entry) {
    const current = cache.get(key);
    if (current === void 0) {
      return failure3(ERROR_CODES.internal, "\u52A0\u8F7D\u66F4\u591A\u65F6\u7F13\u5B58\u88AB\u6E05\u7A7A\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5DE5\u5355\u3002");
    }
    return { ok: true, result: current.snapshot };
  }
  const merged = mergeTickets(entry.raw.tickets, page.tickets);
  const nextCursor = page.nextCursor === cursor ? void 0 : page.nextCursor;
  const raw = {
    repository: entry.raw.repository,
    fetchedAt: deps.now(),
    loaded: merged.length,
    total: page.total,
    tickets: merged,
    // 扩窗响应没带身份时沿用当前已知身份，不因为翻页把筛选行清掉。
    viewer: withViewerFallback(page, entry.raw.viewer).viewer,
    // 父子能力属于整份快照；追加一页不改变它的来源。
    hierarchy: entry.raw.hierarchy,
    ...nextCursor === void 0 ? {} : { nextCursor }
  };
  return await publish(deps, cache, target, resolved2, raw, startedAt, "more");
}
function withViewerFallback(raw, previous) {
  if (raw.viewer !== null || previous === null || previous === void 0) return raw;
  return { ...raw, viewer: previous };
}
async function fetchAndCache(deps, cache, target) {
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(target.workspaceRoot);
    kind = resolved2.kind;
    const raw = await resolved2.tracker.fetchSnapshot(target.workspaceRoot);
    return await publish(deps, cache, target, resolved2, raw, startedAt, "full");
  } catch (error) {
    const mapped = mapError(error);
    deps.log("warn", LOG_EVENTS.snapshot, {
      result: "error",
      ...kind === void 0 ? {} : { backend: kind },
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt)
    });
    return failure3(mapped.code, mapped.message);
  }
}
async function publish(deps, cache, target, resolved2, raw, startedAt, mode) {
  const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels);
  const resolver = resolved2.tracker.resolveBlockers ?? null;
  const repositoryHost = resolved2.kind === "markdown" ? null : resolved2.address?.host ?? null;
  const finalized = resolver === null || !tickets.some((ticket) => ticket.state === "open");
  const metrics = metricsOf(deps, resolved2.kind, raw, tickets, finalized);
  const snapshot = buildSnapshot(
    resolved2.kind,
    repositoryHost,
    raw,
    tickets,
    finalized,
    metrics,
    "live",
    false,
    null
  );
  cache.set(memoryKeyOf(target, resolved2.kind), {
    kind: resolved2.kind,
    scopeRoot: target.scopeRoot,
    workspaceRoot: target.workspaceRoot,
    repositoryKey: repositoryKey(resolved2.kind, resolved2.address),
    repositoryHost,
    raw,
    snapshot,
    resolver,
    pending: null
  });
  await writeStored(deps, target.scopeRoot, target.workspaceRoot, resolved2, raw);
  deps.log("info", LOG_EVENTS.snapshot, {
    result: "ok",
    backend: resolved2.kind,
    stage: SNAPSHOT_STAGES.list,
    durationMs: Math.max(0, deps.now() - startedAt),
    repository: snapshot.repository,
    loaded: snapshot.loaded,
    total: snapshot.total,
    mode
  });
  return { ok: true, result: snapshot };
}
async function keepOldSnapshot(deps, cache, target, mapped, startedAt) {
  const refreshError = { code: mapped.code, message: mapped.message };
  const cached = cachedWorkspace(cache, target);
  if (cached !== void 0) {
    const snapshot2 = { ...cached.snapshot, stale: true, refreshError };
    cached.snapshot = snapshot2;
    deps.log("warn", LOG_EVENTS.snapshot, {
      result: "error",
      backend: cached.kind,
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt)
    });
    return { ok: true, result: snapshot2 };
  }
  const hit = await readStoredFor(deps, target.scopeRoot, target.workspaceRoot);
  if (hit === void 0) return failure3(mapped.code, mapped.message);
  const snapshot = buildStoredSnapshot(deps, hit.entry, { stale: true, refreshError });
  cache.set(hit.key, storedEntry(hit.entry, null, snapshot));
  deps.log("warn", LOG_EVENTS.snapshot, {
    result: "error",
    backend: hit.entry.backend,
    stage: SNAPSHOT_STAGES.list,
    code: mapped.code,
    durationMs: Math.max(0, deps.now() - startedAt)
  });
  return { ok: true, result: snapshot };
}
function resolveBlockers(deps, cache, loading, target) {
  const cached = cachedWorkspace(cache, target);
  if (cached !== void 0) return resolveCached(deps, cache, target, cached);
  return loadWorkspace(deps, cache, loading, target).then((result) => {
    if (!result.ok) return result;
    const entry = cachedWorkspace(cache, target);
    return entry === void 0 ? result : resolveCached(deps, cache, target, entry);
  });
}
function resolveCached(deps, cache, target, entry) {
  if (entry.snapshot.blockersFinalized || entry.resolver === null) {
    return Promise.resolve({ ok: true, result: entry.snapshot });
  }
  if (entry.pending !== null) return entry.pending;
  const task = finalize(deps, cache, target, entry, entry.resolver);
  entry.pending = task;
  return task;
}
async function finalize(deps, cache, target, entry, resolver) {
  const startedAt = deps.now();
  const targets = entry.snapshot.tickets.filter((ticket) => ticket.state === "open").map((ticket) => ({ ref: ticket.ref, number: ticket.number }));
  let settled;
  let failure6 = null;
  try {
    const native = await resolver(target.workspaceRoot, targets);
    const tickets = withSkillActions(
      classifyTickets(mergeNativeBlockers(entry.raw.tickets, native), deps.labels),
      deps.labels
    );
    const metrics = metricsOf(deps, entry.kind, entry.raw, tickets, true);
    settled = buildSnapshot(
      entry.kind,
      entry.repositoryHost,
      entry.raw,
      tickets,
      true,
      metrics,
      entry.snapshot.source,
      entry.snapshot.stale,
      entry.snapshot.refreshError
    );
  } catch (error) {
    failure6 = mapError(error);
    settled = { ...entry.snapshot, blockersFinalized: true };
  }
  const key = storeKeyOf(entry.kind, entry.scopeRoot, entry.workspaceRoot);
  const stale = cache.get(key) !== entry;
  if (!stale) {
    entry.snapshot = settled;
    entry.pending = null;
  }
  deps.log(failure6 === null ? "info" : "warn", LOG_EVENTS.snapshot, {
    result: failure6 === null ? "ok" : "error",
    backend: entry.kind,
    stage: SNAPSHOT_STAGES.blockers,
    ...failure6 === null ? {} : { code: failure6.code },
    durationMs: Math.max(0, deps.now() - startedAt),
    ...stale ? { stale: true } : {}
  });
  return { ok: true, result: settled };
}
function buildSnapshot(kind, repositoryHost, raw, tickets, blockersFinalized, metrics, source, stale, refreshError) {
  return {
    backend: kind,
    repository: raw.repository,
    repositoryHost,
    fetchedAt: raw.fetchedAt,
    viewer: raw.viewer,
    loaded: tickets.length,
    total: raw.total,
    hasMore: raw.nextCursor !== void 0,
    hierarchy: raw.hierarchy,
    blockersFinalized,
    metrics,
    source,
    stale,
    refreshError,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      labels: ticket.labels,
      author: ticket.author,
      assignees: ticket.assignees,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...ticket.closedAt === void 0 ? {} : { closedAt: ticket.closedAt },
      ...ticket.blockedBy === void 0 ? {} : { blockedBy: ticket.blockedBy },
      ...ticket.parent === void 0 ? {} : { parent: ticket.parent }
    }))
  };
}
function mapError(error) {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message };
  }
  return { code: ERROR_CODES.internal, message: "\u8BFB\u53D6\u5DE5\u5355\u65F6\u53D1\u751F\u672A\u9884\u671F\u7684\u9519\u8BEF\u3002" };
}
function failure3(code, message) {
  return { ok: false, error: { code, message } };
}

// src/protocol/backend.ts
var BACKEND_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  markdown: "\u672C\u5730"
};

// src/worker/ticket-service.ts
var PATCH_KEYS = {
  labels: true,
  assignees: true,
  assignSelf: true,
  state: true
};
function createTicketService(deps) {
  return {
    handle(method, params) {
      if (method === RPC_METHODS.ticketGet) return getDetail(deps, params);
      if (method === RPC_METHODS.ticketUpdate) return update(deps, params);
      if (method === RPC_METHODS.ticketOptions) return readOptions(deps, params);
      if (method === RPC_METHODS.ticketDelete) return remove(deps, params);
      return Promise.resolve(failure4(ERROR_CODES.unknownMethod, `\u672A\u77E5\u65B9\u6CD5\uFF1A${method}`));
    }
  };
}
async function getDetail(deps, params) {
  const target = readTicketParams(params);
  if (target === void 0) {
    return failure4(ERROR_CODES.invalidParams, "\u7F3A\u5C11 workspaceRoot\u3001ref \u6216 number \u53C2\u6570\u3002");
  }
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(target.workspaceRoot);
    kind = resolved2.kind;
    const fetchDetail = resolved2.tracker.fetchDetail;
    if (fetchDetail === void 0) {
      return unsupported(kind, "\u8BFB\u53D6\u5DE5\u5355\u8BE6\u60C5");
    }
    const [detail, canDelete] = await Promise.all([
      fetchDetail(target.workspaceRoot, referenceOf(target)),
      readCanDelete(resolved2.tracker, target.workspaceRoot)
    ]);
    logResult(deps, "info", kind, "get", startedAt);
    return { ok: true, result: withCapabilities(kind, resolved2.tracker, detail, canDelete) };
  } catch (error) {
    const mapped = mapError2(error);
    logResult(deps, "warn", kind, "get", startedAt, mapped.code);
    return failure4(mapped.code, mapped.message);
  }
}
async function update(deps, params) {
  const target = readTicketParams(params);
  if (target === void 0) {
    return failure4(ERROR_CODES.invalidParams, "\u7F3A\u5C11 workspaceRoot\u3001ref \u6216 number \u53C2\u6570\u3002");
  }
  const patch = readPatch(readField(params, "patch"));
  if (patch === void 0) {
    return failure4(ERROR_CODES.invalidParams, "patch \u5F62\u72B6\u4E0D\u6B63\u786E\uFF1A\u9700\u8981\u81F3\u5C11\u4E00\u9879\u5DF2\u77E5\u5C5E\u6027\u3002");
  }
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(target.workspaceRoot);
    kind = resolved2.kind;
    const updateTicket = resolved2.tracker.updateTicket;
    if (updateTicket === void 0) {
      return unsupported(kind, "\u4FEE\u6539\u5DE5\u5355\u5C5E\u6027");
    }
    const storeKey = await cacheKeyOf(deps, target.workspaceRoot, resolved2.kind);
    await updateTicket(target.workspaceRoot, referenceOf(target), patch);
    await syncCachedTicket(deps, storeKey, target.ref, patch);
    logResult(deps, "info", kind, "update", startedAt);
    return { ok: true, result: { applied: true } };
  } catch (error) {
    const mapped = mapError2(error);
    logResult(deps, "warn", kind, "update", startedAt, mapped.code);
    return failure4(mapped.code, mapped.message);
  }
}
async function readOptions(deps, params) {
  const workspaceRoot = readWorkspaceRoot2(params);
  if (workspaceRoot === void 0) {
    return failure4(ERROR_CODES.invalidParams, "\u7F3A\u5C11 workspaceRoot \u53C2\u6570\u3002");
  }
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(workspaceRoot);
    kind = resolved2.kind;
    const fetchOptions = resolved2.tracker.fetchOptions;
    if (fetchOptions === void 0) {
      return unsupported(kind, "\u8BFB\u53D6\u6807\u7B7E\u4E0E\u5206\u914D\u4EBA\u5019\u9009");
    }
    const result = await fetchOptions(workspaceRoot);
    logResult(deps, "info", kind, "options", startedAt);
    return { ok: true, result };
  } catch (error) {
    const mapped = mapError2(error);
    logResult(deps, "warn", kind, "options", startedAt, mapped.code);
    return failure4(mapped.code, mapped.message);
  }
}
async function remove(deps, params) {
  const target = readTicketParams(params);
  if (target === void 0) {
    return failure4(ERROR_CODES.invalidParams, "\u7F3A\u5C11 workspaceRoot\u3001ref \u6216 number \u53C2\u6570\u3002");
  }
  if (readField(params, "confirm") !== TICKET_DELETE_CONFIRMATION) {
    return failure4(ERROR_CODES.invalidParams, `\u5220\u9664\u5DE5\u5355\u9700\u8981\u786E\u8BA4\u8BCD ${TICKET_DELETE_CONFIRMATION}\u3002`);
  }
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(target.workspaceRoot);
    kind = resolved2.kind;
    const deleteTicket = resolved2.tracker.deleteTicket;
    if (deleteTicket === void 0) {
      return unsupported(kind, "\u5220\u9664\u5DE5\u5355");
    }
    if (!await readCanDelete(resolved2.tracker, target.workspaceRoot)) {
      const code = ERROR_CODES.fetchFailed;
      logResult(deps, "warn", kind, "delete", startedAt, code);
      return failure4(code, `\u6CA1\u6709\u5220\u9664\u8FD9\u5F20\u5DE5\u5355\u7684\u6743\u9650\uFF08${BACKEND_LABELS[kind]}\uFF09\u3002`);
    }
    const storeKey = await cacheKeyOf(deps, target.workspaceRoot, resolved2.kind);
    await deleteTicket(target.workspaceRoot, referenceOf(target));
    await removeCachedTicket(deps, storeKey, target.ref);
    logResult(deps, "info", kind, "delete", startedAt);
    return { ok: true, result: { deleted: true } };
  } catch (error) {
    const mapped = mapError2(error);
    logResult(deps, "warn", kind, "delete", startedAt, mapped.code);
    return failure4(mapped.code, mapped.message);
  }
}
async function cacheKeyOf(deps, workspaceRoot, kind) {
  return storeKeyOf(kind, await deps.scope(workspaceRoot), workspaceRoot);
}
async function syncCachedTicket(deps, storeKey, ref, patch) {
  const store = deps.store;
  if (store === void 0) return;
  if (patch.labels === void 0 && patch.state === void 0) return;
  try {
    await store.patchTicket(storeKey, ref, {
      ...patch.labels === void 0 ? {} : { labels: patch.labels },
      ...patch.state === void 0 ? {} : { state: patch.state }
    });
  } catch {
  }
}
async function removeCachedTicket(deps, storeKey, ref) {
  const store = deps.store;
  if (store === void 0) return;
  try {
    await store.removeTicket(storeKey, ref);
  } catch {
  }
}
function withCapabilities(kind, tracker, detail, canDelete) {
  const writable = tracker.updateTicket !== void 0;
  const capabilities = {
    labels: writable,
    assignees: writable,
    state: writable,
    link: detail.url !== null,
    delete: canDelete
  };
  return { ...detail, backend: kind, capabilities };
}
async function readCanDelete(tracker, workspaceRoot) {
  if (tracker.canDeleteTickets === void 0 || tracker.deleteTicket === void 0) return false;
  try {
    return await tracker.canDeleteTickets(workspaceRoot);
  } catch {
    return false;
  }
}
function readPatch(value) {
  if (!isRecord(value)) return void 0;
  if (Object.keys(value).some((key) => !Object.hasOwn(PATCH_KEYS, key))) return void 0;
  const patch = {};
  if ("labels" in value) {
    const labels = readNames(value.labels);
    if (labels === void 0) return void 0;
    patch.labels = labels;
  }
  if ("assignees" in value) {
    const assignees = readNames(value.assignees);
    if (assignees === void 0) return void 0;
    patch.assignees = assignees;
  }
  if ("assignSelf" in value) {
    if (typeof value.assignSelf !== "boolean") return void 0;
    patch.assignSelf = value.assignSelf;
  }
  if ("state" in value) {
    const state = value.state;
    if (state !== "open" && state !== "closed") return void 0;
    patch.state = state;
  }
  return Object.keys(patch).length === 0 ? void 0 : patch;
}
function readNames(value) {
  if (!Array.isArray(value)) return void 0;
  const names = [];
  for (const entry of value) {
    if (typeof entry !== "string") return void 0;
    const trimmed = entry.trim();
    if (trimmed.length === 0) return void 0;
    if (!names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}
function readField(params, key) {
  if (typeof params !== "object" || params === null) return void 0;
  return key in params ? params[key] : void 0;
}
function referenceOf(target) {
  return { ref: target.ref, number: target.number };
}
function unsupported(kind, action) {
  return failure4(
    ERROR_CODES.capabilityUnsupported,
    `\u5F53\u524D\u540E\u7AEF\uFF08${BACKEND_LABELS[kind]}\uFF09\u4E0D\u652F\u6301${action}\u3002`
  );
}
function mapError2(error) {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message };
  }
  return { code: ERROR_CODES.internal, message: "\u5904\u7406\u5DE5\u5355\u65F6\u53D1\u751F\u672A\u9884\u671F\u7684\u9519\u8BEF\u3002" };
}
function logResult(deps, level, kind, action, startedAt, code) {
  deps.log(level, LOG_EVENTS.ticket, {
    result: code === void 0 ? "ok" : "error",
    action: TICKET_ACTIONS[action],
    ...kind === void 0 ? {} : { backend: kind },
    ...code === void 0 ? {} : { code },
    durationMs: Math.max(0, deps.now() - startedAt)
  });
}
function failure4(code, message) {
  return { ok: false, error: { code, message } };
}

// src/core/worktree.ts
var WORKTREE_CREATE_TIMEOUT_MS = 12e4;
var WORKTREE_SLUG_LIMIT = 40;
function worktreeSlug(title) {
  const collapsed = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").slice(0, WORKTREE_SLUG_LIMIT);
  return collapsed.replace(/^-+|-+$/g, "");
}
function worktreeBranchName(number, title, category) {
  const kind = category === "bug" ? "bugfix" : "feat";
  const slug = worktreeSlug(title);
  return slug.length === 0 ? `${kind}/${String(number)}` : `${kind}/${String(number)}-${slug}`;
}
function worktreeDisplayName(title) {
  return title.replace(/\s+/g, " ").trim();
}
var PUBLIC_REFERENCE_HOSTS = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "gitea",
  "bitbucket.org": "bitbucket",
  "dev.azure.com": "azure-devops",
  "linear.app": "linear"
};
function isOrcaReferenceUrl(reference, kind) {
  if (kind === "markdown") return false;
  let url;
  try {
    url = new URL(reference.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    return false;
  }
  const host = stripWww(url.hostname);
  const pathname = url.pathname.replace(/\/+$/, "");
  return routeProvider(host, pathname) === kind;
}
function stripWww(host) {
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return PUBLIC_REFERENCE_HOSTS[bare] === void 0 ? host : bare;
}
function routeProvider(host, pathname) {
  const known = PUBLIC_REFERENCE_HOSTS[host];
  const gitlab = /^(\/.+)\/-\/(merge_requests|issues)\/(\d+)(?:\/.*)?$/.exec(pathname);
  if (gitlab !== null && host !== "github.com" && host !== "linear.app") {
    if (!isPositiveNumber(gitlab[3])) return null;
    return known === void 0 || known === "gitlab" ? "gitlab" : null;
  }
  const git = /^(\/[^/]+\/[^/]+)\/(pull|pulls|issues)\/(\d+)(?:\/.*)?$/.exec(pathname);
  if (git === null || host === "linear.app" || host === "gitlab.com") return null;
  if (!isPositiveNumber(git[3])) return null;
  const provider = host === "github.com" || git[2] === "pull" ? "github" : host === "codeberg.org" || git[2] === "pulls" ? "gitea" : null;
  if (provider === null) return null;
  if (git[2] === "pulls" && provider !== "gitea" || git[2] === "pull" && provider !== "github") {
    return null;
  }
  return known === void 0 || known === provider ? provider : null;
}
function isPositiveNumber(raw) {
  if (raw === void 0) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0;
}
function worktreeComment(ticketRef, title, reference) {
  const comment = `${ticketRef} ${worktreeDisplayName(title)}`;
  const url = reference?.trim() ?? "";
  return url.length === 0 ? comment : `${comment}
${url}`;
}
function planWorktree(input) {
  const branch = worktreeBranchName(input.number, input.title, input.category);
  const attachable = isOrcaReferenceUrl(input.reference, input.kind);
  return {
    name: branch,
    branch,
    reference: attachable ? input.reference : null,
    comment: worktreeComment(
      `#${String(input.number)}`,
      input.title,
      attachable ? null : input.reference
    )
  };
}
function worktreeCreateArgs(plan) {
  return [
    "worktree",
    "create",
    "--name",
    plan.name,
    "--branch",
    plan.branch,
    ...plan.reference === null ? [] : ["--reference", plan.reference],
    "--comment",
    plan.comment,
    "--activate",
    "--json"
  ];
}
function worktreeCurrentArgs() {
  return ["worktree", "current", "--json"];
}
function worktreeListArgs(repoId) {
  return ["worktree", "list", "--repo", `id:${repoId}`, "--json"];
}
function normalizeBranch(branch) {
  return branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
}
function parseWorktreeListOutput(stdout) {
  const payload = parseJson11(stdout);
  if (payload === void 0) return void 0;
  const result = resultOf(payload);
  const list = result["worktrees"];
  if (!Array.isArray(list)) return void 0;
  const records = [];
  for (const entry of list) {
    const record = readWorktree(entry);
    if (record !== void 0) records.push(record);
  }
  return records;
}
function parseWorktreeCurrentOutput(stdout) {
  const payload = parseJson11(stdout);
  if (payload === void 0) return void 0;
  const record = readWorktree(resultOf(payload)["worktree"]);
  if (record === void 0 || record.repoId === null) return void 0;
  return {
    id: record.id,
    path: record.path,
    branch: record.branch,
    displayName: record.displayName,
    repoId: record.repoId
  };
}
function parseWorktreeCreateOutput(stdout) {
  const payload = parseJson11(stdout);
  if (payload === void 0) return void 0;
  return readWorktree(resultOf(payload)["worktree"]);
}
function findWorktreeByBranch(records, branch) {
  const target = normalizeBranch(branch);
  return records.find((record) => normalizeBranch(record.branch) === target);
}
function resultOf(payload) {
  return isRecord(payload["result"]) ? payload["result"] : payload;
}
function parseJson11(stdout) {
  try {
    const value = JSON.parse(stdout);
    return isRecord(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function readWorktree(value) {
  if (!isRecord(value)) return void 0;
  const id = value["id"];
  const path = value["path"];
  const branch = value["branch"];
  if (typeof id !== "string" || typeof path !== "string" || typeof branch !== "string") {
    return void 0;
  }
  const displayName = value["displayName"];
  const repoId = value["repoId"];
  return {
    id,
    path,
    branch,
    displayName: typeof displayName === "string" ? displayName : "",
    repoId: typeof repoId === "string" ? repoId : null
  };
}

// src/worker/ticket-worktree-service.ts
function createTicketWorktreeService(deps) {
  return {
    handle(method, params) {
      if (method !== RPC_METHODS.ticketWorktree) {
        return Promise.resolve(failure5(ERROR_CODES.unknownMethod, `\u672A\u77E5\u65B9\u6CD5\uFF1A${method}`));
      }
      return createWorktree(deps, params);
    }
  };
}
async function createWorktree(deps, params) {
  const target = readTicketParams(params);
  if (target === void 0) {
    return failure5(ERROR_CODES.invalidParams, "\u7F3A\u5C11 workspaceRoot\u3001ref \u6216 number \u53C2\u6570\u3002");
  }
  const startedAt = deps.now();
  let kind;
  try {
    const resolved2 = await deps.resolve(target.workspaceRoot);
    kind = resolved2.kind;
    const fetchDetail = resolved2.tracker.fetchDetail;
    if (kind === "markdown" || fetchDetail === void 0) {
      return unsupported2(kind, "\u4E3A\u5DE5\u5355\u521B\u5EFA worktree");
    }
    const detail = await fetchDetail(target.workspaceRoot, referenceOf2(target));
    if (detail.url === null) {
      return failure5(
        ERROR_CODES.capabilityUnsupported,
        `\u5DE5\u5355\u6CA1\u6709\u8FDC\u7AEF\u94FE\u63A5\uFF0C\u65E0\u6CD5\u6302\u5230 worktree\uFF08${BACKEND_LABELS[kind]}\uFF09\u3002`
      );
    }
    if (detail.number === null) {
      return failure5(ERROR_CODES.capabilityUnsupported, "\u5DE5\u5355\u6CA1\u6709\u7F16\u53F7\uFF0C\u65E0\u6CD5\u63A8\u5BFC\u5206\u652F\u540D\u3002");
    }
    const cli = await resolveOrcaCli(deps.run, {
      ...deps.candidates === void 0 ? {} : { candidates: deps.candidates() },
      cwd: target.workspaceRoot
    });
    if (cli === void 0) {
      const code = ERROR_CODES.orcaMissing;
      logResult2(deps, "warn", kind, "worktree", startedAt, code);
      return failure5(
        code,
        "\u672A\u627E\u5230 Orca \u547D\u4EE4\u884C\uFF0C\u8BF7\u5148\u5B89\u88C5 Orca \u6216\u5728\u73AF\u5883\u68C0\u67E5\u91CC\u8BBE\u7F6E ORCA_CLI_COMMAND\u3002"
      );
    }
    const plan = planWorktree({
      kind,
      number: detail.number,
      title: detail.title,
      category: categorize(detail.labels, TRACKER_LABELS),
      reference: detail.url
    });
    const current = await readCurrentWorktree(deps, cli, target.workspaceRoot);
    if (current === void 0) {
      const code = ERROR_CODES.worktreeCreateFailed;
      logResult2(deps, "warn", kind, "worktree", startedAt, code);
      return failure5(code, "\u65E0\u6CD5\u8BC6\u522B\u5F53\u524D\u5DE5\u4F5C\u533A\u6240\u5C5E\u7684\u4ED3\u5E93\uFF0COrca \u6CA1\u6709\u8FD4\u56DE\u4ED3\u5E93 id\u3002");
    }
    const existing = await listExisting(deps, cli, target.workspaceRoot, current.repoId, plan.branch);
    if (existing !== void 0) {
      logResult2(deps, "info", kind, "worktree", startedAt);
      return { ok: true, result: worktreeResultOf(existing, detail.url, plan.name, false) };
    }
    const output = await deps.run(cli.command, worktreeCreateArgs(plan), {
      cwd: target.workspaceRoot,
      timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
    });
    const created = parseWorktreeCreateOutput(output.stdout);
    if (created === void 0) {
      const code = ERROR_CODES.worktreeCreateFailed;
      logResult2(deps, "warn", kind, "worktree", startedAt, code);
      return failure5(code, "Orca \u8FD4\u56DE\u7684 worktree \u521B\u5EFA\u7ED3\u679C\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
    }
    logResult2(deps, "info", kind, "worktree", startedAt);
    return { ok: true, result: worktreeResultOf(created, detail.url, plan.name, true) };
  } catch (error) {
    const mapped = mapError3(error);
    logResult2(deps, "warn", kind, "worktree", startedAt, mapped.code);
    return failure5(mapped.code, mapped.message);
  }
}
async function readCurrentWorktree(deps, cli, workspaceRoot) {
  const output = await deps.run(cli.command, worktreeCurrentArgs(), {
    cwd: workspaceRoot,
    timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
  });
  return parseWorktreeCurrentOutput(output.stdout);
}
async function listExisting(deps, cli, workspaceRoot, repoId, branch) {
  const output = await deps.run(cli.command, worktreeListArgs(repoId), {
    cwd: workspaceRoot,
    timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
  });
  const records = parseWorktreeListOutput(output.stdout);
  if (records === void 0) {
    throw new OrcaOutputError("\u65E0\u6CD5\u89E3\u6790 Orca \u7684 worktree \u5217\u8868\u8F93\u51FA\u3002");
  }
  return findWorktreeByBranch(records, branch);
}
function worktreeResultOf(record, reference, fallbackName, created) {
  return {
    id: record.id,
    path: record.path,
    branch: normalizeBranch(record.branch),
    name: record.displayName.length > 0 ? record.displayName : fallbackName,
    reference,
    created
  };
}
var UNSUPPORTED_REFERENCE = /Unsupported reference URL/i;
function commandDiagnostic(error) {
  const parsed = parseErrorEnvelope(error.stdout);
  if (parsed !== void 0) return parsed;
  return commandFailureDetail(error);
}
function parseErrorEnvelope(stdout) {
  try {
    const value = JSON.parse(stdout);
    if (!isRecord(value) || !isRecord(value["error"])) return void 0;
    const error = value["error"];
    const code = typeof error["code"] === "string" ? error["code"] : null;
    const message = typeof error["message"] === "string" ? error["message"] : null;
    if (message === null) return void 0;
    const text = code === null ? message : `${code}: ${message}`;
    return text.length > 200 ? `${text.slice(0, 200)}\u2026` : text;
  } catch {
    return void 0;
  }
}
var OrcaOutputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OrcaOutputError";
  }
};
function referenceOf2(target) {
  return { ref: target.ref, number: target.number };
}
function unsupported2(kind, action) {
  if (kind === "markdown") {
    return failure5(
      ERROR_CODES.capabilityUnsupported,
      "\u672C\u5730\u5DE5\u5355\u6CA1\u6709\u8FDC\u7AEF\u94FE\u63A5\uFF0C\u65E0\u6CD5\u6302\u5230 worktree\u3002"
    );
  }
  return failure5(
    ERROR_CODES.capabilityUnsupported,
    `\u5F53\u524D\u540E\u7AEF\uFF08${BACKEND_LABELS[kind]}\uFF09\u4E0D\u652F\u6301${action}\u3002`
  );
}
function mapError3(error) {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof CommandError) {
    if (error.kind === "not-found") {
      return {
        code: ERROR_CODES.orcaMissing,
        message: "\u672A\u627E\u5230 Orca \u547D\u4EE4\u884C\uFF0C\u8BF7\u5148\u5B89\u88C5 Orca \u6216\u5728\u73AF\u5883\u68C0\u67E5\u91CC\u8BBE\u7F6E ORCA_CLI_COMMAND\u3002"
      };
    }
    const detail = commandDiagnostic(error);
    const prefix = error.kind === "timeout" ? "\u521B\u5EFA worktree \u8D85\u65F6" : "\u521B\u5EFA worktree \u5931\u8D25";
    if (error.kind !== "timeout" && UNSUPPORTED_REFERENCE.test(detail)) {
      return {
        code: ERROR_CODES.worktreeCreateFailed,
        message: "\u521B\u5EFA worktree \u5931\u8D25\uFF1A\u8BE5\u5DE5\u5355\u94FE\u63A5\u4E0D\u53D7 Orca \u652F\u6301\uFF0Cworktree \u672A\u521B\u5EFA\u3002\u8BF7\u6362\u7528 Orca \u80FD\u8BC6\u522B\u7684\u5DE5\u5355\u94FE\u63A5\uFF0C\u6216\u7A0D\u540E\u91CD\u8BD5\u3002"
      };
    }
    return {
      code: ERROR_CODES.worktreeCreateFailed,
      message: detail.length === 0 ? `${prefix}\u3002` : `${prefix}\uFF1A${detail}`
    };
  }
  if (error instanceof OrcaOutputError) {
    return { code: ERROR_CODES.worktreeCreateFailed, message: error.message };
  }
  return { code: ERROR_CODES.internal, message: "\u521B\u5EFA worktree \u65F6\u53D1\u751F\u672A\u9884\u671F\u7684\u9519\u8BEF\u3002" };
}
function logResult2(deps, level, kind, action, startedAt, code) {
  deps.log(level, LOG_EVENTS.ticket, {
    result: code === void 0 ? "ok" : "error",
    action: TICKET_ACTIONS[action],
    ...kind === void 0 ? {} : { backend: kind },
    ...code === void 0 ? {} : { code },
    durationMs: Math.max(0, deps.now() - startedAt)
  });
}
function failure5(code, message) {
  return { ok: false, error: { code, message } };
}

// src/worker/timer.ts
function createTimer() {
  return {
    timeout(callback, delay) {
      const handle = setTimeout(callback, delay);
      handle.unref();
      return () => {
        clearTimeout(handle);
      };
    }
  };
}

// src/worker/workspace-resolver.ts
import { homedir as homedir5 } from "node:os";
var PREFERENCE_KEY = "workspace-selection";
var PREFERENCE_VERSION = 1;
function createWorkspaceResolver(host, storage) {
  let cached;
  let preferred;
  let loadingPreference;
  const persistPreference = async (preference) => {
    if (storage === void 0) return;
    try {
      await storage.set(PREFERENCE_KEY, {
        version: PREFERENCE_VERSION,
        contextKey: preference.contextKey,
        path: preference.path
      });
    } catch {
    }
  };
  const ensurePreference = () => {
    if (storage === void 0) return Promise.resolve();
    loadingPreference ??= storage.get(PREFERENCE_KEY).then((raw) => {
      const stored = readStoredPreference(raw);
      if (stored !== void 0) preferred ??= stored;
    }).catch(() => {
    });
    return loadingPreference;
  };
  return {
    async resolve() {
      await ensurePreference();
      const context = await readContext(host);
      if (context === void 0) {
        cached = void 0;
        return { status: "unresolved", candidates: [], contextKey: "" };
      }
      const key = contextKeyOf(context);
      if (cached?.key === key) return cached.resolution;
      const resolution = await matchWorkspace(host, context, preferred);
      cached = { key, resolution };
      return resolution;
    },
    invalidate() {
      cached = void 0;
    },
    async prefer(path) {
      const context = await readContext(host);
      if (context === void 0) {
        cached = void 0;
        return;
      }
      const preference = { contextKey: contextKeyOf(context), path };
      if (preferred !== void 0 && preferred.contextKey === preference.contextKey && preferred.path === path) {
        return;
      }
      preferred = preference;
      cached = void 0;
      await persistPreference(preference);
    }
  };
}
function contextKeyOf(context) {
  if (context.workspaceId !== void 0) return `id\0${context.workspaceId}`;
  return `${context.displayName}\0${context.branch}`;
}
async function readContext(host) {
  try {
    const raw = await host.call("workspace.readContext");
    if (!isRecord(raw)) return void 0;
    const displayName = raw["displayName"];
    const branch = raw["branch"];
    if (typeof displayName !== "string" || typeof branch !== "string") return void 0;
    const terminals = raw["terminals"];
    const terminalTitles = Array.isArray(terminals) ? terminals.map(
      (terminal) => isRecord(terminal) && typeof terminal["title"] === "string" ? terminal["title"] : ""
    ).filter((title) => title.length > 0) : [];
    const workspaceId = raw["workspaceId"];
    return {
      ...typeof workspaceId === "string" && workspaceId.length > 0 ? { workspaceId } : {},
      displayName,
      branch,
      terminalTitles
    };
  } catch {
    return void 0;
  }
}
function readStoredPreference(value) {
  if (!isRecord(value)) return void 0;
  if (value["version"] !== PREFERENCE_VERSION) return void 0;
  const contextKey = value["contextKey"];
  const path = value["path"];
  if (typeof contextKey !== "string" || typeof path !== "string" || path.length === 0) {
    return void 0;
  }
  return { contextKey, path };
}
function matchByName(workspaces, displayName) {
  const exact = workspaces.filter((workspace) => workspace.name === displayName);
  if (exact.length > 0) return exact;
  const loose = workspaces.filter(
    (workspace) => workspace.name.trim().toLowerCase() === displayName.toLowerCase()
  );
  if (loose.length > 0) return loose;
  return workspaces.filter(
    (workspace) => workspace.project !== null && workspace.project.toLowerCase() === displayName.toLowerCase()
  );
}
function matchByTerminalTitle(workspaces, titles) {
  for (const title of titles) {
    const hits = [];
    for (const workspace of workspaces) {
      const length = Math.max(
        0,
        ...pathForms(workspace.path).filter((form) => containsPath(title, form)).map((form) => form.length)
      );
      if (length > 0) hits.push({ workspace, length });
    }
    if (hits.length === 0) continue;
    const deepest = Math.max(...hits.map((hit) => hit.length));
    const best = hits.filter((hit) => hit.length === deepest);
    if (best.length === 1) return best[0]?.workspace;
  }
  return void 0;
}
function containsPath(title, path) {
  if (path.length === 0) return false;
  let from = 0;
  for (; ; ) {
    const index = title.indexOf(path, from);
    if (index < 0) return false;
    const before = index === 0 ? "" : title.charAt(index - 1);
    const after = title.charAt(index + path.length);
    const startsClean = before === "" || /[\s:'"(\[]/.test(before);
    const endsClean = after === "" || /[\s/:'")\]]/.test(after);
    if (startsClean && endsClean) return true;
    from = index + 1;
  }
}
function pathForms(path) {
  const home = homedir5();
  const forms = [path];
  if (home.length > 0 && path.startsWith(home)) {
    forms.push(`~${path.slice(home.length)}`);
  }
  return forms;
}
async function matchWorkspace(host, context, preferred) {
  const key = contextKeyOf(context);
  const workspaces = await listWorkspaces(host);
  if (workspaces.length === 0) return { status: "unresolved", candidates: [], contextKey: key };
  if (context.workspaceId !== void 0) {
    const exact = workspaces.find((workspace) => workspace.id === context.workspaceId);
    if (exact !== void 0) return resolved(exact, key);
  }
  if (preferred !== void 0 && preferred.contextKey === key) {
    const chosen = workspaces.find((workspace) => workspace.path === preferred.path);
    if (chosen !== void 0) return resolved(chosen, key);
  }
  const displayName = context.displayName.trim();
  const branch = context.branch.trim();
  const nameIsClue = displayName.length > 0 && displayName !== branch;
  const byName = nameIsClue ? matchByName(workspaces, displayName) : [];
  if (byName.length === 1) {
    const candidate = byName[0];
    if (candidate !== void 0) return resolved(candidate, key);
  }
  const byBranch = branch.length > 0 ? workspaces.filter((workspace) => workspace.branch === branch) : [];
  const narrowed = byName.length > 1 ? byName.filter((workspace) => byBranch.includes(workspace)) : byBranch;
  if (narrowed.length > 1) {
    const byTerminal = matchByTerminalTitle(narrowed, context.terminalTitles);
    if (byTerminal !== void 0) return resolved(byTerminal, key);
  }
  if (narrowed.length === 1) {
    const candidate = narrowed[0];
    if (candidate !== void 0) return resolved(candidate, key);
  }
  if (narrowed.length === 0) {
    const candidates = byName.length > 1 ? byName : workspaces;
    return { status: "unresolved", candidates, contextKey: key };
  }
  return { status: "ambiguous", candidates: narrowed, contextKey: key };
}
function resolved(candidate, contextKey) {
  return { status: "resolved", root: candidate.path, candidate, contextKey };
}
async function listWorkspaces(host) {
  try {
    const raw = await host.call("workspace.list");
    if (!isRecord(raw)) return [];
    const workspaces = raw["workspaces"];
    if (!Array.isArray(workspaces)) return [];
    const candidates = [];
    for (const entry of workspaces) {
      const candidate = readCandidate(entry);
      if (candidate !== void 0) candidates.push(candidate);
    }
    return candidates;
  } catch {
    return [];
  }
}
function readCandidate(value) {
  if (!isRecord(value)) return void 0;
  const id = value["id"];
  const name = value["name"];
  const path = value["path"];
  const branch = value["branch"];
  const project = value["project"];
  const kind = value["kind"];
  if (typeof id !== "string" || typeof name !== "string" || typeof path !== "string") return void 0;
  return {
    id,
    name,
    path,
    branch: typeof branch === "string" ? branch : null,
    project: typeof project === "string" ? project : null,
    kind: kind === "folder" ? "folder" : "worktree"
  };
}

// src/worker/main.ts
var REFRESH_COMMAND_ID = "mattwf.refresh";
var OPEN_WORKSPACE_COMMAND_ID = "mattwf.open-workspace";
function activate(orca) {
  const log = createLog(orca);
  const run = createCommandRunner();
  const runBinary = createBinaryCommandRunner();
  const timer = createTimer();
  const now = () => Date.now();
  const files = createNodeWorkspaceFiles();
  const scope = createRepositoryScopeResolver({ run });
  const resolve2 = createBackendResolver({ run, runBinary, now, files, scope });
  const resolveFresh = createBackendResolver({ run, runBinary, now, files, cache: false });
  const store = createNodeSnapshotStore();
  void store.prune(now()).catch((error) => {
    log("warn", LOG_EVENTS.snapshot, {
      result: "error",
      reason: error instanceof Error ? error.message : String(error)
    });
  });
  const snapshot = createSnapshotService({ resolve: resolve2, scope, now, labels: TRACKER_LABELS, log, store });
  const ticket = createTicketService({ resolve: resolve2, scope, now, log, store });
  const worktree = createTicketWorktreeService({ resolve: resolve2, run, now, log });
  const avatar = createAvatarService();
  const envCheck = createEnvCheckService({
    resolve: resolveFresh,
    github: createGithubEnvProbe({ run }),
    gitlab: createGitlabEnvProbe({ run }),
    gitea: createGiteaEnvProbe({ run }),
    files: createNodeEnvFiles(),
    localIssues: createLocalIssuesProbe({ files }),
    skills: createSkillCatalog(),
    run,
    now,
    deadline: createProbeDeadline(timer, ENV_PROBE_TIMEOUT_MS),
    log
  });
  const workspace = createWorkspaceResolver(orca.host, orca.storage);
  registerRpcHandlers(orca, { snapshot, ticket, worktree, envCheck, workspace, avatar, log });
  orca.commands.register(REFRESH_COMMAND_ID, async () => {
    workspace.invalidate();
    const result = await refreshWorkspace(orca, { snapshot, workspace, log });
    orca.panels.post(SNAPSHOT_REFRESHED_EVENT, { result });
    return result;
  });
  orca.commands.register(OPEN_WORKSPACE_COMMAND_ID, async () => {
    const resolution = await workspace.resolve();
    if (resolution.status !== "resolved") {
      reportWorkspaceFailure(orca, resolution, log);
      return "\u8BA4\u4E0D\u5230\u5F53\u524D\u5DE5\u4F5C\u533A\uFF0C\u8BF7\u5728\u9762\u677F\u9876\u90E8\u9009\u4E00\u4E2A\u3002";
    }
    await orca.host.call("workspace.open", { workspaceId: resolution.candidate.id });
    return `\u5DF2\u5728 Orca \u91CC\u6253\u5F00 ${resolution.candidate.path}`;
  });
  orca.events.on("workspace.changed", () => {
    workspace.invalidate();
  });
}
async function refreshWorkspace(orca, deps) {
  const resolution = await deps.workspace.resolve();
  if (resolution.status !== "resolved") {
    reportWorkspaceFailure(orca, resolution, deps.log);
    return {
      ok: false,
      error: {
        code: ERROR_CODES.invalidParams,
        message: workspaceFailureMessage(resolution)
      }
    };
  }
  return await deps.snapshot.handle(RPC_METHODS.snapshotRefresh, {
    workspaceRoot: resolution.root,
    full: true
  });
}
export {
  activate as default,
  refreshWorkspace
};
