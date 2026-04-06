// engine.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { execSync } from 'child_process';

execSync('npx drizzle-kit push', { stdio: 'inherit' });

const app = express();
app.use(express.json());
const SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    req.caller = null;
    if (token) try { req.caller = jwt.verify(token, SECRET); } catch { }
    next();
});

async function loadModules() {
    const bust = `?t=${Date.now()}`;
    const schema = await import(pathToFileURL(resolve('src/database.js')) + bust);
    const { operations } = await import(pathToFileURL(resolve('src/operations.js')) + bust);
    return { db: schema.db, operations };
}

app.post('/api/:operation', async (req, res) => {
    try {
        const { db, operations } = await loadModules();
        const handler = operations[req.params.operation];
        if (!handler) return res.status(404).json({ ok: false, error: 'unknown operation' });
        const result = await handler({ input: req.body, caller: req.caller, db });
        res.json({ ok: true, data: result });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

app.listen(3000, () => console.log('Ready — all changes are picked up automatically'));