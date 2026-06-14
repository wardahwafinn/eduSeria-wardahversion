// src/db.js
// Unified data-access layer with two drivers:
//   - "sqlite": Node's built-in SQLite (local development / quick demo)
//   - "mssql" : Azure SQL Database (production deployment, matches Q1 design)
//
// Route code is written once using "?" placeholders. This module translates
// the SQL and parameters to whichever driver is active, so the rest of the
// application does not need to know which database it is talking to.

require('dotenv').config();

const DB_CLIENT = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

let driver; // set by init()

/* ------------------------------------------------------------------ */
/*  SQLite driver (local) — uses node:sqlite, no native build needed  */
/* ------------------------------------------------------------------ */
function createSqliteDriver() {
  const { DatabaseSync } = require('node:sqlite');
  const path = require('path');
  const file = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    name: 'sqlite',
    // SELECT -> rows
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    // INSERT/UPDATE/DELETE -> { changes, lastID }
    run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastID: Number(info.lastInsertRowid) };
    },
    exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Azure SQL driver (production) — uses the mssql package            */
/* ------------------------------------------------------------------ */
function createMssqlDriver() {
  const sql = require('mssql');
  const config = {
    server: process.env.AZURE_SQL_SERVER, // e.g. eduseria-sql.database.windows.net
    database: process.env.AZURE_SQL_DATABASE, // e.g. eduseria_lms
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    port: Number(process.env.AZURE_SQL_PORT || 1433),
    options: {
      encrypt: true, // required for Azure SQL
      trustServerCertificate: false,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };

  let pool;
  async function getPool() {
    if (!pool) pool = await sql.connect(config);
    return pool;
  }

  // Convert "?" placeholders into @p0, @p1, ... and bind params.
  function buildRequest(request, params) {
    params.forEach((value, i) => request.input(`p${i}`, value));
  }
  function rewrite(text) {
    let i = 0;
    return text.replace(/\?/g, () => `@p${i++}`);
  }

  return {
    name: 'mssql',
    async all(text, params = []) {
      const p = await getPool();
      const request = p.request();
      buildRequest(request, params);
      const result = await request.query(rewrite(text));
      return result.recordset || [];
    },
    async run(text, params = []) {
      const p = await getPool();
      const request = p.request();
      buildRequest(request, params);
      // For INSERTs, append a query to return the new identity value.
      const isInsert = /^\s*insert/i.test(text);
      const finalSql = isInsert
        ? `${rewrite(text)}; SELECT CAST(SCOPE_IDENTITY() AS INT) AS lastID;`
        : rewrite(text);
      const result = await request.query(finalSql);
      const lastID = isInsert && result.recordset && result.recordset[0]
        ? result.recordset[0].lastID
        : undefined;
      return { changes: result.rowsAffected[0] || 0, lastID };
    },
    async exec(text) {
      const p = await getPool();
      await p.request().query(text);
    },
    async close() {
      if (pool) await pool.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Oracle Autonomous Database driver (production, OCI Free Tier)      */
/*  Uses node-oracledb Thin mode (pure JS) + mTLS wallet.             */
/* ------------------------------------------------------------------ */
function createOracleDriver() {
  const oracledb = require('oracledb');
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = true; // simple, fine for a prototype

  const config = {
    user: process.env.ORACLE_USER, // e.g. ADMIN
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING, // tns alias, e.g. eduseriadb_tp
    configDir: process.env.ORACLE_WALLET_DIR, // folder with tnsnames.ora
    walletLocation: process.env.ORACLE_WALLET_DIR, // folder with ewallet.pem
    walletPassword: process.env.ORACLE_WALLET_PASSWORD,
    poolMin: 0,
    poolMax: 4,
    poolIncrement: 1,
  };

  let pool;
  async function getPool() {
    if (!pool) pool = await oracledb.createPool(config);
    return pool;
  }

  // "?" -> ":b1, :b2, ..."  and build a matching named-bind object.
  function rewrite(text) { let i = 0; return text.replace(/\?/g, () => `:b${++i}`); }
  function binds(params) { const o = {}; params.forEach((v, i) => { o[`b${i + 1}`] = v; }); return o; }
  // Oracle returns UPPERCASE column names; lower them so the app sees educator_id etc.
  function lower(rows) {
    return rows.map((r) => { const o = {}; for (const k in r) o[k.toLowerCase()] = r[k]; return o; });
  }

  return {
    name: 'oracle',
    async all(text, params = []) {
      const conn = await (await getPool()).getConnection();
      try {
        const res = await conn.execute(rewrite(text), binds(params));
        return lower(res.rows || []);
      } finally { await conn.close(); }
    },
    async run(text, params = []) {
      const conn = await (await getPool()).getConnection();
      try {
        const isInsert = /^\s*insert/i.test(text);
        if (isInsert) {
          const b = binds(params);
          b.ret_id = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };
          const res = await conn.execute(`${rewrite(text)} RETURNING id INTO :ret_id`, b, { autoCommit: true });
          const lastID = res.outBinds && res.outBinds.ret_id ? res.outBinds.ret_id[0] : undefined;
          return { changes: res.rowsAffected || 0, lastID };
        }
        const res = await conn.execute(rewrite(text), binds(params), { autoCommit: true });
        return { changes: res.rowsAffected || 0 };
      } finally { await conn.close(); }
    },
    async exec(text) {
      const conn = await (await getPool()).getConnection();
      try { await conn.execute(text, [], { autoCommit: true }); }
      finally { await conn.close(); }
    },
    async close() { if (pool) await pool.close(0); },
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

// SQL expression for "now", per dialect (used for updated_at stamps).
function nowExpr() {
  if (DB_CLIENT === 'mssql') return 'SYSUTCDATETIME()';
  if (DB_CLIENT === 'oracle') return 'SYSTIMESTAMP';
  return "datetime('now')";
}
function getDriver() {
  if (!driver) throw new Error('Database not initialised. Call db.init() first.');
  return driver;
}

module.exports = {
  client: DB_CLIENT,

  nowExpr,

  async init() {
    if (DB_CLIENT === 'mssql') driver = createMssqlDriver();
    else if (DB_CLIENT === 'oracle') driver = createOracleDriver();
    else driver = createSqliteDriver();
    return driver;
  },

  // SELECT — always returns an array of row objects
  async all(sql, params = []) {
    return getDriver().all(sql, params);
  },

  // INSERT / UPDATE / DELETE — returns { changes, lastID }
  async run(sql, params = []) {
    return getDriver().run(sql, params);
  },

  // first row helper
  async get(sql, params = []) {
    const rows = await getDriver().all(sql, params);
    return rows[0] || null;
  },

  async exec(sql) {
    return getDriver().exec(sql);
  },

  async close() {
    if (driver) await driver.close();
  },
};
