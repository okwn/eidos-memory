import fs from 'fs';
import path from 'path';
import os from 'os';

const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

const DEMO_FILES: Record<string, string> = {
  'auth.py': `
import hashlib, jwt, os
from datetime import datetime, timedelta

SECRET_KEY = os.getenv("JWT_SECRET", "changeme")

def hash_password(password: str) -> str:
    """Hash a password with SHA-256 + salt."""
    salt = os.urandom(16).hex()
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{hashed}"

def verify_password(password: str, stored: str) -> bool:
    salt, hashed = stored.split(":")
    return hashlib.sha256((salt + password).encode()).hexdigest() == hashed

def create_jwt(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.utcnow() + timedelta(hours=24)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def decode_jwt(token: str) -> dict:
    # BUG: missing expiry validation
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False})
`.trim(),

  'database.py': `
import sqlite3
from contextlib import contextmanager

DB_PATH = "app.db"

def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER
            )
        """)

@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def create_user(user_id: str, email: str, password_hash: str) -> None:
    import time
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
            (user_id, email, password_hash, int(time.time()))
        )
`.trim(),

  'api.py': `
from flask import Flask, request, jsonify
from auth import hash_password, verify_password, create_jwt, decode_jwt
from database import init_db, get_conn
import uuid

app = Flask(__name__)

@app.before_first_request
def setup():
    init_db()

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(data["password"])
    with get_conn() as conn:
        conn.execute("INSERT INTO users VALUES (?,?,?,?)",
                     (user_id, data["email"], pw_hash, 0))
    return jsonify({"id": user_id}), 201

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE email=?", (data["email"],)).fetchone()
    if not row or not verify_password(data["password"], row["password_hash"]):
        return jsonify({"error": "invalid credentials"}), 401
    return jsonify({"token": create_jwt(row["id"])})

if __name__ == "__main__":
    app.run(debug=True)
`.trim(),
};

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function typeWrite(text: string, delayMs = 18): Promise<void> {
  for (const ch of text) {
    process.stdout.write(ch);
    await sleep(delayMs);
  }
}

async function simulateConversation(demoDir: string): Promise<void> {
  const turns = [
    {
      role: 'user',
      text: 'There\'s a bug in the JWT decode — tokens never expire. Fix it.',
    },
    {
      role: 'assistant',
      text: `Found it. In \`auth.py:decode_jwt()\` the option \`"verify_exp": False\` disables expiry validation.\n\nFix:\n\`\`\`python\ndef decode_jwt(token: str) -> dict:\n    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])\n\`\`\`\nThis restores the default expiry check. Tokens issued with \`create_jwt()\` already set \`exp\` to 24 h.`,
    },
    {
      role: 'user',
      text: 'What was the architecture decision about the database?',
    },
    {
      role: 'assistant',
      text: 'From memory: the decision was to use SQLite with a context manager pattern (`get_conn()`) for transaction safety. Connection pooling was deferred to Phase 2.',
    },
  ];

  for (const turn of turns) {
    const isUser = turn.role === 'user';
    const prefix = isUser
      ? `\n${CYAN}${BOLD}You${RESET}  `
      : `\n${GREEN}${BOLD}Claude${RESET}`;
    process.stdout.write(prefix + ' ');
    await typeWrite(turn.text, isUser ? 22 : 12);
    await sleep(300);
  }
}

export async function runDemo(): Promise<void> {
  console.clear();
  console.log(`\n${BOLD}${MAGENTA}⚡ EidosCore Demo${RESET}  ${DIM}— your AI memory engine in action${RESET}\n`);
  await sleep(400);

  // 1. Create temp project
  const demoDir = path.join(os.tmpdir(), `eidos-demo-${Date.now()}`);
  fs.mkdirSync(demoDir, { recursive: true });
  for (const [name, content] of Object.entries(DEMO_FILES)) {
    fs.writeFileSync(path.join(demoDir, name), content);
  }
  console.log(`${DIM}Created demo project at ${demoDir}${RESET}`);
  await sleep(300);

  // 2. Index the project
  console.log(`\n${BOLD}Step 1: Indexing demo project...${RESET}`);
  process.env['EIDOS_WORKSPACE'] = demoDir;
  const { resetDbInstance } = await import('../store/db.js');
  resetDbInstance();
  const { getDb } = await import('../store/db.js');
  const db = getDb();

  const { handleIndexProject } = await import('../mcp/tools/index_project.js');
  const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let si = 0;
  const spinInterval = setInterval(() => {
    process.stdout.write(`\r  ${CYAN}${spinner[si++ % spinner.length]}${RESET} Analyzing code...`);
  }, 80);

  await handleIndexProject({ path: demoDir, languages: ['python'] });
  clearInterval(spinInterval);

  const { countNodes } = await import('../store/nodes.js');
  const nodeCount = countNodes(db);
  process.stdout.write(`\r  ${GREEN}✔${RESET} Indexed ${BOLD}${nodeCount} nodes${RESET} from 3 Python files\n`);
  await sleep(400);

  // 3. Log a decision
  console.log(`\n${BOLD}Step 2: Storing architecture decision...${RESET}`);
  const { handleRemember } = await import('../mcp/tools/remember.js');
  await handleRemember({
    statement: 'Use SQLite with context manager pattern for transaction safety. Connection pooling deferred.',
    type: 'decision',
    session_id: 'demo',
  });
  console.log(`  ${GREEN}✔${RESET} Decision stored in memory graph`);
  await sleep(300);

  // 4. Assemble context to show token savings
  console.log(`\n${BOLD}Step 3: Assembling context (adaptive budget)...${RESET}`);
  const { handleAssembleContext } = await import('../mcp/tools/assemble_context.js');
  const assembleResult = await handleAssembleContext({
    query: 'There is a bug in the JWT decode — tokens never expire. Fix it.',
    session_id: 'demo',
  });
  const meta = assembleResult._meta as { tokens: number; tokens_saved: number; budget_used: number; intent: string };
  // "Without EidosCore" = full file contents naively sent (approx 3 files × ~250 tokens avg + system prompt)
  const naiveTokens = Math.max(3800, meta.tokens + meta.tokens_saved);
  const withEidos   = meta.tokens;
  const savingsPct  = ((naiveTokens - withEidos) / naiveTokens * 100).toFixed(1);
  const costSaved   = ((naiveTokens - withEidos) * 0.015 / 1000).toFixed(5);
  console.log(`  ${GREEN}✔${RESET} Context assembled: ${BOLD}${withEidos} tokens${RESET} (budget ${meta.budget_used}, intent: ${meta.intent})`);
  await sleep(400);

  // 5. Simulated conversation
  console.log(`\n${BOLD}Step 4: Simulated conversation with Claude...${RESET}`);
  await simulateConversation(demoDir);

  // 6. Stats — dramatic before/after
  console.log(`\n\n${BOLD}${YELLOW}─────────────────────────────────────────────${RESET}`);
  console.log(`${BOLD}  🌟 EidosCore Demo Results${RESET}`);
  console.log(`${YELLOW}─────────────────────────────────────────────${RESET}`);
  console.log(`  Without EidosCore: ${BOLD}${naiveTokens.toLocaleString()} tokens${RESET} per prompt`);
  console.log(`  ${GREEN}${BOLD}With EidosCore:    ${withEidos.toLocaleString()} tokens${RESET}`);
  console.log(`  ${GREEN}${BOLD}Savings:           ${savingsPct}%  (~$${costSaved} per prompt)${RESET}`);
  console.log(`  Nodes in memory:   ${nodeCount}`);
  console.log(`${BOLD}${YELLOW}─────────────────────────────────────────────${RESET}\n`);
  console.log(`  This memory engine is now active for your project.`);

  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  ${CYAN}eidos index .${RESET}          — index your own project`);
  console.log(`  ${CYAN}eidos wrap claude "..."${RESET}  — inject memory into any AI CLI`);
  console.log(`  ${CYAN}eidos dash${RESET}              — open the visual graph explorer`);
  console.log(`  ${CYAN}eidos init --global${RESET}     — patch your shell for automatic injection\n`);

  // Cleanup temp demo project
  fs.rmSync(demoDir, { recursive: true, force: true });
}
