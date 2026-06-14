require('dotenv').config();
const oracledb = require('oracledb');

(async () => {
  try {
    const conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
      configDir: process.env.ORACLE_WALLET_DIR,
      walletLocation: process.env.ORACLE_WALLET_DIR,
      walletPassword: process.env.ORACLE_WALLET_PASSWORD,
    });
    console.log('✅ CONNECTED OK');
    const r = await conn.execute('select 1 as ok from dual');
    console.log(r.rows);
    await conn.close();
  } catch (e) {
    console.error('❌ REAL ERROR:', e.message);
  }
})();