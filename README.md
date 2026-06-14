# Edu Seria LMS — Prototype

**BCN3243 Cloud Computing Technology — Final Assessment, Question 2**

A working Learning Management System prototype for the Edu Seria case study. It implements
the architecture proposed in Question 1: a **Node.js / Express** application (deploys to
**Azure App Service**) backed by **Azure SQL Database**, with custom JWT authentication and
two roles — **Educator** and **Learner**.

| Q2 requirement | Where it is met |
|---|---|
| CRUD for course data | Create / Read / Update / Delete courses (`src/routes/courses.js`) |
| CRUD for user data | Register, read, update profile, delete account (`src/routes/users.js`, `auth.js`) |
| Authentication | Hashed passwords (bcrypt) + JWT (`src/auth.js`, `src/routes/auth.js`) |
| Authorization (2 roles) | Role-based access control middleware — Educator vs Learner |
| Database integration | Azure SQL Database in production, SQLite for local demo (`src/db.js`) |
| Cloud deployment | Azure App Service (steps below) |

---

## What each role can do

**Educator** — create, edit and delete their own courses; view registered learners; see who
is enrolled in each course.

**Learner** — browse all courses; enrol in and drop courses; view their own learning list.

Both — update their profile/password and delete their own account.

Role-based access is enforced on **every** API endpoint, not just hidden in the UI. For
example, a Learner calling the "create course" endpoint directly receives `403 Forbidden`.

---

## Run locally (5 minutes)

Requires **Node.js 22 or newer** (uses the built-in SQLite for the local demo — no database
install needed).

```bash
npm install
cp .env.example .env        # default DB_CLIENT=sqlite works out of the box
npm run setup               # creates tables + demo accounts
npm start                   # http://localhost:3000
```

Demo logins:

| Role | Email | Password |
|---|---|---|
| Educator | educator@eduseria.com | Educator123! |
| Learner | learner@eduseria.com | Learner123! |

You can also register a fresh account from the sign-up tab and pick either role.

---

## Project structure

```
eduseria-lms/
├── server.js              # Express entry point, wires up routes + static front-end
├── db/setup.js            # creates schema and seeds demo data (both databases)
├── src/
│   ├── db.js              # data-access layer: SQLite (local) OR Azure SQL (prod)
│   ├── auth.js            # JWT signing + authenticate + requireRole (RBAC)
│   └── routes/
│       ├── auth.js        # register, login, me
│       ├── courses.js     # course CRUD (educator-owned)
│       ├── users.js       # user CRUD (profile, list, delete)
│       └── enrollments.js # enrol / drop / view enrolments
└── public/                # front-end (HTML + CSS + vanilla JS)
```

The application is database-agnostic: switching `DB_CLIENT` between `sqlite` and `mssql`
in `.env` is the only change needed to move from the local demo to Azure SQL.

---

## Deploy to Azure (App Service + Azure SQL Database)

This mirrors the Question 1 architecture. You can do it from the Azure Portal or the CLI.

### 1. Create an Azure SQL Database

Azure Portal → **Create a resource → SQL Database**.

- Create a new server (note the **server name**, e.g. `eduseria-sql.database.windows.net`,
  and the admin login + password).
- Database name: `eduseria_lms`.
- Compute tier: **Serverless (General Purpose)** — auto-pauses when idle, matching the
  cost model in Question 1.
- After creation, open the server → **Networking** → tick
  *"Allow Azure services and resources to access this server"*, and add your own client IP
  so you can run the setup script.

### 2. Create the App Service

Azure Portal → **Create a resource → Web App**.

- Runtime stack: **Node 22 LTS**, Operating System: **Linux**.
- Pick a plan (the free F1 tier is fine for a demo).

### 3. Configure application settings

In the Web App → **Settings → Environment variables**, add:

| Name | Value |
|---|---|
| `DB_CLIENT` | `mssql` |
| `AZURE_SQL_SERVER` | `eduseria-sql.database.windows.net` |
| `AZURE_SQL_DATABASE` | `eduseria_lms` |
| `AZURE_SQL_USER` | your SQL admin login |
| `AZURE_SQL_PASSWORD` | your SQL admin password |
| `JWT_SECRET` | a long random string |

(`PORT` is provided by App Service automatically — do not set it.)

### 4. Initialise the database schema

From your machine, with the same values in a local `.env` (and `DB_CLIENT=mssql`):

```bash
npm install
npm run setup     # creates the tables and demo accounts in Azure SQL
```

### 5. Deploy the code

Easiest option — **VS Code Azure App Service extension**: right-click the Web App →
*Deploy to Web App* → select this folder.

Or with the Azure CLI:

```bash
az webapp up --name <your-app-name> --runtime "NODE:22-lts"
```

App Service runs `npm install` then `npm start` automatically. Once deployed, open
`https://<your-app-name>.azurewebsites.net`.

> **Tip for the demo / report:** the `GET /api/health` endpoint returns
> `{"status":"ok","db":"mssql"}` once it is talking to Azure SQL — a quick way to prove the
> compute + database integration is live.

---

## Deploy to Oracle Cloud (Compute VM + Autonomous Database)

This is the alternative deployment used for the prototype: a free OCI **Compute VM** runs the
Node app (compute), and a free **Oracle Autonomous Database** stores the data (database).

### 1. Create the Autonomous Database

OCI Console → hamburger menu → **Oracle Database → Autonomous Database** → **Create Autonomous Database**.

- Display name + database name: `eduseriadb`.
- Workload type: **Transaction Processing**.
- **Always Free**: toggle ON.
- Set the **ADMIN password** (write it down — this is `ORACLE_PASSWORD`).
- Network access: leave **Secure access from everywhere** (mTLS handles security).
- Create, and wait until status is **Available**.

### 2. Download the wallet

Open the database → **Database connection** → **Download wallet** → set a **wallet password**
(write it down — this is `ORACLE_WALLET_PASSWORD`) → download `Wallet_eduseriadb.zip`.

Unzip it into a `wallet/` folder. Open `tnsnames.ora` inside it and note a connect alias such as
`eduseriadb_tp` (that is `ORACLE_CONNECT_STRING`).

### 3. Configure `.env`

```
DB_CLIENT=oracle
ORACLE_USER=ADMIN
ORACLE_PASSWORD=<your ADMIN password>
ORACLE_CONNECT_STRING=eduseriadb_tp
ORACLE_WALLET_DIR=./wallet
ORACLE_WALLET_PASSWORD=<your wallet password>
```

You can now create the tables from your own machine:

```bash
npm install
npm run setup     # creates the schema + demo accounts in Autonomous Database
```

### 4. Create the Compute VM (compute tier)

OCI Console → **Compute → Instances → Create instance**.

- Image: **Canonical Ubuntu** (22.04 or later).
- Shape: an **Always Free-eligible** shape (e.g. `VM.Standard.E2.1.Micro`, or Ampere `A1.Flex`
  with 1 OCPU / 6 GB). If you get an "out of capacity" error, try a different availability domain.
- Networking: create a new VCN with a public subnet, and **assign a public IPv4**.
- Download the generated **SSH private key**.

Then open the app's port: VCN → your subnet's **Security List** → **Add Ingress Rule**:
Source `0.0.0.0/0`, IP protocol **TCP**, destination port **3000**.

### 5. Deploy the app to the VM

```bash
# from your machine — copy the project (with the wallet/ folder and .env) to the VM
scp -i your-key.pem -r eduseria-lms ubuntu@<vm-public-ip>:~/

# SSH in
ssh -i your-key.pem ubuntu@<vm-public-ip>

# on the VM: install Node 22, then run
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
cd eduseria-lms
npm install
npm run setup     # (skip if you already ran it from your machine)
# keep it running after logout:
sudo npm install -g pm2
pm2 start server.js --name eduseria
pm2 save
```

Open `http://<vm-public-ip>:3000` in your browser. `GET /api/health` should return
`{"status":"ok","db":"oracle"}`, proving the VM (compute) is talking to Autonomous Database.

> **Note:** the wallet folder and `.env` contain secrets — never commit them to GitHub
> (they are already in `.gitignore`). Copy them to the VM directly as shown above.

---

## Security notes (ties back to Question 1)

- Passwords are never stored in plain text — they are hashed with **bcrypt**.
- Sessions use signed **JWTs**; the token carries the role claim, verified on every request
  (zero-trust: every call is checked, nothing is trusted by default).
- **Least privilege** is enforced by `requireRole(...)` and per-resource ownership checks
  (an educator can only edit or delete their *own* courses).
- All Azure SQL connections use `encrypt: true` (TLS in transit).
